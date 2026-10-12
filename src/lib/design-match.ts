import type { BoardDesign } from "./types";

/**
 * Reading a palette out of a founder's own site, so the board can be made to
 * look like it rather than like us.
 *
 * Everything here is pure: it takes stylesheet text and returns a proposed
 * design. Fetching the site is `src/server/site-palette.ts`, which is where
 * the network and its hazards live.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** A colour found on the site, and how much of the page's look it carries. */
export interface ColorHit {
  hex: string;
  weight: number;
}

export interface DesignMatch {
  accent: string;
  theme: BoardDesign["theme"];
  radius: BoardDesign["radius"];
  /** The page background this was read off, for the preview swatch. */
  background: string;
  /** Everything considered, strongest first, for the "or pick another" row. */
  candidates: ColorHit[];
  /** One line per decision, shown to the founder so nothing is magic. */
  notes: string[];
  /** True when the accent had to be darkened to stay readable. */
  adjusted: boolean;
}

const NAMED: Record<string, string> = {
  white: "#FFFFFF",
  black: "#000000",
  red: "#FF0000",
  blue: "#0000FF",
  green: "#008000",
  gray: "#808080",
  grey: "#808080",
  silver: "#C0C0C0",
  navy: "#000080",
  teal: "#008080",
  purple: "#800080",
  orange: "#FFA500",
};

/**
 * Parses the colour notations a real stylesheet uses. Anything it does not
 * understand returns null rather than a guess — a wrong colour is worse than
 * one fewer candidate.
 */
export function parseColor(raw: string): Rgb | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;

  const named = NAMED[value];
  if (named) return parseColor(named);

  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (/^[0-9a-f]{3,4}$/.test(hex)) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
      };
    }
    if (/^[0-9a-f]{6}$/.test(hex) || /^[0-9a-f]{8}$/.test(hex)) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
    return null;
  }

  const fn = /^(rgba?|hsla?)\(([^)]+)\)$/.exec(value);
  if (!fn) return null;

  // Both the legacy comma form and the modern space form, with an optional
  // slash-separated alpha.
  const parts = fn[2]
    .replace(/\//g, " ")
    .split(/[\s,]+/)
    .filter(Boolean);
  if (parts.length < 3) return null;

  if (fn[1].startsWith("rgb")) {
    const nums = parts.slice(0, 3).map(channel);
    if (nums.some((n) => n === null)) return null;
    return { r: nums[0] as number, g: nums[1] as number, b: nums[2] as number };
  }

  const h = Number.parseFloat(parts[0]);
  const s = Number.parseFloat(parts[1]) / 100;
  const l = Number.parseFloat(parts[2]) / 100;
  if ([h, s, l].some((n) => Number.isNaN(n))) return null;
  return hslToRgb(h, clamp01(s), clamp01(l));
}

/** One rgb() channel, as a number or a percentage. */
function channel(part: string): number | null {
  const pct = part.endsWith("%");
  const n = Number.parseFloat(part);
  if (Number.isNaN(n)) return null;
  return Math.max(0, Math.min(255, Math.round(pct ? (n / 100) * 255 : n)));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

/** WCAG relative luminance. */
export function luminance({ r, g, b }: Rgb): number {
  const channelLum = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channelLum(r) + 0.7152 * channelLum(g) + 0.0722 * channelLum(b);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * How far apart the channels are, 0–255. Saturation is a ratio, so a very
 * dark colour like #191D20 reads as surprisingly saturated; this does not,
 * which is what separates a brand's near-black from its actual colour.
 */
export function chroma({ r, g, b }: Rgb): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/** 0 for a grey, 1 for a pure hue. */
export function saturation({ r, g, b }: Rgb): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };

/**
 * The accent is rendered as a filled button with white text, so a pale brand
 * colour has to be darkened or the label on it disappears.
 */
const MIN_ACCENT_CONTRAST = 3.4;

export function darkenToContrast(color: Rgb, min = MIN_ACCENT_CONTRAST): Rgb {
  let current = color;
  // Forty steps of 5% reach black, which passes against white whatever the hue.
  for (let i = 0; i < 40 && contrast(current, WHITE) < min; i++) {
    current = { r: current.r * 0.95, g: current.g * 0.95, b: current.b * 0.95 };
  }
  return { r: Math.round(current.r), g: Math.round(current.g), b: Math.round(current.b) };
}

/**
 * Declarations worth reading a colour out of, and what each is worth. A colour
 * a site names `--brand` is almost certainly its brand; one on a border is
 * almost certainly not.
 */
const PROPERTY_WEIGHT: { pattern: RegExp; weight: number }[] = [
  { pattern: /^--[\w-]*(brand|primary|accent)[\w-]*$/, weight: 10 },
  { pattern: /^--[\w-]*(color|colour|bg|background|fg)[\w-]*$/, weight: 3 },
  { pattern: /^background(-color)?$/, weight: 3 },
  { pattern: /^color$/, weight: 2 },
  { pattern: /^fill$/, weight: 2 },
  { pattern: /^(border|outline)(-[\w-]+)?-color$/, weight: 1 },
];

const COLOR_VALUE = /#[0-9a-fA-F]{3,8}\b|(?:rgb|hsl)a?\([^)]{3,60}\)/g;

export interface Declaration {
  property: string;
  value: string;
  weight: number;
}

/** Every colour declaration in a stylesheet, with the weight of its property. */
export function readDeclarations(css: string): Declaration[] {
  const out: Declaration[] = [];
  // Deliberately not a CSS parser. A stylesheet only has to give up its
  // property/value pairs here, and the cost of being wrong is one candidate
  // colour too many in a list the founder can see and override.
  const decl = /(--[\w-]+|[a-zA-Z-]+)\s*:\s*([^;{}]+)/g;
  let match: RegExpExecArray | null;
  while ((match = decl.exec(css))) {
    const property = match[1].toLowerCase();
    const weight = PROPERTY_WEIGHT.find((p) => p.pattern.test(property))?.weight;
    if (!weight) continue;
    for (const value of match[2].match(COLOR_VALUE) ?? []) {
      out.push({ property, value, weight });
    }
  }
  return out;
}

/**
 * The page's background, read from whatever `html`, `body` or `:root` sets.
 * Falls back to white, which is what a browser would paint.
 */
export function readBackground(css: string): Rgb {
  const rule = /(?:^|[}\s,])(?:html|body|:root)\b[^{}]*\{([^}]*)\}/gi;
  let match: RegExpExecArray | null;
  while ((match = rule.exec(css))) {
    const bg = /background(?:-color)?\s*:\s*([^;]+)/i.exec(match[1]);
    const colour = bg?.[1].match(COLOR_VALUE)?.[0];
    const parsed = colour ? parseColor(colour) : null;
    // `background: none` and gradients give nothing to go on; keep looking.
    if (parsed) return parsed;
  }
  return WHITE;
}

/** The corner radius the site uses most, in pixels. */
export function readRadius(css: string): number | null {
  const decl = /border(?:-[a-z]+)?-radius\s*:\s*([^;{}]+)/gi;
  const tally = new Map<number, number>();
  let match: RegExpExecArray | null;
  while ((match = decl.exec(css))) {
    const first = match[1].trim().split(/[\s/]+/)[0];
    const px = /^(\d+(?:\.\d+)?)px$/.exec(first);
    const em = /^(\d+(?:\.\d+)?)r?em$/.exec(first);
    const value = px
      ? Number.parseFloat(px[1])
      : em
        ? Number.parseFloat(em[1]) * 16
        : null;
    // A pill (9999px, 50%) is a shape, not the site's corner radius.
    if (value === null || value > 40) continue;
    tally.set(value, (tally.get(value) ?? 0) + 1);
  }
  if (!tally.size) return null;
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

export function radiusBand(px: number | null): BoardDesign["radius"] | null {
  if (px === null) return null;
  if (px <= 5) return "Sharp";
  if (px <= 11) return "Soft";
  return "Round";
}

/** Below this a colour is a grey — chrome, text or a rule, not a brand. */
const MIN_SATURATION = 0.18;
/** And below this it is a near-black or near-white, whatever its ratio says. */
const MIN_CHROMA = 24;
/** Below this a colour would vanish into the background it sits on. */
const MIN_BACKGROUND_CONTRAST = 1.6;

/**
 * Proposes a board design from a site's stylesheets.
 *
 * The accent is the most-used colour that is actually a colour; the theme
 * follows the page background; the radius follows the corners the site rounds
 * most of its boxes to. Every one of those is a guess, which is why the
 * founder is shown the reasoning and keeps the final say.
 */
export function matchDesign(css: string): DesignMatch {
  const notes: string[] = [];
  const background = readBackground(css);
  const dark = luminance(background) < 0.2;

  const tally = new Map<string, number>();
  for (const { value, weight } of readDeclarations(css)) {
    const rgb = parseColor(value);
    if (!rgb) continue;
    if (saturation(rgb) < MIN_SATURATION) continue;
    if (chroma(rgb) < MIN_CHROMA) continue;
    if (contrast(rgb, background) < MIN_BACKGROUND_CONTRAST) continue;

    const hex = toHex(rgb);
    tally.set(hex, (tally.get(hex) ?? 0) + weight);
  }

  const candidates: ColorHit[] = [...tally.entries()]
    .map(([hex, weight]) => ({ hex, weight }))
    .sort((a, b) => b.weight - a.weight || a.hex.localeCompare(b.hex))
    .slice(0, 6);

  const picked = candidates[0] ? parseColor(candidates[0].hex) : null;
  let adjusted = false;
  let accent: Rgb;

  if (picked) {
    const safe = darkenToContrast(picked);
    adjusted = toHex(safe) !== toHex(picked);
    accent = safe;
    notes.push(
      adjusted
        ? `Accent ${toHex(picked)} from your site, darkened to ${toHex(safe)} so white button text stays readable.`
        : `Accent ${toHex(safe)}, the colour your site leans on most.`,
    );
  } else {
    accent = dark ? { r: 124, g: 58, b: 237 } : { r: 23, g: 23, b: 26 };
    notes.push("No brand colour stood out, so the accent is left neutral.");
  }

  notes.push(
    dark
      ? `Your site's background is ${toHex(background)}, so the board is set to dark.`
      : `Your site's background is ${toHex(background)}, so the board stays light.`,
  );

  const px = readRadius(css);
  const band = radiusBand(px);
  notes.push(
    band
      ? `Corners are rounded to ${px}px on your site, which is the "${band}" setting here.`
      : "No corner radius to read, so that is left on Soft.",
  );

  return {
    accent: toHex(accent),
    theme: dark ? "Dark" : "Light",
    radius: band ?? "Soft",
    background: toHex(background),
    candidates,
    notes,
    adjusted,
  };
}
