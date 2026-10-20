/**
 * Turning what the server saw into the sentence a founder needs.
 *
 * The install screen has always been able to say "yes" or "still waiting".
 * "Still waiting" is the useless half: it is the same message whether the
 * snippet was never pasted, was pasted into a file that never runs, or is
 * running perfectly and being refused by the allow-list on every load.
 *
 * `install_signals` records the last two cases (see 0031). This decides which
 * one a founder is actually in, and it is a pure function of those rows so
 * the decision can be tested without a database or a browser.
 */

export type InstallSignalReason = "blocked" | "local";

export interface InstallSignal {
  /** Hostname the request came from. */
  origin: string;
  reason: InstallSignalReason;
  count: number;
  /** ISO timestamp of the most recent one. */
  lastSeen: string;
}

export type Diagnosis =
  /** Serving on a real site. Nothing to diagnose. */
  | { kind: "installed" }
  /** Reaching us and being refused. The only one with a fix attached. */
  | { kind: "blocked"; origins: string[]; count: number }
  /** Working, on the founder's own machine. Not broken, just not deployed. */
  | { kind: "local"; origins: string[] }
  /** Nothing has arrived at all. The snippet is not running. */
  | { kind: "silent" };

/** Most recent first, and the busiest origin first within a tie. */
function byRecency(a: InstallSignal, b: InstallSignal): number {
  const diff = Date.parse(b.lastSeen) - Date.parse(a.lastSeen);
  if (diff !== 0 && Number.isFinite(diff)) return diff;
  return b.count - a.count;
}

/**
 * What to tell the founder.
 *
 * The order is the content. `installed` first, because a board that is live
 * has nothing to answer for even if it collected refusals on the way there —
 * a founder who fixed their allow-list an hour ago should not still be told
 * about it.
 *
 * Then `blocked` ahead of `local`, which is the one real judgement here. A
 * founder developing locally against a board that is also refusing their
 * staging domain is in both states at once, and only one of them is a
 * problem: "working on localhost" is reassurance, and reassurance that hides
 * a fault is worse than no message. So the fault wins and the reassurance
 * waits until there is nothing to fix.
 */
export function diagnose(installed: boolean, signals: InstallSignal[]): Diagnosis {
  if (installed) return { kind: "installed" };

  const blocked = signals.filter((s) => s.reason === "blocked").sort(byRecency);
  if (blocked.length > 0) {
    return {
      kind: "blocked",
      origins: blocked.map((s) => s.origin),
      // Every refusal, not just the newest origin's: the number is there to
      // say "this is happening constantly", and splitting it per host buries
      // that under arithmetic the reader has to do themselves.
      count: blocked.reduce((sum, s) => sum + s.count, 0),
    };
  }

  const local = signals.filter((s) => s.reason === "local").sort(byRecency);
  if (local.length > 0) return { kind: "local", origins: local.map((s) => s.origin) };

  return { kind: "silent" };
}
