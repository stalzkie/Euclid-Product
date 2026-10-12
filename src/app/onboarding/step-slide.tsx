"use client";

import { m } from "motion/react";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { dur, ease } from "@/lib/motion/tokens";
import { hasHydrated } from "@/components/motion/hydrated";

/** The three steps, in order, so the slide knows which way it is going. */
const STEPS = ["/onboarding/app", "/onboarding/profile", "/onboarding/install"];

/**
 * Remembers which step was last shown, so a step change knows its direction.
 *
 * Module scope because the template remounts on every navigation — state
 * inside the component would be gone by the time the next step needed it.
 */
let lastIndex: number | null = null;

function rememberStep(index: number): void {
  lastIndex = index;
}

/**
 * Slides the step pane sideways as the founder moves through onboarding.
 *
 * Forward enters from the right, back from the left, which is the one place
 * in Euclid where direction carries meaning: it says whether you are making
 * progress or revisiting something. 16px and a crossfade, so the card itself
 * never appears to jump.
 */
export function StepSlide({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const index = STEPS.indexOf(pathname);

  // A page outside the three steps, or the very first paint: no direction to
  // show, and nothing should animate over server-rendered markup.
  const animate = index !== -1 && hasHydrated() && lastIndex !== null;
  const forward = animate && index >= (lastIndex ?? 0);

  // Recorded after the render that used it, so the next step knows where it
  // came from without this render reading a value it just wrote.
  useEffect(() => {
    if (index !== -1) rememberStep(index);
  }, [index]);

  return (
    <m.div
      initial={
        animate
          ? { opacity: 0, x: forward ? "var(--eu-slide-step)" : "calc(-1 * var(--eu-slide-step))" }
          : false
      }
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: dur.moderate, ease: ease.out }}
    >
      {children}
    </m.div>
  );
}
