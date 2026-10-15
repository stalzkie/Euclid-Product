import { createPolar } from "@polar-sh/sdk/2027-01";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  isEntitled,
  planForProduct,
  polarServer,
  topupForProduct,
  type TopupKind,
} from "@/lib/polar";
import { commissionFor } from "@/lib/referrals";
import type { PlanTier } from "@/lib/types";

/**
 * The Polar side of billing: one client, and the single function that turns a
 * subscription into a workspace's plan.
 *
 * Everything here runs with the service role and no user session — the webhook
 * is called by Polar, not by a browser — so nothing in this file may trust an
 * id that arrived in a request body without first tying it back to a row we
 * already own.
 */

let client: ReturnType<typeof createPolar> | null = null;

export function polar() {
  const accessToken = process.env.POLAR_ACCESS_TOKEN;
  if (!accessToken) throw new Error("POLAR_ACCESS_TOKEN is not set");
  // Cached across invocations in the same lambda. The client is a thin wrapper
  // over fetch, so this is about avoiding the construction, not a connection.
  client ??= createPolar({ accessToken, environment: polarServer() });
  return client;
}

/** What a webhook told us about one paid order, narrowed to what we need. */
export interface OrderState {
  orderId: string;
  customerId: string;
  productId: string;
  /** `workspace_id` as set in the checkout's metadata, when it survived. */
  workspaceId: string | null;
}

/**
 * Apply a one-time top-up purchase.
 *
 * The same shape as `applySubscription` and for the same reasons: the pack is
 * derived from the product id alone and an unknown id grants nothing, the
 * workspace is found by the routes we already trust, and the write goes
 * through a definer function granted to `service_role` only.
 *
 * The one thing this has that subscriptions do not is an explicit idempotency
 * key. A plan is a state — applying it three times leaves the same plan, which
 * is why the retries during testing did no harm. A top-up is an increment, so
 * the same three retries would be three times the credit. `apply_topup` keys
 * on the Polar order id and tells us whether it granted or recognised a
 * replay.
 */
export async function applyTopup(
  state: OrderState,
): Promise<
  | { ok: true; workspace: string; kind: TopupKind; quantity: number; granted: boolean }
  | { ok: false; error: string }
> {
  const pack = topupForProduct(state.productId);
  if (!pack) {
    return { ok: false, error: `Unknown Polar product ${state.productId}` };
  }

  const workspace = await workspaceForSubscription({
    subscriptionId: "",
    customerId: state.customerId,
    productId: state.productId,
    status: "",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    workspaceId: state.workspaceId,
  });
  if (!workspace) {
    return { ok: false, error: `No workspace for order ${state.orderId}` };
  }

  const db = supabaseAdmin();
  const { data, error } = await db.rpc("apply_topup", {
    p_workspace: workspace,
    p_order_id: state.orderId,
    p_kind: pack.kind,
    p_quantity: pack.quantity,
  });

  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    workspace,
    kind: pack.kind,
    quantity: pack.quantity,
    granted: data === true,
  };
}

/**
 * Reverse a top-up because Polar reported its order refunded.
 *
 * Keyed on the order id alone: the ledger already knows which workspace it
 * credited and with what, so nothing here has to re-derive entitlement from a
 * product id. An order we never granted for — a refunded subscription
 * invoice, say — is not an error, it simply has no ledger row.
 *
 * Partial refunds are treated as full reversals. A top-up is a single
 * indivisible pack, so there is no sensible fraction of one to give back, and
 * erring towards the customer's money rather than ours is the right way round.
 */
export async function reverseTopup(
  orderId: string,
): Promise<{ ok: true; reversed: boolean } | { ok: false; error: string }> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("reverse_topup", { p_order_id: orderId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, reversed: data === true };
}

/** What a webhook told us about one subscription, narrowed to what we store. */
export interface SubscriptionState {
  subscriptionId: string;
  customerId: string;
  productId: string;
  status: string;
  currentPeriodEnd: string | null;
  /**
   * Polar's `cancel_at_period_end`. Cancelling does not change `status` — the
   * plan keeps running to the end of the period it is paid for — so this is
   * the only field that says a subscription is on its way out.
   */
  cancelAtPeriodEnd: boolean;
  /** `workspace_id` as set in the checkout's metadata, when it survived. */
  workspaceId: string | null;
}

/**
 * Read a Polar subscription payload into the shape this module applies.
 *
 * Lives here rather than inline in the webhook route so it can be tested
 * against a real captured payload. The fields it picks out are a deliberately
 * small subset: Polar sends the customer, product, price, discount and a
 * nested copy of each, none of which this app trusts over the product id.
 *
 * `cancel_at_period_end` is the field worth being careful with. It arrived
 * with API version 2027-01 and is absent on older ones, so anything that is
 * not literally `true` means "not cancelled" — an absent field must not read
 * as cancelled, which would drop a paying workspace's plan on the next event.
 */
export function subscriptionStateFrom(payload: unknown): SubscriptionState {
  const sub = (payload ?? {}) as {
    id?: unknown;
    customer_id?: unknown;
    product_id?: unknown;
    status?: unknown;
    current_period_end?: unknown;
    cancel_at_period_end?: unknown;
    metadata?: Record<string, unknown> | null;
  };

  const str = (value: unknown): string => (typeof value === "string" ? value : "");
  const workspaceId = sub.metadata?.workspace_id;

  return {
    subscriptionId: str(sub.id),
    customerId: str(sub.customer_id),
    productId: str(sub.product_id),
    status: str(sub.status),
    currentPeriodEnd: typeof sub.current_period_end === "string" ? sub.current_period_end : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end === true,
    workspaceId: typeof workspaceId === "string" ? workspaceId : null,
  };
}

/**
 * Find the workspace a subscription belongs to.
 *
 * Three paths, in order of how much we trust them:
 *
 * 1. The `workspace_id` written into the checkout metadata by our own checkout
 *    route. Authoritative for a first subscription, because nothing else links
 *    the two yet.
 * 2. The subscription id, for a workspace we have already seen.
 * 3. The customer id, which covers a founder who cancelled and resubscribed —
 *    new subscription, same Polar customer.
 *
 * Returns null rather than guessing. A subscription we cannot place is a
 * subscription we must not act on: granting Pro to the wrong workspace is
 * worse than a webhook that has to be replayed.
 */
export async function workspaceForSubscription(state: SubscriptionState): Promise<string | null> {
  const db = supabaseAdmin();

  if (state.workspaceId) {
    const { data } = await db
      .from("workspaces")
      .select("id")
      .eq("id", state.workspaceId)
      .maybeSingle();
    if (data) return data.id as string;
  }

  for (const [column, value] of [
    ["polar_subscription_id", state.subscriptionId],
    ["polar_customer_id", state.customerId],
  ] as const) {
    // An empty id matches a row whose column is an empty string rather than
    // null, which would hand someone else's workspace the credit. A one-time
    // order has no subscription id at all, so this is reached on every
    // top-up — the same blank-is-not-absent trap `planForProduct` guards.
    if (!value) continue;
    const { data } = await db.from("workspaces").select("id").eq(column, value).maybeSingle();
    if (data) return data.id as string;
  }

  return null;
}

/**
 * Apply a subscription state to its workspace.
 *
 * The tier comes from the product id and nothing else. Polar is the authority
 * on what was paid for, and an unrecognised product means this deployment is
 * pointed at an organisation it does not know — which is a configuration error
 * to be shouted about, not a reason to pick a tier.
 */
export async function applySubscription(
  state: SubscriptionState,
): Promise<{ ok: true; workspace: string; plan: PlanTier } | { ok: false; error: string }> {
  const workspace = await workspaceForSubscription(state);
  if (!workspace) {
    return { ok: false, error: `No workspace for subscription ${state.subscriptionId}` };
  }

  const mapped = planForProduct(state.productId);
  if (!mapped) {
    return { ok: false, error: `Unknown Polar product ${state.productId}` };
  }

  // An ended subscription drops the workspace to free; anything still entitled
  // keeps the tier it paid for. `isEntitled` is where `past_due` is decided.
  const entitled = isEntitled(state.status);
  const plan: PlanTier = entitled ? mapped.tier : "free";

  const db = supabaseAdmin();
  const { error } = await db.rpc("apply_subscription", {
    p_workspace: workspace,
    p_plan: plan,
    p_period: mapped.period,
    p_customer_id: state.customerId,
    p_subscription_id: state.subscriptionId,
    p_status: state.status,
    p_period_end: state.currentPeriodEnd,
    p_cancel_at_period_end: state.cancelAtPeriodEnd,
  });

  return error ? { ok: false, error: error.message } : { ok: true, workspace, plan };
}

/* --------------------------------------------------------------------------
 * Referral commissions
 *
 * Paid in Build Prompts rather than money, because Polar is the merchant of
 * record: payments land in Euclid's balance and Polar pays out to Euclid
 * alone. See `supabase/migrations/0020_referrals.sql` for the whole argument.
 *
 * Shaped exactly like the top-up pair above, including the "granted or
 * recognised a replay" return, because they face the same problem: Polar
 * retries until it gets a 2xx and sent three events for one state change
 * during testing, so the same order arriving twice is expected.
 * ------------------------------------------------------------------------ */

/**
 * Credit the referrer of this workspace for one paid order.
 *
 * Runs for every paid order, not only top-ups: a subscription renewal is the
 * case that matters most, since it is the one that recurs. An order from a
 * workspace nobody referred is the common case and is not an error.
 */
export async function applyReferralCommission(args: {
  orderId: string;
  customerId: string;
  workspaceId: string | null;
  netCents: number;
}): Promise<{ ok: true; granted: boolean; quantity: number } | { ok: false; error: string }> {
  const quantity = commissionFor(args.netCents);

  // A $0 trial invoice earns nothing, and finding out costs a round trip.
  if (quantity <= 0) return { ok: true, granted: false, quantity: 0 };

  /*
    Resolve the buyer the same way a top-up does, rather than trusting the
    order's metadata alone.

    A checkout sets `workspace_id` and it reaches the first order. Whether a
    *renewal* order carries it forward is Polar's business and not something
    this depends on — and renewals are exactly the orders that recur, so a
    commission that only ever fired on the first invoice would look like it
    worked and quietly be worth a twelfth of what it should be. The customer
    id is already stored on the workspace and is the durable link.
  */
  const workspace = await workspaceForSubscription({
    subscriptionId: "",
    customerId: args.customerId,
    productId: "",
    status: "",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    workspaceId: args.workspaceId,
  });

  if (!workspace) return { ok: true, granted: false, quantity: 0 };

  const { data, error } = await supabaseAdmin().rpc("grant_referral_commission", {
    p_referred: workspace,
    p_order_id: args.orderId,
    p_quantity: quantity,
    p_order_cents: args.netCents,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, granted: data === true, quantity };
}

/**
 * Take a commission back because the order behind it was refunded.
 *
 * An order that never earned one is not an error — most orders have no
 * referrer — so this reports "nothing to reverse" the way `reverseTopup`
 * does rather than failing a webhook Polar would then retry.
 */
export async function reverseReferralCommission(
  orderId: string,
): Promise<{ ok: true; reversed: boolean } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin().rpc("reverse_referral_commission", {
    p_order_id: orderId,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, reversed: data === true };
}
