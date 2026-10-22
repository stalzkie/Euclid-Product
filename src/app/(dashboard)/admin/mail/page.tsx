import { requireAdmin } from "@/server/admin";
import { consoleData } from "@/server/admin-console";
import {
  deliveryQueue,
  emailQueue,
  jobHealth,
  linkHealth,
  mailByKind,
  recipients,
} from "@/server/admin-model";
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
  pct,
} from "../parts";
import { Search, matches } from "../search";

/**
 * Mail, webhooks and jobs: everything that happens on a schedule rather than
 * in a request, which is also everything that can stop working without anyone
 * noticing.
 *
 * Addresses are the whole point of the recipients panel. "Did they get the
 * e-mail" is the most common support question there is, and the answer is a
 * row in `email_outbox` with a `sent_at` — not a guess from the provider's
 * dashboard.
 */
export const dynamic = "force-dynamic";

export default async function MailPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const { q } = await searchParams;
  const { data, index } = await consoleData();
  const now = new Date();

  const mail = emailQueue(data);
  const hooks = deliveryQueue(data);
  const jobs = jobHealth(data);
  const links = linkHealth(data, now);
  const kinds = mailByKind(data.outbox.rows);
  const people = recipients(data.outbox.rows).filter((r) => matches(q, r.email, ...r.kinds));
  const messages = data.outbox.rows.filter((m) => matches(q, m.to_email, m.subject, m.kind));
  const failing = data.outbox.rows.filter((m) => !m.sent_at && (m.attempts ?? 0) > 0);

  const boardName = (id: string) => index.boards.get(id)?.name ?? "unknown board";

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Mail and queues</h1>
          <p className="text-[12.5px] text-ink-3">
            {data.outbox.rows.length} messages · {people.length} distinct recipients ·{" "}
            {data.magicLinks.rows.length} magic links
          </p>
        </div>
        <Search q={q} action="/admin/mail" placeholder="Address, subject, kind" />
      </header>

      <Cols min={170}>
        <Figure
          label="Queued e-mail"
          value={mail.queued}
          note={mail.failing > 0 ? `${mail.failing} failing` : "draining normally"}
          tone={mail.failing > 0 ? "bad" : mail.queued > 20 ? "warn" : "ok"}
        />
        <Figure
          label="Queued webhooks"
          value={hooks.queued}
          note={hooks.failing > 0 ? `${hooks.failing} failing` : "draining normally"
          }
          tone={hooks.failing > 0 ? "bad" : hooks.queued > 20 ? "warn" : "ok"}
        />
        <Figure
          label="Jobs pending"
          value={jobs.pending}
          note={`${jobs.running} running · ${jobs.failing} failing`}
          tone={jobs.failing > 0 ? "bad" : "ok"}
        />
        <Figure
          label="Magic links used"
          value={pct(links.rate)}
          note={`${links.used} used · ${links.expired} expired · ${links.pending} live`}
          tone={links.total > 0 && links.rate < 0.5 ? "warn" : "ok"}
        />
        <Figure label="Sent" value={data.outbox.rows.filter((m) => m.sent_at).length} tone="ok" />
      </Cols>

      {(mail.lastError || hooks.lastError || jobs.lastError) && (
        <Panel title="Last errors" note="The oldest unsent row in each queue, and what it said.">
          <Table min={620} head={["Queue", "Error"]}>
            {mail.lastError && (
              <Tr tone="bad">
                <Td>E-mail outbox</Td>
                <Td wrap>{mail.lastError}</Td>
              </Tr>
            )}
            {hooks.lastError && (
              <Tr tone="bad">
                <Td>Webhook deliveries</Td>
                <Td wrap>{hooks.lastError}</Td>
              </Tr>
            )}
            {jobs.lastError && (
              <Tr tone="bad">
                <Td>Jobs</Td>
                <Td wrap>{jobs.lastError}</Td>
              </Tr>
            )}
          </Table>
        </Panel>
      )}

      <div className="grid gap-7 lg:grid-cols-2">
        <Panel title="By kind" note="Which template, and whether it is going out.">
          {kinds.length === 0 ? (
            <Empty>Nothing has been queued.</Empty>
          ) : (
            <Table min={460} head={["Kind", "Sent", "Queued", "Failing", "Latest"]}>
              {kinds.map((k) => (
                <Tr key={k.kind} tone={k.failing > 0 ? "bad" : undefined}>
                  <Td>{k.kind}</Td>
                  <Td num>{k.sent}</Td>
                  <Td num>{k.queued}</Td>
                  <Td num>{k.failing || "—"}</Td>
                  <Td>
                    <When at={k.lastAt} />
                  </Td>
                </Tr>
              ))}
            </Table>
          )}
        </Panel>

        <Panel title="Jobs by kind" note="The scheduler's own work.">
          {jobs.byKind.length === 0 ? (
            <Empty>No job has ever been enqueued.</Empty>
          ) : (
            <Table min={420} head={["Kind", "Pending", "Done", "Failing"]}>
              {jobs.byKind.map((k) => (
                <Tr key={k.kind} tone={k.failing > 0 ? "bad" : undefined}>
                  <Td>{k.kind}</Td>
                  <Td num>{k.pending}</Td>
                  <Td num>{k.done}</Td>
                  <Td num>{k.failing || "—"}</Td>
                </Tr>
              ))}
            </Table>
          )}
        </Panel>
      </div>

      {failing.length > 0 && (
        <Panel title="Failing to send" note="Attempted at least once and still unsent.">
          <Table min={820} head={["Queued", "To", "Kind", "Subject", "Attempts", "Error"]}>
            {failing.map((m) => (
              <Tr key={m.id} tone="bad">
                <Td>
                  <When at={m.created_at} />
                </Td>
                <Td wrap>
                  <Email address={m.to_email} />
                </Td>
                <Td>{m.kind}</Td>
                <Td wrap className="max-w-[300px]">
                  {m.subject}
                </Td>
                <Td num>{m.attempts ?? 0}</Td>
                <Td wrap className="max-w-[280px] text-ink-3">
                  {m.last_error ?? "—"}
                </Td>
              </Tr>
            ))}
          </Table>
        </Panel>
      )}

      <Panel
        title={`Recipients${q ? ` matching “${q}”` : ""}`}
        note="Every address Euclid has written to, most recent first."
        aside={<span className="text-[12px] text-ink-3">{people.length} addresses</span>}
      >
        {people.length === 0 ? (
          <Empty>No recipient matches that.</Empty>
        ) : (
          <Table min={700} head={["Address", "Sent", "Queued", "Kinds", "Latest"]}>
            {people.slice(0, 300).map((r) => (
              <Tr key={r.email} tone={r.queued > 0 ? "warn" : undefined}>
                <Td wrap>
                  <Email address={r.email} />
                </Td>
                <Td num>{r.sent}</Td>
                <Td num>{r.queued || "—"}</Td>
                <Td wrap>{r.kinds.join(", ")}</Td>
                <Td>
                  <When at={r.lastAt} />
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel
        title={`Messages${q ? ` matching “${q}”` : ""}`}
        note="The outbox itself, newest first."
      >
        {messages.length === 0 ? (
          <Empty>Nothing matches that.</Empty>
        ) : (
          <Table min={900} head={["When", "To", "Kind", "Subject", "State", "Attempts", "Error"]}>
            {messages.slice(0, 200).map((m) => (
              <Tr key={m.id} tone={!m.sent_at && (m.attempts ?? 0) > 0 ? "bad" : undefined}>
                <Td>
                  <When at={m.created_at} />
                </Td>
                <Td wrap>
                  <Email address={m.to_email} />
                </Td>
                <Td>{m.kind}</Td>
                <Td wrap className="max-w-[340px]">
                  {m.subject}
                </Td>
                <Td>
                  {m.sent_at ? <Pill tone="ok">sent</Pill> : <Pill tone="warn">queued</Pill>}
                </Td>
                <Td num>{m.attempts ?? 0}</Td>
                <Td wrap className="max-w-[240px] text-ink-3">
                  {m.last_error ?? "—"}
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel
        title="Magic links"
        note="Board identity by e-mail. A low use rate means the mail is not arriving, not that people changed their minds."
      >
        {data.magicLinks.rows.length === 0 ? (
          <Empty>No board has asked anyone to verify an address.</Empty>
        ) : (
          <Table min={700} head={["When", "Address", "Board", "Expires", "State"]}>
            {data.magicLinks.rows.slice(0, 200).map((m) => (
              <Tr key={`${m.email}-${m.created_at}`}>
                <Td>
                  <When at={m.created_at} />
                </Td>
                <Td wrap>
                  <Email address={m.email} />
                </Td>
                <Td>{boardName(m.board_id)}</Td>
                <Td>
                  <When at={m.expires_at} />
                </Td>
                <Td>
                  {m.used_at ? (
                    <Pill tone="ok">used</Pill>
                  ) : new Date(m.expires_at) < now ? (
                    <Pill tone="warn">expired unused</Pill>
                  ) : (
                    <Pill tone="neutral">live</Pill>
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
