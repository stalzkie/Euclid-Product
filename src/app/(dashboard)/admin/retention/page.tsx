import Link from "next/link";
import { requireAdmin } from "@/server/admin";
import { consoleData } from "@/server/admin-console";
import { retentionGrid, stickiness, weekKey, workspaceViews } from "@/server/admin-model";
import { Cols, Email, Empty, Figure, Panel, Table, Td, Tr, When, pct } from "../parts";

/**
 * Retention: of the workspaces that arrived in a week, how many came back.
 *
 * Week 0 is 100% by construction — creating the workspace is itself an event
 * in the stream — so the column that carries the information is week 1, and
 * the diagonal edge of the grid is simply "has not happened yet" rather than
 * churn. Blank, not zero, for exactly that reason.
 *
 * Cohorts this small are anecdote rather than statistics, and the page says
 * so instead of implying a trend from two rows.
 */
export const dynamic = "force-dynamic";

const WEEKS = 10;

export default async function RetentionPage() {
  await requireAdmin();
  const { data, index, events } = await consoleData();
  const now = new Date();

  const grid = retentionGrid(data.workspaces.rows, events, WEEKS, now);
  const sticky = stickiness(events, now);
  const spaces = workspaceViews(data, events, index);

  const since = now.getTime() - 30 * 86_400_000;
  const recent = events.filter((e) => new Date(e.at).getTime() >= since);
  const activeByWorkspace = new Map<string, number>();
  for (const e of recent) {
    if (!e.workspaceId) continue;
    activeByWorkspace.set(e.workspaceId, (activeByWorkspace.get(e.workspaceId) ?? 0) + 1);
  }

  const leaderboard = spaces
    .map((w) => ({ w, count: activeByWorkspace.get(w.id) ?? 0 }))
    .sort((a, b) => b.count - a.count);

  // Week 1 across every cohort old enough to have one: the single number that
  // says whether this product keeps anybody.
  const mature = grid.filter((row) => row.cells[1] !== null);
  const week1 = mature.reduce(
    (acc, row) => ({ size: acc.size + row.size, kept: acc.kept + (row.cells[1] ?? 0) }),
    { size: 0, kept: 0 },
  );

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Retention</h1>
        <p className="text-[12.5px] text-ink-3">
          Weekly cohorts by the UTC week a workspace was created. Active means any event at all in
          that workspace during the week.
        </p>
      </header>

      <Cols min={160}>
        <Figure label="Active today" value={sticky.dau} />
        <Figure label="Active this week" value={sticky.wau} />
        <Figure label="Active this month" value={sticky.mau} />
        <Figure
          label="Stickiness"
          value={pct(sticky.ratio)}
          note="daily over monthly"
          tone={sticky.ratio >= 0.3 ? "ok" : "neutral"}
        />
        <Figure
          label="Week-1 retention"
          value={week1.size === 0 ? "—" : pct(week1.kept / week1.size)}
          note={`${week1.kept} of ${week1.size} across ${mature.length} cohorts`}
          tone={week1.size === 0 ? "neutral" : week1.kept / week1.size >= 0.4 ? "ok" : "warn"}
        />
        <Figure label="This week" value={weekKey(now)} note="cohort in progress" />
      </Cols>

      <Panel
        title="Cohort grid"
        note="Each cell is how many of that cohort were active that many weeks later. A blank cell is a week that has not happened yet."
      >
        {grid.length === 0 ? (
          <Empty>No workspaces yet.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-card border border-line">
            <table className="w-full text-[12.5px]" style={{ minWidth: 720 }}>
              <thead>
                <tr className="border-b border-line bg-subtle text-[11px] uppercase tracking-[0.05em] text-ink-3">
                  <th className="px-3 py-2 text-left font-medium">Cohort</th>
                  <th className="px-3 py-2 text-right font-medium">Size</th>
                  {Array.from({ length: WEEKS }, (_, i) => (
                    <th key={i} className="px-2 py-2 text-center font-medium">
                      W{i}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.map((row) => (
                  <tr key={row.cohort} className="border-b border-hairline last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[11.5px] text-ink">
                      {row.cohort}
                    </td>
                    <td className="tnum px-3 py-2 text-right font-medium text-ink">{row.size}</td>
                    {row.cells.map((cell, i) => {
                      if (cell === null) {
                        return <td key={i} className="bg-subtle/60 px-2 py-2" />;
                      }
                      const share = row.size === 0 ? 0 : cell / row.size;
                      return (
                        <td
                          key={i}
                          className="tnum px-2 py-2 text-center"
                          title={`${cell} of ${row.size} active in week ${i}`}
                          style={{
                            // One colour at varying strength rather than a
                            // rainbow: the eye reads intensity as magnitude
                            // without needing a key.
                            background: cell === 0 ? undefined : `rgba(10, 114, 220, ${0.08 + share * 0.5})`,
                            color: share > 0.6 ? "#fff" : undefined,
                          }}
                        >
                          {cell === 0 ? <span className="text-ink-3">0</span> : pct(share)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {grid.length > 0 && grid.every((r) => r.size < 5) && (
          <p className="text-[12px] text-ink-3">
            Every cohort here is under five workspaces, so read these as individual stories rather
            than as rates — one founder going quiet moves a column by 50%.
          </p>
        )}
      </Panel>

      <Panel
        title="Most active, last 30 days"
        note="Events per workspace, owner address attached — the list to read before writing to anyone."
      >
        {leaderboard.length === 0 ? (
          <Empty>Nothing in the last 30 days.</Empty>
        ) : (
          <Table
            min={980}
            head={["Workspace", "Owner", "Events 30d", "All-time", "Requests", "Prompts", "Stage", "Last seen"]}
          >
            {leaderboard.map(({ w, count }) => (
              <Tr key={w.id} tone={count === 0 ? "warn" : undefined}>
                <Td>{w.name}</Td>
                <Td wrap>
                  {w.owners[0] ? (
                    <Link href={`/admin/people/${w.owners[0].userId}`}>
                      <Email address={w.owners[0].email} />
                    </Link>
                  ) : (
                    <span className="text-ink-3">no member</span>
                  )}
                </Td>
                <Td num>{count}</Td>
                <Td num>{w.events}</Td>
                <Td num>{w.posts}</Td>
                <Td num>{w.prompts}</Td>
                <Td>{w.stage}</Td>
                <Td>
                  <When at={w.lastSeenAt} />
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}
