import { describe, expect, it } from "vitest";
import { subscriptionStateFrom } from "@/server/billing";

/**
 * Reading a Polar subscription payload.
 *
 * The payload below is real: it is the `subscription.updated` Polar delivered
 * on 2026-10-15 when the Euclid Test trial was cancelled through the customer
 * portal, copied from the webhook delivery log. Trimmed of the nested
 * customer, product, price and discount objects, which this app does not read
 * — the product id is the only thing it trusts for entitlement.
 *
 * It is here rather than invented because the bug it guards against was a
 * wrong assumption about the payload, not a wrong line of code: cancelling
 * leaves `status` as `trialing`, and the news is carried in a separate field.
 * A hand-written fixture would have encoded the same wrong assumption and
 * passed.
 */
const CANCELLED_TRIAL = {
  created_at: "2026-10-15T12:29:19.312898Z",
  modified_at: "2026-10-15T13:00:06.621809Z",
  id: "b988f1d9-2aee-45d4-a473-a794517c753d",
  amount: 960,
  currency: "usd",
  recurring_interval: "month",
  status: "trialing",
  current_period_start: "2026-10-15T12:29:19.292348Z",
  current_period_end: "2026-10-22T12:28:47.171143Z",
  trial_start: "2026-10-15T12:29:19.292348Z",
  trial_end: "2026-10-22T12:28:47.171143Z",
  cancel_at_period_end: true,
  canceled_at: "2026-10-15T13:00:06.618030Z",
  started_at: "2026-10-15T12:29:19.292348Z",
  ends_at: "2026-10-22T12:28:47.171143Z",
  ended_at: null,
  past_due_at: null,
  pause_at_period_end: false,
  customer_id: "ae2a3dba-8b5e-48a8-8c26-a44920240124",
  product_id: "44461f56-e2a7-4e83-a4dd-e11383498fc3",
  discount_id: "d41b8cfe-8864-4ec7-a309-0a2b5666362e",
  metadata: { workspace_id: "c9adf846-3187-43e6-95e5-d6e3f567f3bf" },
};

describe("subscriptionStateFrom", () => {
  it("reads a cancellation that leaves the status alone", () => {
    const state = subscriptionStateFrom(CANCELLED_TRIAL);

    // The assertion that matters: status says nothing is wrong, and the plan
    // is on its way out anyway. Reading only `status` — which is what the app
    // did — sees an untouched subscription.
    expect(state.status).toBe("trialing");
    expect(state.cancelAtPeriodEnd).toBe(true);

    expect(state).toEqual({
      subscriptionId: "b988f1d9-2aee-45d4-a473-a794517c753d",
      customerId: "ae2a3dba-8b5e-48a8-8c26-a44920240124",
      productId: "44461f56-e2a7-4e83-a4dd-e11383498fc3",
      status: "trialing",
      currentPeriodEnd: "2026-10-22T12:28:47.171143Z",
      cancelAtPeriodEnd: true,
      workspaceId: "c9adf846-3187-43e6-95e5-d6e3f567f3bf",
    });
  });

  it("treats an uncancelled subscription as renewing", () => {
    const state = subscriptionStateFrom({
      ...CANCELLED_TRIAL,
      cancel_at_period_end: false,
      canceled_at: null,
    });
    expect(state.cancelAtPeriodEnd).toBe(false);
  });

  /**
   * The dangerous direction. `cancel_at_period_end` arrived with API version
   * 2027-01; an endpoint left on an older version does not send it. If absent
   * read as cancelled, every webhook from such an endpoint would tell a paying
   * founder their plan was ending.
   */
  it("does not read an absent flag as cancelled", () => {
    const { cancel_at_period_end: _omitted, ...withoutFlag } = CANCELLED_TRIAL;
    expect(subscriptionStateFrom(withoutFlag).cancelAtPeriodEnd).toBe(false);
  });

  it.each([
    ["null", { cancel_at_period_end: null }],
    ["undefined", { cancel_at_period_end: undefined }],
    ["the string \"false\"", { cancel_at_period_end: "false" }],
    ["the string \"true\"", { cancel_at_period_end: "true" }],
    ["the number 1", { cancel_at_period_end: 1 }],
  ])("does not read %s as cancelled", (_label, overrides) => {
    const state = subscriptionStateFrom({ ...CANCELLED_TRIAL, ...overrides });
    expect(state.cancelAtPeriodEnd).toBe(false);
  });

  it("survives a payload with nothing in it", () => {
    expect(subscriptionStateFrom({})).toEqual({
      subscriptionId: "",
      customerId: "",
      productId: "",
      status: "",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      workspaceId: null,
    });

    // `workspaceForSubscription` treats an empty id as absent rather than
    // matching a row whose column is an empty string, so these blanks are
    // safe — but only because nothing downstream reads them as ids.
    expect(subscriptionStateFrom(null).subscriptionId).toBe("");
    expect(subscriptionStateFrom(undefined).workspaceId).toBe(null);
  });

  it("ignores a workspace_id that is not a string", () => {
    const state = subscriptionStateFrom({
      ...CANCELLED_TRIAL,
      metadata: { workspace_id: 12345 },
    });
    expect(state.workspaceId).toBe(null);
  });
});
