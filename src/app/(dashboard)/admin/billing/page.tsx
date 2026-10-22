import Link from "next/link";
import { requireAdmin } from "@/server/admin";
import { consoleData } from "@/server/admin-console";
import { partnerPoolStatus } from "@/server/billing";
import { breakdown, revenue, workspaceViews } from "@/server/admin-model";
import {
  Cols,
  Email,
  Empty,
  Figure,
  Meterline,
  Panel,
  Pill,
  Table,
  Td,
  Tr,
  When,
  money,
  pct,
} from "../parts";

/**
 * Billing: what is paid, what is promised, and what is about to lapse.
 *
 * MRR counts a yearly subscription at its per-month price rather than the
 * amount charged — billing a year in January does not make January worth
 * twelve months. Three populations are kept apart on purpose, because they
 * are three different conversations: paying, on trial, and **comped** — a
 * paid tier with no live subscription, which `changePlan` allows while
 * billing is unconfigured and which a seeded workspace looks like.
 */
export const dynamic = "force-dynamic";

const SOON_HOURS = 72;

export default async function BillingPage() {
  await requireAdmin();
  const { data, index, events } = await consoleData();
  const pool = await partnerPoolStatus();

  const now = new Date();
  const soon = new Date(now.getTime() + SOON_HOURS * 3_600_000).toISOString();

  const rev = revenue(data.workspaces.rows);
  const spaces = workspaceViews(data, events, index);
  const byId = new Map(spaces.map((w) => [w.id, w]));

  const trialsEnding = data.workspaces.rows
    .filter(
      (w) =>
        w.subscription_status === "trialing" &&
        w.current_period_end &&
        w.current_period_end < soon,
    )
    .sort((a, b) => (a.current_period_end ?? "").localeCompare(b.current_period_end ?? ""));

  const leaving = spaces.filter((w) => w.cancelAtPeriodEnd);
  const topups = data.topups.rows;
  const commissions = data.commissions.rows;
  const statuses = breakdown("Status", data.workspaces.rows, (w) => w.subscription_status ?? "none");
  const statusTotal = data.workspaces.rows.length || 1;

  const owner = (workspaceId: string) => byId.get(workspaceId)?.owners[0] ?? null;

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Billing</h1>
        <p className="text-[12.5px] text-ink-3">
          {rev.payers} paying · {rev.trials} on trial · {rev.comped} comped ·{" "}
          {topups.filter((t) => !t.refunded_at).length} top-ups
        </p>
      </header>

      <Cols min={170}>
        <Figure label="MRR" value={money(rev.mrrCents)} tone="ok" />
        <Figure label="ARR run rate" value={money(rev.arrCents)} />
        <Figure label="ARPA" value={money(rev.arpaCents)} note="per paying workspace" />
        <Figure
          label="On trial"
          value={rev.trials}
          note={`${money(rev.trialCents)} at stake`}
          tone="state"
        />
        <Figure
          label="Cancelling"
          value={rev.leaving}
          note={`${money(rev.leavingCents)} leaving`}
          tone={rev.leaving > 0 ? "bad" : "ok"}
        />
        <Figure
          label="Comped"
          value={rev.comped}
          note={`${money(rev.compedCents)} not billed`}
          tone={rev.comped > 0 ? "warn" : "neutral"}
        />
      </Cols>

      <div className="grid gap-7 lg:grid-cols-2">
        <Panel title="Revenue by plan" note="Paying subscriptions only.">
          {rev.lines.length === 0 ? (
            <Empty>Nothing is being billed yet.</Empty>
          ) : (
            <Table min={420} head={["Plan", "Monthly", "Yearly", "MRR"]}>
              {rev.lines.map((line) => (
                <Tr key={line.plan}>
                  <Td>{line.name}</Td>
                  <Td num>{line.monthly}</Td>
                  <Td num>{line.yearly}</Td>
                  <Td num>{money(line.cents)}</Td>
                </Tr>
              ))}
            </Table>
          )}
        </Panel>

        <Panel title="Subscription status" note="Every workspace, including those that never went to checkout.">
          <div className="flex flex-col rounded-card border border-line">
            {statuses.rows.map((r) => (
              <Meterline
                key={r.key}
                label={r.key}
                value={r.count}
                share={r.count / statusTotal}
                right={pct(r.count / statusTotal)}
                tone={r.key === "active" ? "ok" : r.key === "trialing" ? "state" : "neutral"}
              />
            ))}
          </div>
        </Panel>
      </div>

      <Panel
        title={`Trials ending within ${SOON_HOURS} hours`}
        note="The list to act on today, with the address to write to."
      >
        {trialsEnding.length === 0 ? (
          <Empty>No trial ends in the next three days.</Empty>
        ) : (
          <Table min={760} head={["Workspace", "Owner", "Plan", "Ends", "Reminder sent", "Worth"]}>
            {trialsEnding.map((w) => (
              <Tr key={w.id} tone="warn">
                <Td>{w.name}</Td>
                <Td wrap>
                  {owner(w.id) ? (
                    <Link href={`/admin/people/${owner(w.id)!.userId}`}>
                      <Email address={owner(w.id)!.email} />
                    </Link>
                  ) : (
                    <span className="text-ink-3">no member</span>
                  )}
                </Td>
                <Td>{w.plan}</Td>
                <Td>
                  <When at={w.current_period_end} />
                </Td>
                <Td>
                  {w.trial_reminder_sent_at ? (
                    <When at={w.trial_reminder_sent_at} />
                  ) : (
                    <Pill tone="warn">not yet</Pill>
                  )}
                </Td>
                <Td num>{money(byId.get(w.id)?.mrrCents ?? 0)}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Panel>

      {leaving.length > 0 && (
        <Panel title="Cancelling at period end" note="Still paying, already decided.">
          <Table min={700} head={["Workspace", "Owner", "Plan", "MRR", "Ends", "Last seen"]}>
            {leaving.map((w) => (
              <Tr key={w.id} tone="bad">
                <Td>{w.name}</Td>
                <Td wrap>
                  <Email address={w.owners[0]?.email ?? null} />
                </Td>
                <Td>{w.planName}</Td>
                <Td num>{money(w.mrrCents)}</Td>
                <Td>
                  <When at={w.periodEnd} />
                </Td>
                <Td>
                  <When at={w.lastSeenAt} />
                </Td>
              </Tr>
            ))}
          </Table>
        </Panel>
      )}

      <Panel
        title="Top-ups"
        note="Purchased balance. Nothing resets it, so a refund is the only way it goes down other than use."
      >
        {topups.length === 0 ? (
          <Empty>Nobody has bought a pack.</Empty>
        ) : (
          <Table min={820} head={["When", "Workspace", "Buyer", "Pack", "Quantity", "Order", "State"]}>
            {topups.map((t) => (
              <Tr key={t.id} tone={t.refunded_at ? "warn" : undefined}>
                <Td>
                  <When at={t.created_at} />
                </Td>
                <Td>{byId.get(t.workspace_id)?.name ?? "unknown"}</Td>
                <Td wrap>
                  <Email address={owner(t.workspace_id)?.email ?? null} />
                </Td>
                <Td>{t.kind}</Td>
                <Td num>{t.quantity}</Td>
                <Td mono>{t.polar_order_id}</Td>
                <Td>
                  {t.refunded_at ? (
                    <Pill tone="bad">refunded</Pill>
                  ) : (
                    <Pill tone="ok">granted</Pill>
                  )}
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Panel>

      <div className="grid gap-7 lg:grid-cols-2">
        <Panel title="Referrals" note="Commission is credits, not cash, so this costs tokens rather than margin.">
          <Cols min={140}>
            <Figure
              label="Granted"
              value={commissions.filter((c) => !c.reversed_at).length}
              note={`${commissions
                .filter((c) => !c.reversed_at)
                .reduce((n, c) => n + c.quantity, 0)} credits`}
            />
            <Figure
              label="Reversed"
              value={commissions.filter((c) => c.reversed_at).length}
              tone={commissions.some((c) => c.reversed_at) ? "warn" : "neutral"}
            />
            <Figure label="Codes minted" value={data.referralCodes.rows.length} />
            <Figure
              label="Signups attributed"
              value={data.workspaces.rows.filter((w) => w.referred_by).length}
            />
          </Cols>
          {commissions.length > 0 && (
            <Table min={520} head={["When", "Referrer", "Code", "Credits", "Order"]}>
              {commissions.slice(0, 20).map((c) => (
                <Tr key={c.polar_order_id}>
                  <Td>
                    <When at={c.created_at} />
                  </Td>
                  <Td wrap>
                    <Email address={owner(c.referrer_id)?.email ?? null} />
                  </Td>
                  <Td mono>{c.code}</Td>
                  <Td num>{c.quantity}</Td>
                  <Td num>{money(c.order_cents)}</Td>
                </Tr>
              ))}
            </Table>
          )}
        </Panel>

        <Panel
          title="Partner promotion"
          note="A grant with no code is an IOU: the founder qualified while the pool was empty and is still owed a month."
        >
          <Cols min={140}>
            <Figure
              label="Codes available"
              value={pool?.available ?? "—"}
              tone={(pool?.available ?? 0) < 10 ? "warn" : "ok"}
            />
            <Figure
              label="Owed"
              value={pool?.owed ?? "—"}
              tone={(pool?.owed ?? 0) > 0 ? "bad" : "ok"}
            />
            <Figure label="Grants" value={data.grants.rows.length} />
            <Figure
              label="Filled"
              value={data.grants.rows.filter((g) => g.code).length}
            />
          </Cols>
          {data.grants.rows.length > 0 && (
            <Table min={520} head={["When", "Workspace", "Founder", "Code", "State"]}>
              {data.grants.rows.slice(0, 20).map((g) => (
                <Tr key={`${g.workspace_id}-${g.partner}`} tone={g.code ? undefined : "bad"}>
                  <Td>
                    <When at={g.created_at} />
                  </Td>
                  <Td>{byId.get(g.workspace_id)?.name ?? "unknown"}</Td>
                  <Td wrap>
                    <Email address={owner(g.workspace_id)?.email ?? null} />
                  </Td>
                  <Td mono>{g.code ?? "—"}</Td>
                  <Td>{g.code ? <Pill tone="ok">filled</Pill> : <Pill tone="bad">owed</Pill>}</Td>
                </Tr>
              ))}
            </Table>
          )}
        </Panel>
      </div>

      <Panel
        title="Student verifications"
        note="Addresses that asked for the academic discount, and whether the link was redeemed."
      >
        {data.students.rows.length === 0 ? (
          <Empty>Nobody has asked.</Empty>
        ) : (
          <Table min={700} head={["When", "Address", "Route", "Workspace", "Expires", "State"]}>
            {data.students.rows.map((s) => (
              <Tr key={`${s.workspace_id}-${s.created_at}`}>
                <Td>
                  <When at={s.created_at} />
                </Td>
                <Td wrap>
                  <Email address={s.email} />
                </Td>
                <Td>
                  <Pill tone={s.kind === "auto" ? "ok" : "warn"}>{s.kind}</Pill>
                </Td>
                <Td>{byId.get(s.workspace_id)?.name ?? "unknown"}</Td>
                <Td>
                  <When at={s.expires_at} />
                </Td>
                <Td>
                  {s.used_at ? (
                    <Pill tone="ok">redeemed</Pill>
                  ) : new Date(s.expires_at) < now ? (
                    <Pill tone="bad">expired</Pill>
                  ) : (
                    <Pill tone="neutral">pending</Pill>
                  )}
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}
