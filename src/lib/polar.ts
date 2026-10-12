import type { PlanTier } from "./types";

/**
 * The map between Euclid's plans and Polar's products.
 *
 * Polar gives a product one billing interval, so the three tiers in
 * `plans.ts` become four paid products — Indie and Pro, monthly and yearly.
 * Free is not a product: it is the absence of a subscription.
 *
 * The ids live in the environment rather than in this file because they differ
 * between the sandbox and the production organisation, and a build that hard
 * coded them would sell the wrong thing in one of the two.
 */

export type BillingPeriod = "monthly" | "yearly";

/** A paid tier. `free` is excluded by construction — it cannot be bought. */
export type PaidTier = Exclude<PlanTier, "free">;

export interface PolarProduct {
  tier: PaidTier;
  period: BillingPeriod;
  env: string;
}

export const POLAR_PRODUCTS: PolarProduct[] = [
  { tier: "indie", period: "monthly", env: "POLAR_PRODUCT_INDIE_MONTHLY" },
  { tier: "indie", period: "yearly", env: "POLAR_PRODUCT_INDIE_YEARLY" },
  { tier: "pro", period: "monthly", env: "POLAR_PRODUCT_PRO_MONTHLY" },
  { tier: "pro", period: "yearly", env: "POLAR_PRODUCT_PRO_YEARLY" },
];

/**
 * Which Polar to talk to. Sandbox is the default on purpose: forgetting to set
 * this should route money nowhere, not to a live card.
 */
export function polarServer(): "sandbox" | "production" {
  return process.env.POLAR_SERVER === "production" ? "production" : "sandbox";
}

/** Whether billing is configured enough to offer a checkout at all. */
export function billingEnabled(): boolean {
  return Boolean(process.env.POLAR_ACCESS_TOKEN) && POLAR_PRODUCTS.every((p) => process.env[p.env]);
}

/** The product to send a founder to for a given tier and period. */
export function productIdFor(tier: PaidTier, period: BillingPeriod): string | null {
  const match = POLAR_PRODUCTS.find((p) => p.tier === tier && p.period === period);
  return (match && process.env[match.env]) || null;
}

/**
 * The reverse: what a Polar product id entitles a workspace to.
 *
 * The webhook needs this, and it must fail closed. An id we do not recognise
 * is not a reason to guess a tier — it means the environment is pointed at the
 * wrong organisation, or someone bought a product this deployment does not
 * know about, and either way granting Pro would be wrong.
 */
export function planForProduct(
  productId: string,
): { tier: PaidTier; period: BillingPeriod } | null {
  // An empty id matches nothing. Without this, a deployment whose `.env` has
  // `POLAR_PRODUCT_INDIE_MONTHLY=` — unset, but present, so the value is "" and
  // not undefined — would resolve an empty product id to Indie and grant a plan
  // nobody bought.
  if (!productId) return null;
  const match = POLAR_PRODUCTS.find((p) => process.env[p.env] === productId);
  return match ? { tier: match.tier, period: match.period } : null;
}

/**
 * The free trial, in days, as configured on the Polar products.
 *
 * Polar owns the trial — it is a per-product setting there, and the app has no
 * say in it. This variable exists only so the upgrade button can say "Start
 * your 7-day free trial" truthfully. Unset means the button makes no promise,
 * which is the right default: a deployment whose Polar products have no trial
 * must not advertise one.
 *
 * Deliberately not read from the Polar API. That would be a network call on
 * every render of the billing page to learn a number that changes once a year.
 */
export function trialDays(): number | null {
  const raw = Number(process.env.POLAR_TRIAL_DAYS);
  return Number.isInteger(raw) && raw > 0 ? raw : null;
}

/**
 * A discount applied automatically to every checkout — the launch promotion.
 *
 * Codes a customer types (a student discount, say) need nothing here: Polar
 * accepts those at the checkout page on its own. This is only for a discount
 * with no code, which has to be named when the checkout is created.
 *
 * Polar enforces the promotion's own `starts_at` / `ends_at` window, so an
 * expired id is refused there rather than silently discounting forever. That is
 * why this stays a plain id and carries no dates of its own — two places
 * holding the same deadline is one place to forget.
 */
export function autoDiscountId(): string | null {
  return process.env.POLAR_DISCOUNT_FIRST_PURCHASE || null;
}

/** The student discount. Codeless — applied by the server, never typed in. */
export function studentDiscountId(): string | null {
  return process.env.POLAR_DISCOUNT_STUDENT || null;
}

/**
 * Which discount a checkout should carry.
 *
 * Polar applies one discount per checkout, so this is a choice rather than a
 * sum. A verified student gets the student discount even though the launch
 * promotion may be larger on the first invoice: theirs is the one that keeps
 * applying, and quietly giving someone the worse long-term deal because it
 * looks bigger today is not a trade worth making on their behalf.
 */
export function discountForCheckout(studentVerified: boolean): string | null {
  return (studentVerified ? studentDiscountId() : null) ?? autoDiscountId();
}

/**
 * Polar subscription statuses that should keep a founder's paid features on.
 *
 * `past_due` is deliberately included. Polar retries a failed payment for
 * several days, and switching a workspace to free the moment a card expires
 * would take their boards offline over something their bank will most likely
 * resolve on its own. `revoked` and `canceled` are the statuses that actually
 * end entitlement, and Polar only sends those once the paid period is over.
 */
const ENTITLED = new Set(["active", "trialing", "past_due"]);

export function isEntitled(status: string | null | undefined): boolean {
  return Boolean(status && ENTITLED.has(status));
}
