import { describe, expect, it } from "vitest";
import {
  PLANS,
  hasAllowance,
  hasChatAllowance,
  hasPromptAllowance,
  spendAllowance,
} from "@/lib/plans";

/**
 * Purchased allowance.
 *
 * The property that matters most here is the one that is easiest to get
 * wrong and hardest to notice: a top-up is a balance that depletes, not a
 * bigger monthly limit. Modelled as a bigger limit it would silently re-grant
 * itself every month forever, and nothing in the product would look broken —
 * it would just quietly give away the thing being sold.
 */

describe("spendAllowance", () => {
  it("spends the monthly allowance before the purchased balance", () => {
    // The plan's allowance expires at the end of the month and the bought one
    // does not, so the perishable one goes first.
    const after = spendAllowance({ used: 0, limit: 50, extra: 100 });
    expect(after).toEqual({ used: 1, extra: 100 });
  });

  it("draws on the purchased balance only once the allowance is gone", () => {
    const after = spendAllowance({ used: 50, limit: 50, extra: 100 });
    expect(after).toEqual({ used: 50, extra: 99 });
  });

  it("splits a cost that straddles the boundary", () => {
    // A chat question costs one credit per step, so a 7-step question can
    // begin inside the allowance and finish outside it.
    const after = spendAllowance({ used: 697, limit: 700, extra: 250 }, 7);
    expect(after).toEqual({ used: 700, extra: 246 });
  });

  it("never drives the purchased balance below zero", () => {
    // The answer is already written by the time this runs; refusing to record
    // the spend would be worse than letting the balance bottom out.
    const after = spendAllowance({ used: 700, limit: 700, extra: 2 }, 7);
    expect(after).toEqual({ used: 700, extra: 0 });
  });

  it("is unchanged by a zero cost", () => {
    expect(spendAllowance({ used: 10, limit: 50, extra: 5 }, 0)).toEqual({
      used: 10,
      extra: 5,
    });
  });

  it("survives a month it was never reset for", () => {
    // `roll_usage_period` zeroes `used` and leaves `extra` alone. Replaying
    // that here is what proves the balance carries over rather than being
    // re-granted: 20 bought, 5 spent last month, 15 left this month — not 20.
    let state = { used: 48, limit: 50, extra: 20 };
    for (let i = 0; i < 7; i++) {
      const next = spendAllowance(state);
      state = { ...state, used: next.used, extra: next.extra };
    }
    expect(state).toEqual({ used: 50, limit: 50, extra: 15 });

    const newMonth = { ...state, used: 0 };
    expect(newMonth.extra).toBe(15);
  });
});

describe("hasAllowance", () => {
  it("is true while the monthly allowance holds", () => {
    expect(hasAllowance({ used: 0, limit: 50, extra: 0 })).toBe(true);
    expect(hasAllowance({ used: 49, limit: 50, extra: 0 })).toBe(true);
  });

  it("is false when both are exhausted", () => {
    expect(hasAllowance({ used: 50, limit: 50, extra: 0 })).toBe(false);
  });

  it("is true on purchased balance alone", () => {
    expect(hasAllowance({ used: 50, limit: 50, extra: 1 })).toBe(true);
  });

  it("is false on a plan with no allowance and nothing bought", () => {
    expect(hasAllowance({ used: 0, limit: 0, extra: 0 })).toBe(false);
  });
});

describe("plan gates", () => {
  it("lets a top-up extend Build Prompts past the plan limit", () => {
    const limit = PLANS.indie.buildPrompts;
    expect(hasPromptAllowance("indie", limit)).toBe(false);
    expect(hasPromptAllowance("indie", limit, 10)).toBe(true);
  });

  it("keeps chat shut on a plan without it, whatever the balance", () => {
    // Credits bought on Pro and carried into a downgrade must not reopen Ask
    // Euclid: the plan flag gates the feature, the balance only meters it.
    expect(PLANS.indie.chatAssistant).toBe(false);
    expect(hasChatAllowance("indie", 0, 1000)).toBe(false);
    expect(hasChatAllowance("free", 0, 1000)).toBe(false);
  });

  it("lets a top-up extend chat on a plan that has it", () => {
    const limit = PLANS.pro.chatCredits;
    expect(hasChatAllowance("pro", limit)).toBe(false);
    expect(hasChatAllowance("pro", limit, 250)).toBe(true);
  });

  it("defaults to no purchased balance", () => {
    // Every existing call site passes two arguments; the third has to be
    // optional or the old behaviour changes silently.
    expect(hasPromptAllowance("pro", 0)).toBe(true);
    expect(hasPromptAllowance("pro", PLANS.pro.buildPrompts)).toBe(false);
  });
});
