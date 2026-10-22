import Link from "next/link";
import { isAdminEmail, requireAdmin } from "@/server/admin";
import { consoleData } from "@/server/admin-console";
import {
  captureSince,
  capturedStats,
  daySpan,
  intentGaps,
  onboardingProgress,
  pathStats,
  propBreakdown,
  sessionStats,
  trend,
} from "@/server/admin-model";
import { EVENT_NAMES } from "@/lib/analytics/events";
import { cx } from "@/components/ui";
import {
  Bars,
  Cols,
  Delta,
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
  pct,
} from "../parts";
import { Range } from "../range";

/**
 * Behaviour: the half of the console that is captured rather than derived.
 *
 * Every other tab reads state, which is complete back to the first row ever
 * written. This one reads `analytics_events`, which starts when capture was
 * deployed and covers only what a browser was asked to send — so it says so
 * at the top rather than letting an operator read a four-day-old table as
 * though it were history.
 *
 * What it answers that nothing else can: which screens get opened, which
 * onboarding step people stop on, and who showed intent that product state
 * says never became anything.
 */
export const dynamic = "force-dynamic";

export default async function BehaviourPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; all?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const days = params.days === "7" ? 7 : params.days === "90" ? 90 : 30;
  const includeOperators = params.all === "1";

  const { data, users, index, events } = await consoleData();
  const now = new Date();
  const labels = daySpan(days, now);

  /*
    The operator's own clicking is excluded by default.

    Not vanity — accuracy. Whoever reads this screen also spends their day
    opening every other screen in the app, so with them included the top
    screen is always whichever one was last being debugged, and "did anyone
    use the designer" cannot be answered at all.
  */
  const operators = new Set(users.rows.filter((u) => isAdminEmail(u.email)).map((u) => u.id));
  const rows = includeOperators
    ? data.captured.rows
    : data.captured.rows.filter((r) => !r.user_id || !operators.has(r.user_id));
  const excluded = data.captured.rows.length - rows.length;

  const since = captureSince(data.captured.rows);
  const screens = capturedStats(rows, days, now, (name) => name.startsWith("screen."));
  const actions = capturedStats(rows, days, now, (name) => !name.startsWith("screen."));
  const paths = pathStats(rows, days, now);
  const sessions = sessionStats(rows, days, now);
  const onboarding = onboardingProgress(data, index, users.rows);
  const gaps = intentGaps(data, index);
  const everything = trend(
    events.filter((e) => e.kind === "track"),
    ["track"],
    "Captured events",
    days,
    now,
  );

  const frameworks = propBreakdown(rows, "install.snippet_copied", "framework");
  const upgrades = propBreakdown(rows, "billing.upgrade_clicked", "tier");

  const screenTop = screens[0]?.people || 1;
  const pathTop = paths[0]?.events || 1;

  const href = (next: { days?: number; all?: boolean }) => {
    const sp = new URLSearchParams();
    sp.set("days", String(next.days ?? days));
    if (next.all ?? includeOperators) sp.set("all", "1");
    return `/admin/behaviour?${sp.toString()}`;
  };

  if (data.captured.missing) {
    return (
      <>
        <Header days={days} includeOperators={includeOperators} />
        <Panel title="Not migrated yet">
          <div className="flex flex-col gap-2 rounded-card border border-[#FDE68A] bg-warn-wash px-4 py-3.5 text-[13px] text-warn">
            <p className="font-medium">
              `analytics_events` is not in the database, so nothing is being captured.
            </p>
            <p>
              Apply <code className="font-mono">supabase/migrations/0032_analytics_events.sql</code>{" "}
              through the Supabase SQL editor. Until then the capture endpoint logs a warning and
              drops what it is sent, which is deliberate: a missing table must not turn into an
              error on a founder&apos;s dashboard.
            </p>
            <p>
              Everything on the other tabs is derived from state and is unaffected — this is the
              only screen that needs the new table.
            </p>
          </div>
        </Panel>
      </>
    );
  }

  return (
    <>
      <Header days={days} includeOperators={includeOperators} />

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={href({ all: !includeOperators })}
          className={cx(
            "rounded-chip border px-2 py-[3px] text-[12px] transition-colors",
            includeOperators
              ? "border-ink bg-ink text-white"
              : "border-line text-ink-2 hover:border-line-strong hover:text-ink",
          )}
        >
          {includeOperators ? "Operators included" : `Operators excluded${excluded > 0 ? ` (${excluded} events)` : ""}`}
        </Link>
        <span className="text-[12px] text-ink-3">
          {since ? (
            <>
              Capture began <When at={since} /> · {data.captured.rows.length.toLocaleString("en-US")}{" "}
              events, pruned after 180 days
            </>
          ) : (
            "Nothing captured yet."
          )}
        </span>
      </div>

      {data.captured.rows.length === 0 ? (
        <Panel title="Nothing captured yet">
          <Empty>
            The table is there and the dashboard is wired, so the first screen anybody opens after
            the next deploy will appear here. Capture needs a signed-in session, so nothing before
            signup is recorded — the top of the funnel stays derived from{" "}
            <code className="font-mono">workspaces.created_at</code>.
          </Empty>
        </Panel>
      ) : (
        <>
          <Cols min={170}>
            <Figure
              label="Events"
              value={everything.total}
              note={<Delta now={everything.total} prev={everything.previous} />}
            />
            <Figure label="Sessions" value={sessions.sessions} note="distinct tabs" />
            <Figure
              label="Screens a visit"
              value={sessions.screensPerSession}
              note={`deepest ${sessions.deepest}`}
            />
            <Figure
              label="Screens opened"
              value={screens.reduce((n, s) => n + s.events, 0)}
              note={`${screens.length} of ${EVENT_NAMES.filter((n) => n.startsWith("screen.")).length} screens seen`}
            />
            <Figure
              label="People"
              value={new Set(rows.filter((r) => r.user_id).map((r) => r.user_id)).size}
              note="logins with any event"
            />
          </Cols>

          <Panel title={`Captured events · last ${days} days`}>
            <div className="rounded-card border border-line px-3 py-3">
              <Bars points={everything.points} labels={labels} tone="ai" height={60} />
            </div>
          </Panel>

          <Panel
            title="Onboarding, step by step"
            note="The one panel here that could not be derived: an abandoned step writes nothing at all. The last two steps are state rather than capture, because the database already holds them."
          >
            {onboarding[0]?.count === 0 ? (
              <Empty>No login has sent an event yet.</Empty>
            ) : (
              <div className="flex flex-col rounded-card border border-line">
                {onboarding.map((step, i) => (
                  <div key={step.label} className="border-b border-line last:border-0">
                    <Meterline
                      label={step.label}
                      value={step.count}
                      share={step.count / (onboarding[0]?.count || 1)}
                      right={i === 0 || step.conversion === null ? "" : pct(step.conversion)}
                      tone={i >= onboarding.length - 2 ? "ok" : "ai"}
                    />
                    {step.stuck.length > 0 && (
                      <details className="px-3 pb-2.5">
                        <summary className="cursor-pointer list-none text-[12px] text-ink-3 hover:text-ink">
                          {step.stuck.length} stopped before this step — show addresses
                        </summary>
                        <ul className="mt-2 flex flex-col gap-1 border-t border-hairline pt-2">
                          {step.stuck.map((person) => (
                            <li key={person.userId} className="flex flex-wrap items-center gap-2">
                              <Link href={`/admin/people/${person.userId}`}>
                                <Email address={person.email} />
                              </Link>
                              <span className="text-[12px] text-ink-3">
                                {person.workspace ?? "no workspace"}
                              </span>
                              <When at={person.firstSeen} prefix="first seen" />
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {gaps.map((gap) => (
            <Panel key={gap.label} title={gap.label} note={gap.note}>
              {gap.people.length === 0 ? (
                <Empty>Nobody — everyone who showed the intent followed through.</Empty>
              ) : (
                <Table min={760} head={["Address", "Workspace", "When", "Detail", ""]}>
                  {gap.people.map((person) => (
                    <Tr key={`${gap.label}-${person.userId}`} tone="warn">
                      <Td wrap>
                        <Email address={person.email} />
                      </Td>
                      <Td>{person.workspace ?? "—"}</Td>
                      <Td>
                        <When at={person.at} />
                      </Td>
                      <Td wrap className="text-ink-3">
                        {person.detail ?? "—"}
                      </Td>
                      <Td>
                        {person.userId && (
                          <Link
                            href={`/admin/people/${person.userId}`}
                            className="text-[12px] text-state hover:underline"
                          >
                            open
                          </Link>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </Table>
              )}
            </Panel>
          ))}

          <Panel
            title="Screens"
            note="People rather than views is the column to read: one founder reloading the designer twenty times is one founder."
          >
            {screens.length === 0 ? (
              <Empty>No screen has been opened in this window.</Empty>
            ) : (
              <Table min={840} head={["Screen", "People", "Views", "Sessions", "Workspaces", "Shape", "Last"]}>
                {screens.map((s) => (
                  <Tr key={s.name}>
                    <Td>
                      <span className="flex flex-col">
                        <span className="text-ink">{s.label}</span>
                        <span className="font-mono text-[11px] text-ink-3">{s.name}</span>
                      </span>
                    </Td>
                    <Td num>{s.people}</Td>
                    <Td num>{s.events}</Td>
                    <Td num>{s.sessions}</Td>
                    <Td num>{s.workspaces}</Td>
                    <Td>
                      <span className="block w-[120px]">
                        <Bars points={s.points} tone="ai" height={22} />
                      </span>
                    </Td>
                    <Td>
                      <When at={s.lastAt} />
                    </Td>
                  </Tr>
                ))}
              </Table>
            )}
          </Panel>

          <div className="grid gap-7 lg:grid-cols-2">
            <Panel title="Actions" note="Intentions that leave no row behind.">
              {actions.length === 0 ? (
                <Empty>No action captured in this window.</Empty>
              ) : (
                <Table min={460} head={["Event", "People", "Count", "Last"]}>
                  {actions.map((a) => (
                    <Tr key={a.name}>
                      <Td wrap>
                        <span className="flex items-center gap-1.5">
                          {a.label}
                          {a.name.startsWith("onboarding.") && <Pill tone="state">step</Pill>}
                        </span>
                      </Td>
                      <Td num>{a.people}</Td>
                      <Td num>{a.events}</Td>
                      <Td>
                        <When at={a.lastAt} />
                      </Td>
                    </Tr>
                  ))}
                </Table>
              )}
            </Panel>

            <Panel title="Routes" note="Where people were, with ids collapsed so the same screen groups.">
              {paths.length === 0 ? (
                <Empty>Nothing in this window.</Empty>
              ) : (
                <div className="flex flex-col rounded-card border border-line">
                  {paths.slice(0, 12).map((p) => (
                    <Meterline
                      key={p.name}
                      label={<span className="font-mono text-[11.5px]">{p.name}</span>}
                      value={p.events}
                      share={p.events / pathTop}
                      right={`${p.people}p`}
                      tone="ai"
                    />
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <div className="grid gap-7 lg:grid-cols-2">
            {[frameworks, upgrades].map((b) => {
              const total = b.rows.reduce((n, r) => n + r.count, 0);
              return (
                <Panel key={b.label} title={b.label} note="From the properties on the captured event.">
                  {b.rows.length === 0 ? (
                    <Empty>Not captured yet.</Empty>
                  ) : (
                    <div className="flex flex-col rounded-card border border-line">
                      {b.rows.map((r) => (
                        <Meterline
                          key={r.key}
                          label={r.key}
                          value={r.count}
                          share={r.count / (b.rows[0]?.count || 1)}
                          right={pct(r.count / (total || 1))}
                          tone="ai"
                        />
                      ))}
                    </div>
                  )}
                </Panel>
              );
            })}
          </div>

          <Panel title="Most opened screen" note="Of the people seen in this window.">
            <div className="flex flex-col rounded-card border border-line">
              {screens.slice(0, 10).map((s) => (
                <Meterline
                  key={s.name}
                  label={s.label}
                  value={s.people}
                  share={s.people / screenTop}
                  right={`${s.events} views`}
                  tone="ai"
                />
              ))}
            </div>
          </Panel>

          <p className="text-[12px] text-ink-3">
            Captured rows are pruned after 180 days by the daily job, and nothing identifying is
            stored in a property: the route knows who sent an event from the session, and{" "}
            <code className="font-mono">cleanProps</code> drops anything shaped like an address.
            Capture needs a session, so there is no anonymous write path into this table — and
            nothing before signup is recorded.
          </p>
        </>
      )}
    </>
  );
}

function Header({ days, includeOperators }: { days: number; includeOperators: boolean }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Behaviour</h1>
        <p className="text-[12.5px] text-ink-3">
          Captured, not derived. Screens opened, steps abandoned, intent that state says never
          happened.
        </p>
      </div>
      <Range days={days} base="/admin/behaviour" extra={{ all: includeOperators ? "1" : undefined }} />
    </header>
  );
}
