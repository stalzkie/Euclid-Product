/**
 * The in-app "Reduce motion" switch.
 *
 * Stored in a cookie rather than localStorage so the server renders the same
 * thing the client does — the preference has to be known before the first
 * paint, or the founder sees exactly the motion they asked not to see.
 */
export const REDUCE_MOTION_COOKIE = "eu-reduce-motion";

/** A year: it is a preference, not a session. */
export const REDUCE_MOTION_MAX_AGE = 60 * 60 * 24 * 365;

export function isReduceMotionValue(value: string | undefined): boolean {
  return value === "1";
}
