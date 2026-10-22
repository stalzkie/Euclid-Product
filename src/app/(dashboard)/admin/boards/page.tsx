import { requireAdmin } from "@/server/admin";
import { consoleData } from "@/server/admin-console";
import { boardViews } from "@/server/admin-model";
import {
  Cols,
  Email,
  Empty,
  Figure,
  Panel,
  Pill,
  Table,
  Td,
  Tr,
  When,
} from "../parts";
import { Search, matches } from "../search";

/**
 * Boards, and why a widget is not working.
 *
 * The two panels that earn this tab are **Blocked origins** and **Never
 * installed**. `install_signals` records a widget request the allow-list
 * refused, which means a founder whose board has blocked traffic is a founder
 * about to write in saying it is broken — and this is the one place that can
 * be known before they do.
 */
export const dynamic = "force-dynamic";

export default async function BoardsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const { q } = await searchParams;
  const { data, index } = await consoleData();

  const all = boardViews(data, index);
  const rows = all.filter((b) =>
    matches(
      q,
      b.name,
      b.slug,
      b.publicId,
      b.workspace,
      b.customDomain,
      ...b.ownerEmails,
      ...b.allowedDomains,
      ...b.blocked.map((x) => x.origin),
    ),
  );

  const blocked = all.filter((b) => b.blocked.length > 0);
  const neverInstalled = all.filter((b) => !b.installedAt);
  const openList = all.filter((b) => b.allowedDomains.length === 0);
  const held = all.reduce((n, b) => n + b.held, 0);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Boards</h1>
          <p className="text-[12.5px] text-ink-3">
            {all.length} boards across {data.workspaces.rows.length} workspaces
          </p>
        </div>
        <Search q={q} action="/admin/boards" placeholder="Board, owner, domain, origin" />
      </header>

      <Cols min={170}>
        <Figure
          label="Blocked by allow-list"
          value={blocked.length}
          note="boards refusing real traffic"
          tone={blocked.length > 0 ? "bad" : "ok"}
        />
        <Figure
          label="Never installed"
          value={neverInstalled.length}
          note="no widget request ever"
          tone={neverInstalled.length > 0 ? "warn" : "ok"}
        />
        <Figure
          label="Open allow-list"
          value={openList.length}
          note="any origin may embed"
          tone={openList.length > 0 ? "warn" : "ok"}
        />
        <Figure label="Held for review" value={held} note="posts awaiting approval" />
        <Figure
          label="Custom domains"
          value={all.filter((b) => b.customDomain).length}
          note="pointed at a board"
        />
      </Cols>

      {blocked.length > 0 && (
        <Panel
          title="Blocked origins"
          note="A widget request refused because the origin is not on the board's allow-list. This is a broken install, not an attack."
        >
          <Table min={860} head={["Board", "Owner", "Origin", "Refused", "Last seen", "Allow-list"]}>
            {blocked.flatMap((b) =>
              b.blocked.map((s) => (
                <Tr key={`${b.id}-${s.origin}`} tone="bad">
                  <Td>{b.name}</Td>
                  <Td wrap>
                    <Email address={b.ownerEmails[0] ?? null} />
                  </Td>
                  <Td mono>{s.origin}</Td>
                  <Td num>{s.count}</Td>
                  <Td>
                    <When at={s.lastSeen} />
                  </Td>
                  <Td wrap>{b.allowedDomains.join(", ") || "empty"}</Td>
                </Tr>
              )),
            )}
          </Table>
        </Panel>
      )}

      <Panel
        title={q ? `Matching “${q}”` : "All boards"}
        aside={<span className="text-[12px] text-ink-3">{rows.length} shown</span>}
      >
        {rows.length === 0 ? (
          <Empty>Nothing matches that.</Empty>
        ) : (
          <Table
            min={1480}
            head={[
              "Board",
              "Workspace",
              "Owner",
              "Installed",
              "Identity",
              "Allow-list",
              "Domain",
              "Requests",
              "Votes",
              "Comments",
              "Visitors",
              "Blocked",
              "Local",
              "Keys",
              "Integrations",
              "Badge",
              "Last request",
            ]}
          >
            {rows.map((b) => (
              <Tr key={b.id} tone={b.blocked.length > 0 ? "bad" : !b.installedAt ? "warn" : undefined}>
                <Td wrap>
                  <span className="flex flex-col">
                    <span className="font-medium text-ink">{b.name}</span>
                    <span className="font-mono text-[11px] text-ink-3">{b.publicId}</span>
                  </span>
                </Td>
                <Td>{b.workspace ?? "—"}</Td>
                <Td wrap>
                  <Email address={b.ownerEmails[0] ?? null} />
                </Td>
                <Td>
                  {b.installedAt ? <When at={b.installedAt} /> : <Pill tone="warn">never</Pill>}
                </Td>
                <Td>{b.identityMode}</Td>
                <Td wrap className="max-w-[220px]">
                  {b.allowedDomains.length === 0 ? (
                    <Pill tone="warn">open</Pill>
                  ) : (
                    b.allowedDomains.join(", ")
                  )}
                </Td>
                <Td>{b.customDomain ?? "—"}</Td>
                <Td num>
                  {b.posts}
                  {b.held > 0 && <span className="text-warn"> · {b.held} held</span>}
                </Td>
                <Td num>{b.votes}</Td>
                <Td num>{b.comments}</Td>
                <Td num>
                  {b.visitors}
                  {b.visitorsWithEmail > 0 && (
                    <span className="text-ink-3"> · {b.visitorsWithEmail}✉</span>
                  )}
                </Td>
                <Td num>
                  {b.blocked.length === 0 ? (
                    "—"
                  ) : (
                    <span className="text-bad">
                      {b.blocked.reduce((n, s) => n + s.count, 0)}
                    </span>
                  )}
                </Td>
                <Td num>{b.localOnly || "—"}</Td>
                <Td num>{b.apiKeys || "—"}</Td>
                <Td>{b.integrations.join(", ") || "—"}</Td>
                <Td>{b.showBadge ? "shown" : "hidden"}</Td>
                <Td>
                  <When at={b.lastPostAt} />
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}
