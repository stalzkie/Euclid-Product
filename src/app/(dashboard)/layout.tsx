import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { MotionProvider, Toaster } from "@/components/motion";
import { REDUCE_MOTION_COOKIE, isReduceMotionValue } from "@/lib/motion/preference";

/**
 * Every dashboard page reads the founder's session and their board's live
 * counts, so none of them can be prerendered.
 */
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
  const reduceMotion = isReduceMotionValue(store.get(REDUCE_MOTION_COOKIE)?.value);

  return (
    // display: contents keeps the wrapper out of the layout while still
    // handing the reduced-motion tokens down to everything inside it.
    <div style={{ display: "contents" }} data-reduce-motion={reduceMotion ? "1" : undefined}>
      <MotionProvider reduceMotion={reduceMotion}>
        <Toaster>{children}</Toaster>
      </MotionProvider>
    </div>
  );
}
