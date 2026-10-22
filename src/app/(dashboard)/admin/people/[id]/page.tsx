import Link from "next/link";
import { notFound } from "next/navigation";
import { isAdminEmail, requireAdmin } from "@/server/admin";
import { consoleData } from "@/server/admin-console";
import { workspaceViews } from "@/server/admin-model";
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
  pct,
  statusTone,
} from "../../parts";

/**
 * One person, everything.
 *
 * The screen a general analytics tool calls a person profile, with the
 * difference that the properties are the real ones rather than whatever was
 * passed to an identify call: the plan they are on, the allowance they have
 * burned, the boards they installed, the e-mail Euclid actually sent them and
 * whether it went out.
 *
 * The timeline is every event attributed to them *or* to a workspace they
 * belong to — their own actions and what their users did to them, which is
 * the pair of things you need when they write in.
 */
export const dynamic = "force-dynamic";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { data, users, index, events } = await consoleData();

  const user = users.rows.find((u) => u.id === id);
  if (!user) notFound();

  const memberships = data.members.rows.filter((m) => m.user_id === id);
  const workspaceIds = new Set(memberships.map((m) => m.workspace_id));
  const spaces = workspaceViews(data, events, index).filter((w) => workspaceIds.has(w.id));

  const mine = events.filter(
    (e) => e.actor.userId === id || (e.workspaceId && workspaceIds.has(e.workspaceId)),
  );
  const own = mine.filter((e) => e.actor.userId === id);

  const address = user.email?.toLowerCase() ?? null;
  const theirMail = address
    ? data.outbox.rows.filter((m) => m.to_email.toLowerCase() === address)
    : [];
  const theirLinks = address
    ? data.magicLinks.rows.filter((m) => m.email.toLowerCase() === address)
    : [];
  const theirStudent = data.students.rows.filter(
    (s) => workspaceIds.has(s.workspace_id) || (address && s.email.toLowerCase() === address),
  );
  const theirTopups = data.topups.rows.filter((t) => workspaceIds.has(t.workspace_id));
  const theirCommissions = data.commissions.rows.filter((c) => workspaceIds.has(c.referrer_id));
  const theirGrants = data.grants.rows.filter((g) => workspaceIds.has(g.workspace_id));

  const boards = data.boards.rows.filter((b) => workspaceIds.has(b.workspace_id));

  return (
    <>
      <header className="flex flex-col gap-1.5">
        <Link href="/admin/people" className="text-[12px] text-ink-3 hover:text-ink">
          ← People
        </Link>
        <h1 className="flex flex-wrap items-center gap-2 text-[22px] font-semibold tracking-[-0.015em]">
          {user.email ?? user.id}
          {isAdminEmail(user.email) && <Pill tone="ai">operator</Pill>}
          {!user.confirmedAt && <Pill tone="warn">address unconfirmed</Pill>}
        </h1>
        <p className="text-[12.5px] text-ink-3">
          {user.name ? `${user.name} · ` : ""}
          {own.length} of {mine.length} events are their own actions
        </p>
      </header>

      <Panel title="Identity" note="From the auth record, which is the only place the address lives.">
        <div className="grid gap-x-8 gap-y-2 rounded-card border border-line px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
          <Property label="Address">
            <Email address={user.email} />
          </Property>
          <Property label="Name">{user.name ?? "—"}</Property>
          <Property label="Sign-in provider">{user.provider ?? "—"}</Property>
          <Property label="User id">
            <span className="break-all font-mono text-[11.5px] text-ink-2">{user.id}</span>
          </Property>
          <Property label="Signed up">
            <When at={user.createdAt} />
          </Property>
          <Property label="Address confirmed">
            <When at={user.confirmedAt} />
          </Property>
          <Property label="Last sign-in">
            <When at={user.lastSignInAt} />
          </Property>
          <Property label="Role">{memberships[0]?.role ?? "no membership"}</Property>
          <Property label="Member since">
            <When at={memberships[0]?.created_at} />
          </Property>
        </div>
      </Panel>

      {spaces.length === 0 ? (
        <Panel title="Workspace">
          <Empty>
            This login owns no workspace. The bootstrap in <code>0013</code> creates one on first
            sign-in, so a login without one either predates it or hit an error on the way through.
          </Empty>
        </Panel>
      ) : (
        spaces.map((w) => (
          <Panel
            key={w.id}
            title={`Workspace · ${w.name}`}
            note={`${w.slug} · created ${new Date(w.createdAt).toISOString().slice(0, 10)}`}
            aside={
              <span className="flex items-center gap-1.5">
                <Pill tone={w.plan === "free" ? "neutral" : "ok"}>{w.planName}</Pill>
                <Pill tone={statusTone(w.status)}>{w.status ?? "no subscription"}</Pill>
                {w.cancelAtPeriodEnd && <Pill tone="warn">cancelling</Pill>}
              </span>
            }
          >
            <Cols min={150}>
              <Figure label="MRR" value={w.mrrCents > 0 ? money(w.mrrCents) : "—"} />
              <Figure label="Stage" value={w.stage} />
              <Figure
                label="Build Prompts"
                value={`${w.promptsUsed}/${w.promptLimit}`}
                note={w.extraPrompts > 0 ? `+${w.extraPrompts} bought` : "this month"}
                tone={w.promptLimit > 0 && w.promptsUsed >= w.promptLimit ? "warn" : "neutral"}
              />
              <Figure
                label="Chat credits"
                value={`${w.creditsUsed}/${w.creditLimit}`}
                note={w.extraCredits > 0 ? `+${w.extraCredits} bought` : "this month"}
                tone={w.creditLimit > 0 && w.creditsUsed >= w.creditLimit ? "warn" : "neutral"}
              />
              <Figure label="Boards" value={`${w.installedBoards}/${w.boards}`} note="installed" />
              <Figure label="Requests" value={w.posts} note={`${w.votes} votes`} />
              <Figure
                label="Visitors"
                value={w.visitors}
                note={`${w.visitorsWithEmail} with an address`}
              />
              <Figure
                label="Prompts"
                value={w.prompts}
                note={`${w.promptsCopied} copied out`}
                tone="ai"
              />
              <Figure label="Period ends" value={w.periodEnd ? new Date(w.periodEnd).toISOString().slice(0, 10) : "—"} />
              <Figure label="Referred by" value={w.referredBy ?? "direct"} />
              <Figure label="Their code" value={w.referralCode ?? "none minted"} />
              <Figure label="App" value={w.appName ?? "—"} note={w.appUrl ?? undefined} />
            </Cols>
            {w.codingTools.length > 0 && (
              <p className="text-[12px] text-ink-3">Coding tools: {w.codingTools.join(", ")}</p>
            )}
          </Panel>
        ))
      )}

      {boards.length > 0 && (
        <Panel title="Their boards">
          <Table
            min={900}
            head={["Board", "Public id", "Installed", "Identity", "Allow-list", "Custom domain", "Badge"]}
          >
            {boards.map((b) => (
              <Tr key={b.id}>
                <Td>{b.name}</Td>
                <Td mono>{b.public_id}</Td>
                <Td>
                  {b.installed_at ? <When at={b.installed_at} /> : <Pill tone="warn">never</Pill>}
                </Td>
                <Td>{b.identity_mode}</Td>
                <Td wrap>
                  {(b.allowed_domains ?? []).length === 0 ? (
                    <Pill tone="warn">open</Pill>
                  ) : (
                    (b.allowed_domains ?? []).join(", ")
                  )}
                </Td>
                <Td>{b.custom_domain ?? "—"}</Td>
                <Td>{b.show_badge ? "shown" : "hidden"}</Td>
              </Tr>
            ))}
          </Table>
        </Panel>
      )}

      {(theirTopups.length > 0 || theirCommissions.length > 0 || theirGrants.length > 0 ||
        theirStudent.length > 0) && (
        <Panel title="Money and grants">
          <Table min={760} head={["What", "When", "Detail", "State"]}>
            {theirTopups.map((t) => (
              <Tr key={t.id}>
                <Td>Top-up · {t.quantity} {t.kind}</Td>
                <Td>
                  <When at={t.created_at} />
                </Td>
                <Td mono>{t.polar_order_id}</Td>
                <Td>
                  {t.refunded_at ? <Pill tone="bad">refunded</Pill> : <Pill tone="ok">granted</Pill>}
                </Td>
              </Tr>
            ))}
            {theirCommissions.map((c) => (
              <Tr key={c.polar_order_id}>
                <Td>Referral commission · {c.quantity} credits</Td>
                <Td>
                  <When at={c.created_at} />
                </Td>
                <Td>
                  {c.code} · order {money(c.order_cents)}
                </Td>
                <Td>
                  {c.reversed_at ? <Pill tone="bad">reversed</Pill> : <Pill tone="ok">granted</Pill>}
                </Td>
              </Tr>
            ))}
            {theirGrants.map((g) => (
              <Tr key={`${g.workspace_id}-${g.partner}`}>
                <Td>Partner grant · {g.partner}</Td>
                <Td>
                  <When at={g.created_at} />
                </Td>
                <Td mono>{g.code ?? "no code yet"}</Td>
                <Td>
                  {g.code ? <Pill tone="ok">filled</Pill> : <Pill tone="warn">owed</Pill>}
                </Td>
              </Tr>
            ))}
            {theirStudent.map((s) => (
              <Tr key={`${s.workspace_id}-${s.created_at}`}>
                <Td>Student verification · {s.kind}</Td>
                <Td>
                  <When at={s.created_at} />
                </Td>
                <Td wrap>
                  <Email address={s.email} dim />
                </Td>
                <Td>
                  {s.used_at ? <Pill tone="ok">redeemed</Pill> : <Pill tone="neutral">pending</Pill>}
                </Td>
              </Tr>
            ))}
          </Table>
        </Panel>
      )}

      <Panel
        title="Mail to this address"
        note="What Euclid sent them, and whether it actually went out."
        aside={
          <span className="text-[12px] text-ink-3">
            {theirMail.filter((m) => m.sent_at).length} sent of {theirMail.length}
            {theirLinks.length > 0 &&
              ` · ${theirLinks.filter((l) => l.used_at).length}/${theirLinks.length} magic links used`}
          </span>
        }
      >
        {theirMail.length === 0 ? (
          <Empty>Nothing has been addressed to them.</Empty>
        ) : (
          <Table min={820} head={["When", "Kind", "Subject", "State", "Attempts", "Last error"]}>
            {theirMail.map((m) => (
              <Tr key={m.id} tone={!m.sent_at && (m.attempts ?? 0) > 0 ? "bad" : undefined}>
                <Td>
                  <When at={m.created_at} />
                </Td>
                <Td>{m.kind}</Td>
                <Td wrap className="max-w-[360px]">
                  {m.subject}
                </Td>
                <Td>
                  {m.sent_at ? <Pill tone="ok">sent</Pill> : <Pill tone="warn">queued</Pill>}
                </Td>
                <Td num>{m.attempts ?? 0}</Td>
                <Td wrap className="max-w-[260px] text-ink-3">
                  {m.last_error ?? "—"}
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel
        title="Timeline"
        note="Their own actions and everything that happened in their workspaces, newest first."
        aside={
          <span className="text-[12px] text-ink-3">
            {mine.length} events · {pct(mine.length === 0 ? 0 : own.length / mine.length)} their own
          </span>
        }
      >
        {mine.length === 0 ? (
          <Empty>Nothing yet beyond signing up.</Empty>
        ) : (
          <Table min={880} head={["When", "Event", "Who", "What", "Where"]}>
            {mine.slice(0, 200).map((e, i) => (
              <Tr key={`${e.at}-${i}`}>
                <Td>
                  <When at={e.at} />
                </Td>
                <Td>
                  <Pill tone={e.actor.userId === id ? "state" : "neutral"}>{e.kind}</Pill>
                </Td>
                <Td wrap>
                  {e.actor.email ? (
                    <Email address={e.actor.email} dim />
                  ) : (
                    <span className="text-ink-3">{e.actor.label}</span>
                  )}
                </Td>
                <Td wrap className="max-w-[420px]">
                  {e.title}
                  {e.detail && <span className="text-ink-3"> · {e.detail}</span>}
                </Td>
                <Td>{e.boardName ?? e.workspaceName ?? "—"}</Td>
              </Tr>
            ))}
          </Table>
        )}
        {mine.length > 200 && (
          <p className="text-[12px] text-ink-3">
            Showing the 200 most recent of {mine.length}.
          </p>
        )}
      </Panel>
    </>
  );
}

function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="text-[11px] uppercase tracking-[0.05em] text-ink-3">{label}</span>
      <span className="text-[12.5px] text-ink">{children}</span>
    </div>
  );
}
