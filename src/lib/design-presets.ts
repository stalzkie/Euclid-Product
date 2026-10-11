import type { BoardDesign } from "./types";

/** The handful of presets the designer ships with. */
export interface DesignPreset {
  id: string;
  label: string;
  accent: string;
  theme: BoardDesign["theme"];
  radius: BoardDesign["radius"];
  /** Swatch colours for the preset card. */
  swatchBg: string;
  swatchLine: string;
}

export const PRESETS: DesignPreset[] = [
  {
    id: "minimal",
    label: "Minimal",
    accent: "#17171A",
    theme: "Light",
    radius: "Soft",
    swatchBg: "#FFFFFF",
    swatchLine: "#E7E7E4",
  },
  {
    id: "midnight",
    label: "Midnight",
    accent: "#7C3AED",
    theme: "Dark",
    radius: "Soft",
    swatchBg: "#18181B",
    swatchLine: "#3F3F46",
  },
  {
    id: "candy",
    label: "Candy",
    accent: "#D1347A",
    theme: "Light",
    radius: "Round",
    swatchBg: "#FFF7FB",
    swatchLine: "#F9C9DE",
  },
  {
    id: "paper",
    label: "Paper",
    accent: "#B45309",
    theme: "Light",
    radius: "Sharp",
    swatchBg: "#FBF8F2",
    swatchLine: "#E9E1D2",
  },
];

export const ACCENTS = [
  { name: "Ink", hex: "#17171A" },
  { name: "Blue", hex: "#0A72DC" },
  { name: "Pink", hex: "#D1347A" },
  { name: "Violet", hex: "#7C3AED" },
  { name: "Green", hex: "#15803D" },
  { name: "Amber", hex: "#B45309" },
];

export const DEFAULT_DESIGN: BoardDesign = {
  preset: "minimal",
  accent: "#17171A",
  theme: "Light",
  radius: "Soft",
  mode: "floating",
  heading: "What should we build next?",
  subheading: "Suggest an idea or vote on one. We read every post.",
  submitCta: "Post idea",
  showStatuses: true,
  showComments: true,
  showChangelog: true,
  showRoadmap: true,
  showVoteCounts: true,
};

/**
 * Resolves a stored design config into the concrete values the widget renders
 * with. Keeping this in one place means the designer preview and the live
 * widget can never drift apart.
 */
export interface ResolvedTheme {
  bg: string;
  card: string;
  fg: string;
  sub: string;
  border: string;
  hover: string;
  accent: string;
  onAccent: string;
  r8: string;
  r10: string;
  r16: string;
}

export function resolveTheme(design: BoardDesign): ResolvedTheme {
  const dark = design.theme === "Dark";
  const radii =
    design.radius === "Sharp"
      ? [4, 4, 6]
      : design.radius === "Round"
        ? [14, 18, 22]
        : [8, 10, 16];

  return {
    bg: dark ? "#141416" : "#FFFFFF",
    card: dark ? "#1C1C20" : "#FFFFFF",
    fg: dark ? "#F4F4F5" : "#17171A",
    sub: dark ? "#A1A1AA" : "#737379",
    border: dark ? "#2A2A30" : "#E7E7E4",
    hover: dark ? "#232328" : "#F8F8F7",
    accent: design.accent,
    onAccent: "#FFFFFF",
    r8: `${radii[0]}px`,
    r10: `${radii[1]}px`,
    r16: `${radii[2]}px`,
  };
}

export function mergeDesign(stored: Partial<BoardDesign> | null | undefined): BoardDesign {
  return { ...DEFAULT_DESIGN, ...(stored ?? {}) };
}
