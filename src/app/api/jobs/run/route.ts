import { NextResponse, type NextRequest } from "next/server";
import { hasServiceRole, supabaseAdmin } from "@/lib/supabase/server";
import { remindExpiringTrials, sendQueuedEmails } from "@/server/jobs";
import { deliverIntegrationEvents } from "@/server/integrations";
import { authorizeCron } from "@/server/cron";
import { topUpPartnerPool } from "@/server/partner";
import { appOrigin } from "@/lib/origin";

/**
 * The queue drain. Anything slow or expensive — emails, embeddings backfill,
 * clustering, the weekly digest — runs here rather than on a board read.
 *
 * Point a scheduler at this with the CRON_SECRET in an Authorization header.
 */
/** A backlog of email and webhooks takes longer than the default ceiling. */
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const auth = authorizeCron(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!hasServiceRole()) {
    return NextResponse.json({ error: "No service role configured" }, { status: 503 });
  }

  // Queue before draining, so a reminder that becomes due on this pass goes
  // out on this pass rather than waiting a day for the next one. A trial has
  // seven of them; losing one to ordering would be a quarter of the warning.
  const trials = await remindExpiringTrials(await appOrigin());

  const emails = await sendQueuedEmails(50);
  const integrations = await deliverIntegrationEvents(20);

  // Expired magic links are dropped rather than left to accumulate.
  const db = supabaseAdmin();
  await db.from("magic_links").delete().lt("expires_at", new Date().toISOString());

  // Old rate limit rows, which used to be swept by check_rate_limit itself on
  // every single vote, post and comment — a full table scan per request, and
  // an invisible 24-hour ceiling on every window. It belongs on a schedule;
  // see 0023_rate_limits.sql.
  const { data: pruned } = await db.rpc("prune_rate_limits");

  // Faults that were dealt with and have not recurred in a month. Unresolved
  // ones are kept however old — an old unresolved fault is a thing still
  // broken, not a thing to tidy away.
  const { data: prunedErrors } = await db.rpc("prune_error_events");

  // Install diagnoses nobody has looked at in a month. Unlike an unresolved
  // error these are safe to forget: either the install happened and the
  // screen stopped asking, or the founder is long gone. See 0031.
  const { data: prunedSignals } = await db.rpc("prune_install_signals");

  /*
    Refill the Bernn promo-code pool.

    Here rather than anywhere nearer the purchase, deliberately: minting is
    always ahead of demand and never during it, so a Bernn outage can never
    affect a Polar webhook. Unconfigured is the normal case and reports
    itself rather than failing — see topUpPartnerPool.
  */
  const partner = await topUpPartnerPool();
  if (!partner.ok && partner.reason !== "not configured") {
    console.error(`[jobs] partner pool top-up: ${partner.reason}`);
  }

  return NextResponse.json({
    ok: true,
    emails,
    integrations,
    trials,
    pruned: pruned ?? 0,
    prunedErrors: prunedErrors ?? 0,
    prunedSignals: prunedSignals ?? 0,
    partner,
  });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
