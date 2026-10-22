import Link from "next/link";
import { cx } from "@/components/ui";

/**
 * The window every time-based panel is read through, as links rather than
 * state.
 *
 * A link means the window is in the URL: an operator can bookmark "last 90
 * days of the event stream" and send it to someone, and the page stays a
 * server render with no client JavaScript. `scroll={false}` because the
 * answer usually sits where they already are.
 */
export function Range({
  days,
  base,
  options = [7, 30, 90],
  extra,
}: {
  days: number;
  base: string;
  options?: number[];
  /** Other query parameters to carry across, so a filter survives a range change. */
  extra?: Record<string, string | undefined>;
}) {
  const href = (value: number) => {
    const params = new URLSearchParams();
    for (const [key, v] of Object.entries(extra ?? {})) if (v) params.set(key, v);
    params.set("days", String(value));
    return `${base}?${params.toString()}`;
  };

  return (
    <nav aria-label="Range" className="flex items-center gap-1 rounded-control border border-line p-[2px]">
      {options.map((value) => (
        <Link
          key={value}
          href={href(value)}
          scroll={false}
          aria-current={value === days ? "true" : undefined}
          className={cx(
            "rounded-[6px] px-2.5 py-[3px] text-[12px] transition-colors",
            value === days
              ? "bg-nav-active font-medium text-ink"
              : "text-ink-3 hover:bg-subtle hover:text-ink",
          )}
        >
          {value}d
        </Link>
      ))}
    </nav>
  );
}
