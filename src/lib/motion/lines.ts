/**
 * Which lines of a document are new, so `DiffHighlight` knows what to tint.
 *
 * Deliberately not a real diff: the founder wants to see what a refinement or
 * a confirmed assumption actually changed, and for that "this line was not
 * here before" is the whole question. A line that merely moved is not news,
 * which is why matching is by content and not by position.
 *
 * Counted rather than set-tested, so a prompt that genuinely gained a second
 * copy of a line highlights the new one.
 */
export function changedLines(previous: string | null, next: string): Set<number> {
  const changed = new Set<number>();
  const lines = next.split("\n");

  // Nothing to compare against: the whole document is new, and highlighting
  // every line of it would be noise rather than information.
  if (previous === null) return changed;

  const remaining = new Map<string, number>();
  for (const line of previous.split("\n")) {
    remaining.set(line, (remaining.get(line) ?? 0) + 1);
  }

  lines.forEach((line, index) => {
    const left = remaining.get(line) ?? 0;
    if (left > 0) {
      remaining.set(line, left - 1);
      return;
    }
    // Blank lines carry no meaning and tinting them looks like a glitch.
    if (line.trim() !== "") changed.add(index);
  });

  return changed;
}
