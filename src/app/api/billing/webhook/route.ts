import { NextResponse, after, type NextRequest } from "next/server";
import { webhooks } from "@polar-sh/sdk/2027-01";
import { hasServiceRole } from "@/lib/supabase/server";
import {
  applyReferralCommission,
  applySubscription,
  applyTopup,
  claimPartnerCode,
  partnerPoolStatus,
  reverseReferralCommission,
  reverseTopup,
  subscriptionStateFrom,
} from "@/server/billing";
import { orderAmountCents } from "@/lib/referrals";
import { INDIE3 } from "@/lib/polar";
import { sendPartnerCode, topUpPartnerPool, warnPartnerPoolLow } from "@/server/partner";
import { drainAfterResponse } from "@/server/dispatch";
import { sendQueuedEmails } from "@/server/jobs";

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

  /*
    The partner half of the 4-for-3 promotion.

    Granted on the first order with money in it rather than after the third,
    which is the trade the promotion is built on: a month of Bernn costs
    infrastructure rather than cash, so the hook is worth more than the
    protection waiting would buy. `orderAmountCents > 0` is what skips a
    trial's $0 invoice — the same guard the commission above relies on.

    `metadata.promo` is set by our own checkout route and only when the
    discount actually applied, so this cannot be triggered by a founder adding
    ?promo= to a URL.
  */
  if (buyer && order.metadata?.promo === INDIE3 && orderAmountCents(order) > 0) {
    const claim = await claimPartnerCode({ workspaceId: buyer, orderId: order.id });

    if (!claim.ok) {
      console.error(`[billing] ${event.type}: partner code: ${claim.error}`);
      return NextResponse.json({ error: claim.error }, { status: 422 });
    }

    // A replay. The grant already stands and the founder already has the
    // email; doing nothing is the whole of the correct behaviour here.
    if (!claim.granted) {
      console.info(`[billing] partner code already granted to ${buyer}`);
    } else if (claim.owed) {
      // Not an error to Polar: the payment was fine and the obligation is
      // recorded. It is an error to us, and the only way anyone finds out.
      console.error(`[billing] partner pool empty — ${buyer} is owed a code`);
      await warnPartnerPoolLow(await partnerPoolStatus());

      /*
        Try to refill now rather than leaving them owed until tomorrow.

        In `after()`, which is what keeps the rule intact: this runs once the
        200 is on the wire, so Bernn being slow or down cannot delay Polar's
        webhook or turn it into a retry. The founder who just paid gets their
        code in seconds instead of a day, and nothing about the payment path
        depends on that working.

        The cron does the same thing on a schedule. This is the impatient
        version for the case that actually hurts, not a replacement for it —
        Euclid's cron is daily.
      */
      after(async () => {
        const top = await topUpPartnerPool();
        if (top.ok && top.filled > 0) {
          console.info(`[billing] pool refilled, settled ${top.filled} owed`);
          /*
            Drained inline rather than through `drainAfterResponse`.

            A settled grant queues the founder's code email, and this is
            already running inside an after-response callback — the drain
            scheduled further down may well have run before this did, so
            scheduling another one risks the email waiting for the daily cron.
            Sending here is what the cron route does and is strictly more
            immediate than deferring again.
          */
          await sendQueuedEmails(20);
        } else if (!top.ok && top.reason !== "not configured") {
          console.error(`[billing] pool refill failed: ${top.reason}`);
        }
      });
    } else if (claim.code) {
      await sendPartnerCode(buyer, claim.code);
    }

    /*
      Send it as soon as this response is out rather than leaving it for the
      daily cron.

      The founder has just paid and been redirected to the billing page; a
      code that arrives tomorrow reads as a promise half kept. Same reasoning
      as the magic link and the student verification, and the same mechanism —
      `tests/unit/outbox-drain.test.ts` is what insists on it, and it caught
      this file queueing without draining.

      Deliveries are off: nothing here enqueues an integration event, and
      draining that queue on a billing webhook would be work for another
      board's benefit on a request that is not theirs.
    */
    drainAfterResponse({ deliveries: false });
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
