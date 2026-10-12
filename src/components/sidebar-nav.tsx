"use client";

import Link from "next/link";
import { m } from "motion/react";
import { useId, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { cx } from "./ui";
import { AnimatedNumber } from "./motion/animated-number";
import { RailLabel } from "./sidebar-rail";
import { spring } from "@/lib/motion/tokens";

/**
 * The sidebar's rows.
 *
 * The active background is a single element shared across every row through
 * one `layoutId`, so moving between sections slides it rather than blinking it
 * off one row and on to another. It is the same idea as the segmented control
 * — one highlight, moved, not two states crossfaded.
 *
 * All the rows in a group have to be rendered by one component for that to
 * work, which is why the groups come through as data.
 */

export interface NavRow {
  key: string;
  label: string;
  href: string;
  icon?: IconName;
  count?: number;
  /** A board's colour swatch, in place of an icon. */
  swatch?: string;
  active?: boolean;
  height?: "sm" | "md";
}

export function SidebarNav({
  rows,
  /**
   * Rows across every group in the sidebar share one highlight, so the caller
   * passes the same id to each group it renders.
   */
  group,
}: {
  rows: NavRow[];
  group: string;
}) {
  return (
    <>
      {rows.map((row) => (
        <Link
          key={row.key}
          href={row.href}
          aria-current={row.active ? "page" : undefined}
          className={cx(
            "eu-colors relative flex items-center gap-[10px] rounded-control px-[10px]",
            "text-[13.5px] no-underline",
            row.height === "sm" ? "h-[30px]" : "h-8",
            row.active ? "font-medium text-ink" : "font-normal text-ink-body hover:bg-muted",
          )}
        >
          {row.active && (
            <m.span
              layoutId={group}
              transition={spring.snappy}
              className="absolute inset-0 rounded-control bg-nav-active"
            />
          )}

          <span className="relative flex w-4 shrink-0 justify-center">
            {row.swatch ? (
              <span className="h-2 w-2 rounded-[3px]" style={{ background: row.swatch }} />
            ) : row.icon ? (
              <Icon name={row.icon} size={16} />
            ) : null}
          </span>

          <RailLabel className="relative flex-1">{row.label}</RailLabel>

          {row.count !== undefined && (
            <RailLabel className="relative">
              <AnimatedNumber value={row.count} className="text-[11.5px] text-ink-3" />
            </RailLabel>
          )}
        </Link>
      ))}
    </>
  );
}

/**
 * A notification dot that scales in when something arrives and does not
 * pulse — it is a fact, not a request.
 */
export function NotificationDot({ show }: { show: boolean }) {
  const id = useId();
  if (!show) return null;

  return (
    <m.span
      key={id}
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={spring.snappy}
      className="absolute right-[6px] top-[5px] h-[6px] w-[6px] rounded-full bg-ai-bright"
    />
  );
}

/** Group headings and other sidebar text that disappears with the labels. */
export function RailHeading({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <RailLabel className={className}>{children}</RailLabel>;
}
