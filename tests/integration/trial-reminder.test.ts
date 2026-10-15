import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SUPABASE_URL, dbHeaders, db, stackIsUp } from "./setup";

/**
 * The "your trial is ending" reminder.
 *
 * Worth an integration test rather than a unit one because the part that can
 * be wrong is a query, and a query against a mock proves nothing. Too wide a
 * window and real founders get a warning about a trial that has weeks to run;
 * too narrow and nobody is warned at all, which is the situation this job
 * exists to fix.
 *
 * The rows below are built directly rather than through `createFixture`: this
 * needs several workspaces in specific billing states, and none of them need a
 * board or a post.
 */

const APP = process.env.TEST_APP_URL ?? "http://localhost:3000";
const CRON = process.env.CRON_SECRET ?? "";

const up = await stackIsUp();
const suite = up && CRON ? describe : describe.skip;

interface Workspace {
  id: string;
  name: string;
}

const made: string[] = [];
const users: string[] = [];

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

/** A real auth user, because the job reads the owner's address from auth. */
async function createUser(email: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: dbHeaders,
    body: JSON.stringify({ email, email_confirm: true }),
  });
  const body = (await res.json()) as { id?: string; msg?: string };
  if (!body.id) throw new Error(`could not create ${email}: ${JSON.stringify(body)}`);
  users.push(body.id);
  return body.id;
}

/** A workspace in a given billing state, with an owner who has a mailbox. */
async function trialWorkspace(
  label: string,
  billing: Record<string, unknown>,
): Promise<Workspace> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const [workspace] = await db.insert<Workspace>("workspaces", {
    name: `Trial ${label} ${suffix}`,
    slug: `itest-trial-${label}-${suffix}`,
    plan: "indie",
    polar_subscription_id: `sub_${suffix}`,
    ...billing,
  });
  if (!workspace) throw new Error(`could not create the ${label} workspace`);
  made.push(workspace.id);

  const userId = await createUser(`trial-${label}-${suffix}@euclid-itest.com`);
  await db.insert("workspace_members", {
    workspace_id: workspace.id,
    user_id: userId,
    role: "owner",
    name: `Owner ${label}`,
  });

  return workspace;
}

async function runJobs(): Promise<{ trials?: { queued: number; skipped: number } }> {
  const res = await fetch(`${APP}/api/jobs/run`, {
    method: "POST",
    headers: { authorization: `Bearer ${CRON}` },
  });
  return (await res.json()) as { trials?: { queued: number; skipped: number } };
}

async function remindersFor(workspaceName: string) {
  // The subject carries the workspace name, which is unique per run, so this
  // finds this test's mail and nobody else's.
  const rows = await db.select<{ to_email: string; subject: string; body: string }>(
    `email_outbox?kind=eq.trial_ending&select=to_email,subject,body`,
  );
  return rows.filter((row) => row.body.includes(workspaceName));
}

let ending: Workspace;
let distant: Workspace;
let cancelled: Workspace;
let expired: Workspace;

suite("trial reminders", () => {
  beforeAll(async () => {
    // Inside the 48-hour window: the only one that should be reminded.
    ending = await trialWorkspace("ending", {
      subscription_status: "trialing",
      cancel_at_period_end: false,
      current_period_end: hoursFromNow(20),
    });

    // A week out. A reminder here lands while they are still setting up.
    distant = await trialWorkspace("distant", {
      subscription_status: "trialing",
      cancel_at_period_end: false,
      current_period_end: hoursFromNow(24 * 7),
    });

    // Already cancelled. They know; telling them to add a card to keep a plan
    // they just ended would be arguing with their decision.
    cancelled = await trialWorkspace("cancelled", {
      subscription_status: "trialing",
      cancel_at_period_end: true,
      current_period_end: hoursFromNow(20),
    });

    // Already over. Warning about something that has happened is noise.
    expired = await trialWorkspace("expired", {
      subscription_status: "trialing",
      cancel_at_period_end: false,
      current_period_end: hoursFromNow(-2),
    });

    await runJobs();
  });

  afterAll(async () => {
    for (const id of made) await db.remove(`workspaces?id=eq.${id}`);
    for (const id of users) {
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
        method: "DELETE",
        headers: dbHeaders,
      });
    }
  });

  it("reminds a trial inside the window, once", async () => {
    const mail = await remindersFor(ending.name);
    expect(mail).toHaveLength(1);

    // The address came from auth, not from any column on the workspace.
    expect(mail[0].to_email).toContain("trial-ending-");
    // The body has to carry the way out, or it is just bad news.
    expect(mail[0].body).toContain("/billing");

    const [row] = await db.select<{ trial_reminder_sent_at: string | null }>(
      `workspaces?id=eq.${ending.id}&select=trial_reminder_sent_at`,
    );
    expect(row.trial_reminder_sent_at).not.toBeNull();
  });

  it("does not remind twice", async () => {
    await runJobs();
    await runJobs();
    expect(await remindersFor(ending.name)).toHaveLength(1);
  });

  it.each([
    ["a trial that is still a week away", () => distant],
    ["a trial the founder has already cancelled", () => cancelled],
    ["a trial that has already ended", () => expired],
  ])("does not remind %s", async (_label, pick) => {
    expect(await remindersFor(pick().name)).toHaveLength(0);
  });

  it("clears the flag when a new subscription starts", async () => {
    // A second trial on a new subscription has to be reminded again, so
    // apply_subscription drops the flag whenever the subscription id moves.
    await db.rpc("apply_subscription", {
      p_workspace: ending.id,
      p_plan: "indie",
      p_period: "monthly",
      p_customer_id: "cus_itest",
      p_subscription_id: `sub_second_${Date.now()}`,
      p_status: "trialing",
      p_period_end: hoursFromNow(24 * 7),
      p_cancel_at_period_end: false,
    });

    const [row] = await db.select<{ trial_reminder_sent_at: string | null }>(
      `workspaces?id=eq.${ending.id}&select=trial_reminder_sent_at`,
    );
    expect(row.trial_reminder_sent_at).toBeNull();
  });
});
