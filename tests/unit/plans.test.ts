import { describe, expect, it } from "vitest";
import {
  PLANS,
  PLAN_ORDER,
  boardAllowance,
  hasChatAllowance,
  hasPromptAllowance,
} from "@/lib/plans";

/**
 * Plan limits are what stops a free account spending the founder's AI budget,
 * so the boundary cases are the point: exactly at the limit must be refused,
 * one below must be allowed.
 */

describe("plan definitions", () => {
  it("prices each tier above the one below it", () => {
    expect(PLANS.free.monthly).toBeLessThan(PLANS.indie.monthly);
    expect(PLANS.indie.monthly).toBeLessThan(PLANS.pro.monthly);
  });

  it("gives more Build Prompts as the tier rises", () => {
    expect(PLANS.free.buildPrompts).toBeLessThan(PLANS.indie.buildPrompts);
    expect(PLANS.indie.buildPrompts).toBeLessThan(PLANS.pro.buildPrompts);
  });

  it("discounts the yearly price", () => {
    for (const tier of PLAN_ORDER) {
      if (PLANS[tier].monthly > 0) {
        expect(PLANS[tier].yearly).toBeLessThan(PLANS[tier].monthly);
      }
    }
  });

  it("keeps the badge on free only, since that is the growth loop", () => {
    expect(PLANS.free.badge).toBe(true);
    expect(PLANS.indie.badge).toBe(false);
    expect(PLANS.pro.badge).toBe(false);
  });

  it("gates the chat assistant to Pro", () => {
    expect(PLANS.free.chatAssistant).toBe(false);
    expect(PLANS.indie.chatAssistant).toBe(false);
    expect(PLANS.pro.chatAssistant).toBe(true);
  });

  it("gates signed identity above free", () => {
    expect(PLANS.free.jwtIdentity).toBe(false);
    expect(PLANS.indie.jwtIdentity).toBe(true);
  });

  it("gives Pro unlimited boards", () => {
    expect(PLANS.pro.boards).toBeNull();
    expect(PLANS.free.boards).toBe(1);
  });
});

describe("hasPromptAllowance", () => {
  it("allows a founder below their limit", () => {
    expect(hasPromptAllowance("free", 0)).toBe(true);
    expect(hasPromptAllowance("free", PLANS.free.buildPrompts - 1)).toBe(true);
  });

  it("refuses exactly at the limit, not one past it", () => {
    expect(hasPromptAllowance("free", PLANS.free.buildPrompts)).toBe(false);
    expect(hasPromptAllowance("indie", PLANS.indie.buildPrompts)).toBe(false);
  });

  it("refuses when usage somehow exceeded the limit", () => {
    expect(hasPromptAllowance("free", PLANS.free.buildPrompts + 10)).toBe(false);
  });
});

describe("hasChatAllowance", () => {
  it("refuses a plan without the chat assistant, however little is used", () => {
    expect(hasChatAllowance("free", 0)).toBe(false);
    expect(hasChatAllowance("indie", 0)).toBe(false);
  });

  it("allows Pro under its credit limit", () => {
    expect(hasChatAllowance("pro", 0)).toBe(true);
    expect(hasChatAllowance("pro", PLANS.pro.chatCredits - 1)).toBe(true);
  });

  it("refuses Pro at its credit limit", () => {
    expect(hasChatAllowance("pro", PLANS.pro.chatCredits)).toBe(false);
  });
});

describe("boardAllowance", () => {
  it("allows a first board on free", () => {
    expect(boardAllowance("free", 0)).toBe(true);
  });

  it("refuses a second board on free", () => {
    expect(boardAllowance("free", 1)).toBe(false);
  });

  it("allows up to the Indie limit", () => {
    expect(boardAllowance("indie", 2)).toBe(true);
    expect(boardAllowance("indie", 3)).toBe(false);
  });

  it("never refuses Pro, which is unlimited", () => {
    expect(boardAllowance("pro", 0)).toBe(true);
    expect(boardAllowance("pro", 9999)).toBe(true);
  });
});
