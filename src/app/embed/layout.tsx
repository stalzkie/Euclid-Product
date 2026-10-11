import type { ReactNode } from "react";

/**
 * The embed renders inside an iframe on someone else's page, so it carries no
 * dashboard chrome and no page background of its own.
 */
export default function EmbedLayout({ children }: { children: ReactNode }) {
  return <div className="bg-transparent">{children}</div>;
}
