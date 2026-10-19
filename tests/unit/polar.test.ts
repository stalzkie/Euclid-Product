import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  POLAR_PRODUCTS,
  autoDiscountId,
  billingEnabled,
  discountForCheckout,
  isEntitled,
  planForProduct,
  polarServer,
  productIdFor,
  promoDiscountId,
  promoEligible,
  trialDays,
} from "@/lib/polar";

/**
 * Billing's failure modes are asymmetric: refusing a paying founder is an
 * annoyance, granting Pro to someone who did not pay is revenue walking out of
 * the door, and charging a live card from a sandbox build is worse than both.
 * These tests are written around that asymmetry rather than the happy path.
 */

const ENV_KEYS = [
  "POLAR_SERVER",
  "POLAR_ACCESS_TOKEN",
  "POLAR_TRIAL_DAYS",
  "POLAR_DISCOUNT_FIRST_PURCHASE",
  "POLAR_DISCOUNT_STUDENT",
  "POLAR_DISCOUNT_INDIE3",
  ...POLAR_PRODUCTS.map((p) => p.env),
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** Point every product env at a distinct id. */
function configure() {
  process.env.POLAR_ACCESS_TOKEN = "polar_at_test";
  for (const product of POLAR_PRODUCTS) {
    process.env[product.env] = `prod_${product.tier}_${product.period}`;
  }
}

describe("polar environment", () => {
  it("defaults to sandbox when nothing is set", () => {
    expect(polarServer()).toBe("sandbox");
  });

  it("only reaches production on an exact match", () => {
    // A typo must not route a checkout at a live card. Anything that is not
    // precisely "production" stays in the sandbox.
    for (const value of ["Production", "PRODUCTION", "prod", "live", "true", ""]) {
      process.env.POLAR_SERVER = value;
      expect(polarServer()).toBe("sandbox");
    }
    process.env.POLAR_SERVER = "production";
    expect(polarServer()).toBe("production");
  });
});

describe("billingEnabled", () => {
  it("is false with no configuration at all", () => {
    expect(billingEnabled()).toBe(false);
  });

  it("is false when the token is set but a product id is missing", () => {
    // The half-configured case is the dangerous one: an upgrade button that
    // leads to a checkout for a product that does not exist.
    configure();
    delete process.env.POLAR_PRODUCT_PRO_YEARLY;
    expect(billingEnabled()).toBe(false);
  });

  it("is false when every product is set but the token is not", () => {
    configure();
    delete process.env.POLAR_ACCESS_TOKEN;
    expect(billingEnabled()).toBe(false);
  });

  it("is true only once everything is present", () => {
    configure();
    expect(billingEnabled()).toBe(true);
  });
});

describe("productIdFor", () => {
  it("maps every paid tier and period to its own product", () => {
    configure();
    const ids = [
      productIdFor("indie", "monthly"),
      productIdFor("indie", "yearly"),
      productIdFor("pro", "monthly"),
      productIdFor("pro", "yearly"),
    ];
    // Four distinct products. A copy-paste in the env block that pointed Indie
    // yearly at the Pro product would sell the wrong thing for the wrong price.
    expect(new Set(ids).size).toBe(4);
    expect(ids.every(Boolean)).toBe(true);
  });

  it("returns null rather than a fallback when unconfigured", () => {
    expect(productIdFor("pro", "monthly")).toBeNull();
  });
});

describe("planForProduct", () => {
  it("round-trips every product back to the tier that bought it", () => {
    configure();
    for (const product of POLAR_PRODUCTS) {
      const id = productIdFor(product.tier, product.period);
      expect(planForProduct(id!)).toEqual({ tier: product.tier, period: product.period });
    }
  });

  it("refuses an unknown product id", () => {
    configure();
    // This is the fail-closed case. An id from another organisation — a
    // production id reaching a sandbox deployment, say — must not resolve to a
    // tier, because any guess here grants a plan nobody paid for.
    expect(planForProduct("prod_someone_elses")).toBeNull();
  });

  it("refuses an empty product id when the env vars are present but blank", () => {
    // This is how a real `.env` looks before the ids are filled in: the keys
    // exist, so their values are "" rather than undefined. Matching on equality
    // alone would make an empty product id equal to the blank Indie env and
    // grant a plan nobody bought. Removing the guard in planForProduct fails
    // this test and only this test.
    for (const product of POLAR_PRODUCTS) process.env[product.env] = "";
    expect(planForProduct("")).toBeNull();
  });
});

describe("isEntitled", () => {
  it("keeps features on while a payment is retried", () => {
    // past_due means the bank declined once and Polar is retrying. Taking the
    // boards offline over that would punish the founder for their card
    // expiring, days before Polar has given up.
    expect(isEntitled("past_due")).toBe(true);
  });

  it("entitles active and trialing", () => {
    expect(isEntitled("active")).toBe(true);
    expect(isEntitled("trialing")).toBe(true);
  });

  it("does not entitle a subscription that has ended", () => {
    for (const status of ["canceled", "revoked", "unpaid", "incomplete_expired", "paused"]) {
      expect(isEntitled(status)).toBe(false);
    }
  });

  it("does not entitle a missing status", () => {
    expect(isEntitled(null)).toBe(false);
    expect(isEntitled(undefined)).toBe(false);
    expect(isEntitled("")).toBe(false);
  });
});

describe("trialDays", () => {
  it("is null when unset, so no trial is ever advertised by default", () => {
    // The button copy is a promise to the customer. A deployment whose Polar
    // products carry no trial must not offer one the checkout then withdraws.
    expect(trialDays()).toBeNull();
  });

  it("reads a positive whole number of days", () => {
    process.env.POLAR_TRIAL_DAYS = "7";
    expect(trialDays()).toBe(7);
  });

  it("rejects values that are not a usable number of days", () => {
    for (const bad of ["0", "-7", "7.5", "seven", "", " "]) {
      process.env.POLAR_TRIAL_DAYS = bad;
      expect(trialDays()).toBeNull();
    }
  });
});

describe("autoDiscountId", () => {
  it("is null when unset", () => {
    expect(autoDiscountId()).toBeNull();
  });

  it("is null when present but blank", () => {
    // Same trap as the product ids: a `.env` with the key and no value yields
    // "" rather than undefined. Passing "" to Polar as a discount id is an
    // error, not a no-op, so it must read as "no promotion running".
    process.env.POLAR_DISCOUNT_FIRST_PURCHASE = "";
    expect(autoDiscountId()).toBeNull();
  });

  it("returns the id when one is configured", () => {
    process.env.POLAR_DISCOUNT_FIRST_PURCHASE = "disc_123";
    expect(autoDiscountId()).toBe("disc_123");
  });
});

describe("discountForCheckout", () => {
  it("gives a verified student the student discount, not the larger promo", () => {
    // The promo is 20% once; the student rate is 50% on every invoice. Polar
    // applies one discount per checkout, so handing the student the promo
    // because it looks bigger on the first bill would be the worse deal.
    process.env.POLAR_DISCOUNT_STUDENT = "disc_student";
    process.env.POLAR_DISCOUNT_FIRST_PURCHASE = "disc_promo";
    expect(discountForCheckout(true)).toBe("disc_student");
  });

  it("gives everyone else the launch promotion", () => {
    process.env.POLAR_DISCOUNT_STUDENT = "disc_student";
    process.env.POLAR_DISCOUNT_FIRST_PURCHASE = "disc_promo";
    expect(discountForCheckout(false)).toBe("disc_promo");
  });

  it("falls back to the promotion when no student discount is configured", () => {
    // A deployment that verifies students but has no student discount set up
    // must not drop the promotion they would otherwise have had.
    process.env.POLAR_DISCOUNT_FIRST_PURCHASE = "disc_promo";
    expect(discountForCheckout(true)).toBe("disc_promo");
  });

  it("is null when no discount is running at all", () => {
    expect(discountForCheckout(true)).toBeNull();
    expect(discountForCheckout(false)).toBeNull();
  });
});

/**
 * The "4 months for the price of 3" promotion.
 *
 * Two things can go wrong and they cost differently. Letting it apply where it
 * should not discounts a plan whose margin was never worked out for it, every
 * month, for four months. Failing to apply it where it should loses a sale
 * that was already half made. The first is the one worth being strict about,
 * which is why eligibility is re-derived on the server rather than trusted
 * from the link the founder clicked.
 */
describe("the 4-for-3 promotion", () => {
  it("is not on offer unless a discount id is configured", () => {
    // A deployment without the discount must not advertise or apply it.
    expect(promoDiscountId()).toBeNull();
    expect(promoEligible("indie", "monthly")).toBe(false);
  });

  it("applies to Indie monthly only", () => {
    process.env.POLAR_DISCOUNT_INDIE3 = "disc_indie3";
    expect(promoEligible("indie", "monthly")).toBe(true);
  });

  it("refuses Pro, whose margin it was never costed against", () => {
    process.env.POLAR_DISCOUNT_INDIE3 = "disc_indie3";
    // The query string is a request, not permission: ?tier=pro&promo=indie3
    // must not buy Pro at 25% off for four months.
    expect(promoEligible("pro", "monthly")).toBe(false);
    expect(promoEligible("pro", "yearly")).toBe(false);
  });

  it("refuses yearly, which is already cheaper per month", () => {
    process.env.POLAR_DISCOUNT_INDIE3 = "disc_indie3";
    // Indie yearly is $10/mo. The promotion exists to carry a *monthly*
    // subscriber past the point where they decide it was worth it.
    expect(promoEligible("indie", "yearly")).toBe(false);
  });

  it("beats the launch promotion when the founder came through its link", () => {
    process.env.POLAR_DISCOUNT_FIRST_PURCHASE = "disc_launch";
    process.env.POLAR_DISCOUNT_INDIE3 = "disc_indie3";
    // -25% over four months against -20% once, and it is what they were told.
    expect(discountForCheckout(false, true)).toBe("disc_indie3");
  });

  it("loses to the student rate, which keeps applying", () => {
    process.env.POLAR_DISCOUNT_STUDENT = "disc_student";
    process.env.POLAR_DISCOUNT_INDIE3 = "disc_indie3";
    // Same reasoning the launch promotion already loses on: four months of
    // -25% is worth less than -50% forever, and picking the bigger number
    // today on someone else's behalf is the wrong trade.
    expect(discountForCheckout(true, true)).toBe("disc_student");
  });

  it("falls back to the launch promotion when the promo is unconfigured", () => {
    process.env.POLAR_DISCOUNT_FIRST_PURCHASE = "disc_launch";
    // Asked for, not available: the founder still gets the standing offer
    // rather than no discount at all.
    expect(discountForCheckout(false, true)).toBe("disc_launch");
  });

  it("is not applied to a checkout that did not ask for it", () => {
    process.env.POLAR_DISCOUNT_FIRST_PURCHASE = "disc_launch";
    process.env.POLAR_DISCOUNT_INDIE3 = "disc_indie3";
    expect(discountForCheckout(false)).toBe("disc_launch");
  });
});
