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

/* -------------------------------------------------------------------------- */
/* Top-ups                                                                    */
/* -------------------------------------------------------------------------- */

/** What a top-up pack adds to. Matches the two metered things in `plans.ts`. */
export type TopupKind = "prompts" | "credits";

export interface TopupPack {
  id: string;
  kind: TopupKind;
  /** How many Build Prompts or chat credits the pack grants. */
  quantity: number;
  label: string;
  /** Display price. Polar holds the real one; this is for the button. */
  price: number;
  env: string;
  /** Tiers allowed to buy it. Credits are useless without the chat feature. */
  tiers: PaidTier[];
}

/**
 * One-time purchases that extend an allowance without changing the plan.
 *
 * These are ordinary Polar products rather than subscriptions, which is why
 * they arrive at the webhook as `order.*` and not `subscription.*`. The
 * quantities live here and not in Polar because the webhook has to know what
 * an order grants, and reading it back from the product metadata would make
 * entitlement depend on a field anybody with dashboard access can edit.
 *
 * Purchased balance never expires — see `Allowance` in `plans.ts`.
 */
export const TOPUP_PACKS: TopupPack[] = [
  {
    id: "prompts_50",
    kind: "prompts",
    quantity: 50,
    label: "50 Build Prompts",
    price: 5,
    env: "POLAR_TOPUP_PROMPTS_50",
    // Indie's allowance is the one that actually runs out, and Build Prompts
    // are the feature it is sold on.
    tiers: ["indie", "pro"],
  },
  {
    id: "prompts_200",
    kind: "prompts",
    quantity: 200,
    label: "200 Build Prompts",
    price: 15,
    env: "POLAR_TOPUP_PROMPTS_200",
    tiers: ["indie", "pro"],
  },
  {
    id: "credits_250",
    kind: "credits",
    quantity: 250,
    label: "250 chat credits",
    price: 5,
    env: "POLAR_TOPUP_CREDITS_250",
    // Pro only. Indie has `chatAssistant: false`, so credits bought there
    // would be unspendable — and Ask Euclid is the reason to upgrade.
    tiers: ["pro"],
  },
  {
    id: "credits_1000",
    kind: "credits",
    quantity: 1000,
    label: "1,000 chat credits",
    price: 15,
    env: "POLAR_TOPUP_CREDITS_1000",
    tiers: ["pro"],
  },
];

/** The configured product id for a pack, or null when it is not for sale. */
export function topupProductId(pack: TopupPack): string | null {
  return process.env[pack.env] || null;
}

/** Packs this deployment can actually sell to this tier. */
export function availableTopups(tier: PaidTier): TopupPack[] {
  return TOPUP_PACKS.filter((p) => p.tiers.includes(tier) && topupProductId(p));
}

export function topupById(id: string): TopupPack | null {
  return TOPUP_PACKS.find((p) => p.id === id) ?? null;
}

/**
 * What a purchased Polar product grants, by product id.
 *
 * Fails closed exactly like `planForProduct`, and for the same reason: an
 * order for a product this deployment does not recognise must grant nothing
 * rather than be guessed at. The empty-string guard matters here too — a
 * blank `POLAR_TOPUP_*` would otherwise match an empty product id.
 */
export function topupForProduct(productId: string): TopupPack | null {
  if (!productId) return null;
  return TOPUP_PACKS.find((p) => topupProductId(p) === productId) ?? null;
}

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

/* -------------------------------------------------------------------------- */
/* The promotions                                                             */
/* -------------------------------------------------------------------------- */

/** "Four months for the price of three." The launch promotion. */
export const INDIE3 = "indie3";

/** "Your first month is on us." The freebie owed to the waitlist. */
export const WAITLIST = "waitlist";

/**
 * Every promotion, by the slug that appears in a `?promo=` link, in the
 * cookie, and in the checkout's metadata.
 *
 * There was one of these as a plain constant, and the cost of the second
 * promotion turned out not to be the discount but the five places that each
 * tested `=== INDIE3` and would all have had to learn the new slug
 * separately. The webhook is the reason that matters: `metadata.promo ===
 * INDIE3` is what grants a Bernn code, and a waitlist order must not trigger
 * it. A table makes "which promotion is this" a lookup rather than a
 * condition somebody forgets to extend.
 *
 *   `env`      - the environment variable holding the Polar discount id.
 *   `waitlist` - whether the buyer's address has to be on the waitlist. The
 *                launch promotion is open to anyone holding the link and is
 *                bounded by `max_redemptions`; a free month is not something
 *                to hand to whoever forwards the URL, so this one is checked
 *                against `waitlist_signups` on the server.
 */
const PROMOS = {
  [INDIE3]: { env: "POLAR_DISCOUNT_INDIE3", waitlist: false },
  [WAITLIST]: { env: "POLAR_DISCOUNT_WAITLIST", waitlist: true },
} as const;

export type Promo = keyof typeof PROMOS;

/** Every slug, for the query-string schema in the checkout route. */
export const PROMO_SLUGS = [INDIE3, WAITLIST] as const;

/**
 * The cookie a `?promo=` lands in, and how long it is honoured for.
 *
 * The promotion needs this for the same reason referrals do, and the lesson
 * was learned there first: the link points at a page, the page bounces a
 * signed-out visitor to `/signup`, and a parameter that lives only in the URL
 * is gone by the time anybody could act on it. See the capture in
 * `middleware.ts`, which writes both.
 *
 * Thirty days rather than the referral cookie's ninety. This one has to
 * survive signing up, a seven-day trial and a weekend of thinking about it —
 * not a bookmark opened next quarter — and the promotion itself will be over
 * long before the cookie is.
 */
export const PROMO_COOKIE = "euclid_promo";
export const PROMO_COOKIE_DAYS = 30;

/**
 * Whether an arriving `?promo=` should replace the cookie already held.
 *
 * A different promotion overwrites; the same one does not.
 *
 * Both halves are load-bearing and they were learned in the opposite order.
 * Not overwriting came first, borrowed from the referral cookie, and the
 * reason given was that re-writing on every visit would quietly extend the
 * window for anyone who keeps clicking the same link — true, and still the
 * reason the second half exists.
 *
 * The first half is the correction. With one promotion, "do not overwrite"
 * and "do not extend" were the same sentence. With two they are not: a
 * founder who had clicked a 4-for-3 link within the last thirty days opened
 * their waitlist e-mail, arrived with `?promo=waitlist`, and was shown the
 * launch offer, because the cookie still said `indie3`. The e-mail promised
 * a month at zero and the page offered 25% off. Which promise to keep is not
 * a close question: it is the one they were just sent.
 *
 * Note this is not attribution. Referrals keep first-write-wins because
 * somebody is owed a commission there and a later link must not take it; a
 * promotion owes nobody anything except the founder reading it.
 */
export function shouldWritePromo(
  existing: string | null | undefined,
  incoming: Promo,
): boolean {
  return existing !== incoming;
}

/**
 * The promotion named by a `?promo=` value, or null.
 *
 * A lookup in `PROMOS` rather than a comparison: a slug that is not in the
 * table is not a promotion whose name we failed to recognise, it is a typo or
 * someone guessing. Null rather than a thrown error — a bad `?promo=` should
 * sell the plan at list price, not fail the request.
 */
export function normalisePromo(raw: string | null | undefined): Promo | null {
  const slug = raw?.trim().toLowerCase();
  return slug && slug in PROMOS ? (slug as Promo) : null;
}

/**
 * A repeating discount: 25% off for four months, on Indie Monthly.
 *
 * $9 x 4 is $36, which is four months for the price of three. It is expressed
 * as an even discount rather than three paid months and a free one because
 * Polar cannot express the latter: a subscription's interval is day, week,
 * month or year, and a repeating discount applies the same percentage every
 * period. Four at 25% is the same money and the same promise in the shape
 * Polar can bill, and it leaves the subscription renewing normally at $12
 * afterwards rather than ending.
 *
 * Configure it in Polar with `duration: repeating`, `duration_in_months: 4`,
 * `products: [Indie Monthly]` and a `max_redemptions` cap — the cap is the
 * only thing bounding what the promotion can cost.
 */
export function promoDiscountId(promo: Promo = INDIE3): string | null {
  return process.env[PROMOS[promo].env] || null;
}

/**
 * Whether this promotion is only for people on the waitlist.
 *
 * The check itself is not here. This file reads environment variables and
 * does arithmetic; it does not touch the database, which is what keeps it
 * testable without one. `onWaitlist` in `server/waitlist.ts` answers the
 * question, and the checkout route is where the two meet.
 */
export function promoRequiresWaitlist(promo: Promo): boolean {
  return PROMOS[promo].waitlist;
}

/**
 * The free month the waitlist was promised.
 *
 * One month at -100% on Indie Monthly, after which the subscription renews at
 * list price rather than ending. Configure it in Polar with `duration:
 * repeating`, `duration_in_months: 1`, `basis_points: 10000`, `products:
 * [Indie Monthly]` and a `max_redemptions` cap — the cap is the only thing
 * bounding what the promotion can cost, and a 100% discount is the one where
 * that matters most.
 *
 * The seven-day trial does not eat the free month: Polar leaves
 * `discount_applied_at` null while a subscription is trialing and stamps it at
 * the first *paid* period, so a waitlist founder gets the trial and then the
 * month. That was established for the 4-for-3 promotion and holds here for
 * the same reason.
 */

/**
 * Whether this checkout may carry the promotion.
 *
 * Indie monthly only. Yearly Indie is already $10 a month and the promotion
 * exists to get monthly subscribers past the point where they decide whether
 * this was worth it, which is not a problem a yearly subscriber has. Pro is
 * excluded because the arithmetic was done on Indie's margin and nothing has
 * been done on Pro's.
 *
 * Checked on the server as well as in the link, so a founder who edits
 * `?tier=` in the URL does not get Pro at 25% off.
 */
export function promoEligible(
  promo: Promo,
  tier: PaidTier,
  period: BillingPeriod,
): boolean {
  return Boolean(promoDiscountId(promo)) && tier === "indie" && period === "monthly";
}

/**
 * Which discount a checkout should carry.
 *
 * Polar applies one discount per checkout, so this is a choice rather than a
 * sum, and the order is the whole content of the function:
 *
 *   1. The student rate. A verified student gets it even though the launch
 *      promotion may be larger on the first invoice: theirs is the one that
 *      keeps applying, and quietly giving someone the worse long-term deal
 *      because it looks bigger today is not a trade to make on their behalf.
 *   2. The promotion the founder arrived through, when the plan qualifies.
 *      Either one beats the launch promotion's -20% once, and it is also the
 *      thing they were promised.
 *
 *      So a student who is also on the waitlist gets the student rate rather
 *      than the free month, which is rule 1 doing exactly what it says: half
 *      price forever is worth more than one month at zero by the end of the
 *      second month, and Polar applies one discount per checkout — attaching
 *      the free month instead would mean the student rate never attaches to
 *      that subscription at all.
 *   3. The launch promotion, which applies to everyone else.
 *
 * `wantsPromo` is the caller's business: this does not look at a request.
 */
export function discountForCheckout(
  studentVerified: boolean,
  promo: Promo | null = null,
): string | null {
  if (studentVerified) {
    const student = studentDiscountId();
    if (student) return student;
  }
  if (promo) {
    const id = promoDiscountId(promo);
    if (id) return id;
  }
  return autoDiscountId();
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
