"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

/**
 * The console's only navigation.
 *
 * A tab strip rather than the dashboard sidebar, and that is the deliberate
 * part: the sidebar is a founder's nav — one workspace, one board, their own
 * data — and carrying it into a screen that reads every workspace invites
 * clicking "Feedback" and landing back in one. This is a different tool that
 * happens to share a login, so it gets a different frame.
 */
const TABS: { href: string; label: string }[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/people", label: "People" },
  { href: "/admin/workspaces", label: "Workspaces" },
  { href: "/admin/events", label: "Events" },
  { href: "/admin/behaviour", label: "Behaviour" },
  { href: "/admin/retention", label: "Retention" },
  { href: "/admin/boards", label: "Boards" },
  { href: "/admin/billing", label: "Billing" },
  { href: "/admin/mail", label: "Mail" },
  { href: "/admin/errors", label: "Errors" },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Operations" className="-mb-px flex gap-1 overflow-x-auto">
      {TABS.map((tab) => {
        // Exact for Overview, prefix for the rest, so /admin/people/<id> keeps
        // People lit rather than falling back to Overview.
        const active =
          tab.href === "/admin"
            ? pathname === "/admin"
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "whitespace-nowrap border-b-2 px-3 py-2 text-[13px] transition-colors",
              active
                ? "border-ink font-medium text-ink"
                : "border-transparent text-ink-3 hover:border-line-strong hover:text-ink",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
