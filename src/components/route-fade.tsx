"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { FadeRise } from "./motion/fade-rise";

/**
 * Fades the main column in when the route changes.
 *
 * Only the main column: the sidebar stays exactly where it is, because the
 * chrome did not change and moving it would make navigation feel slower than
 * it is. There is no exit animation for the outgoing page for the same reason
 * — nothing should sit between a click and the next screen.
 *
 * Keyed on the pathname, so a query change (a date range, a board filter)
 * updates in place rather than fading the whole column again.
 */
export function RouteFade({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <FadeRise key={pathname}>{children}</FadeRise>;
}
