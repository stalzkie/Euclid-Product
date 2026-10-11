"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { cx } from "./ui";

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
        "relative block h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-state-bright" : "bg-line",
      )}
    >
      <span
        className="absolute top-[2px] h-4 w-4 rounded-full bg-white transition-[left]"
        style={{ left: checked ? 18 : 2 }}
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
              "rounded-[7px] font-medium transition-colors",
              size === "sm" ? "h-6 px-[10px] text-[12px]" : "h-7 px-3 text-[12.5px]",
              on ? "bg-canvas text-ink shadow-seg" : "bg-transparent text-ink-2",
            )}
          >
            {opt.label}
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
              "flex h-7 items-center gap-[6px] rounded-[7px] px-3 text-[12.5px] font-medium transition-colors",
              on ? "bg-canvas text-ink shadow-seg" : "bg-transparent text-ink-2",
            )}
          >
            {opt.label}
            <span className="tnum text-[11.5px] text-ink-3">{opt.count}</span>
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
              "-mb-px border-b-2 pb-[9px] text-[13.5px] font-medium transition-colors",
              on ? "border-ink text-ink" : "border-transparent text-ink-3",
            )}
          >
            {opt.label}
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
        "rounded-[10px] border bg-canvas p-3 text-left transition-shadow",
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
        "h-9 rounded-control border px-[14px] text-[13.5px] font-medium transition-colors",
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

  return (
    <button
      type="button"
      aria-pressed={voted}
      aria-label={voted ? `Voted, ${votes} votes` : `Upvote, ${votes} votes`}
      onClick={onVote}
      disabled={disabled || !onVote}
      style={style}
      className={cx(
        "flex shrink-0 flex-col items-center justify-center gap-[1px] rounded-[10px] border font-semibold transition-colors",
        dims,
        !accent && voted
          ? "border-state-bright bg-state-wash text-state"
          : !accent
            ? "border-line-strong bg-canvas text-ink hover:border-ink-3"
            : "",
        !onVote && "cursor-default",
      )}
    >
      <Icon name="caretUp" size={14} strokeWidth={2.2} />
      <span className="tnum">{votes}</span>
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
        "inline-flex h-9 items-center gap-[7px] rounded-control px-[14px] text-[13.5px] font-medium transition-colors",
        styles[variant],
      )}
    >
      <Icon name={copied ? "check" : "copy"} size={14} strokeWidth={2} />
      {copied ? copiedLabel : label}
    </button>
  );
}

/** Small icon-only copy, for code blocks. */
export function CopyIconButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy to clipboard"}
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className="flex h-7 items-center gap-[6px] rounded-[6px] border border-line bg-canvas px-2 text-[12px] font-medium text-ink-2 hover:bg-subtle"
    >
      <Icon name={copied ? "check" : "copy"} size={12} strokeWidth={2} />
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
      className="inline-flex h-9 items-center gap-[7px] rounded-control border border-line-strong bg-canvas px-[14px] text-[13.5px] font-medium text-ink hover:bg-subtle"
    >
      <Icon name={icon} size={14} strokeWidth={1.9} />
      Download .md
    </button>
  );
}

/** A spinner for the generate paths, which can take seconds. */
export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className="animate-spin"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={3} />
      <path
        d="M12 3a9 9 0 0 1 9 9"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
      />
    </svg>
  );
}
