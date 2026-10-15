import { describe, expect, it } from "vitest";
import {
  REFERRAL_PROMPTS_PER_DOLLAR,
  commissionFor,
  normaliseCode,
  orderAmountCents,
  referralLink,
} from "@/lib/referrals";

/**
 * Referral arithmetic.
 *
 * The failure modes here are asymmetric in the same way billing's are, and in
 * the same direction: paying a referrer too little is a complaint, paying
 * them for revenue that never existed is a loss that compounds every month a
 * subscription renews. The free-order case matters most of all — a trial's
 * first invoice is $0, and paying on it would mean every trial that never
 * converts still cost real credit.
 */

describe("orderAmountCents", () => {
  /**
   * The field names are not interchangeable, and this is the real order they
   * came from: the $5 top-up on this organisation, 2026-10-15, read back from
   * the Polar API rather than guessed.
   */
  const REAL_ORDER = {
    subtotal_amount: 500,
    discount_amount: 0,
    net_amount: 500,
    tax_amount: 0,
    total_amount: 500,
    platform_fee_amount: 83,
  };

  it("uses net_amount", () => {
    expect(orderAmountCents(REAL_ORDER)).toBe(500);
  });

  it("prefers net over a total that includes tax", () => {
    // Commission on tax is commission on money that goes to a government.
    expect(
      orderAmountCents({ net_amount: 1200, tax_amount: 240, total_amount: 1440 }),
    ).toBe(1200);
  });

  it("does not pay on a discount nobody funded", () => {
    // Launch 20% on Indie: $12 listed, $9.60 received.
    expect(
      orderAmountCents({ subtotal_amount: 1200, discount_amount: 240, total_amount: 960 }),
    ).toBe(960);
  });

  it("falls back rather than reading a missing field as zero", () => {
    // A silent zero would be the failure nobody notices: every commission
    // quietly becomes nothing and the ledger looks healthy.
    expect(orderAmountCents({ subtotal_amount: 2900, discount_amount: 0 })).toBe(2900);
    expect(orderAmountCents({ total_amount: 2900 })).toBe(2900);
    expect(orderAmountCents({})).toBe(0);
  });

  it("refuses nonsense instead of trusting it", () => {
    expect(orderAmountCents({ net_amount: -500 })).toBe(0);
    expect(orderAmountCents({ net_amount: "500" })).toBe(0);
    expect(orderAmountCents({ net_amount: Number.NaN, total_amount: 100 })).toBe(100);
    // A negative discount must not inflate the base above the subtotal.
    expect(orderAmountCents({ subtotal_amount: 500, discount_amount: -1000 })).toBe(500);
  });
});

describe("commissionFor", () => {
  it("pays nothing on a free order", () => {
    // The trial's first invoice. This is the one that would have hurt.
    expect(commissionFor(0)).toBe(0);
  });

  it.each([
    ["a 5 dollar top-up", 500, 20],
    ["an Indie month at full price", 1200, 48],
    ["an Indie month after the launch discount", 960, 36],
    ["a Pro month", 2900, 116],
    ["a Pro year", 28800, 1152],
  ])("pays %s", (_label, cents, expected) => {
    expect(commissionFor(cents)).toBe(expected);
  });

  it("floors to whole dollars rather than rounding up", () => {
    expect(commissionFor(99)).toBe(0);
    expect(commissionFor(199)).toBe(REFERRAL_PROMPTS_PER_DOLLAR);
  });

  it("never pays on a negative or unreadable amount", () => {
    expect(commissionFor(-1200)).toBe(0);
    expect(commissionFor(Number.NaN)).toBe(0);
    expect(commissionFor(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("normaliseCode", () => {
  it("accepts a code as typed, shared or pasted", () => {
    expect(normaliseCode("maya-k2")).toBe("maya-k2");
    expect(normaliseCode("Maya-K2")).toBe("maya-k2");
    expect(normaliseCode("  maya-k2  ")).toBe("maya-k2");
  });

  it("rejects anything that cannot be a code", () => {
    // Null rather than a doomed query, so a caller can tell "no referral"
    // from "a referral we could not read".
    expect(normaliseCode(null)).toBe(null);
    expect(normaliseCode("")).toBe(null);
    expect(normaliseCode("ab")).toBe(null);
    expect(normaliseCode("a".repeat(33))).toBe(null);
    expect(normaliseCode("maya k2")).toBe(null);
    expect(normaliseCode("maya_k2")).toBe(null);
    expect(normaliseCode("../etc/passwd")).toBe(null);
    expect(normaliseCode("maya'; drop table--")).toBe(null);
  });
});

describe("referralLink", () => {
  it("points at signup, where the middleware can see it", () => {
    expect(referralLink("https://app.euclidhq.com", "maya-k2")).toBe(
      "https://app.euclidhq.com/signup?ref=maya-k2",
    );
  });

  it("does not double a trailing slash", () => {
    expect(referralLink("https://app.euclidhq.com/", "maya-k2")).toBe(
      "https://app.euclidhq.com/signup?ref=maya-k2",
    );
  });
});
