import type { ReactNode } from "react";

/** Onboarding reads the signed-in user, so it is per-request. */
export const dynamic = "force-dynamic";

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return children;
}
