import Link from "next/link";
import { isAdminEmail, requireAdmin } from "@/server/admin";
import { consoleData } from "@/server/admin-console";
import { addressBook, people, visitors } from "@/server/admin-model";
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
 * People: every person Euclid can name, on one screen.
 *
 * Two populations, kept apart because they are not the same kind of person.
 * A **login** is a founder — they pay, they get the e-mails, and their
 * address comes from `auth.users`, which is why it needs the auth admin API
 * rather than a select. A **visitor** is somebody on a board: an address if
 * the board asks for one, a fingerprint if it does not.
 *
 * Addresses are shown in full rather than masked. This screen is behind
 * `ADMIN_EMAILS` precisely so that it can be the place where an operator
 * finds out who wrote in, and a console that redacts the one field it exists
 * to show is a console you work around with SQL.
 */
export const dynamic = "force-dynamic";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const { q } = await searchParams;
  const { data, users, index, events } = await consoleData();

  const book = addressBook(data, users.rows);
  const founders = people(data, users.rows, events, index, isAdminEmail).filter((p) =>
    matches(q, p.email, p.name, p.userId, ...p.workspaces.map((w) => w.name)),
  );
  const guests = visitors(data, index).filter((v) =>
    matches(q, v.email, v.label, v.name, v.board, v.workspace, v.id),
  );

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em]">People</h1>
          <p className="text-[12.5px] text-ink-3">
            {book.founders} logins and {book.visitors} addressable visitors.{" "}
            {book.anonymous > 0 && `${book.anonymous} voters are anonymous and have no address.`}
          </p>
        </div>
        <Search q={q} action="/admin/people" placeholder="Address, name, workspace, board" />
      </header>

      <Cols min={170}>
        <Figure label="Logins" value={users.rows.length} note={`${book.founders} with an address`} />
        <Figure
          label="Visitors with an address"
          value={book.visitors}
          note={`${book.verifiedVisitors} verified`}
        />
        <Figure label="Anonymous visitors" value={book.anonymous} note="fingerprint only" />
        <Figure label="Written to" value={book.recipients} note="distinct recipients" />
        <Figure label="Known addresses" value={book.total} note="all sources, de-duplicated" />
      </Cols>

      <Panel
        title={`Logins${q ? ` matching “${q}”` : ""}`}
        note="Everyone who can sign in to the dashboard. Open a row for their full timeline."
        aside={<span className="text-[12px] text-ink-3">{founders.length} shown</span>}
      >
        {founders.length === 0 ? (
          <Empty>No login matches that.</Empty>
        ) : (
          <Table
            min={1240}
            head={[
              "Address",
              "Name",
              "Workspace",
              "Plan",
              "Status",
              "MRR",
              "Stage",
              "Boards",
              "Requests",
              "Prompts",
              "Chats",
              "Events",
              "Signed up",
              "Last sign-in",
              "Last seen",
              "",
            ]}
          >
            {founders.map((p) => (
              <Tr key={p.userId}>
                <Td wrap>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Email address={p.email} />
                    {p.isAdmin && <Pill tone="ai">operator</Pill>}
                    {!p.confirmedAt && <Pill tone="warn">unconfirmed</Pill>}
                  </span>
                </Td>
                <Td>{p.name ?? <span className="text-ink-3">—</span>}</Td>
                <Td wrap>
                  {p.workspaces.length === 0 ? (
                    <Pill tone="bad">no workspace</Pill>
                  ) : (
                    p.workspaces.map((w) => (
                      <Link
                        key={w.id}
                        href={`/admin/workspaces?q=${encodeURIComponent(w.name)}`}
                        className="text-state hover:underline"
                      >
                        {w.name}
                      </Link>
                    ))
                  )}
                </Td>
                <Td>{p.plan ?? "—"}</Td>
                <Td>
                  <Pill tone={statusTone(p.status)}>{p.status ?? "none"}</Pill>
                </Td>
                <Td num>{p.mrrCents > 0 ? money(p.mrrCents) : "—"}</Td>
                <Td>{p.stage}</Td>
                <Td num>
                  {p.installedBoards}/{p.boards}
                </Td>
                <Td num>{p.posts}</Td>
                <Td num>{p.prompts}</Td>
                <Td num>{p.chats}</Td>
                <Td num>{p.events}</Td>
                <Td>
                  <When at={p.signedUpAt} />
                </Td>
                <Td>
                  <When at={p.lastSignInAt} />
                </Td>
                <Td>
                  <When at={p.lastSeenAt} />
                </Td>
                <Td>
                  <Link
                    href={`/admin/people/${p.userId}`}
                    className="text-[12px] text-state hover:underline"
                  >
                    open
                  </Link>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel
        title={`Visitors${q ? ` matching “${q}”` : ""}`}
        note="People on the boards themselves. A board on anonymous identity can only ever show a fingerprint."
        aside={<span className="text-[12px] text-ink-3">{guests.length} shown</span>}
      >
        {guests.length === 0 ? (
          <Empty>No visitor matches that.</Empty>
        ) : (
          <Table
            min={1080}
            head={[
              "Address or key",
              "Identity",
              "Board",
              "Workspace",
              "Votes",
              "Requests",
              "Comments",
              "Weight",
              "First seen",
              "Last seen",
            ]}
          >
            {guests.slice(0, 500).map((v) => (
              <Tr key={v.id}>
                <Td wrap>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {v.email ? (
                      <Email address={v.email} />
                    ) : (
                      <span className="font-mono text-[11.5px] text-ink-3">{v.label}</span>
                    )}
                    {v.email && !v.emailVerified && <Pill tone="warn">unverified</Pill>}
                    {v.email && v.emailVerified && <Pill tone="ok">verified</Pill>}
                  </span>
                </Td>
                <Td>{v.kind}</Td>
                <Td>
                  <Link
                    href={`/admin/boards?q=${encodeURIComponent(v.board)}`}
                    className="text-state hover:underline"
                  >
                    {v.board}
                  </Link>
                </Td>
                <Td>{v.workspace ?? "—"}</Td>
                <Td num>{v.votes}</Td>
                <Td num>{v.posts}</Td>
                <Td num>{v.comments}</Td>
                <Td num>{v.voteWeight}</Td>
                <Td>
                  <When at={v.firstSeenAt} />
                </Td>
                <Td>
                  <When at={v.lastSeenAt} />
                </Td>
              </Tr>
            ))}
          </Table>
        )}
        {guests.length > 500 && (
          <p className="text-[12px] text-ink-3">
            Showing the 500 most recent of {guests.length}. Narrow it with the search above.
          </p>
        )}
      </Panel>
    </>
  );
}
