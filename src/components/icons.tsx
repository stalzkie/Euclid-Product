import Image from "next/image";
import type { SVGProps } from "react";

/**
 * Every icon in the product, as the single-path outlines the designs use:
 * 24×24 box, no fill, currentColor stroke, round caps and joins.
 */
export const PATHS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  feedback: "M4 13h4l1.5 3h5L16 13h4M5 5h14l1 8v6H4v-6z",
  themes: "m12 3 9 5-9 5-9-5zM3 13l9 5 9-5",
  insights: "M5 20V11M11 20V5M17 20v-6M3 20h18",
  prompts:
    "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM7 9l3 3-3 3M13 15h4",
  changelog: "M4 4h16v16H4zM8 9h8M8 13h8M8 17h5",
  designer:
    "M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-1.3 1-2.4 2.3-2.4H18a3 3 0 0 0 3-3 9 9 0 0 0-9-9zM7.5 11h.01M10 7.5h.01M14.5 7.5h.01",
  install: "m8 7-5 5 5 5M16 7l5 5-5 5",
  profile: "M12 3 3 7.5v9L12 21l9-4.5v-9zM3 7.5 12 12l9-4.5M12 12v9",
  settings:
    "M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
  chevronDown: "m6 9 6 6 6-6",
  chevronRight: "m9 6 6 6-6 6",
  chevronUpDown: "m8 9 4-4 4 4M8 15l4 4 4-4",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  arrowUpRight: "M7 17 17 7M8 7h9v9",
  caretUp: "m6 14 6-6 6 6",
  plus: "M12 5v14M5 12h14",
  check: "m5 12 5 5 9-10",
  merge: "M6 7v10M6 7c0 3 3 5 10 5",
  copy: "M8 8h13v13H8zM16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3",
  download: "M12 3v12M7 11l5 5 5-5M4 20h16",
  bell: "M6 9a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 21h4",
  invite: "M19 8v6M16 11h6",
  comment: "M21 12a8 8 0 0 1-8 8H8l-5 2 1.5-4.5A8 8 0 1 1 21 12z",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18",
  lock: "M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  filter: "M4 6h16M7 12h10M10 18h4",
  sort: "M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  refresh: "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5",
  code: "m9 8-4 4 4 4M15 8l4 4-4 4",
  warn: "M12 4l9 16H3zM12 10v4M12 17h.01",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 8h.01",
  search: "m20 20-3.5-3.5",
  panel: "M9 4v16",
  users: "M2.5 20a6.5 6.5 0 0 1 13 0",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3.5 2",
  star: "M12 4l2.4 5 5.6.8-4 4 1 5.5-5-2.7-5 2.7 1-5.5-4-4L9.6 9z",
  send: "M4 12l16-8-6 16-2.5-6z",
  pin: "M12 3v8M8 11h8l-1 4h-6zM12 15v6",
  eye: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z",
  bolt: "M13 3 5 14h6l-1 7 8-11h-6z",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  link: "M9 15l6-6M8 12l-2 2a3 3 0 0 0 4 4l2-2M16 12l2-2a3 3 0 0 0-4-4l-2 2",
  flag: "M5 3v18M5 4h12l-2 4 2 4H5",
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}

export function Icon({ name, size = 16, strokeWidth = 1.7, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The search icon needs a circle as well as its path. */
export function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function CollapseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}

export function InviteIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6" />
    </svg>
  );
}

export function SettingsIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d={PATHS.settings} />
    </svg>
  );
}

/** Filled success tick, used in toasts and shipped markers. */
export function SuccessBadge({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#16A34A" />
      <path
        d="m7.5 12.5 3 3 6-6.5"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The mark. Two files, because the glyph's counter is knocked out rather than
 * painted: on a dark surface the blue "e" needs the white variant or the
 * counter disappears into the background.
 */
export function Logo({
  size = 28,
  variant = "light",
}: {
  size?: number;
  /** The surface the mark sits on, not the colour of the mark itself. */
  variant?: "light" | "dark";
}) {
  return (
    <Image
      src={variant === "dark" ? "/logos/logo-dark.png" : "/logos/logo.png"}
      alt="Euclid"
      width={size}
      height={size}
      className="shrink-0"
    />
  );
}
