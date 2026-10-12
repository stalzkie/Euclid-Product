"use client";

import { LazyMotion, MotionConfig } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { dur, ease } from "@/lib/motion/tokens";
import { ForcedReduceMotion } from "./reduce-motion";
import { markHydrated } from "./hydrated";

const loadFeatures = () => import("./features").then((mod) => mod.default);


/**
 * Wraps the app and onboarding layouts.
 *
 * `strict` is deliberate: it makes `motion.div` throw, so the only way to
 * animate is the `m` component, and nobody can quietly pull the full bundle
 * back in.
 */
export function MotionProvider({
  children,
  reduceMotion = false,
}: {
  children: ReactNode;
  /**
   * The in-app switch, read from a cookie on the server. The OS setting is
   * handled by `"user"`; this forces the same mode regardless of it.
   */
  reduceMotion?: boolean;
}) {
  // Runs after the hydration commit, so everything rendered into server markup
  // has already decided not to animate on mount.
  useEffect(markHydrated, []);

  return (
    <ForcedReduceMotion.Provider value={reduceMotion}>
      <LazyMotion features={loadFeatures} strict>
        <MotionConfig
          reducedMotion={reduceMotion ? "always" : "user"}
          transition={{ duration: dur.base, ease: ease.standard }}
        >
          {children}
        </MotionConfig>
      </LazyMotion>
    </ForcedReduceMotion.Provider>
  );
}
