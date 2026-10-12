import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { MotionProvider, Toaster } from "@/components/motion";
import { REDUCE_MOTION_COOKIE, isReduceMotionValue } from "@/lib/motion/preference";

/** Onboarding reads the signed-in user, so it is per-request. */
export const dynamic = "force-dynamic";

export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
  const reduceMotion = isReduceMotionValue(store.get(REDUCE_MOTION_COOKIE)?.value);

  return (
    <div style={{ display: "contents" }} data-reduce-motion={reduceMotion ? "1" : undefined}>
      <MotionProvider reduceMotion={reduceMotion}>
        <Toaster>{children}</Toaster>
      </MotionProvider>
    </div>
  );
}
