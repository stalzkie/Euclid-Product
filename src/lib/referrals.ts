/**
 * Referrals: what a referrer earns, and how a code travels.
 *
 * Euclid's referral reward is Build Prompts, not money. Polar is the merchant
 * of record — payments land in Euclid's balance and Polar pays out to Euclid
 * alone — so paying a third party would mean a second rail, identity and tax
 * collection, payout thresholds, and a way to claw a payout back when the
 * order behind it is refunded. Granting credit needs none of that and runs on
 * machinery that has already handled a real purchase and a real refund.
 */

/** The cookie a `?ref=` lands in, and how long it is honoured for. */
export const REFERRAL_COOKIE = "euclid_ref";

/**
 * Ninety days.
 *
 * Long enough that someone who reads a post, bookmarks it and signs up a
 * month later is still attributed, short enough that the cookie is not
 * claiming credit for a decision it had nothing to do with. The usual
 * affiliate default is 30; this is longer because Euclid's own funnel is
 * slow — a founder evaluates a feedback board against a product they are
 * still building.
 */
export const REFERRAL_COOKIE_DAYS = 90;

/**
 * Build Prompts granted per whole dollar of a paid order.
 *
 * Four, which makes a $12 Indie month worth 48 prompts and a $29 Pro month
 * worth 116. The arithmetic behind that number, from the costing on
 * 2026-10-13: Pro's 300 Build Prompts cost $10.29 at full use, so one prompt
 * costs about $0.034 and four cost about $0.137. Against a dollar of revenue
 * that is roughly a 14% commission in what it actually costs to honour —
 * comparable to a cash affiliate rate, without being cash.
 *
 * It is a constant rather than a setting because there is one Euclid and one
 * rate. If that stops being true it belongs in the database, and
 * `referral_commissions.order_cents` is already recorded so historical rows
 * stay explainable when the rate moves.
 */
export const REFERRAL_PROMPTS_PER_DOLLAR = 4;

/**
 * The amount an order earns commission on, in cents.
 *
 * `net_amount` is the one to use, and the names are not interchangeable. Read
 * off a real order on this organisation (the $5 top-up of 2026-10-15):
 *
 *   subtotal_amount 500 · discount_amount 0 · net_amount 500
 *   tax_amount 0 · total_amount 500 · platform_fee_amount 83
 *
 * `total_amount` includes tax, and commission on tax is commission on money
 * that goes to a government. `subtotal_amount` ignores the discount, which
 * would pay a referrer for revenue nobody received. `net_amount` is after the
 * discount and before tax, which is what the sale was actually worth.
 *
 * It is worth knowing that `net_amount` is also before Polar's cut: that $5
 * order carried an $83 platform fee, so Euclid received $4.17 of it. The rate
 * is set with that in mind rather than by netting it off here, because the
 * fee is Polar's pricing and can move without the commission rate moving.
 *
 * The fallbacks exist because a missing field must not silently become a zero
 * commission on every order forever — the failure nobody would notice.
 */
export function orderAmountCents(order: {
  net_amount?: unknown;
  subtotal_amount?: unknown;
  discount_amount?: unknown;
  total_amount?: unknown;
  // A real order carries a dozen more fields -- tax, platform fee, refunded
  // amounts. This is handed the whole thing, so it has to say so.
  [key: string]: unknown;
}): number {
  const cents = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

  const net = cents(order.net_amount);
  if (net !== null) return net;

  const subtotal = cents(order.subtotal_amount);
  if (subtotal !== null) return Math.max(0, subtotal - (cents(order.discount_amount) ?? 0));

  return cents(order.total_amount) ?? 0;
}

/**
 * What a referrer earns for an order of this size.
 *
 * Floors to whole dollars: a $5 top-up earns 20, and anything under a dollar
 * earns nothing rather than a rounded-up token. Returns 0 for a free order,
 * which is the case that matters most — a trial's first invoice is $0, and
 * paying a commission on it would mean every trial that never converts still
 * cost real credit.
 */
export function commissionFor(orderCents: number): number {
  if (!Number.isFinite(orderCents) || orderCents <= 0) return 0;
  return Math.floor(orderCents / 100) * REFERRAL_PROMPTS_PER_DOLLAR;
}

/**
 * Normalise a code as typed, shared or pasted.
 *
 * Codes are lower-case and hyphenated in the database, and people will arrive
 * with "?ref=Maya-K2" or a trailing space from a copy-paste. Anything that
 * cannot be a code becomes null rather than a query that finds nothing, so
 * callers can tell "no referral" from "a referral we could not read".
 */
export function normaliseCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim().toLowerCase();
  return /^[a-z0-9-]{4,32}$/.test(code) ? code : null;
}

/** The link a referrer shares. */
export function referralLink(origin: string, code: string): string {
  return `${origin.replace(/\/$/, "")}/signup?ref=${encodeURIComponent(code)}`;
}
