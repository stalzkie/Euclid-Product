import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixture, db, destroyFixture, stackIsUp, type Fixture } from "./setup";

/**
 * The delivery pipeline, against the real database and the real job endpoint.
 *
 * The success path needs a live Slack or Discord webhook, which a test suite
 * has no business owning, so what is covered here is everything around it:
 * who gets queued, that the queue is actually drained, and that a webhook
 * which does not answer is retried, backed off, and eventually switched off
 * rather than retried forever.
 */

const CRON = process.env.CRON_SECRET ?? "";
const APP = process.env.TEST_APP_URL ?? "http://localhost:3000";

// Top level, not in beforeAll: whether to skip has to be known while the
// suite is being collected.
const up = await stackIsUp();
const suite = up ? describe : describe.skip;

let fixture: Fixture;

async function connect(kind: string, url: string, events: string[]) {
  const [row] = await db.insert<{ id: string }>("integrations", {
    board_id: fixture.boardId,
    kind,
    config: { webhook_url: url },
    events,
    active: true,
  });
  return row.id;
}

async function deliveriesFor(integrationId: string) {
  return db.select<{
    id: string;
    attempts: number;
    delivered_at: string | null;
    last_error: string | null;
    deliver_after: string;
  }>(`integration_deliveries?select=*&integration_id=eq.${integrationId}`);
}

async function drain() {
  const response = await fetch(`${APP}/api/jobs/run`, {
    method: "POST",
    headers: { authorization: `Bearer ${CRON}` },
  });
  expect(response.status).toBe(200);
  return response.json();
}

suite("integration delivery", () => {
  beforeAll(async () => {
    fixture = await createFixture("integrations");
  });

  afterAll(async () => {
    if (fixture) await destroyFixture(fixture);
  });

  it("queues a post only for integrations subscribed to that event", async () => {
    // A webhook that resolves but never returns 2xx, so delivery fails
    // predictably without depending on anyone's chat workspace.
    const wants = await connect("slack", "https://hooks.slack.com/services/T0/B0/none", [
      "post.created",
    ]);
    const doesNot = await connect("discord", "https://discord.com/api/webhooks/0/none", [
      "post.status_changed",
    ]);

    try {
      const response = await fetch(`${APP}/api/public/post`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: APP },
        body: JSON.stringify({
          board: fixture.publicId,
          title: "Keyboard shortcuts for the editor",
          body: "A palette like the one in the sidebar.",
        }),
      });
      expect(response.status).toBe(200);

      expect(await deliveriesFor(wants)).toHaveLength(1);
      expect(await deliveriesFor(doesNot)).toHaveLength(0);
    } finally {
      await db.remove(`integrations?id=eq.${wants}`);
      await db.remove(`integrations?id=eq.${doesNot}`);
    }
  });

  it("records the failure and backs off rather than retrying at once", async () => {
    const id = await connect("slack", "https://hooks.slack.com/services/T0/B0/none", [
      "post.created",
    ]);

    try {
      await db.insert("integration_deliveries", {
        integration_id: id,
        event: "post.created",
        payload: {
          number: 1,
          title: "Test",
          status: "under_review",
          votes: 1,
          url: `${APP}/b/${fixture.publicId}`,
          boardName: "Testbed",
        },
      });

      await drain();

      const [delivery] = await deliveriesFor(id);
      expect(delivery.attempts).toBe(1);
      expect(delivery.delivered_at).toBeNull();
      expect(delivery.last_error).toBeTruthy();

      // Backed off into the future, so the next drain does not hammer it.
      expect(new Date(delivery.deliver_after).getTime()).toBeGreaterThan(Date.now());

      const [integration] = await db.select<{ last_error: string | null; active: boolean }>(
        `integrations?select=last_error,active&id=eq.${id}`,
      );
      expect(integration.last_error).toBeTruthy();
      // One failure is not grounds for switching the integration off.
      expect(integration.active).toBe(true);
    } finally {
      await db.remove(`integrations?id=eq.${id}`);
    }
  });

  it("switches off a webhook that has failed too many times", async () => {
    const id = await connect("slack", "https://hooks.slack.com/services/T0/B0/none", [
      "post.created",
    ]);

    try {
      await db.insert("integration_deliveries", {
        integration_id: id,
        event: "post.created",
        // One below the limit: the claim bumps it to the limit, the attempt
        // fails, and that is the try that gives up. A row already at the
        // limit is never claimed, so it could not reach this state.
        attempts: 4,
        // deliver_after is left to the database default. Computing "now"
        // here would depend on this machine's clock agreeing with the
        // database's, and on this machine they are two minutes apart.
        payload: {
          number: 1,
          title: "Test",
          status: "under_review",
          votes: 1,
          url: `${APP}/b/${fixture.publicId}`,
          boardName: "Testbed",
        },
      });

      await drain();

      const [integration] = await db.select<{ active: boolean }>(
        `integrations?select=active&id=eq.${id}`,
      );
      expect(integration.active).toBe(false);
    } finally {
      await db.remove(`integrations?id=eq.${id}`);
    }
  });

  it("leaves a delivery alone until it is due", async () => {
    const id = await connect("slack", "https://hooks.slack.com/services/T0/B0/none", [
      "post.created",
    ]);

    try {
      await db.insert("integration_deliveries", {
        integration_id: id,
        event: "post.created",
        // Far enough out that clock skew between here and the database
        // cannot make it look due.
        deliver_after: new Date(Date.now() + 3_600_000).toISOString(),
        payload: {
          number: 1,
          title: "Test",
          status: "under_review",
          votes: 1,
          url: `${APP}/b/${fixture.publicId}`,
          boardName: "Testbed",
        },
      });

      await drain();

      const [delivery] = await deliveriesFor(id);
      expect(delivery.attempts).toBe(0);
    } finally {
      await db.remove(`integrations?id=eq.${id}`);
    }
  });

  it("does not queue anything for an integration that is switched off", async () => {
    const id = await connect("slack", "https://hooks.slack.com/services/T0/B0/none", [
      "post.created",
    ]);
    await db.patch(`integrations?id=eq.${id}`, { active: false });

    try {
      await fetch(`${APP}/api/public/post`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: APP },
        body: JSON.stringify({
          board: fixture.publicId,
          title: "Bulk edit for tags across entries",
          body: "Select several and retag in one go.",
        }),
      });

      expect(await deliveriesFor(id)).toHaveLength(0);
    } finally {
      await db.remove(`integrations?id=eq.${id}`);
    }
  });
});
