import { inputClass } from "@/components/ui";

/**
 * Search as a GET form.
 *
 * No client component and no debounce: the query lands in the URL, the server
 * filters, and the result is linkable. On a console whose whole job is "find
 * the person who wrote in", a shareable URL for the search beats
 * search-as-you-type.
 */
export function Search({
  q,
  action,
  placeholder,
  hidden,
}: {
  q?: string;
  action: string;
  placeholder: string;
  /** Other query parameters to preserve while searching. */
  hidden?: Record<string, string | undefined>;
}) {
  return (
    <form action={action} className="flex items-center gap-2">
      {Object.entries(hidden ?? {}).map(([name, value]) =>
        value ? <input key={name} type="hidden" name={name} value={value} /> : null,
      )}
      <input
        type="search"
        name="q"
        defaultValue={q ?? ""}
        placeholder={placeholder}
        aria-label={placeholder}
        className={`${inputClass} h-[30px] w-[260px] text-[12.5px]`}
      />
      <button
        type="submit"
        className="h-[30px] rounded-control border border-line px-2.5 text-[12.5px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
      >
        Search
      </button>
      {q ? (
        <a href={action} className="text-[12px] text-ink-3 hover:text-ink">
          clear
        </a>
      ) : null}
    </form>
  );
}

/** Case-folded "does this row mention it" over a handful of fields. */
export function matches(q: string | undefined, ...fields: (string | null | undefined)[]): boolean {
  const needle = q?.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((f) => f?.toLowerCase().includes(needle));
}
