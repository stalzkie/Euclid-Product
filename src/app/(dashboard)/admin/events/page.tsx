import Link from "next/link";
import { requireAdmin } from "@/server/admin";
import { consoleData } from "@/server/admin-console";
import {
  EVENT_LABELS,
  daySpan,
  kindCounts,
  trend,
  type EventKind,
} from "@/server/admin-model";
import { cx } from "@/components/ui";
import { Bars, Email, Empty, Panel, Pill, Table, Td, Tr, When, Delta } from "../parts";
import { Range } from "../range";
import { Search, matches } from "../search";

/**
 * The event stream.
 *
 * Every row here is a database row that already carried a timestamp — a post,
 * a vote, a top-up, an installed widget — read as a timeline rather than as
 * state. Nothing is captured at a call site, so this list is complete back to
 * the first row ever written and cannot disagree with the tables it is drawn
 * from. The trade is that it can only show what state records: see the note
 * on `deriveEvents` for the two things deliberately left out.
 */
export const dynamic = "force-dynamic";

const LIMIT = 300;

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; days?: string; q?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const days = params.days === "7" ? 7 : params.days === "90" ? 90 : 30;
  const q = params.q;
  const now = new Date();
  const since = now.getTime() - days * 86_400_000;

  const { events } = await consoleData();
  const counts = kindCounts(events, days, now);
  const known = new Set(counts.map((c) => c.kind as string));
  const kind = params.kind && known.has(params.kind) ? (params.kind as EventKind) : null;

  const window = events.filter((e) => new Date(e.at).getTime() >= since);
  const filtered = window
    .filter((e) => (kind ? e.kind === kind : true))
    .filter((e) =>
      matches(q, e.actor.email, e.actor.label, e.title, e.detail, e.workspaceName, e.boardName),
    );

  const shape = trend(
    kind ? events.filter((e) => e.kind === kind) : events,
    kind ? [kind] : (counts.map((c) => c.kind) as EventKind[]),
    kind ? EVENT_LABELS[kind] : "Everything",
    days,
    now,
  );

  const href = (next: EventKind | null) => {
    const sp = new URLSearchParams();
    if (next) sp.set("kind", next);
    sp.set("days", String(days));
    if (q) sp.set("q", q);
    return `/admin/events?${sp.toString()}`;
  };

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Events</h1>
          <p className="text-[12.5px] text-ink-3">
            {window.length.toLocaleString("en-US")} in the last {days} days ·{" "}
            {events.length.toLocaleString("en-US")} all time
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Search
            q={q}
            action="/admin/events"
            placeholder="Address, title, workspace, board"
            hidden={{ kind: kind ?? undefined, days: String(days) }}
          />
          <Range days={days} base="/admin/events" extra={{ kind: kind ?? undefined, q }} />
        </div>
      </header>

      <Panel
        title={shape.label}
        aside={
          <span className="text-[12px]">
            <Delta now={shape.total} prev={shape.previous} />
          </span>
        }
      >
        <div className="rounded-card border border-line px-3 py-3">
          <Bars points={shape.points} labels={daySpan(days, now)} tone="state" height={64} />
        </div>
      </Panel>

      <Panel title="Filter by kind" note="Counts are for the window above.">
        <div className="flex flex-wrap gap-1.5">
          <Link
            href={href(null)}
            className={cx(
              "rounded-chip border px-2 py-[3px] text-[12px] transition-colors",
              kind === null
                ? "border-ink bg-ink text-white"
                : "border-line text-ink-2 hover:border-line-strong hover:text-ink",
            )}
          >
            Everything <span className="tnum opacity-60">{window.length}</span>
          </Link>
          {counts.map((c) => (
            <Link
              key={c.kind}
              href={href(c.kind)}
              className={cx(
                "rounded-chip border px-2 py-[3px] text-[12px] transition-colors",
                kind === c.kind
                  ? "border-ink bg-ink text-white"
                  : "border-line text-ink-2 hover:border-line-strong hover:text-ink",
              )}
            >
              {c.label} <span className="tnum opacity-60">{c.count}</span>
            </Link>
          ))}
        </div>
      </Panel>

      <Panel
        title="Stream"
        aside={
          <span className="text-[12px] text-ink-3">
            {filtered.length.toLocaleString("en-US")} match
            {filtered.length > LIMIT ? ` · showing ${LIMIT}` : ""}
          </span>
        }
      >
        {filtered.length === 0 ? (
          <Empty>Nothing in this window matches.</Empty>
        ) : (
          <Table head={["When", "Event", "Who", "What", "Workspace", "Board"]} min={1040}>
            {filtered.slice(0, LIMIT).map((e, i) => (
              <Tr key={`${e.at}-${i}`} tone={e.kind === "error" ? "bad" : undefined}>
                <Td>
                  <When at={e.at} />
                </Td>
                <Td>
                  <Pill
                    tone={
                      e.kind === "error"
                        ? "bad"
                        : e.actor.kind === "visitor"
                          ? "state"
                          : e.actor.kind === "system"
                            ? "neutral"
                            : "ok"
                    }
                  >
                    {e.kind}
                    {e.count > 1 ? ` ×${e.count}` : ""}
                  </Pill>
                </Td>
                <Td wrap>
                  {e.actor.userId ? (
                    <Link href={`/admin/people/${e.actor.userId}`}>
                      <Email address={e.actor.email} />
                    </Link>
                  ) : e.actor.email ? (
                    <Email address={e.actor.email} />
                  ) : (
                    <span className="font-mono text-[11.5px] text-ink-3">{e.actor.label}</span>
                  )}
                </Td>
                <Td wrap className="max-w-[460px]">
                  {e.title}
                  {e.detail && <span className="text-ink-3"> · {e.detail}</span>}
                </Td>
                <Td>{e.workspaceName ?? "—"}</Td>
                <Td>{e.boardName ?? "—"}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}
