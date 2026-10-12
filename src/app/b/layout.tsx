import type { ReactNode } from "react";
import { MotionProvider, Toaster } from "@/components/motion";

/**
 * The hosted public board.
 *
 * No cookie is read: the in-app reduced-motion switch belongs to the founder's
 * dashboard, and a visitor to a public board has never seen it. Their
 * operating system setting still applies, through `reducedMotion="user"`.
 */
export default function PublicBoardLayout({ children }: { children: ReactNode }) {
  return (
    <MotionProvider>
      <Toaster>{children}</Toaster>
    </MotionProvider>
  );
}
