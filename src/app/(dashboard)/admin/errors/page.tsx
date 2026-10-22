import { requireAdmin } from "@/server/admin";
import { consoleData } from "@/server/admin-console";
import { breakdown, countByDay, daySpan } from "@/server/admin-model";
import { Bars, Cols, Empty, Figure, Meterline, Panel, Table, When } from "../parts";
import { ErrorRow } from "../error-row";
import { Search, matches } from "../search";

/**
 * Errors, grouped by fingerprint.
 *
 * `error_events` keys on a normalised fingerprint, so an occurrence is an
 * upsert and the table cannot grow faster than the number of distinct faults —
 * which is what makes this readable where a log tail is not. The first row it
 * ever captured proved the point twice: it read `GET /?_rsc=fH7YU5buuezjznK`,
 * and without normalising that random parameter the same fault on the same
 * page would have been a new row every request.
 */
export const dynamic = "force-dynamic";

export default async function ErrorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; show?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const all = params.show === "all";
  const q = params.q;

  const { data } = await consoleData();
  const now = new Date();

  const rows = data.errors.rows
    .filter((e) => (all ? true : !e.resolved_at))
    .filter((e) => matches(q, e.kind, e.message, e.route, e.fingerprint));

  const open = data.errors.rows.filter((e) => !e.resolved_at);
  const occurrences = open.reduce((n, e) => n + e.count, 0);
  const byRoute = breakdown("Route", open, (e) => e.route ?? "no route");
  const byKind = breakdown("Kind", open, (e) => e.kind);
  const routeTop = byRoute.rows[0]?.count || 1;
  const kindTop = byKind.rows[0]?.count || 1;

  // Last seen per fault, bucketed: a spike here is a deploy that went wrong.
  const points = countByDay(
    data.errors.rows.map((e) => e.last_seen),
    30,
    now,
  );

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Errors</h1>
          <p className="text-[12.5px] text-ink-3">
            {open.length} open faults, {occurrences.toLocaleString("en-US")} occurrences. A fault
            that comes back reopens itself.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Search
            q={q}
            action="/admin/errors"
            placeholder="Message, kind, route"
            hidden={{ show: all ? "all" : undefined }}
          />
          <a
            href={all ? `/admin/errors${q ? `?q=${encodeURIComponent(q)}` : ""}` : "/admin/errors?show=all"}
            className="rounded-control border border-line px-2.5 py-[5px] text-[12px] text-ink-2 hover:border-line-strong hover:text-ink"
          >
            {all ? "Open only" : "Include resolved"}
          </a>
        </div>
      </header>

      <Cols min={170}>
        <Figure
          label="Open faults"
          value={open.length}
          tone={open.length > 0 ? "bad" : "ok"}
          note={open.length === 0 ? "nothing unresolved" : "distinct fingerprints"}
        />
        <Figure label="Occurrences" value={occurrences} tone={occurrences > 0 ? "warn" : "ok"} />
        <Figure
          label="Resolved"
          value={data.errors.rows.filter((e) => e.resolved_at).length}
          note="marked by hand"
        />
        <Figure
          label="Newest"
          value={open[0] ? <When at={open[0].last_seen} /> : "—"}
          note={open[0]?.kind}
        />
      </Cols>

      <Panel title="Last 30 days" note="One bar per day, counting faults last seen that day.">
        <div className="rounded-card border border-line px-3 py-3">
          <Bars points={points} labels={daySpan(30, now)} tone="bad" height={56} />
        </div>
      </Panel>

      <div className="grid gap-7 lg:grid-cols-2">
        <Panel title="Open by route" note="Where the faults are.">
          {byRoute.rows.length === 0 ? (
            <Empty>Nothing open.</Empty>
          ) : (
            <div className="flex flex-col rounded-card border border-line">
              {byRoute.rows.slice(0, 10).map((r) => (
                <Meterline
                  key={r.key}
                  label={<span className="font-mono text-[11.5px]">{r.key}</span>}
                  value={r.count}
                  share={r.count / routeTop}
                  tone="bad"
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Open by kind" note="What they are.">
          {byKind.rows.length === 0 ? (
            <Empty>Nothing open.</Empty>
          ) : (
            <div className="flex flex-col rounded-card border border-line">
              {byKind.rows.slice(0, 10).map((r) => (
                <Meterline key={r.key} label={r.key} value={r.count} share={r.count / kindTop} tone="bad" />
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title={all ? "Every fault" : "Open faults"}
        aside={<span className="text-[12px] text-ink-3">{rows.length} shown</span>}
      >
        {rows.length === 0 ? (
          <Empty>
            {q ? "Nothing matches that." : "Nothing unresolved. A fault that comes back reopens itself."}
          </Empty>
        ) : (
          <Table min={940} head={["Count", "Fault", "Route", "First seen", "Last seen", ""]}>
            {rows.map((e) => (
              <ErrorRow
                key={e.fingerprint}
                error={{
                  fingerprint: e.fingerprint,
                  kind: e.kind,
                  message: e.message,
                  route: e.route,
                  stack: e.stack,
                  count: e.count,
                  firstSeen: e.first_seen,
                  lastSeen: e.last_seen,
                  resolvedAt: e.resolved_at,
                }}
              />
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}
