import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { STATUS_LABEL, STATUS_LOOK, type PostStatus } from "@/lib/types";
import { FadeRise } from "./motion/fade-rise";
import { CountUp } from "./motion/count-up";

/**
 * The component vocabulary from Foundations. Ink is the one primary per view.
 * Pink only on AI actions. Blue only for billing and system actions.
 */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* -------------------------------------------------------------------------- */
/* Buttons · 36 px controls                                                   */
/* -------------------------------------------------------------------------- */

type Variant = "primary" | "secondary" | "ai" | "system" | "ghost" | "danger";

const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-white border border-transparent hover:bg-[#28282d]",
  secondary:
    "bg-canvas text-ink border border-line-strong hover:bg-subtle",
  ai: "bg-ai text-white border border-transparent hover:bg-ai-deep",
  system: "bg-state text-white border border-transparent hover:bg-[#095fb8]",
  ghost: "bg-transparent text-ink-2 border border-transparent hover:bg-muted",
  danger: "bg-bad-wash text-bad border border-bad-line hover:bg-[#fde8e8]",
};

const BASE =
  "inline-flex h-9 items-center justify-center gap-[7px] rounded-control px-[14px] " +
  "text-[13.5px] font-medium eu-press disabled:opacity-50 " +
  "disabled:pointer-events-none whitespace-nowrap";

export function Button({
  variant = "secondary",
  icon,
  className,
  children,
  ...rest
}: ComponentProps<"button"> & { variant?: Variant; icon?: IconName }) {
  return (
    <button type="button" className={cx(BASE, VARIANT[variant], className)} {...rest}>
      {icon && <Icon name={icon} size={15} strokeWidth={1.9} />}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "secondary",
  icon,
  iconAfter,
  className,
  children,
  ...rest
}: ComponentProps<typeof Link> & {
  variant?: Variant;
  icon?: IconName;
  iconAfter?: IconName;
}) {
  return (
    <Link className={cx(BASE, VARIANT[variant], "no-underline", className)} {...rest}>
      {icon && <Icon name={icon} size={15} strokeWidth={1.9} />}
      {children}
      {iconAfter && <Icon name={iconAfter} size={13} strokeWidth={2} />}
    </Link>
  );
}

/** Primary with a split chevron, as on Home's "New Build Prompt". */
export function SplitButton({
  href,
  label,
  onMore,
}: {
  href: string;
  label: string;
  onMore?: () => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-control">
      <Link
        href={href}
        className="eu-press flex h-9 items-center bg-ink px-[14px] text-[13.5px] font-medium text-white no-underline hover:bg-[#28282d]"
      >
        {label}
      </Link>
      <button
        type="button"
        aria-label="More create options"
        onClick={onMore}
        className="eu-press flex h-9 w-8 items-center justify-center border-l border-ink-edge bg-ink text-white hover:bg-[#28282d]"
      >
        <Icon name="chevronDown" size={14} strokeWidth={2} />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                   */
/* -------------------------------------------------------------------------- */

export function Card({
  className,
  children,
  ...rest
}: ComponentProps<"section">) {
  return (
    <section
      className={cx("rounded-card border border-line bg-canvas", className)}
      {...rest}
    >
      {children}
    </section>
  );
}

/** Tinted pink, as every AI surface is. */
export function AiCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={cx(
        "rounded-[14px] border border-ai-line p-[18px]",
        "bg-[linear-gradient(180deg,#FDF0F6_0%,#FFFFFF_55%)]",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function SectionTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-[16px] font-semibold">
      {children}
    </h2>
  );
}

export function Overline({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-3">
      {children}
    </h2>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-[26px] font-semibold tracking-[-0.015em]">{title}</h1>
        {subtitle && <p className="text-[14px] text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Chips and badges                                                           */
/* -------------------------------------------------------------------------- */

export function StatusChip({ status }: { status: PostStatus }) {
  const look = STATUS_LOOK[status];
  return (
    <span
      className="eu-crossfade whitespace-nowrap rounded-full px-[9px] py-[3px] text-[12px] font-medium"
      style={{ background: look.bg, color: look.fg }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Chip({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "ok" | "warn" | "bad" | "state" | "ai";
  children: ReactNode;
}) {
  const tones = {
    neutral: "bg-muted text-ink-2",
    ok: "bg-ok-wash text-ok",
    warn: "bg-warn-wash text-warn",
    bad: "bg-bad-wash text-bad",
    state: "bg-state-wash text-state",
    ai: "bg-ai-wash text-ai-deep",
  } as const;
  return (
    <span
      className={cx(
        "eu-crossfade whitespace-nowrap rounded-full px-[7px] py-[2px] text-[12px] font-medium",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-[5px] border border-line px-[5px] font-mono text-[11px] text-ink-3">
      {children}
    </span>
  );
}

/** The pink AI label used above every generated surface. */
export function AiLabel({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-center gap-[7px] text-[12.5px] font-semibold text-ai-deep">
      <Icon name="sparkle" size={15} strokeWidth={1.9} />
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Data display                                                              */
/* -------------------------------------------------------------------------- */

export function Stat({
  label,
  value,
  delta,
  deltaTone = "ok",
  note,
  className,
  metric,
}: {
  label: string;
  value: string | number;
  delta?: string;
  deltaTone?: "ok" | "bad" | "neutral";
  note?: string;
  className?: string;
  /**
   * Turns the number into a count-up the first time it is seen this session.
   * Pass something stable and unique; omit it for a figure that should simply
   * be there, which is most of them.
   */
  metric?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-[6px] px-5 py-4", className)}>
      <span className="text-[13px] text-ink-2">{label}</span>
      <span className="flex items-baseline gap-2">
        {metric !== undefined && typeof value === "number" ? (
          <CountUp
            value={value}
            metric={metric}
            className="text-[30px] font-semibold tracking-[-0.02em]"
          />
        ) : (
          <span className="tnum text-[30px] font-semibold tracking-[-0.02em]">{value}</span>
        )}
        {delta && (
          <span
            className={cx(
              "rounded-full px-[7px] py-[2px] text-[12px] font-medium",
              deltaTone === "ok" && "bg-ok-wash text-ok",
              deltaTone === "bad" && "bg-bad-wash text-bad",
              deltaTone === "neutral" && "text-ink-3",
            )}
          >
            {delta}
          </span>
        )}
        {note && <span className="text-[12px] text-ink-3">{note}</span>}
      </span>
    </div>
  );
}

/** A 7-point sparkline on a 0–24 vertical box, matching the design's polylines. */
export function Sparkline({
  points,
  width = 88,
  height = 26,
  color = "#15803D",
}: {
  points: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  const max = Math.max(1, ...points);
  const step = points.length > 1 ? (width - 4) / (points.length - 1) : 0;
  const path = points
    .map((v, i) => `${(2 + i * step).toFixed(1)},${(height - 3 - (v / max) * (height - 6)).toFixed(1)}`)
    .join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline
        points={path}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Meter({
  value,
  max,
  color = "#1A8CFF",
  /** The colour it crossfades to once the allowance is gone. */
  limitColor = "#F59E0B",
}: {
  value: number;
  max: number;
  color?: string;
  limitColor?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const full = pct >= 100;

  return (
    <div className="h-[6px] overflow-hidden rounded-full bg-line" role="presentation">
      {/*
        A full-width bar scaled from its left edge. Animating the width would
        lay the page out again on every frame; a transform is composited, and
        the parent's overflow gives the fill its rounded cap.
      */}
      <div
        className={cx(
          "h-full w-full origin-left",
          "transition-[transform,background-color] ease-eu-standard",
          "duration-[var(--eu-dur-moderate)]",
        )}
        style={{
          transform: `scaleX(${pct / 100})`,
          background: full ? limitColor : color,
        }}
      />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    // One fade for the whole thing. The illustration does not move: an empty
    // state is a dead end, and animating it suggests something is coming.
    <FadeRise className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-muted text-ink-3">
        <Icon name={icon} size={20} />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-[15px] font-medium">{title}</p>
        <p className="max-w-[380px] text-[13px] leading-[1.5] text-ink-3">{body}</p>
      </div>
      {action}
    </FadeRise>
  );
}

/* -------------------------------------------------------------------------- */
/* Form fields                                                                */
/* -------------------------------------------------------------------------- */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-[6px] text-[13px] font-medium">
      {label}
      {children}
      {hint && <span className="text-[12px] font-normal text-ink-3">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "eu-colors h-9 w-full rounded-control border border-line-strong bg-canvas px-3 " +
  "text-[14px] font-normal text-ink placeholder:text-ink-3 outline-none";

export const textareaClass =
  "eu-colors w-full rounded-control border border-line-strong bg-canvas px-3 py-2 " +
  "text-[14px] font-normal leading-[1.5] text-ink placeholder:text-ink-3 outline-none resize-y";

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(textareaClass, props.className)} />;
}

export function Banner({
  tone,
  icon,
  children,
  action,
}: {
  tone: "ok" | "warn" | "bad" | "ai" | "state";
  icon?: IconName;
  children: ReactNode;
  action?: ReactNode;
}) {
  const tones = {
    ok: "border-ok-line bg-ok-wash text-ok",
    warn: "border-[#FDE68A] bg-warn-wash text-warn",
    bad: "border-bad-line bg-bad-wash text-bad",
    ai: "border-ai-line bg-ai-wash text-ink",
    state: "border-[#BFDBFE] bg-state-wash text-state",
  } as const;
  return (
    <div
      className={cx(
        "flex items-center gap-[10px] rounded-[10px] border px-3 py-[10px] text-[13px]",
        tones[tone],
      )}
    >
      {icon && <Icon name={icon} size={16} strokeWidth={1.8} />}
      <span className="flex-1">{children}</span>
      {action}
    </div>
  );
}
