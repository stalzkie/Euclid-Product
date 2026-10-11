import type { ReactNode } from "react";

/**
 * Every dashboard page reads the founder's session and their board's live
 * counts, so none of them can be prerendered.
 */
export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return children;
}
