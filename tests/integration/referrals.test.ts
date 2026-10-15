import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, stackIsUp } from "./setup";

/**
 * The referral ledger, against a real database.
 *
 * The arithmetic is unit-tested; this is about the three things only Postgres
 * can answer. Does a commission survive the same order arriving twice, which
 * Polar guarantees will happen. Does a refund take it back without driving a
 * balance negative. And can a workspace earn from itself — which is the one
 * that would be found by a stranger rather than by us.
 */

const up = await stackIsUp();
const suite = up ? describe : describe.skip;

interface Workspace {
  id: string;
  name: string;
}

const made: string[] = [];

async function workspace(label: string): Promise<Workspace> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const [row] = await db.insert<Workspace>("workspaces", {
    name: `Ref ${label} ${suffix}`,
    slug: `itest-ref-${label}-${suffix}`,
    plan: "free",
  });
  if (!row) throw new Error(`could not create the ${label} workspace`);
  made.push(row.id);
  return row;
}

async function extraPrompts(id: string): Promise<number> {
  const [row] = await db.select<{ extra_prompts: number }>(
    `workspaces?id=eq.${id}&select=extra_prompts`,
  );
  return row?.extra_prompts ?? 0;
}

/** Mints a code the way the action does, but as the service role. */
async function codeFor(id: string, base: string): Promise<string> {
  const [row] = await db.insert<{ code: string }>("referral_codes", {
    code: `${base}-${Math.random().toString(36).slice(2, 6)}`,
    workspace_id: id,
  });
  if (!row) throw new Error("could not mint a code");
  return row.code;
}

let referrer: Workspace;
let referred: Workspace;
let code: string;

suite("referral commissions", () => {
  beforeAll(async () => {
    referrer = await workspace("referrer");
    referred = await workspace("referred");
    code = await codeFor(referrer.id, "itest");
    await db.patch(`workspaces?id=eq.${referred.id}`, {
      referred_by: code,
      referred_at: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    for (const id of made) await db.remove(`workspaces?id=eq.${id}`);
  });

  it("credits the referrer when the referred workspace pays", async () => {
    const before = await extraPrompts(referrer.id);

    const granted = await db.rpc<boolean>("grant_referral_commission", {
      p_referred: referred.id,
      p_order_id: "itest_order_first",
      p_quantity: 48,
      p_order_cents: 1200,
    });

    expect(granted).toBe(true);
    expect(await extraPrompts(referrer.id)).toBe(before + 48);
  });

  it("ignores the same order arriving again", async () => {
    // Polar retries until it gets a 2xx and sent three events for one state
    // change during testing, so this is the expected case, not an edge one.
    const before = await extraPrompts(referrer.id);

    const again = await db.rpc<boolean>("grant_referral_commission", {
      p_referred: referred.id,
      p_order_id: "itest_order_first",
      p_quantity: 48,
      p_order_cents: 1200,
    });

    expect(again).toBe(false);
    expect(await extraPrompts(referrer.id)).toBe(before);
  });

  it("takes the credit back when the order is refunded", async () => {
    const before = await extraPrompts(referrer.id);

    const reversed = await db.rpc<boolean>("reverse_referral_commission", {
      p_order_id: "itest_order_first",
    });

    expect(reversed).toBe(true);
    expect(await extraPrompts(referrer.id)).toBe(before - 48);

    // And the ledger row survives, marked, rather than disappearing.
    const [row] = await db.select<{ reversed_at: string | null }>(
      `referral_commissions?polar_order_id=eq.itest_order_first&select=reversed_at`,
    );
    expect(row?.reversed_at).not.toBeNull();
  });

  it("ignores a refund arriving twice", async () => {
    const before = await extraPrompts(referrer.id);
    const again = await db.rpc<boolean>("reverse_referral_commission", {
      p_order_id: "itest_order_first",
    });

    expect(again).toBe(false);
    expect(await extraPrompts(referrer.id)).toBe(before);
  });

  it("floors a reversal at zero rather than going negative", async () => {
    // The referrer has spent what they earned. Taking the balance negative
    // would hold their next commission hostage to somebody else's refund.
    await db.patch(`workspaces?id=eq.${referrer.id}`, { extra_prompts: 10 });

    await db.rpc<boolean>("grant_referral_commission", {
      p_referred: referred.id,
      p_order_id: "itest_order_spent",
      p_quantity: 48,
      p_order_cents: 1200,
    });
    await db.patch(`workspaces?id=eq.${referrer.id}`, { extra_prompts: 5 });

    await db.rpc<boolean>("reverse_referral_commission", {
      p_order_id: "itest_order_spent",
    });

    expect(await extraPrompts(referrer.id)).toBe(0);
  });

  it("pays nobody when the workspace was not referred", async () => {
    const stranger = await workspace("stranger");
    const granted = await db.rpc<boolean>("grant_referral_commission", {
      p_referred: stranger.id,
      p_order_id: "itest_order_stranger",
      p_quantity: 48,
      p_order_cents: 1200,
    });

    expect(granted).toBe(false);
    const rows = await db.select(
      `referral_commissions?polar_order_id=eq.itest_order_stranger`,
    );
    expect(rows).toHaveLength(0);
  });

  it("refuses to let a workspace earn from itself", async () => {
    // The code's owner is also the buyer. Worth refusing in the database
    // rather than only in the app: this is the one somebody would go looking
    // for, and a referral code is a string anybody can type.
    const selfish = await workspace("selfish");
    const own = await codeFor(selfish.id, "self");
    await db.patch(`workspaces?id=eq.${selfish.id}`, { referred_by: own });

    const granted = await db.rpc<boolean>("grant_referral_commission", {
      p_referred: selfish.id,
      p_order_id: "itest_order_self",
      p_quantity: 48,
      p_order_cents: 1200,
    });

    expect(granted).toBe(false);
    expect(await extraPrompts(selfish.id)).toBe(0);
  });
});

suite("referral attribution", () => {
  it("attaches an unknown code to nothing, without refusing the workspace", async () => {
    // create_workspace needs a signed-in caller, so the rule is checked where
    // it is enforced: the foreign key. An unknown code cannot be stored, and
    // the app passes it through `normaliseCode` and lets the function drop it.
    const orphan = await workspace("orphan");
    const res = await db.patchRaw(`workspaces?id=eq.${orphan.id}`, {
      referred_by: "no-such-code-here",
    });

    expect(res.ok).toBe(false);
    const [row] = await db.select<{ referred_by: string | null }>(
      `workspaces?id=eq.${orphan.id}&select=referred_by`,
    );
    expect(row.referred_by).toBeNull();
  });
});
