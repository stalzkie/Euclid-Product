/**
 * The retry schedule shared by both outboxes.
 *
 * Two queues retry on failure — webhook deliveries and emails — and they must
 * agree, because the thing that performs the retry is the same thing in both
 * cases: whichever request next calls `drainAfterResponse`, with the scheduled
 * job as a backstop. The formula lived inline in the delivery loop, where the
 * email loop could not see it and did not have one at all.
 *
 * The shape is chosen by one constraint: both queues carry things with a short
 * shelf life. A magic link expires an hour after it is created, and "the
 * feature you voted for shipped" is not news a week later. So every attempt
 * has to fit inside that hour — which rules out the usual
 * minutes-then-hours-then-days backoff, not because it is unfair to the
 * provider but because it would be retrying a token that is already dead.
 *
 * Within that hour, quadratic spaces the attempts out while keeping the first
 * retry a minute away rather than instant. A doubling schedule would fit too;
 * this is not the only answer, just a reasonable one with a stated bound.
 */

/** Attempts before a queued item is abandoned. Mirrored in SQL. */
export const RETRY_MAX_ATTEMPTS = 5;

/**
 * How long to wait before attempt `attempts + 1`, given how many have already
 * been made. 1, 4, 9 and 16 minutes, so a dead provider is given up on about
 * half an hour after the first try.
 *
 * `attempts` is the count *including* the one that just failed, which is what
 * both claim functions return — they increment on claim, so a first failure
 * arrives here as 1 and waits a minute rather than retrying instantly.
 */
export function retryDelayMs(attempts: number): number {
  // Floored at one attempt, and non-finite input treated as one. The row's
  // `attempts` is an integer column so this should not arise — but the result
  // goes straight into `new Date(...).toISOString()`, which throws on NaN, and
  // that would take down the whole batch rather than one message.
  const n = Number.isFinite(attempts) ? Math.max(1, Math.floor(attempts)) : 1;
  return n * n * 60_000;
}

/** Whether an item that has failed this many times should be retried at all. */
export function retriesLeft(attempts: number): boolean {
  return attempts < RETRY_MAX_ATTEMPTS;
}

/**
 * The same delay in whole seconds, which is what the two `fail_*` functions
 * in 0030 take.
 *
 * A delay rather than a timestamp, and that is the whole point. `deliver_after`
 * is only ever compared against the database's `now()`, so a timestamp computed
 * here was a value from one clock being read by another — and a server running
 * *behind* the database would compute a `deliver_after` already in the past and
 * retry with no backoff at all. Sending how long to wait and letting the
 * database add it to its own clock cannot drift, however far apart the two are.
 *
 * There is deliberately no `retryAfter` returning a timestamp any more. It
 * would still be correct wherever the clocks happen to agree, which is exactly
 * what made the fault survive a proof run that measured it.
 */
export function retryDelaySeconds(attempts: number): number {
  return Math.round(retryDelayMs(attempts) / 1000);
}
