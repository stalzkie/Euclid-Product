import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { appOrigin } from "@/lib/origin";
import {
  PARTNER_CODE_SUBJECT,
  partnerCodeHtml,
  partnerCodeText,
} from "@/lib/emails/partner-code";
import { replyTo, signOff } from "@/lib/emails/sender";
import { partnerPoolStatus, fillPartnerGrants, BERNN } from "@/server/billing";

/**
 * The partner promotion's supply side: telling people about a code, and
 * keeping enough codes to hand out.
 *
 * The emails go through `email_outbox` rather than being sent inline. Their
 * caller is a Polar webhook, which has to answer quickly and must not fail
 * because a mail provider is slow — and the outbox already has the retry
 * schedule and the claim-once semantics from 0015_email_retry.
 *
 * The top-up at the bottom is the automated half of what
 * `scripts/import-partner-codes.mjs` does by hand. Both remain: the script is
 * what works when Bernn is unreachable, which is exactly when the pool is
 * most likely to need filling.
 */

/** Below this many spare codes, say so. */
const LOW_WATER = 10;

/**
 * How many spare codes to keep, and the most to ask for at once.
 *
 * The target is generous relative to the cap on the Polar discount, because
 * codes cost nothing to hold: an unused one is a row, and the only thing a
 * too-small pool buys is a founder who paid for a promotion and got half of
 * it. The per-request cap matches the ceiling Bernn enforces, so a request
 * this builds can never be refused for being too large.
 */
const POOL_TARGET = 50;
const MINT_CAP = 200;

/** What Euclid asks for. Bernn decides what it actually grants. */
const TRIAL_DAYS = 30;

/** How long to wait on Bernn before giving up and letting the pool drain. */
const MINT_TIMEOUT_MS = 15_000;

/** Where operational warnings go. Falls back to the sender address. */
function operatorAddress(): string | null {
  const explicit = process.env.STUDENT_REVIEW_EMAIL;
  if (explicit) return explicit;
  const from = process.env.EMAIL_FROM ?? "";
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from || null;
}

/**
 * Send a founder the Bernn code they just earned.
 *
 * Addressed to the workspace owner, because that is who went through
 * checkout. A workspace with several members does not get several codes — the
 * grant is one per workspace, and the billing page shows it to everyone who
 * can see billing anyway.
 */
export async function sendPartnerCode(workspaceId: string, code: string): Promise<void> {
  const db = supabaseAdmin();

  const { data: owner } = await db
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();

  if (!owner) {
    console.error(`[partner] no owner for ${workspaceId}; code ${code} not emailed`);
    return;
  }

  // The address lives in auth, not in our tables: workspace_members carries a
  // display name and nothing to write to.
  const { data: user } = await db.auth.admin.getUserById(owner.user_id as string);
  const email = user?.user?.email;
  if (!email) {
    console.error(`[partner] no address for owner of ${workspaceId}`);
    return;
  }

  const origin = await appOrigin();
  const content = {
    code,
    billingUrl: `${origin}/billing`,
    recipient: email,
    signOff: signOff(),
    origin,
  };

  await db.from("email_outbox").insert({
    to_email: email,
    subject: PARTNER_CODE_SUBJECT,
    body: partnerCodeText(content),
    html: partnerCodeHtml(content),
    reply_to: replyTo(),
    kind: "partner_code",
  });
}

/**
 * Warn when the pool is nearly out, or already is.
 *
 * Deliberately noisy at zero: a workspace owed a code is a promise made and
 * not kept, and the only reason anybody would notice is this email. Keyed on
 * nothing — the drain sends what is queued, and a repeated warning while the
 * pool is empty is the correct amount of nagging.
 */
export async function warnPartnerPoolLow(
  status: { available: number; owed: number } | null,
): Promise<void> {
  if (!status) return;
  if (status.available > LOW_WATER && status.owed === 0) return;

  const to = operatorAddress();
  if (!to) return;

  await supabaseAdmin()
    .from("email_outbox")
    .insert({
      to_email: to,
      subject:
        status.available === 0
          ? `Euclid: Bernn promo codes exhausted (${status.owed} owed)`
          : `Euclid: Bernn promo codes running low (${status.available} left)`,
      body: [
        `Codes available: ${status.available}`,
        `Workspaces owed:  ${status.owed}`,
        "",
        process.env.BERNN_MINT_URL
          ? "Automatic top-up is configured, so this may already have fixed itself on the next run. If it has not, Bernn is unreachable or refusing — mint by hand:"
          : "Mint more in the Bernn repo:",
        "",
        "    cd apps/api",
        "    node --env-file=.env scripts/create-promo-code.mjs \\",
        "      --trial-days 30 --note euclid-indie3 --count 50",
        "",
        "Then load them into Euclid:",
        "",
        "    node scripts/import-partner-codes.mjs codes.txt",
        "",
        "Anyone owed a code is given one automatically as soon as the pool",
        "has them — nothing has to be replayed.",
      ].join("\n"),
      kind: "partner_pool",
    });
}

/* --------------------------------------------------------------------------
 * Keeping the pool stocked
 *
 * Minting is always ahead of demand and never during it. The webhook claims
 * from inventory; this fills inventory back up on the schedule. That ordering
 * is the whole reason there is a pool at all -- see 0025_partner_promo.sql.
 * ------------------------------------------------------------------------ */

/**
 * How many codes to ask for, given what is in the pool and who is waiting.
 *
 * Pure, so the arithmetic that decides whether to call another service at all
 * can be tested without one. `owed` is added rather than ignored because a
 * workspace waiting on a code is demand that has already happened: topping up
 * to the target without covering them would leave them owed through the next
 * cycle too.
 */
export function codesToMint(
  status: { available: number; owed: number },
  target = POOL_TARGET,
  cap = MINT_CAP,
): number {
  const want = target - status.available + status.owed;
  return want <= 0 ? 0 : Math.min(want, cap);
}

/** What Bernn returns. Validated rather than trusted -- it is another service. */
const MintResponse = z.object({
  codes: z.array(z.string().min(1)).min(1),
  // Bernn is the authority on how long the trial is. Euclid stores what comes
  // back, not what it asked for: if the two ever drift, the billing page would
  // promise a month while Bernn granted a week.
  trial_days: z.number().int().positive(),
});

export type TopUpResult =
  | { ok: true; minted: number; filled: number; available: number }
  | { ok: false; reason: string };

/**
 * Ask Bernn for enough codes to refill the pool, then settle anyone owed one.
 *
 * Returns rather than throws on every failure, because both callers are
 * background work: the scheduled job, and an `after()` on a webhook that has
 * already answered. Neither has anywhere useful to put an exception, and
 * neither should fail because a partner service is down -- the pool drains,
 * the low-water email fires, and `scripts/import-partner-codes.mjs` is still
 * there to do it by hand.
 */
export async function topUpPartnerPool(partner = BERNN): Promise<TopUpResult> {
  const url = process.env.BERNN_MINT_URL;
  const token = process.env.BERNN_MINT_TOKEN;
  // Unconfigured is not an error. It means the manual path is the path, the
  // same way billingEnabled() means plan changes happen without a card.
  if (!url || !token) return { ok: false, reason: "not configured" };

  const status = await partnerPoolStatus(partner);
  if (!status) return { ok: false, reason: "could not read pool status" };

  const count = codesToMint(status);
  if (count === 0) {
    return { ok: true, minted: 0, filled: 0, available: status.available };
  }

  let payload: z.infer<typeof MintResponse>;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        // Raw secret, not Bearer-prefixed: it matches how Bernn's own
        // RevenueCat webhook compares the header.
        authorization: token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ count, trial_days: TRIAL_DAYS, note: "euclid-indie3" }),
      signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
    });

    if (!res.ok) {
      return { ok: false, reason: `bernn returned ${res.status}` };
    }
    payload = MintResponse.parse(await res.json());
  } catch (err) {
    // A timeout here may still have minted on Bernn's side. Those codes are
    // never handed out and so can never be redeemed; the `note` on them makes
    // them identifiable. Over-minting is the harmless direction, which is why
    // none of this needs an idempotency key.
    return { ok: false, reason: err instanceof Error ? err.message : "mint failed" };
  }

  const db = supabaseAdmin();
  const { data: inserted, error } = await db
    .from("partner_codes")
    // A code already in the pool may already belong to somebody, so a
    // collision is skipped rather than merged -- rewriting its row would be a
    // way to quietly change what a founder was promised.
    .upsert(
      payload.codes.map((code) => ({
        code,
        partner,
        trial_days: payload.trial_days,
      })),
      { onConflict: "code", ignoreDuplicates: true },
    )
    .select("code");

  if (error) return { ok: false, reason: error.message };

  /*
    Settle anyone who qualified while the pool was empty — and tell them.

    The owed workspaces are read *before* filling because `fill_partner_grants`
    returns a count rather than the rows it touched, and the alternative was
    changing its signature in a migration that is already being applied.

    Emailing matters more here than it looks. A founder in this group paid,
    was told their code was coming, and would otherwise be the only one who
    never gets a message about it — the code would appear on their billing
    page and nowhere else, which is a worse experience than the one everybody
    who bought when the pool was healthy gets.
  */
  const { data: waiting } = await db
    .from("partner_grants")
    .select("workspace_id")
    .eq("partner", partner)
    .is("code", null);

  const filled = await fillPartnerGrants(partner);

  if (filled > 0 && waiting?.length) {
    const { data: settled } = await db
      .from("partner_grants")
      .select("workspace_id,code")
      .eq("partner", partner)
      .in("workspace_id", waiting.map((row) => row.workspace_id as string))
      .not("code", "is", null);

    for (const grant of settled ?? []) {
      await sendPartnerCode(grant.workspace_id as string, grant.code as string);
    }
  }

  // Re-read rather than computing from the numbers above: codes skipped as
  // duplicates and grants settled in parallel both make that arithmetic lie.
  const after = await partnerPoolStatus(partner);

  return {
    ok: true,
    minted: inserted?.length ?? 0,
    filled,
    available: after?.available ?? 0,
  };
}
