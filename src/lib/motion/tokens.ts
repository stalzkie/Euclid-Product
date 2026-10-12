/**
 * The motion tokens, mirrored from `src/app/globals.css` for the animations
 * that run in JavaScript. CSS owns hover, focus, colour and switch changes;
 * these values are for presence, layout moves, springs and number rolls.
 *
 * Keep the two in step. Nothing in a component should write a duration or a
 * cubic-bezier of its own.
 */

/** Seconds, because that is what Motion takes. */
export const dur = {
  press: 0.1,
  fast: 0.15,
  base: 0.2,
  moderate: 0.25,
  slow: 0.32,
  data: 0.6,
  /** One-shot highlights: the diff tint and the theme border flash. */
  highlight: 0.9,
  /** The vote chevron's hop. Longer than a press, shorter than a move. */
  hop: 0.22,
  /**
   * How far behind a height change the content inside it fades, so a section
   * opening reads as the box making room and then filling it.
   */
  contentLag: 0.05,
} as const;

export const ease = {
  standard: [0.2, 0, 0, 1],
  out: [0.16, 1, 0.3, 1],
  in: [0.4, 0, 1, 1],
} as const;

/** Critically damped, so nothing bounces or overshoots. */
export const spring = {
  /** Indicators and thumbs: arrives almost immediately. */
  snappy: { type: "spring", stiffness: 520, damping: 40, mass: 1 },
  /** Cards moving between columns: a little more travel to read. */
  smooth: { type: "spring", stiffness: 300, damping: 34, mass: 1 },
} as const;

/** 30ms per item, and only the first eight items stagger. */
export const stagger = { step: 0.03, max: 8 } as const;

/**
 * Chart bars are tighter than a list: there are more of them, they are
 * smaller, and the cascade should read as one gesture rather than a queue.
 */
export const barStagger = 0.02;

/** Distances, in pixels, matching --eu-rise-* and --eu-slide-step. */
export const rise = { sm: 4, md: 8 } as const;
export const slideStep = 16;

/* -------------------------------------------------------------------------- */
/* Ready-made transitions                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Exits take about 70% of their entrance and use an accelerating ease, so a
 * dismissal never feels like it is lingering.
 */
export const exitOf = (entrance: number) =>
  ({ duration: Number((entrance * 0.7).toFixed(3)), ease: ease.in }) as const;

export const enter = { duration: dur.base, ease: ease.out } as const;
export const move = { duration: dur.base, ease: ease.standard } as const;
