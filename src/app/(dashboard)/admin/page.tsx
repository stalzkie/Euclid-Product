import Link from "next/link";
import { requireAdmin } from "@/server/admin";
import { consoleData } from "@/server/admin-console";
import {
  addressBook,
  daySpan,
  deliveryQueue,
  emailQueue,
  estateBreakdowns,
  funnel,
  funnelRows,
  jobHealth,
  linkHealth,
  revenue,
  stickiness,
  trend,
  type QueueHealth,
} from "@/server/admin-model";
import {
  Cols,
  Email,
  Empty,
  Figure,
  Meterline,
  Panel,
  Pill,
  Series,
  Table,
  Td,
  Tr,
  When,
  money,
  pct,
} from "./parts";
import { Range } from "./range";

/**
 * Overview: the whole business on one screen.
 *
 * Order is deliberate and it is the order an operator actually asks in. What
 * is the business worth, is it growing, where do people stop, who is stuck,
 * is anything broken. Everything here is a slice of the same event stream the
 * other tabs read — see the note at the top of `admin-model.ts`.
 */
export const dynamic = "force-dynamic";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const days = params.days === "7" ? 7 : params.days === "90" ? 90 : 30;

  const { data, users, index, events } = await consoleData();
  const now = new Date();
  const labels = daySpan(days, now);

  const steps = funnel(funnelRows(data, index));
  const book = addressBook(data, users.rows);
  const rev = revenue(data.workspaces.rows);
  const sticky = stickiness(events, now);
  const mail = emailQueue(data);
  const hooks = deliveryQueue(data);
  const jobs = jobHealth(data);
  const links = linkHealth(data, now);
  const openErrors = data.errors.rows.filter((e) => !e.resolved_at);

  const series = [
    trend(events, ["signup"], "Workspaces created", days, now),
    trend(events, ["install"], "Widgets installed", days, now),
    trend(events, ["post"], "Requests posted", days, now),
    trend(events, ["vote"], "Votes", days, now),
    trend(events, ["prompt"], "Build Prompts", days, now),
    trend(events, ["chat"], "Ask Euclid threads", days, now),
  ];

  const boards = data.boards.rows;
  const installed = boards.filter((b) => b.installed_at).length;
  const latest = events.slice(0, 12);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Overview</h1>
          <p className="text-[12.5px] text-ink-3">
            {data.workspaces.rows.length} workspaces · {book.total} known addresses ·{" "}
            {events.length.toLocaleString("en-US")} events derived from state
          </p>
        </div>
        <Range days={days} base="/admin" />
      </header>

      <Panel title="Where the business is">
        <Cols min={170}>
          <Figure label="MRR" value={money(rev.mrrCents)} note={`${rev.payers} paying`} tone="ok" />
          <Figure
            label="ARR run rate"
            value={money(rev.arrCents)}
            note={rev.leaving > 0 ? `${rev.leaving} cancelling` : "none cancelling"}
            tone={rev.leaving > 0 ? "warn" : "neutral"}
          />
          <Figure
            label="On trial"
            value={rev.trials}
            note={`${money(rev.trialCents)} at stake`}
            tone="state"
          />
          <Figure
            label="Comped"
            value={rev.comped}
            note={`${money(rev.compedCents)} not billed`}
            tone={rev.comped > 0 ? "warn" : "neutral"}
          />
          <Figure
            label="ARPA"
            value={money(rev.arpaCents)}
            note="per paying workspace"
          />
          <Figure
            label="Logins"
            value={book.founders}
            note={`${users.rows.length} total · ${book.recipients} written to`}
            href="/admin/people"
          />
          <Figure
            label="Known addresses"
            value={book.total}
            note={`${book.anonymous} anonymous voters have none`}
            href="/admin/people"
          />
          <Figure
            label="Boards"
            value={boards.length}
            note={`${installed} installed · ${boards.length - installed} not`}
            href="/admin/boards"
            tone={boards.length > installed ? "warn" : "ok"}
          />
        </Cols>
      </Panel>

      <Panel
        title={`Trends · last ${days} days`}
        note="Each bar is a UTC day. The comparison is the same length of window immediately before it."
      >
        <Cols min={250}>
          {series.map((s) => (
            <Series
              key={s.label}
              label={s.label}
              total={s.total}
              previous={s.previous}
              points={s.points}
              labels={labels}
              tone={s.kind === "prompt" || s.kind === "chat" ? "ai" : "state"}
            />
          ))}
        </Cols>
      </Panel>

      <Panel
        title="Activation funnel"
        note="Cumulative, so a step can never exceed the one above it. Open a step to see exactly who stopped there."
        aside={
          <span className="text-[12px] text-ink-3">
            {steps.at(-1)?.count ?? 0} of {steps[0]?.count ?? 0} reach paid
          </span>
        }
      >
        <div className="flex flex-col rounded-card border border-line">
          {steps.map((step, i) => {
            const top = steps[0]?.count || 1;
            return (
              <div key={step.label} className="border-b border-line last:border-0">
                <Meterline
                  label={step.label}
                  value={step.count}
                  share={step.count / top}
                  right={
                    i === 0 || step.conversion === null ? "" : pct(step.conversion)
                  }
                  tone={i === steps.length - 1 ? "ok" : "state"}
                />
                {step.stuck.length > 0 && (
                  <details className="group px-3 pb-2.5">
                    <summary className="cursor-pointer list-none text-[12px] text-ink-3 hover:text-ink">
                      {step.stuck.length} stopped before this step — show addresses
                    </summary>
                    <ul className="mt-2 flex flex-col gap-1 border-t border-hairline pt-2">
                      {step.stuck.map((s) => (
                        <li key={s.id} className="flex flex-wrap items-center gap-2">
                          <Email address={s.email} />
                          <span className="text-[12px] text-ink-3">{s.name}</span>
                          <When at={s.since} prefix="signed up" />
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-7 lg:grid-cols-2">
        <Panel
          title="Engagement"
          note="A workspace counts as active on a day if anything at all happened in it."
        >
          <Cols min={120}>
            <Figure label="Active today" value={sticky.dau} />
            <Figure label="Active this week" value={sticky.wau} />
            <Figure label="Active this month" value={sticky.mau} />
            <Figure
              label="Stickiness"
              value={pct(sticky.ratio)}
              note="daily over monthly"
              tone={sticky.ratio >= 0.3 ? "ok" : "neutral"}
            />
          </Cols>
          <p className="mt-1 text-[12px] text-ink-3">
            <Link href="/admin/retention" className="text-state hover:underline">
              Weekly cohort retention →
            </Link>
          </p>
        </Panel>

        <Panel title="Health" note="The things that stop working without anyone noticing.">
          <Cols min={150}>
            <Queue label="E-mail outbox" q={mail} />
            <Queue label="Webhook deliveries" q={hooks} />
            <Figure
              label="Jobs pending"
              value={jobs.pending}
              note={jobs.failing > 0 ? `${jobs.failing} failing` : `${jobs.done} done`}
              tone={jobs.failing > 0 ? "bad" : "ok"}
            />
            <Figure
              label="Open errors"
              value={openErrors.length}
              note={openErrors.length > 0 ? "needs a look" : "nothing unresolved"}
              tone={openErrors.length > 0 ? "bad" : "ok"}
              href="/admin/errors"
            />
            <Figure
              label="Magic links used"
              value={pct(links.rate)}
              note={`${links.used} of ${links.total}`}
              tone={links.total > 0 && links.rate < 0.5 ? "warn" : "neutral"}
            />
            <Figure
              label="Prompts generated"
              value={data.prompts.rows.length}
              note={`${data.prompts.rows.filter((p) => p.copied).length} copied out`}
              tone="ai"
            />
            {/*
              The one figure here that is captured rather than derived, so it
              is the one that can be structurally zero: until 0032 is applied
              there is no table to read.
            */}
            <Figure
              label="Captured events"
              value={data.captured.missing ? "—" : data.captured.rows.length}
              note={
                data.captured.missing
                  ? "0032 not applied yet"
                  : "screens, steps, intent"
              }
              tone={data.captured.missing ? "warn" : "ai"}
              href="/admin/behaviour"
            />
          </Cols>
        </Panel>
      </div>

      <Panel title="Breakdowns" note="Every workspace, board, post and prompt, counted by property.">
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {estateBreakdowns(data).map((b) => {
            const top = b.rows[0]?.count || 1;
            const total = b.rows.reduce((a, r) => a + r.count, 0) || 1;
            return (
              <div key={b.label} className="flex flex-col rounded-card border border-line">
                <span className="border-b border-line bg-subtle px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-ink-3">
                  {b.label}
                </span>
                {b.rows.length === 0 ? (
                  <span className="px-3 py-3 text-[12px] text-ink-3">nothing yet</span>
                ) : (
                  b.rows
                    .slice(0, 8)
                    .map((r) => (
                      <Meterline
                        key={r.key}
                        label={r.key}
                        value={r.count}
                        share={r.count / top}
                        right={pct(r.count / total)}
                      />
                    ))
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel
        title="Latest activity"
        aside={
          <Link href="/admin/events" className="text-[12px] text-state hover:underline">
            Full event stream →
          </Link>
        }
      >
        {latest.length === 0 ? (
          <Empty>Nothing has happened yet.</Empty>
        ) : (
          <Table head={["When", "Event", "Who", "What", "Where"]} min={820}>
            {latest.map((e, i) => (
              <Tr key={`${e.at}-${i}`}>
                <Td>
                  <When at={e.at} />
                </Td>
                <Td>
                  <Pill tone={e.kind === "error" ? "bad" : "neutral"}>{e.kind}</Pill>
                </Td>
                <Td>
                  {e.actor.email ? (
                    <Email address={e.actor.email} />
                  ) : (
                    <span className="text-ink-3">{e.actor.label}</span>
                  )}
                </Td>
                <Td wrap className="max-w-[420px]">
                  {e.title}
                  {e.detail && <span className="text-ink-3"> · {e.detail}</span>}
                </Td>
                <Td>
                  <span className="text-ink-2">
                    {e.workspaceName ?? "—"}
                    {e.boardName ? ` · ${e.boardName}` : ""}
                  </span>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Panel>

      <p className="text-[12px] text-ink-3">
        Totals are derived from the rows themselves rather than captured events, so every number
        here is retroactive to the first row ever written and cannot drift out of step with the
        database.
      </p>
    </>
  );
}

/** A queue in a figure: its state in one word, its detail underneath. */
function Queue({ label, q }: { label: string; q: QueueHealth }) {
  const tone = q.failing > 0 ? "bad" : q.queued > 20 ? "warn" : "ok";
  const word = q.failing > 0 ? `${q.failing} failing` : q.queued > 20 ? "draining" : "clear";
  return (
    <Figure
      label={label}
      value={q.queued}
      note={
        <>
          {word}
          {q.oldestQueued ? <> · oldest {new Date(q.oldestQueued).toISOString().slice(0, 10)}</> : null}
        </>
      }
      tone={tone}
    />
  );
}
