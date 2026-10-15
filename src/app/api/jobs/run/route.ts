import { NextResponse, type NextRequest } from "next/server";
import { hasServiceRole, supabaseAdmin } from "@/lib/supabase/server";
import { remindExpiringTrials, sendQueuedEmails } from "@/server/jobs";
import { deliverIntegrationEvents } from "@/server/integrations";
import { authorizeCron } from "@/server/cron";
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

  return NextResponse.json({ ok: true, emails, integrations, trials });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
