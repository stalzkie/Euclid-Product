import { NextResponse, type NextRequest } from "next/server";
import { webhooks } from "@polar-sh/sdk/2027-01";
import { hasServiceRole } from "@/lib/supabase/server";
import { applySubscription, type SubscriptionState } from "@/server/billing";

/**
 * Polar's webhook. The only thing in the system allowed to move a workspace
 * between plans.
 *
 * Every subscription event is handled the same way, because they all carry the
 * same subscription object and differ only in why it was sent. Treating them
 * uniformly means a new event type Polar adds later cannot silently do nothing:
 * `subscription.updated` accompanies the lot and will apply the same state.
 */

/** The webhook signature covers the raw bytes, so the body must not be parsed first. */
export const dynamic = "force-dynamic";

const SUBSCRIPTION_EVENTS = new Set([
  "subscription.created",
  "subscription.active",
  "subscription.updated",
  "subscription.uncanceled",
  "subscription.cycled",
  "subscription.canceled",
  "subscription.past_due",
  "subscription.revoked",
  "subscription.paused",
  "subscription.resumed",
]);

export async function POST(request: NextRequest) {
  const secret = process.env.POLAR_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "No webhook secret configured" }, { status: 503 });
  }
  if (!hasServiceRole()) {
    return NextResponse.json({ error: "No service role configured" }, { status: 503 });
  }

  const body = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  let event;
  try {
    // Verifies the signature before we look at a single field. An unsigned
    // request reaching this route is someone trying to grant themselves Pro.
    event = await webhooks.validateEvent(body, headers, secret);
  } catch {
    return NextResponse.json({ error: "Bad signature" }, { status: 403 });
  }

  if (!SUBSCRIPTION_EVENTS.has(event.type)) {
    // Orders, refunds and benefit grants all arrive here too. Entitlement is
    // derived from the subscription alone, so the rest are acknowledged and
    // dropped — a non-2xx would make Polar retry them forever.
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  const sub = event.data as {
    id: string;
    customer_id: string;
    product_id: string;
    status: string;
    current_period_end: string | null;
    metadata?: Record<string, unknown> | null;
  };

  const workspaceId = sub.metadata?.workspace_id;
  const state: SubscriptionState = {
    subscriptionId: sub.id,
    customerId: sub.customer_id,
    productId: sub.product_id,
    status: sub.status,
    currentPeriodEnd: sub.current_period_end,
    workspaceId: typeof workspaceId === "string" ? workspaceId : null,
  };

  const result = await applySubscription(state);
  if (!result.ok) {
    // 422 rather than 500: the request was well formed and correctly signed,
    // we simply cannot place it. Polar will retry, which is the right outcome
    // if the workspace row is merely a moment behind the checkout — and the
    // delivery stays visible in Polar's dashboard if it is not.
    console.error(`[billing] ${event.type}: ${result.error}`);
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  return NextResponse.json({ ok: true, plan: result.plan });
}
