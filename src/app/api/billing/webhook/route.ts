import { NextResponse, type NextRequest } from "next/server";
import { webhooks } from "@polar-sh/sdk/2027-01";
import { hasServiceRole } from "@/lib/supabase/server";
import {
  applyReferralCommission,
  applySubscription,
  applyTopup,
  reverseReferralCommission,
  reverseTopup,
  subscriptionStateFrom,
} from "@/server/billing";
import { orderAmountCents } from "@/lib/referrals";

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

/**
 * One-time purchases: the top-up packs, and giving them back.
 *
 * `order.paid` and nothing earlier. The other order events fire before the
 * money has settled, and a top-up is an increment rather than a state —
 * granting on `order.created` and again on `order.paid` would be two grants
 * for one purchase. `apply_topup` would catch that, since both carry the same
 * order id, but relying on the idempotency key to paper over a wrong event
 * choice is how the key ends up being the only thing holding it together.
 *
 * A subscription renewal also produces an order. That order's product is a
 * plan product, not a top-up pack, so `topupForProduct` returns null and this
 * grants nothing — which is why it fails closed on an unknown product rather
 * than guessing.
 *
 * Both of these must also be ticked on the Polar webhook endpoint itself. An
 * unsubscribed event is never sent at all, and the first top-up purchase
 * granted nothing for exactly that reason — the checkout completed, the card
 * was charged, and no request ever reached this route.
 */
const ORDER_EVENTS = new Set(["order.paid", "order.refunded"]);

/**
 * A refunded order gives back whatever it granted.
 *
 * Keyed on the order id, so an order that never granted anything -- a
 * refunded subscription invoice, for instance -- finds no ledger row and is
 * acknowledged without doing anything.
 */
async function handleRefund(event: { type: string; data: unknown }) {
  const order = event.data as { id: string };
  const result = await reverseTopup(order.id);

  if (!result.ok) {
    console.error(`[billing] ${event.type}: ${result.error}`);
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  /*
    A refund also takes back whatever the referrer earned for the order.

    This is the case the whole ledger exists for. A commission is granted the
    moment an order is paid, and an order can be refunded minutes later — one
    was, on 2026-10-15, five minutes after payment. Without this the referrer
    keeps credit for a sale that no longer exists.

    Reversed after the top-up and reported separately: the two are independent
    ledgers, and a failure in one must not hide a success in the other.
  */
  const commission = await reverseReferralCommission(order.id);
  if (!commission.ok) {
    console.error(`[billing] ${event.type}: commission: ${commission.error}`);
    return NextResponse.json({ error: commission.error }, { status: 422 });
  }

  console.info(
    `[billing] ${event.type}: ${result.reversed ? "reversed" : "nothing to reverse"} ` +
      `for order ${order.id}` +
      (commission.reversed ? " · commission reversed" : ""),
  );
  return NextResponse.json({
    ok: true,
    reversed: result.reversed,
    commissionReversed: commission.reversed,
  });
}

async function handleOrder(event: { type: string; data: unknown }) {
  // `product_id` is nullable on Polar's Order — an order assembled from line
  // items need not have a single product. A top-up always does, and an order
  // without one cannot be a pack, so it falls through to the unknown-product
  // branch below and is acknowledged rather than retried.
  const order = event.data as {
    id: string;
    customer_id: string;
    product_id: string | null;
    net_amount?: unknown;
    subtotal_amount?: unknown;
    discount_amount?: unknown;
    total_amount?: unknown;
    metadata?: Record<string, unknown> | null;
  };

  const workspaceId = order.metadata?.workspace_id;
  const buyer = typeof workspaceId === "string" ? workspaceId : null;

  /*
    The referrer's cut, before anything below can return early.

    A subscription renewal is not a top-up, so it falls through to the
    unknown-product branch and is acknowledged — which is correct for
    top-ups and would silently skip every recurring commission if this
    ran afterwards. Renewals are the ones that recur, so they are the ones
    worth getting right.
  */
  const commission = await applyReferralCommission({
    orderId: order.id,
    customerId: order.customer_id,
    workspaceId: buyer,
    netCents: orderAmountCents(order),
  });

  if (!commission.ok) {
    console.error(`[billing] ${event.type}: commission: ${commission.error}`);
    return NextResponse.json({ error: commission.error }, { status: 422 });
  }
  if (commission.granted) {
    console.info(
      `[billing] ${event.type}: ${commission.quantity} prompts to the referrer of ${buyer}`,
    );
  }

  const result = await applyTopup({
    orderId: order.id,
    customerId: order.customer_id,
    productId: order.product_id ?? "",
    workspaceId: buyer,
  });

  if (!result.ok) {
    // An order for a product that is not a top-up pack is the normal case for
    // a subscription renewal, and must not be retried forever.
    if (result.error.startsWith("Unknown Polar product")) {
      return NextResponse.json({
        ok: true,
        ignored: event.type,
        commission: commission.granted,
      });
    }
    console.error(`[billing] ${event.type}: ${result.error}`);
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  // `granted: false` is a replay Polar sent again because an earlier delivery
  // did not reach us. The ledger already holds it, so this is a success.
  console.info(
    `[billing] ${event.type}: ${result.granted ? "granted" : "already applied"} ` +
      `${result.quantity} ${result.kind} to ${result.workspace}`,
  );
  return NextResponse.json({
    ok: true,
    granted: result.granted,
    commission: commission.granted,
  });
}

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

  if (event.type === "order.refunded") {
    return handleRefund(event);
  }

  if (ORDER_EVENTS.has(event.type)) {
    return handleOrder(event);
  }

  if (!SUBSCRIPTION_EVENTS.has(event.type)) {
    // Refunds and benefit grants arrive here too. Entitlement is derived from
    // the subscription and the top-up ledger alone, so the rest are
    // acknowledged and dropped — a non-2xx would make Polar retry them
    // forever.
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  const state = subscriptionStateFrom(event.data);

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
