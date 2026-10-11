import type { PlanTier } from "./types";

/**
 * Plan limits from the PRD's pricing table. Flat and small, with AI metered in
 * monthly credits because those cost real tokens.
 */
export interface PlanSpec {
  tier: PlanTier;
  name: string;
  monthly: number;
  yearly: number;
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
  features: string[];
}

export const PLANS: Record<PlanTier, PlanSpec> = {
  free: {
    tier: "free",
    name: "Free",
    monthly: 0,
    yearly: 0,
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
    yearly: 10,
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
    yearly: 24,
    boards: null,
    buildPrompts: 300,
    chatCredits: 3000,
    badge: false,
    jwtIdentity: true,
    analytics: true,
    duplicateMerging: true,
    chatAssistant: true,
    digest: true,
    customDomain: true,
    features: [
      "Unlimited boards",
      "300 Build Prompts a month",
      "Ask Euclid chat and weekly digest",
      "Custom domain",
      "GitHub repo context (soon)",
    ],
  },
};

export const PLAN_ORDER: PlanTier[] = ["free", "indie", "pro"];

/** Whether a workspace still has Build Prompt allowance this period. */
export function hasPromptAllowance(plan: PlanTier, used: number): boolean {
  return used < PLANS[plan].buildPrompts;
}

export function hasChatAllowance(plan: PlanTier, used: number): boolean {
  const spec = PLANS[plan];
  return spec.chatAssistant && used < spec.chatCredits;
}

export function boardAllowance(plan: PlanTier, count: number): boolean {
  const max = PLANS[plan].boards;
  return max === null || count < max;
}
