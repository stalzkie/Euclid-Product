import { after } from "next/server";
import { sendQueuedEmails } from "@/server/jobs";
import { deliverIntegrationEvents } from "@/server/integrations";

/**
 * Draining the outboxes once the response has already gone out.
 *
 * Emails and webhook deliveries are queued rather than sent inline, so that a
 * slow mail provider or a Slack outage cannot fail the post that caused them.
 * The queue still has to be drained by something, and leaving that entirely to
 * the scheduler means a magic link arrives whenever the cron next runs — which
 * on some hosts is once a day. That is not a sign-in flow.
 *
 * So the request that queued the work also drains a little of it, after its
 * own response has been sent. The scheduled job stays as the safety net for
 * anything this misses: a retry after a backoff, a host that does not run
 * deferred work, a queue longer than one request should take on.
 *
 * Deliveries are claimed atomically (`claim_integration_deliveries`), so this
 * racing the cron, or two requests racing each other, is safe.
 */

/** Emails to attempt per request. Enough for the one just queued, and a few. */
const EMAIL_BATCH = 5;
/** Webhook deliveries to attempt per request. */
const DELIVERY_BATCH = 5;

export interface DrainOptions {
  emails?: boolean;
  deliveries?: boolean;
}

/**
 * Queues a drain to run after the response. Never throws and never delays the
 * response: whatever fails here is still in the outbox for the scheduler.
 */
export function drainAfterResponse({ emails = true, deliveries = true }: DrainOptions = {}) {
  after(async () => {
    try {
      await Promise.all([
        emails ? sendQueuedEmails(EMAIL_BATCH) : null,
        deliveries ? deliverIntegrationEvents(DELIVERY_BATCH) : null,
      ]);
    } catch {
      // The scheduled job will pick this up. A failure after the response has
      // been sent has nowhere useful to go.
    }
  });
}
