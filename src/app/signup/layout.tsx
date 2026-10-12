import type { ReactNode } from "react";
import { MotionProvider } from "@/components/motion";

/**
 * Sign-up is the one screen with a little atmosphere, so it needs the
 * provider. No cookie is read here — the in-app reduced-motion switch is a
 * founder setting, and nobody signing up has set it yet. The OS setting still
 * applies, through `reducedMotion="user"`.
 */
export default function SignupLayout({ children }: { children: ReactNode }) {
  return <MotionProvider>{children}</MotionProvider>;
}
