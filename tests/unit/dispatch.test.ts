import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Queued work is drained after the response so a magic link does not wait for
 * the next cron run. The contract worth holding to is narrow: it must not run
 * before the response, must not throw into the request that scheduled it, and
 * must only drain the queue it was asked for.
 */

/** Stands in for Next's `after`: records the callback instead of running it. */
const scheduled: (() => Promise<void> | void)[] = [];
vi.mock("next/server", () => ({
  after: (fn: () => Promise<void> | void) => {
    scheduled.push(fn);
  },
}));

const sendQueuedEmails = vi.fn(async (_limit?: number) => ({ sent: 1, failed: 0 }));
const deliverIntegrationEvents = vi.fn(async (_limit?: number) => ({
  delivered: 1,
  failed: 0,
}));

vi.mock("@/server/jobs", () => ({ sendQueuedEmails }));
vi.mock("@/server/integrations", () => ({ deliverIntegrationEvents }));

const { drainAfterResponse } = await import("@/server/dispatch");

/** Runs whatever the request scheduled, as the host would after responding. */
const runScheduled = async () => {
  for (const fn of scheduled.splice(0)) await fn();
};

beforeEach(() => {
  scheduled.length = 0;
  sendQueuedEmails.mockClear();
  deliverIntegrationEvents.mockClear();
  sendQueuedEmails.mockResolvedValue({ sent: 1, failed: 0 });
  deliverIntegrationEvents.mockResolvedValue({ delivered: 1, failed: 0 });
});

describe("drainAfterResponse", () => {
  it("does nothing until the response has gone out", () => {
    drainAfterResponse();
    expect(sendQueuedEmails).not.toHaveBeenCalled();
    expect(deliverIntegrationEvents).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
  });

  it("drains both queues once it runs", async () => {
    drainAfterResponse();
    await runScheduled();
    expect(sendQueuedEmails).toHaveBeenCalledTimes(1);
    expect(deliverIntegrationEvents).toHaveBeenCalledTimes(1);
  });

  it("drains only emails when that is all that was queued", async () => {
    drainAfterResponse({ deliveries: false });
    await runScheduled();
    expect(sendQueuedEmails).toHaveBeenCalledTimes(1);
    expect(deliverIntegrationEvents).not.toHaveBeenCalled();
  });

  it("drains only deliveries when that is all that was queued", async () => {
    drainAfterResponse({ emails: false });
    await runScheduled();
    expect(deliverIntegrationEvents).toHaveBeenCalledTimes(1);
    expect(sendQueuedEmails).not.toHaveBeenCalled();
  });

  it("takes a bounded bite rather than the whole queue", async () => {
    drainAfterResponse();
    await runScheduled();
    const emailLimit = sendQueuedEmails.mock.calls[0]?.[0] ?? 0;
    const deliveryLimit = deliverIntegrationEvents.mock.calls[0]?.[0] ?? 0;
    expect(emailLimit).toBeGreaterThan(0);
    expect(emailLimit).toBeLessThanOrEqual(10);
    expect(deliveryLimit).toBeGreaterThan(0);
    expect(deliveryLimit).toBeLessThanOrEqual(10);
  });

  it("swallows a failure, because the scheduled job is the safety net", async () => {
    sendQueuedEmails.mockRejectedValueOnce(new Error("mail provider down"));
    drainAfterResponse();
    await expect(runScheduled()).resolves.toBeUndefined();
  });
});
