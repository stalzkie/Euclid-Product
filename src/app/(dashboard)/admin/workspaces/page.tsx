import Link from "next/link";
import { requireAdmin } from "@/server/admin";
import { consoleData } from "@/server/admin-console";
import { revenue, workspaceViews } from "@/server/admin-model";
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
  money,
  statusTone,
} from "../parts";
import { Search, matches } from "../search";

/**
 * Every workspace, with the owner address on the row.
 *
 * One table rather than a card per workspace, because the question is almost
 * always comparative — who is near their allowance, who installed and then
 * went quiet, who is paying and not using it. Columns are ordered left to
 * right as "who, what they pay, what they have done, when they were last
 * here", which is how the answer gets read out loud.
 */
export const dynamic = "force-dynamic";

export default async function WorkspacesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const { q } = await searchParams;
  const { data, index, events } = await consoleData();

  const all = workspaceViews(data, events, index);
  const rows = all.filter((w) =>
    matches(
      q,
      w.name,
      w.slug,
      w.plan,
      w.status,
      w.stage,
      w.appName,
      w.appUrl,
      w.referredBy,
      w.referralCode,
      ...w.owners.map((o) => o.email),
    ),
  );

  const rev = revenue(data.workspaces.rows);
  const idle = all.filter((w) => w.installedBoards > 0 && w.posts === 0).length;
  const quiet = all.filter((w) => w.events <= 1).length;

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Workspaces</h1>
          <p className="text-[12.5px] text-ink-3">
            {all.length} in total · {rev.payers} paying · {rev.trials} on trial · {rev.comped} on a
            paid tier with no subscription
          </p>
        </div>
        <Search q={q} action="/admin/workspaces" placeholder="Name, slug, owner, app, code" />
      </header>

      <Cols min={170}>
        <Figure label="MRR" value={money(rev.mrrCents)} tone="ok" note={`${rev.payers} paying`} />
        <Figure
          label="Installed but silent"
          value={idle}
          note="widget in, no request yet"
          tone={idle > 0 ? "warn" : "ok"}
        />
        <Figure
          label="Nothing but a signup"
          value={quiet}
          note="one event or fewer"
          tone={quiet > 0 ? "warn" : "ok"}
        />
        <Figure
          label="Cancelling"
          value={rev.leaving}
          note={`${money(rev.leavingCents)} leaving`}
          tone={rev.leaving > 0 ? "bad" : "ok"}
        />
        <Figure label="Top-ups bought" value={data.topups.rows.filter((t) => !t.refunded_at).length} />
      </Cols>

      <Panel
        title={q ? `Matching “${q}”` : "All workspaces"}
        aside={<span className="text-[12px] text-ink-3">{rows.length} shown</span>}
      >
        {rows.length === 0 ? (
          <Empty>Nothing matches that.</Empty>
        ) : (
          <Table
            min={1700}
            head={[
              "Workspace",
              "Owner",
              "Plan",
              "Status",
              "MRR",
              "Stage",
              "Boards",
              "Requests",
              "Votes",
              "Visitors",
              "Prompts",
              "Chats",
              "Allowance",
              "Credits",
              "Top-ups",
              "Referral",
              "Created",
              "Last seen",
            ]}
          >
            {rows.map((w) => (
              <Tr key={w.id}>
                <Td wrap>
                  <span className="flex flex-col">
                    <span className="font-medium text-ink">{w.name}</span>
                    <span className="font-mono text-[11px] text-ink-3">{w.slug}</span>
                  </span>
                </Td>
                <Td wrap>
                  <span className="flex flex-col gap-0.5">
                    {w.owners.length === 0 ? (
                      <span className="text-ink-3">no member</span>
                    ) : (
                      w.owners.map((o) => (
                        <Link key={o.userId} href={`/admin/people/${o.userId}`} className="block">
                          <Email address={o.email} />
                        </Link>
                      ))
                    )}
                  </span>
                </Td>
                <Td>
                  <Pill tone={w.plan === "free" ? "neutral" : "ok"}>{w.planName}</Pill>
                  <span className="ml-1 text-[11px] text-ink-3">{w.period}</span>
                </Td>
                <Td>
                  <span className="flex items-center gap-1">
                    <Pill tone={statusTone(w.status)}>{w.status ?? "none"}</Pill>
                    {w.cancelAtPeriodEnd && <Pill tone="warn">ending</Pill>}
                  </span>
                </Td>
                <Td num>{w.mrrCents > 0 ? money(w.mrrCents) : "—"}</Td>
                <Td>{w.stage}</Td>
                <Td num>
                  {w.installedBoards}/{w.boards}
                </Td>
                <Td num>{w.posts}</Td>
                <Td num>{w.votes}</Td>
                <Td num>
                  {w.visitors}
                  {w.visitorsWithEmail > 0 && (
                    <span className="text-ink-3"> · {w.visitorsWithEmail}✉</span>
                  )}
                </Td>
                <Td num>
                  {w.prompts}
                  {w.promptsCopied > 0 && <span className="text-ink-3"> · {w.promptsCopied}c</span>}
                </Td>
                <Td num>{w.chats}</Td>
                <Td num>
                  <span
                    className={
                      w.promptLimit > 0 && w.promptsUsed >= w.promptLimit ? "text-warn" : undefined
                    }
                  >
                    {w.promptsUsed}/{w.promptLimit}
                  </span>
                  {w.extraPrompts > 0 && <span className="text-ink-3"> +{w.extraPrompts}</span>}
                </Td>
                <Td num>
                  <span
                    className={
                      w.creditLimit > 0 && w.creditsUsed >= w.creditLimit ? "text-warn" : undefined
                    }
                  >
                    {w.creditsUsed}/{w.creditLimit}
                  </span>
                  {w.extraCredits > 0 && <span className="text-ink-3"> +{w.extraCredits}</span>}
                </Td>
                <Td num>{w.topups}</Td>
                <Td>
                  {w.referredBy ? (
                    <span title={`referred by ${w.referredBy}`}>{w.referredBy}</span>
                  ) : (
                    <span className="text-ink-3">direct</span>
                  )}
                  {w.referralCode && (
                    <span className="ml-1 font-mono text-[11px] text-ink-3">{w.referralCode}</span>
                  )}
                </Td>
                <Td>
                  <When at={w.createdAt} />
                </Td>
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
