"use client";

import { m } from "motion/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { cx } from "./ui";
import { AnimatedNumber } from "./motion/animated-number";
import { IconSwap } from "./motion/icon-swap";
import { dur, ease, spring } from "@/lib/motion/tokens";

/* -------------------------------------------------------------------------- */
/* Toggle · 36×20 pill, blue when on                                          */
/* -------------------------------------------------------------------------- */

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "eu-colors relative block h-5 w-9 shrink-0 rounded-full disabled:opacity-50",
        checked ? "bg-state-bright" : "bg-line",
      )}
    >
      {/*
        The knob travels on a transform. Animating `left` would lay the row out
        again on every frame, and the knob is the one thing in the control that
        has to feel immediate.
      */}
      <span
        className={cx(
          "absolute left-[2px] top-[2px] h-4 w-4 rounded-full bg-white",
          "transition-transform duration-[var(--eu-dur-fast)] ease-eu-standard",
        )}
        style={{ transform: checked ? "translateX(var(--eu-knob-travel))" : undefined }}
      />
    </button>
  );
}

/** Toggle with its label and detail line, as on Build Prompt and Changelog. */
export function ToggleRow({
  label,
  detail,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  detail?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13.5px] font-medium">{label}</span>
        {detail && <span className="text-[12px] text-ink-3">{detail}</span>}
      </span>
      <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Segmented control · grey track, white raised thumb                         */
/* -------------------------------------------------------------------------- */

/**
 * The thumb is one element that slides to the option you picked, rather than
 * a background appearing on the new option and disappearing from the old. It
 * is the same trick as the tab underline and the sidebar's active row: a
 * shared `layoutId` means Motion animates between the two positions, so the
 * control explains where the selection went.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  size?: "sm" | "md";
}) {
  // Each control needs its own id, or two on a page would share a thumb.
  const group = useId();

  return (
    <div className="flex gap-[2px] rounded-[9px] bg-muted p-[3px]" role="tablist">
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(opt.value)}
            className={cx(
              "eu-colors relative font-medium",
              size === "sm" ? "h-6 px-[10px] text-[12px]" : "h-7 px-3 text-[12.5px]",
              on ? "text-ink" : "text-ink-2",
            )}
          >
            {on && (
              <m.span
                layoutId={group}
                transition={spring.snappy}
                className="absolute inset-0 rounded-[7px] bg-canvas shadow-seg"
              />
            )}
            <span className="relative">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Segmented control that also shows a count, as on the Feedback inbox tabs. */
export function CountTabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; count: number }[];
  value: T;
  onChange: (next: T) => void;
}) {
  const group = useId();

  return (
    <div className="flex flex-wrap gap-[2px] rounded-[9px] bg-muted p-[3px]" role="tablist">
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(opt.value)}
            className={cx(
              "eu-colors relative flex h-7 items-center gap-[6px] px-3 text-[12.5px] font-medium",
              on ? "text-ink" : "text-ink-2",
            )}
          >
            {on && (
              <m.span
                layoutId={group}
                transition={spring.snappy}
                className="absolute inset-0 rounded-[7px] bg-canvas shadow-seg"
              />
            )}
            <span className="relative">{opt.label}</span>
            {/* The count rolls, because it is data that changed. */}
            <AnimatedNumber value={opt.count} className="relative text-[11.5px] text-ink-3" />
          </button>
        );
      })}
    </div>
  );
}

/** Underlined tabs, as on Post detail's reply box and Build Prompt's editor. */
export function UnderlineTabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  const group = useId();

  return (
    <div className="flex gap-4 border-b border-line" role="tablist">
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(opt.value)}
            className={cx(
              "eu-colors relative pb-[9px] text-[13.5px] font-medium",
              on ? "text-ink" : "text-ink-3",
            )}
          >
            {opt.label}
            {on && (
              <m.span
                layoutId={group}
                transition={spring.snappy}
                className="absolute -bottom-px left-0 right-0 h-[2px] bg-ink"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Pick-one cards with a blue ring, as on the tool and preset pickers. */
export function PickerCard({
  selected,
  onClick,
  children,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        "eu-press rounded-[10px] border bg-canvas p-3 text-left",
        selected ? "border-state-bright shadow-[0_0_0_3px_var(--color-state-ring)]" : "border-line",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Multi-select pill, as on the "what do you build with" step. */
export function PillToggle({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        "eu-press h-9 rounded-control border px-[14px] text-[13.5px] font-medium",
        selected
          ? "border-state-bright bg-state-wash text-state"
          : "border-line-strong bg-canvas text-ink hover:bg-subtle",
      )}
    >
      {label}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Vote button · 48×52, blue once voted                                       */
/* -------------------------------------------------------------------------- */

/**
 * The signature interaction, so it gets the most care.
 *
 * Pressing it scales to 0.96. Voting hops the chevron up three pixels and
 * back, crossfades the button to the voted colour and rolls the count up — all
 * optimistically, before the request returns, because a vote that waits for a
 * server does not feel like a vote. Un-voting reverses everything except the
 * hop: taking a vote back is not something to celebrate.
 *
 * The count comes from the caller, so a failed write rolls the digits back
 * down simply by passing the old number again.
 */
export function VoteButton({
  votes,
  voted,
  onVote,
  size = "md",
  accent,
  disabled,
}: {
  votes: number;
  voted: boolean;
  onVote?: () => void;
  size?: "sm" | "md";
  accent?: string;
  disabled?: boolean;
}) {
  const dims = size === "sm" ? "h-12 w-11 text-[13px]" : "h-[52px] w-12 text-[13px]";
  const style = accent
    ? voted
      ? { borderColor: accent, background: accent, color: "#fff" }
      : undefined
    : undefined;

  // The hop is a one-shot, so it is keyed on the vote count going up rather
  // than on `voted` — a vote is the cause, and a re-render is not.
  const [hop, setHop] = useState(0);
  const interactive = Boolean(onVote) && !disabled;

  return (
    <button
      type="button"
      aria-pressed={voted}
      aria-label={voted ? `Voted, ${votes} votes` : `Upvote, ${votes} votes`}
      onClick={() => {
        if (!interactive) return;
        if (!voted) setHop((n) => n + 1);
        onVote?.();
      }}
      disabled={!interactive}
      style={style}
      className={cx(
        "eu-press flex shrink-0 flex-col items-center justify-center gap-[1px]",
        "rounded-[10px] border font-semibold",
        "active:scale-[var(--eu-vote-scale)]",
        dims,
        !accent && voted
          ? "border-state-bright bg-state-wash text-state"
          : !accent
            ? "border-line-strong bg-canvas text-ink hover:border-ink-3"
            : "",
        !interactive && "cursor-default",
      )}
    >
      <m.span
        // Remounting on each vote restarts the hop from wherever it is, which
        // is what makes repeated clicks feel responsive instead of queued.
        key={hop}
        initial={hop === 0 ? false : { y: 0 }}
        animate={hop === 0 ? undefined : { y: ["0px", "var(--eu-hop)", "0px"] }}
        transition={{ duration: dur.hop, ease: ease.out, times: [0, 0.45, 1] }}
        className="block"
      >
        <Icon name="caretUp" size={14} strokeWidth={2.2} />
      </m.span>
      <AnimatedNumber value={votes} live={interactive} />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Copy · flips to a tick for two seconds                                     */
/* -------------------------------------------------------------------------- */

export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  variant = "primary",
  onCopied,
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  variant?: "primary" | "secondary" | "ai";
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard can be blocked; fall back to a hidden textarea.
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
    }
    setCopied(true);
    onCopied?.();
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  const styles = {
    primary: "bg-ink text-white hover:bg-[#28282d]",
    secondary: "border border-line-strong bg-canvas text-ink hover:bg-subtle",
    ai: "bg-ai text-white hover:bg-ai-deep",
  } as const;

  return (
    <button
      type="button"
      onClick={copy}
      className={cx(
        "eu-press inline-flex h-9 items-center gap-[7px] rounded-control px-[14px]",
        "text-[13.5px] font-medium",
        styles[variant],
      )}
    >
      <IconSwap swapKey={copied ? "copied" : "idle"}>
        <Icon name={copied ? "check" : "copy"} size={14} strokeWidth={2} />
      </IconSwap>
      {copied ? copiedLabel : label}
    </button>
  );
}

/** Small icon-only copy, for code blocks. */
export function CopyIconButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy to clipboard"}
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1800);
      }}
      className={cx(
        "eu-press flex h-7 items-center gap-[6px] rounded-[6px] border border-line",
        "bg-canvas px-2 text-[12px] font-medium text-ink-2 hover:bg-subtle",
      )}
    >
      <IconSwap swapKey={copied ? "copied" : "idle"} size={12}>
        <Icon name={copied ? "check" : "copy"} size={12} strokeWidth={2} />
      </IconSwap>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** Download text as a file. Used for the .md prompt export. */
export function DownloadButton({
  text,
  filename,
  icon = "download",
}: {
  text: string;
  filename: string;
  icon?: IconName;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }}
      className={cx(
        "eu-press inline-flex h-9 items-center gap-[7px] rounded-control border",
        "border-line-strong bg-canvas px-[14px] text-[13.5px] font-medium text-ink hover:bg-subtle",
      )}
    >
      <Icon name={icon} size={14} strokeWidth={1.9} />
      Download .md
    </button>
  );
}

/**
 * A spinner for the generate paths, which can take seconds.
 *
 * One of the two loops that survive reduced motion: a spinner that does not
 * turn says nothing at all.
 */
export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className="eu-spinner shrink-0"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9.25"
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.25}
        strokeWidth={2.6}
      />
      <path
        d="M12 2.75a9.25 9.25 0 0 1 9.25 9.25"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
      />
    </svg>
  );
}
