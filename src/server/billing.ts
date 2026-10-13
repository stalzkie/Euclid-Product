import { createPolar } from "@polar-sh/sdk/2027-01";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  isEntitled,
  planForProduct,
  polarServer,
  topupForProduct,
  type TopupKind,
} from "@/lib/polar";
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

/** What a webhook told us about one subscription, narrowed to what we store. */
export interface SubscriptionState {
  subscriptionId: string;
  customerId: string;
  productId: string;
  status: string;
  currentPeriodEnd: string | null;
  /** `workspace_id` as set in the checkout's metadata, when it survived. */
  workspaceId: string | null;
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
  });

  return error ? { ok: false, error: error.message } : { ok: true, workspace, plan };
}
