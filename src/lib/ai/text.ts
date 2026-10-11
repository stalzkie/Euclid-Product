/**
 * Tidies model-written text before it is stored or shown.
 *
 * Generated text ends up in a prompt the founder pastes into a coding agent,
 * in an email to their users, and on a public changelog — places where a
 * stray mis-decoded dash looks like a bug in their product, not ours.
 *
 * Mojibake is what you get when UTF-8 bytes are decoded as a single-byte
 * codepage: the three bytes of an en dash become three Latin-1 or box-drawing
 * characters. It reaches text here two ways — a model occasionally emits the
 * broken form directly, and any trip through a Windows console or clipboard
 * on an OEM codepage mangles it in transit.
 *
 * The broken sequences are written as escapes on purpose. Spelling them
 * literally would leave this file one careless re-encode away from becoming
 * the thing it is trying to fix.
 */

/** Broken sequence → what it should have been. */
const MOJIBAKE: [string, string][] = [
  // CP437 / CP850, the Windows OEM codepages.
  ["┬╖", "·"], // middle dot
  ["ÔÇô", "–"], // en dash
  ["ÔÇö", "—"], // em dash
  ["ÔÇ¿", "’"], // right single quote
  ["ÔÇ£", "“"], // left double quote
  ["ÔÇ¥", "”"], // right double quote
  ["ÔÇû", "‘"], // left single quote
  ["ÔÇê", "…"], // ellipsis

  // CP1252, the Windows ANSI codepage.
  ["â€“", "–"], // en dash
  ["â€”", "—"], // em dash
  ["â€™", "’"], // right single quote
  ["â€œ", "“"], // left double quote
  ["â€˜", "‘"], // left single quote
  ["â€¦", "…"], // ellipsis
  ["Ã©", "é"], // e-acute
  ["Ã¨", "è"], // e-grave
  ["Ã¼", "ü"], // u-umlaut
  ["Ã¶", "ö"], // o-umlaut
  ["Ã¤", "ä"], // a-umlaut
  ["Â·", "·"], // middle dot
  ["Â ", " "], // non-breaking space that lost its encoding
];

/**
 * Repairs mis-decoded characters and normalises whitespace that confuses
 * terminals and diffs. Everything else is left exactly as written — this is a
 * clean-up, not a rewrite.
 */
export function repairText(input: string): string {
  let out = input;
  for (const [broken, fixed] of MOJIBAKE) {
    if (out.includes(broken)) out = out.split(broken).join(fixed);
  }
  return (
    out
      // Zero-width and bidi controls: invisible, and a known way to smuggle
      // text past a human reviewing a prompt before they paste it.
      .replace(/[​-‏‪-‮⁦-⁩﻿]/g, "")
      // Exotic spaces behave unpredictably inside code blocks.
      .replace(/[    ]/g, " ")
      // Trailing whitespace is noise in a pasted prompt and in a diff.
      .replace(/[ \t]+$/gm, "")
      // Three or more blank lines collapse to one.
      .replace(/\n{3,}/g, "\n\n")
  );
}

/** Applies {@link repairText} to every string in an object, one level deep. */
export function repairFields<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (typeof field === "string") out[key] = repairText(field);
    else if (Array.isArray(field)) {
      out[key] = field.map((item) =>
        typeof item === "string" ? repairText(item) : item,
      );
    } else out[key] = field;
  }
  return out as T;
}

/**
 * True when text still carries a mis-decode after repair. The maintenance
 * script reports these rather than hiding them, so an unknown codepage shows
 * up as a gap in the table instead of as silently broken copy.
 */
export function looksMojibaked(text: string): boolean {
  return /[À-ÿ─-▟]{2,3}/.test(text);
}
