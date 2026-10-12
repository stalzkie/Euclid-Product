import type { ReactNode } from "react";
import { StepSlide } from "./step-slide";

/**
 * A template rather than a layout, so it remounts on every step change — which
 * is what gives the slide something to animate.
 */
export default function OnboardingTemplate({ children }: { children: ReactNode }) {
  return <StepSlide>{children}</StepSlide>;
}
