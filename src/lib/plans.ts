import type { PlanTier } from "./types";

/**
 * Plan limits from the PRD's pricing table. Flat and small, with AI metered in
 * monthly credits because those cost real tokens.
 */
export interface PlanSpec {
  tier: PlanTier;
  name: string;
  monthly: number;
  /**
   * The ANNUAL TOTAL, not a per-month equivalent -- this is the figure Polar
   * charges the card, and the only one a customer can check a statement
   * against. $8.33 x 12 is $99.96, not $100, so the per-month number below
   * may sit beside this but must never replace it.
   */
  yearly: number;
  /** Display only. Always rendered next to the annual total, never alone. */
  yearlyPerMonth: string;
  boards: number | null;
  buildPrompts: number;
  chatCredits: number;
  badge: boolean;
  jwtIdentity: boolean;
  analytics: boolean;
  duplicateMerging: boolean;
  chatAssistant: boolean;
  digest: boolean;
  customDomain: boolean;
  /** Slack and Discord notifications, and issue export to GitHub or Linear. */
  integrations: boolean;
  features: string[];
}

export const PLANS: Record<PlanTier, PlanSpec> = {
  free: {
    tier: "free",
    name: "Free",
    monthly: 0,
    yearly: 0,
    yearlyPerMonth: "0",
    boards: 1,
    buildPrompts: 3,
    chatCredits: 0,
    badge: true,
    jwtIdentity: false,
    analytics: false,
    duplicateMerging: false,
    chatAssistant: false,
    digest: false,
    customDomain: false,
    integrations: false,
    features: [
      "1 board",
      "Anonymous and email voting",
      "3 Build Prompts a month",
      "Euclid badge on widget",
    ],
  },
  indie: {
    tier: "indie",
    name: "Indie",
    monthly: 12,
    yearly: 100,
    yearlyPerMonth: "8.33",
    boards: 3,
    buildPrompts: 50,
    chatCredits: 500,
    badge: false,
    jwtIdentity: true,
    analytics: true,
    duplicateMerging: true,
    chatAssistant: false,
    digest: false,
    customDomain: false,
    integrations: true,
    features: [
      "3 boards",
      "Signed JWT identity and segments",
      "50 Build Prompts a month",
      "Duplicates, themes, analytics",
      "No badge",
    ],
  },
  pro: {
    tier: "pro",
    name: "Pro",
    monthly: 29,
    yearly: 240,
    yearlyPerMonth: "20.00",
    boards: null,
    buildPrompts: 300,
    /*
      500, down from 3000 on 2026-10-13.

      A credit is one step of the Ask Euclid agent, and a real question takes
      four to seven of them — so this is roughly 85 questions a month. 3000
      was set before anything measured what a step costs: at $0.071 a question
      it put the chat ceiling alone at $30 against $18.79 of net revenue, so a
      single heavy founder cost more than they paid.

      At 500 the whole plan's ceiling is $15.35 against $18.79 — a 18% margin
      even for the one founder who exhausts everything, which is the property
      worth having. Running out has an answer now: a top-up pack, rather than
      waiting for the 1st.
    */
    chatCredits: 500,
    badge: false,
    jwtIdentity: true,
    analytics: true,
    duplicateMerging: true,
    chatAssistant: true,
    digest: true,
    customDomain: true,
    integrations: true,
    features: [
      "Unlimited boards",
      "300 Build Prompts a month",
      "Ask Euclid chat and weekly digest",
      "Custom domain",
      "Read-only GitHub repo context",
    ],
  },
};

export const PLAN_ORDER: PlanTier[] = ["free", "indie", "pro"];

/* -------------------------------------------------------------------------- */
/* Allowance                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What a workspace has left of one metered thing.
 *
 * Two numbers, because they behave differently over time. `used` counts
 * against the monthly `limit` and is reset by `roll_usage_period` on the first
 * visit of a new month. `extra` is a balance bought with a top-up, and nothing
 * resets it — a founder paid cash for it, so it is still there next month.
 *
 * That difference is the whole reason purchased balance is a balance that
 * depletes rather than a larger limit. A top-up modelled as "+250 to the
 * monthly allowance" would quietly grant 250 again every month forever.
 */
export interface Allowance {
  used: number;
  limit: number;
  extra: number;
}

/** Whether there is anything left, in the plan's allowance or bought. */
export function hasAllowance(a: Allowance): boolean {
  return a.used < a.limit || a.extra > 0;
}

/**
 * Spending `cost` against an allowance: the monthly allowance first, the
 * purchased balance only once that is gone.
 *
 * In that order deliberately. The plan's allowance expires at the end of the
 * month and the purchased balance does not, so spending the perishable one
 * first is what the founder would choose if asked.
 *
 * **Nothing calls this in production any more. It is the reference
 * implementation, and that is the point.**
 *
 * The spend moved into `spend_allowance` in `0022_atomic_allowance.sql`,
 * because computing it here meant reading `prompts_used` at the start of a
 * request and writing an absolute value back at the end — so concurrent
 * generations overwrote each other's increments and were never counted. The
 * arithmetic itself was always right; only its distance from the row was
 * wrong.
 *
 * It stays because the unit suite has no way to run plpgsql, so
 * `tests/unit/allowance.test.ts` is the only executable statement of what the
 * SQL is supposed to do — including the floor on `extra` and the
 * plan-before-purchased ordering. Change one of the two and change the other,
 * or the tests are asserting about a function nobody runs.
 */
export function spendAllowance(
  a: Allowance,
  cost = 1,
): { used: number; extra: number } {
  const fromPlan = Math.max(0, Math.min(cost, a.limit - a.used));
  const fromExtra = cost - fromPlan;
  return {
    used: a.used + fromPlan,
    // Floored at zero: a question that costs more credits than remain is
    // allowed to finish rather than being killed mid-answer, so the balance
    // can be asked to go further than it goes.
    extra: Math.max(0, a.extra - fromExtra),
  };
}

/** Whether a workspace still has Build Prompt allowance. */
export function hasPromptAllowance(plan: PlanTier, used: number, extra = 0): boolean {
  return hasAllowance({ used, limit: PLANS[plan].buildPrompts, extra });
}

export function hasChatAllowance(plan: PlanTier, used: number, extra = 0): boolean {
  const spec = PLANS[plan];
  // The plan flag gates the feature, not the balance. Credits bought on Pro
  // and then a downgrade to Indie do not reopen Ask Euclid.
  return spec.chatAssistant && hasAllowance({ used, limit: spec.chatCredits, extra });
}

export function boardAllowance(plan: PlanTier, count: number): boolean {
  const max = PLANS[plan].boards;
  return max === null || count < max;
}
