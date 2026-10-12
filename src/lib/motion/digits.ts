/**
 * The arithmetic behind `AnimatedNumber`, kept out of the component so it can
 * be tested without a DOM.
 *
 * A rolling counter is an odometer: every digit that changed slides the same
 * way, up when the value rose and down when it fell, and the units place stays
 * put when the number gains a digit. That last part is why slots are keyed
 * from the right — 99 → 100 pushes a new cell onto the front rather than
 * renumbering every digit and rolling all three.
 */

export type RollDirection = "up" | "down" | "none";

export interface DigitSlot {
  /** Stable across renders for a given place value, so React reuses the cell. */
  key: string;
  /** The character to show. Empty for a leading cell the value has not reached. */
  char: string;
  /** What this cell showed before, or null if the cell is new. */
  previous: string | null;
  changed: boolean;
  /** Which way this cell rolls. Always the overall direction, or "none". */
  direction: RollDirection;
}

export interface NumberRoll {
  /** Left to right, ready to render. */
  slots: DigitSlot[];
  /** Character cells to reserve, so neighbours never shift mid-roll. */
  width: number;
  direction: RollDirection;
}

export interface RollOptions {
  /** How the number becomes text. Defaults to plain digits. */
  format?: (value: number) => string;
  /**
   * Never reserve fewer cells than this. Pass the widest value a slot will
   * ever hold to stop the layout settling as the number grows.
   */
  minWidth?: number;
}

const PLACEHOLDER = "";

/**
 * Diff two values into per-cell render instructions.
 *
 * Both values are formatted first, so grouping separators and signs are
 * treated as cells like any other and a change in grouping (999 → 1,000)
 * rolls the separator in alongside the digits.
 */
export function rollDigits(
  previous: number,
  next: number,
  options: RollOptions = {},
): NumberRoll {
  const format = options.format ?? ((value: number) => String(value));
  const previousText = format(previous);
  const nextText = format(next);

  const direction: RollDirection =
    next > previous ? "up" : next < previous ? "down" : "none";

  const width = Math.max(
    previousText.length,
    nextText.length,
    options.minWidth ?? 0,
  );

  const previousCells = padFromRight(previousText, width);
  const nextCells = padFromRight(nextText, width);

  const slots: DigitSlot[] = nextCells.map((char, index) => {
    // Place value, counted from the right: 0 is the units cell.
    const place = width - 1 - index;
    const before = previousCells[index];
    const changed = before !== char;

    return {
      key: `p${place}`,
      char,
      previous: before === PLACEHOLDER ? null : before,
      changed,
      direction: changed ? direction : "none",
    };
  });

  return { slots, width, direction };
}

/**
 * Right-align text into a fixed number of cells. Leading cells the value does
 * not reach stay empty rather than becoming zeros — the counter shows 7, not
 * 007, while still holding three cells of space.
 */
function padFromRight(text: string, width: number): string[] {
  const cells: string[] = new Array(width).fill(PLACEHOLDER);
  const offset = width - text.length;
  for (let i = 0; i < text.length; i += 1) cells[offset + i] = text[i];
  return cells;
}

/**
 * Whether anything actually moved. A re-render that does not change the value
 * must not restart the roll.
 */
export function hasRoll(roll: NumberRoll): boolean {
  return roll.direction !== "none" && roll.slots.some((slot) => slot.changed);
}
