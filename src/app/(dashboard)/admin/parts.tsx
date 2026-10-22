import type { ReactNode } from "react";
import Link from "next/link";
import { cx } from "@/components/ui";
import { ago, longDate } from "@/lib/format";

/**
 * The console's own furniture.
 *
 * Denser than `components/ui.tsx` on purpose. The dashboard is one founder
 * reading one board and can spend space on breathing room; this is every
 * workspace at once, and an operator scanning for the row that is wrong wants
 * rows per screen. Same tokens, tighter type, tabular numbers everywhere a
 * number can be compared down a column.
 */

/* -------------------------------------------------------------------------- */
/* Layout                                                                     */
/* -------------------------------------------------------------------------- */

export function Panel({
  title,
  note,
  aside,
  children,
  id,
}: {
  title: string;
  note?: string;
  aside?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  const heading = id ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <section aria-labelledby={heading} className="flex min-w-0 flex-col gap-2.5">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id={heading}
          className="text-[12px] font-semibold uppercase tracking-[0.07em] text-ink-2"
        >
          {title}
        </h2>
        {aside}
      </header>
      {note && <p className="-mt-1 text-[12.5px] text-ink-3">{note}</p>}
      {children}
    </section>
  );
}

export function Cols({ children, min = 220 }: { children: ReactNode; min?: number }) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))` }}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Numbers                                                                    */
/* -------------------------------------------------------------------------- */

export type Tone = "neutral" | "ok" | "warn" | "bad" | "state" | "ai";

const FIGURE_TONE: Record<Tone, string> = {
  neutral: "text-ink",
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
  state: "text-state",
  ai: "text-ai",
};

export function Figure({
  label,
  value,
  note,
  tone = "neutral",
  href,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: Tone;
  href?: string;
}) {
  const body = (
    <>
      <span className="text-[12px] text-ink-2">{label}</span>
      <span className={cx("tnum text-[22px] font-semibold tracking-[-0.02em]", FIGURE_TONE[tone])}>
        {value}
      </span>
      {note !== undefined && <span className="text-[11.5px] text-ink-3">{note}</span>}
    </>
  );

  const shell = "flex min-w-0 flex-col gap-[3px] rounded-card border border-line px-3.5 py-3";
  return href ? (
    <a href={href} className={cx(shell, "transition-colors hover:border-line-strong hover:bg-subtle")}>
      {body}
    </a>
  ) : (
    <div className={shell}>{body}</div>
  );
}

/** A change against the window before it, phrased as the operator reads it. */
export function Delta({ now, prev }: { now: number; prev: number }) {
  if (prev === 0 && now === 0) return <span className="text-ink-3">flat</span>;
  if (prev === 0) return <span className="text-ok">new</span>;
  const pct = Math.round(((now - prev) / prev) * 100);
  if (pct === 0) return <span className="text-ink-3">flat</span>;
  return (
    <span className={pct > 0 ? "text-ok" : "text-bad"}>
      {pct > 0 ? "+" : ""}
      {pct}% vs prev
    </span>
  );
}

export function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/* -------------------------------------------------------------------------- */
/* Chips and addresses                                                        */
/* -------------------------------------------------------------------------- */

const PILL_TONE: Record<Tone, string> = {
  neutral: "border-line bg-subtle text-ink-2",
  ok: "border-ok-line bg-ok-wash text-ok",
  warn: "border-[#FDE68A] bg-warn-wash text-warn",
  bad: "border-bad-line bg-bad-wash text-bad",
  state: "border-state-ring bg-state-wash text-state",
  ai: "border-ai-line bg-ai-wash text-ai",
};

export function Pill({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex shrink-0 items-center rounded-chip border px-1.5 py-[1px] text-[11px] font-medium",
        PILL_TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

/** How a subscription status reads at a glance. */
export function statusTone(status: string | null): Tone {
  switch (status) {
    case "active":
      return "ok";
    case "trialing":
      return "state";
    case "past_due":
    case "unpaid":
      return "bad";
    case "canceled":
      return "warn";
    default:
      return "neutral";
  }
}

/**
 * An address, in mono, selectable, and a mail link.
 *
 * Mono because addresses are compared character by character down a column,
 * and a proportional font makes `rn` and `m` the same shape. The whole point
 * of this console is that the person is named, so nothing here truncates an
 * address with CSS — a long one wraps instead.
 */
export function Email({ address, dim }: { address: string | null | undefined; dim?: boolean }) {
  if (!address) return <span className="text-[12px] text-ink-3">no address</span>;
  return (
    <a
      href={`mailto:${address}`}
      className={cx(
        "break-all font-mono text-[12px] underline-offset-2 hover:underline",
        dim ? "text-ink-2" : "text-ink",
      )}
    >
      {address}
    </a>
  );
}

/** A timestamp: relative for scanning, exact in the title for certainty. */
/**
 * An address, and a way into that person's page.
 *
 * Two anchors side by side rather than one wrapping the other, which is what
 * five of these cells did first: a `<Link>` around `<Email>` is an `<a>`
 * inside an `<a>`. The browser repairs it by closing the outer anchor early,
 * so the server HTML and the client tree disagree and React throws a
 * hydration error (#418) on every tab that rendered one — Workspaces, Events,
 * Behaviour, Retention, and Billing whenever a trial was ending. It also made
 * clicking the address ambiguous: mail them, or open their page?
 *
 * So: the address mails them, the arrow opens them.
 */
export function PersonCell({
  email,
  userId,
  fallback = "no member",
}: {
  email: string | null | undefined;
  userId?: string | null;
  fallback?: string;
}) {
  if (!email && !userId) return <span className="text-[12px] text-ink-3">{fallback}</span>;

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Email address={email} />
      {userId && (
        <Link
          href={`/admin/people/${userId}`}
          title="Open this person"
          aria-label={`Open ${email ?? "this person"}`}
          className="text-[12px] text-ink-3 no-underline hover:text-state"
        >
          ↗
        </Link>
      )}
    </span>
  );
}

export function When({ at, prefix }: { at: string | null | undefined; prefix?: string }) {
  if (!at) return <span className="text-ink-3">never</span>;
  return (
    <span className="whitespace-nowrap text-ink-2" title={longDate(at)}>
      {prefix ? `${prefix} ` : ""}
      {ago(at)}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-card border border-line px-4 py-6 text-center text-[12.5px] text-ink-3">
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Tables                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One scrollable table.
 *
 * The horizontal scroll is on the wrapper rather than the page, so a
 * forty-column workspace table never makes the whole console scroll sideways.
 */
export function Table({
  head,
  children,
  min = 720,
}: {
  head: ReactNode[];
  children: ReactNode;
  min?: number;
}) {
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full text-[12.5px]" style={{ minWidth: min }}>
        <thead>
          <tr className="border-b border-line bg-subtle text-left text-[11px] uppercase tracking-[0.05em] text-ink-3">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Tr({ children, tone }: { children: ReactNode; tone?: Tone }) {
  return (
    <tr
      className={cx(
        "border-b border-hairline last:border-0 hover:bg-subtle",
        tone === "bad" && "bg-bad-wash/40",
        tone === "warn" && "bg-warn-wash/50",
      )}
    >
      {children}
    </tr>
  );
}

export function Td({
  children,
  num,
  wrap,
  mono,
  className,
}: {
  children: ReactNode;
  num?: boolean;
  wrap?: boolean;
  mono?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cx(
        "px-3 py-[7px] align-top text-ink",
        num && "tnum text-right",
        mono && "font-mono text-[11.5px]",
        !wrap && "whitespace-nowrap",
        className,
      )}
    >
      {children}
    </td>
  );
}

/* -------------------------------------------------------------------------- */
/* Charts                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One bar per day.
 *
 * Server-rendered SVG with no client JavaScript: these are read, not
 * interacted with, and a chart library on the operator console would be the
 * largest bundle in the app for the smallest audience in it. `currentColor`
 * takes the tone from the wrapper so the same component is every series.
 */
export function Bars({
  points,
  labels,
  tone = "state",
  height = 54,
}: {
  points: number[];
  labels?: string[];
  tone?: Tone;
  height?: number;
}) {
  const max = Math.max(1, ...points);
  const n = Math.max(1, points.length);
  const width = 320;
  const gap = n > 60 ? 0.5 : 1.5;
  const bar = (width - gap * (n - 1)) / n;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${points.reduce((a, b) => a + b, 0)} over ${n} days, peak ${max}`}
      className={cx("h-[54px] w-full", FIGURE_TONE[tone])}
      style={{ height }}
    >
      {points.map((v, i) => {
        // A non-zero day always draws something: a 1 against a peak of 400 is
        // still the difference between quiet and nothing at all.
        const h = v === 0 ? 0 : Math.max(1.5, (v / max) * (height - 2));
        return (
          <rect
            key={i}
            x={i * (bar + gap)}
            y={height - h}
            width={bar}
            height={h}
            fill="currentColor"
            opacity={labels && i === points.length - 1 ? 1 : 0.75}
          >
            {labels && <title>{`${labels[i]}: ${v}`}</title>}
          </rect>
        );
      })}
    </svg>
  );
}

/** A metric with its shape under it. */
export function Series({
  label,
  total,
  previous,
  points,
  labels,
  tone = "state",
}: {
  label: string;
  total: number;
  previous: number;
  points: number[];
  labels: string[];
  tone?: Tone;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-card border border-line px-3.5 py-3">
      <span className="text-[12px] text-ink-2">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className="tnum text-[22px] font-semibold tracking-[-0.02em]">{total}</span>
        <span className="text-[11.5px]">
          <Delta now={total} prev={previous} />
        </span>
      </span>
      <Bars points={points} labels={labels} tone={tone} height={40} />
    </div>
  );
}

/** A horizontal proportion bar, for breakdowns and funnel steps. */
export function Meterline({
  label,
  value,
  share,
  right,
  tone = "state",
}: {
  label: ReactNode;
  value: ReactNode;
  share: number;
  right?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-hairline px-3 py-2 last:border-0">
      <span className="w-[180px] shrink-0 truncate text-[12.5px] text-ink">{label}</span>
      <span className="h-[14px] flex-1 overflow-hidden rounded-[3px] bg-subtle">
        <span
          className={cx("block h-full rounded-[3px] bg-current", FIGURE_TONE[tone])}
          style={{ width: `${Math.max(share * 100, share > 0 ? 1.5 : 0)}%` }}
        />
      </span>
      <span className="tnum w-12 shrink-0 text-right text-[12.5px] font-medium text-ink">
        {value}
      </span>
      {right !== undefined && (
        <span className="tnum w-20 shrink-0 text-right text-[12px] text-ink-3">{right}</span>
      )}
    </div>
  );
}
