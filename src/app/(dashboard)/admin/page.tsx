import { Shell } from "@/components/shell";
import { SectionTitle, Stat, cx } from "@/components/ui";
import { ago } from "@/lib/format";
import { adminSnapshot, requireAdmin } from "@/server/admin";
import { ErrorRow } from "./error-row";

/**
 * The operator's page. Everything, across every workspace.
 *
 * Gated by `requireAdmin`, which 404s rather than 403s — see src/server/admin.ts.
 * Not in the sidebar: it is reached by typing the URL, because a nav item
 * nobody else can use is a nav item that invites trying.
 */
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const ctx = await requireAdmin();
  const s = await adminSnapshot();

  /*
    A queue's health in one word.

    "Failing" and "draining" are deliberately different states: a backlog of
    fresh rows is a slow drain and resolves itself, while a backlog of rows
    that have already been attempted is something actually broken. Conflating
    them would make the common harmless case look like an incident.
  */
  const queueState = (q: { queued: number; failing: number }) =>
    q.failing > 0
      ? { label: `${q.failing} failing`, cls: "border-bad-line bg-bad-wash text-bad" }
      : q.queued > 20
        ? { label: "draining", cls: "border-[#FDE68A] bg-warn-wash text-warn" }
        : { label: "clear", cls: "border-ok-line bg-ok-wash text-ok" };

  return (
    <Shell active="settings" ctx={ctx} wide>
      <header className="flex flex-col gap-1">
        <h1 className="text-[26px] font-semibold tracking-[-0.015em]">Operations</h1>
        <p className="text-[14px] text-ink-2">
          Every workspace. Read-only except for resolving errors.
        </p>
      </header>

      {/* Funnel — derived from state, so it covers every workspace ever. */}
      <section aria-labelledby="funnel-title" className="flex flex-col gap-3">
        <SectionTitle id="funnel-title">Funnel</SectionTitle>
        <div className="flex flex-col rounded-card border border-line">
          {s.funnel.map((step, i) => {
            // Bar width is share of the first step, so the shape reads as a
            // funnel; the percentage beside it is step-to-step, which is the
            // number that says where people actually stop.
            const top = s.funnel[0].count || 1;
            return (
              <div
                key={step.label}
                className="flex items-center gap-4 border-b border-line px-4 py-3 last:border-0"
              >
                <span className="w-[160px] shrink-0 text-[13px] text-ink">{step.label}</span>
                <span className="h-[18px] flex-1 overflow-hidden rounded-[4px] bg-subtle">
                  <span
                    className="block h-full rounded-[4px] bg-state"
                    style={{ width: `${Math.max((step.count / top) * 100, step.count ? 2 : 0)}%` }}
                  />
                </span>
                <span className="w-10 shrink-0 text-right text-[13px] font-medium text-ink">
                  {step.count}
                </span>
                <span className="w-14 shrink-0 text-right text-[12.5px] text-ink-3">
                  {i === 0 || step.conversion === null
                    ? ""
                    : `${Math.round(step.conversion * 100)}%`}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Queues — the two things that silently stop working. */}
      <section aria-labelledby="queues-title" className="flex flex-col gap-3">
        <SectionTitle id="queues-title">Queues</SectionTitle>
        <div className="grid gap-3 md:grid-cols-2">
          {[
            { name: "Email", q: s.emails },
            { name: "Integrations", q: s.deliveries },
          ].map(({ name, q }) => (
            <div key={name} className="flex flex-col gap-2 rounded-card border border-line p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-medium text-ink">{name}</span>
                <span
                  className={cx(
                    "rounded-chip border px-2 py-[2px] text-[11.5px] font-medium",
                    queueState(q).cls,
                  )}
                >
                  {queueState(q).label}
                </span>
              </div>
              <div className="flex gap-6">
                <span className="text-[12.5px] text-ink-2">
                  {q.queued} queued
                </span>
                {q.oldestQueued && (
                  <span className="text-[12.5px] text-ink-3">oldest {ago(q.oldestQueued)}</span>
                )}
              </div>
              {/* The last error on the oldest stuck row, which is nearly
                  always the one explaining the backlog. */}
              {q.lastError && (
                <p className="truncate font-mono text-[11.5px] text-bad" title={q.lastError}>
                  {q.lastError}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Billing */}
      <section aria-labelledby="billing-title" className="flex flex-col gap-3">
        <SectionTitle id="billing-title">Billing</SectionTitle>
        <div className="grid grid-cols-2 rounded-card border border-line md:grid-cols-4">
          <Stat
            label="Subscriptions"
            value={Object.entries(s.billing.byStatus)
              .filter(([k]) => k !== "none")
              .reduce((n, [, v]) => n + v, 0)}
            note={Object.entries(s.billing.byStatus)
              .map(([k, v]) => `${v} ${k}`)
              .join(" · ")}
            className="border-b border-r border-line md:border-b-0"
          />
          <Stat
            label="Trials ending < 48h"
            value={s.billing.trialsEndingSoon.length}
            note={s.billing.trialsEndingSoon.map((t) => t.name).join(", ") || "none"}
            className="border-b border-line md:border-b-0 md:border-r"
          />
          <Stat
            label="Top-ups"
            value={s.billing.topups}
            note="net of refunds"
            className="border-r border-line"
          />
          <Stat
            label="Commissions"
            value={s.billing.commissions.granted}
            note={`${s.billing.commissions.reversed} reversed`}
          />
        </div>
      </section>

      {/* Partner pool + boards */}
      <section aria-labelledby="supply-title" className="flex flex-col gap-3">
        <SectionTitle id="supply-title">Supply and reach</SectionTitle>
        <div className="grid grid-cols-2 rounded-card border border-line md:grid-cols-4">
          <Stat
            label="Bernn codes"
            value={s.partner.available}
            note={s.partner.owed > 0 ? `${s.partner.owed} owed` : "none owed"}
            className="border-b border-r border-line md:border-b-0"
          />
          <Stat
            label="Boards"
            value={s.boards.total}
            className="border-b border-line md:border-b-0 md:border-r"
          />
          <Stat
            label="Never installed"
            value={s.boards.neverInstalled}
            note="widget never served live"
            className="border-r border-line"
          />
          <Stat
            label="Open allow-list"
            value={s.boards.openAllowList}
            note="will load anywhere"
          />
        </div>
      </section>

      {/* AI spend — the numbers that decide whether a plan ceiling still holds. */}
      <section aria-labelledby="ai-title" className="flex flex-col gap-3">
        <SectionTitle id="ai-title">AI usage</SectionTitle>
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[520px] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[12px] text-ink-3">
                <th className="px-4 py-2 font-medium">Workspace</th>
                <th className="px-4 py-2 font-medium">Plan</th>
                <th className="px-4 py-2 font-medium">Build Prompts</th>
                <th className="px-4 py-2 font-medium">Chat credits</th>
              </tr>
            </thead>
            <tbody>
              {s.ai.map((row) => (
                <tr key={row.workspace} className="border-b border-line last:border-0">
                  <td className="px-4 py-2 text-ink">{row.workspace}</td>
                  <td className="px-4 py-2 text-ink-2">{row.plan}</td>
                  <td className="px-4 py-2 text-ink-2">
                    {row.prompts}
                    {row.extraPrompts > 0 && (
                      <span className="text-ink-3"> +{row.extraPrompts} bought</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-ink-2">
                    {row.credits}
                    {row.extraCredits > 0 && (
                      <span className="text-ink-3"> +{row.extraCredits} bought</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Errors */}
      <section aria-labelledby="errors-title" className="flex flex-col gap-3">
        <SectionTitle id="errors-title">Open errors</SectionTitle>
        {s.errors.length === 0 ? (
          <p className="rounded-card border border-line px-4 py-6 text-center text-[13px] text-ink-3">
            Nothing unresolved. A fault that comes back reopens itself.
          </p>
        ) : (
          <ul className="flex flex-col rounded-card border border-line">
            {s.errors.map((e) => (
              <ErrorRow key={e.fingerprint} error={e} />
            ))}
          </ul>
        )}
      </section>
    </Shell>
  );
}
