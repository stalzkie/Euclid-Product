"use client";

import { createContext, useContext } from "react";
import { useReducedMotion } from "motion/react";

/**
 * Whether the in-app "Reduce motion" switch is on. The OS setting is a
 * separate signal that Motion reads for itself; `useReduceMotion` below is
 * what components should ask, because it answers for both.
 */
export const ForcedReduceMotion = createContext(false);

/**
 * True when movement should be removed, from either trigger.
 *
 * Most components never need this — the CSS tokens zero their own distances
 * and `MotionConfig` strips transforms out of Motion animations. Reach for it
 * when an animation has no final state to snap to and simply should not run:
 * a count-up, a chart draw-in, smooth scrolling.
 */
export function useReduceMotion(): boolean {
  const forced = useContext(ForcedReduceMotion);
  const os = useReducedMotion();
  return forced || Boolean(os);
}
