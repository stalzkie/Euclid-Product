import { PLANS } from "@/lib/plans";
import {
  ONBOARDING_STEPS,
  eventLabel,
  type EventName,
} from "@/lib/analytics/events";
import type { PlanTier } from "@/lib/types";
import type {
  AdminUser,
  AnalyticsRow,
  BoardRow,
  EndUserRow,
  Estate,
  OutboxRow,
  WorkspaceRow,
} from "@/server/admin-data";

/**
 * The operator console, as pure functions.
 *
 * Nothing in this file touches a database. `admin-data.ts` reads the tables
 * once and everything here derives a panel from that shape, which is what
 * makes a console this size possible to trust: retention, cohorts, funnels and
 * the event stream are ordinary functions with ordinary tests, not SQL that
 * can only be checked by looking at the screen and nodding.
 *
 * The one idea the whole file rests on is **one event stream, many panels**.
 * `deriveEvents` turns state into a timeline — a post is an event, a vote is
 * an event, a top-up is an event — and trends, retention, stickiness, the
 * feed and every "last seen" column are then slices of that single list. A
 * general analytics tool has to capture events at the call site because it
 * cannot know what a row means. This one knows, so it does not have to: the
 * timeline is a view of the database rather than a second copy of it, which
 * is why it is retroactive to the first row ever written and cannot drift out
 * of sync with the thing it describes.
 */

/* -------------------------------------------------------------------------- */
/* Time                                                                       */
/* -------------------------------------------------------------------------- */

const DAY_MS = 86_400_000;

/** A UTC day key, `YYYY-MM-DD`. UTC throughout, so a chart does not shift. */
export function dayKey(at: Date | string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return d.toISOString().slice(0, 10);
}

/** The Monday that starts the UTC week `at` falls in, as a day key. */
export function weekKey(at: Date | string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  // getUTCDay is 0 for Sunday, which is 6 days into a Monday-first week.
  const offset = (new Date(start).getUTCDay() + 6) % 7;
  return new Date(start - offset * DAY_MS).toISOString().slice(0, 10);
}

/** `days` day keys ending today, oldest first. */
export function daySpan(days: number, now: Date): string[] {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, i) =>
    new Date(end - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10),
  );
}

/** How many of `stamps` fall on each of the last `days` days. */
export function countByDay(stamps: string[], days: number, now: Date): number[] {
  const index = new Map(daySpan(days, now).map((key, i) => [key, i]));
  const points = new Array<number>(days).fill(0);
  for (const stamp of stamps) {
    const slot = index.get(dayKey(stamp));
    if (slot !== undefined) points[slot] += 1;
  }
  return points;
}

/* -------------------------------------------------------------------------- */
/* The event stream                                                           */
/* -------------------------------------------------------------------------- */

export type EventKind =
  | "signup"
  | "onboarded"
  | "board"
  | "install"
  | "post"
  | "vote"
  | "comment"
  | "prompt"
  | "chat"
  | "ship"
  | "merge"
  | "export"
  | "topup"
  | "commission"
  | "grant"
  | "magic_link"
  | "student"
  | "email"
  | "api_key"
  | "integration"
  | "error"
  | "track";

/** Human names, in the order the filter row shows them. */
export const EVENT_LABELS: Record<EventKind, string> = {
  signup: "Signed up",
  onboarded: "Finished onboarding",
  board: "Board created",
  install: "Widget installed",
  post: "Request posted",
  vote: "Vote",
  comment: "Comment",
  prompt: "Build Prompt",
  chat: "Ask Euclid",
  ship: "Shipped",
  merge: "Duplicate merged",
  export: "Exported to tracker",
  topup: "Top-up purchased",
  commission: "Referral commission",
  grant: "Partner grant",
  magic_link: "Magic link requested",
  student: "Student verification",
  email: "E-mail queued",
  api_key: "API key created",
  integration: "Integration connected",
  error: "Error last seen",
  // Captured rather than derived — the only kind here that was sent by a
  // browser. The event's own name is in the title, so one chip covers all of
  // them and the Behaviour tab is where they are broken out.
  track: "Captured behaviour",
};

export const EVENT_ORDER = Object.keys(EVENT_LABELS) as EventKind[];

/**
 * Who did it.
 *
 * `email` is the point of the whole console, so it is a first-class field
 * rather than something buried in the description: an operator reading a feed
 * wants to know which person is behind a row, and "a visitor" is not an
 * answer when `end_users.email` is sitting right there.
 */
export interface Actor {
  kind: "founder" | "visitor" | "system";
  email: string | null;
  /** The address when there is one, otherwise the most identifying thing there is. */
  label: string;
  /** Set for a founder, so a row can link to their person page. */
  userId: string | null;
  endUserId: string | null;
}

export interface AdminEvent {
  at: string;
  kind: EventKind;
  actor: Actor;
  title: string;
  detail: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  boardId: string | null;
  boardName: string | null;
  /** Repeats, for the kinds that are a grouped row rather than one occurrence. */
  count: number;
}

const SYSTEM: Actor = {
  kind: "system",
  email: null,
  label: "Euclid",
  userId: null,
  endUserId: null,
};

/** An address-less visitor, named by the start of their key so rows stay distinguishable. */
function visitorLabel(row: EndUserRow): string {
  if (row.email) return row.email;
  if (row.name) return row.name;
  return `${row.kind} · ${row.external_key.slice(0, 8)}`;
}

/** Look-ups every derivation needs, built once. */
export interface Index {
  users: Map<string, AdminUser>;
  workspaces: Map<string, WorkspaceRow>;
  boards: Map<string, BoardRow>;
  endUsers: Map<string, EndUserRow>;
  /** Board to workspace, because posts carry a board id and nothing else. */
  boardOwner: Map<string, string>;
  /** Post to board, for votes and comments, which carry only a post id. */
  postBoard: Map<string, string>;
  /** Workspace to the logins that own it, earliest first. */
  owners: Map<string, AdminUser[]>;
  /** The login that owns each workspace, as an actor. */
  ownerActor: Map<string, Actor>;
}

export function buildIndex(data: Estate, users: AdminUser[]): Index {
  const usersMap = new Map(users.map((u) => [u.id, u]));
  const workspaces = new Map(data.workspaces.rows.map((w) => [w.id, w]));
  const boards = new Map(data.boards.rows.map((b) => [b.id, b]));
  const endUsers = new Map(data.endUsers.rows.map((e) => [e.id, e]));

  const boardOwner = new Map(data.boards.rows.map((b) => [b.id, b.workspace_id]));
  const postBoard = new Map(data.posts.rows.map((p) => [p.id, p.board_id]));

  const owners = new Map<string, AdminUser[]>();
  const members = [...data.members.rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const m of members) {
    const user = usersMap.get(m.user_id);
    if (!user) continue;
    const list = owners.get(m.workspace_id) ?? [];
    // Owners before members: the address an operator wants first is the one
    // that pays and gets the e-mail, not whoever happened to join earliest.
    if (m.role === "owner") list.unshift(user);
    else list.push(user);
    owners.set(m.workspace_id, list);
  }

  const ownerActor = new Map<string, Actor>();
  for (const [workspaceId, list] of owners) {
    const first = list[0];
    if (!first) continue;
    ownerActor.set(workspaceId, {
      kind: "founder",
      email: first.email,
      label: first.email ?? first.name ?? first.id.slice(0, 8),
      userId: first.id,
      endUserId: null,
    });
  }

  return { users: usersMap, workspaces, boards, endUsers, boardOwner, postBoard, owners, ownerActor };
}

/**
 * State, read as a timeline.
 *
 * Every branch below is a row that already carries a timestamp, so this adds
 * no capture and cannot double-count. Two deliberate omissions:
 *
 * - **`activity` rows are used only for merges and exports.** The rest of that
 *   table restates posts, prompts and ships, which are derived here from the
 *   source row — counting both would show every ship twice.
 * - **There is no "subscribed" event.** Billing keeps current state, not
 *   history: a status and a period end, which the Billing panel reads as
 *   state. A fabricated timestamp for it would be the one line here that is
 *   a guess, and a feed with one guess in it is a feed you have to check.
 */
export function deriveEvents(data: Estate, index: Index): AdminEvent[] {
  const out: AdminEvent[] = [];

  const wsName = (id: string | null | undefined) =>
    id ? (index.workspaces.get(id)?.name ?? null) : null;
  const boardName = (id: string | null | undefined) =>
    id ? (index.boards.get(id)?.name ?? null) : null;
  const founder = (workspaceId: string | null | undefined): Actor =>
    (workspaceId ? index.ownerActor.get(workspaceId) : undefined) ?? SYSTEM;

  const push = (e: Omit<AdminEvent, "count"> & { count?: number }) =>
    out.push({ count: 1, ...e });

  for (const w of data.workspaces.rows) {
    push({
      at: w.created_at,
      kind: "signup",
      actor: founder(w.id),
      title: `Workspace created — ${w.name}`,
      detail: w.referred_by ? `Referred by ${w.referred_by}` : null,
      workspaceId: w.id,
      workspaceName: w.name,
      boardId: null,
      boardName: null,
    });
    if (w.onboarded_at) {
      push({
        at: w.onboarded_at,
        kind: "onboarded",
        actor: founder(w.id),
        title: "Finished onboarding",
        detail: [w.app_name, (w.coding_tools ?? []).join(", ")].filter(Boolean).join(" · ") || null,
        workspaceId: w.id,
        workspaceName: w.name,
        boardId: null,
        boardName: null,
      });
    }
    if (w.student_verified_at) {
      push({
        at: w.student_verified_at,
        kind: "student",
        actor: founder(w.id),
        title: "Student discount verified",
        detail: w.student_email,
        workspaceId: w.id,
        workspaceName: w.name,
        boardId: null,
        boardName: null,
      });
    }
  }

  for (const b of data.boards.rows) {
    push({
      at: b.created_at,
      kind: "board",
      actor: founder(b.workspace_id),
      title: `Board created — ${b.name}`,
      detail: `${b.identity_mode} identity`,
      workspaceId: b.workspace_id,
      workspaceName: wsName(b.workspace_id),
      boardId: b.id,
      boardName: b.name,
    });
    if (b.installed_at) {
      push({
        at: b.installed_at,
        kind: "install",
        actor: founder(b.workspace_id),
        title: `Widget installed — ${b.name}`,
        detail: (b.allowed_domains ?? []).join(", ") || "no allow-list",
        workspaceId: b.workspace_id,
        workspaceName: wsName(b.workspace_id),
        boardId: b.id,
        boardName: b.name,
      });
    }
  }

  for (const p of data.posts.rows) {
    const workspaceId = index.boardOwner.get(p.board_id) ?? null;
    const author = p.author_id ? index.endUsers.get(p.author_id) : undefined;
    const actor: Actor = author
      ? {
          kind: "visitor",
          email: author.email,
          label: visitorLabel(author),
          userId: null,
          endUserId: author.id,
        }
      : founder(workspaceId);

    push({
      at: p.created_at,
      kind: "post",
      actor,
      title: `#${p.number} ${p.title}`,
      detail: [p.category, p.status, p.approved ? null : "held for review"]
        .filter(Boolean)
        .join(" · "),
      workspaceId,
      workspaceName: wsName(workspaceId),
      boardId: p.board_id,
      boardName: boardName(p.board_id),
    });

    if (p.shipped_at) {
      push({
        at: p.shipped_at,
        kind: "ship",
        actor: founder(workspaceId),
        title: `Shipped #${p.number} ${p.title}`,
        detail: `${p.vote_count} votes`,
        workspaceId,
        workspaceName: wsName(workspaceId),
        boardId: p.board_id,
        boardName: boardName(p.board_id),
      });
    }
  }

  for (const v of data.votes.rows) {
    const boardId = index.postBoard.get(v.post_id) ?? null;
    const workspaceId = boardId ? (index.boardOwner.get(boardId) ?? null) : null;
    const voter = index.endUsers.get(v.end_user_id);
    push({
      at: v.created_at,
      kind: "vote",
      actor: voter
        ? {
            kind: "visitor",
            email: voter.email,
            label: visitorLabel(voter),
            userId: null,
            endUserId: voter.id,
          }
        : SYSTEM,
      title: "Voted",
      detail: v.weight === 1 ? null : `weight ${v.weight}`,
      workspaceId,
      workspaceName: wsName(workspaceId),
      boardId,
      boardName: boardName(boardId),
    });
  }

  for (const c of data.comments.rows) {
    const boardId = index.postBoard.get(c.post_id) ?? null;
    const workspaceId = boardId ? (index.boardOwner.get(boardId) ?? null) : null;
    const asFounder = c.author_user_id ? index.users.get(c.author_user_id) : undefined;
    const visitor = c.end_user_id ? index.endUsers.get(c.end_user_id) : undefined;
    const actor: Actor = asFounder
      ? {
          kind: "founder",
          email: asFounder.email,
          label: asFounder.email ?? asFounder.id.slice(0, 8),
          userId: asFounder.id,
          endUserId: null,
        }
      : visitor
        ? {
            kind: "visitor",
            email: visitor.email,
            label: visitorLabel(visitor),
            userId: null,
            endUserId: visitor.id,
          }
        : SYSTEM;

    push({
      at: c.created_at,
      kind: "comment",
      actor,
      title: c.internal ? "Internal note" : "Comment",
      detail: c.author_name,
      workspaceId,
      workspaceName: wsName(workspaceId),
      boardId,
      boardName: boardName(boardId),
    });
  }

  for (const p of data.prompts.rows) {
    const author = p.created_by ? index.users.get(p.created_by) : undefined;
    push({
      at: p.created_at,
      kind: "prompt",
      actor: author
        ? {
            kind: "founder",
            email: author.email,
            label: author.email ?? author.id.slice(0, 8),
            userId: author.id,
            endUserId: null,
          }
        : founder(p.workspace_id),
      title: `Build Prompt — ${p.title}`,
      detail: [p.target, `v${p.version}`, p.copied ? "copied" : "not copied"].join(" · "),
      workspaceId: p.workspace_id,
      workspaceName: wsName(p.workspace_id),
      boardId: null,
      boardName: null,
    });
  }

  const messagesByThread = new Map<string, number>();
  for (const m of data.threadMessages.rows) {
    messagesByThread.set(m.thread_id, (messagesByThread.get(m.thread_id) ?? 0) + 1);
  }
  for (const t of data.threads.rows) {
    const author = t.created_by ? index.users.get(t.created_by) : undefined;
    push({
      at: t.created_at,
      kind: "chat",
      actor: author
        ? {
            kind: "founder",
            email: author.email,
            label: author.email ?? author.id.slice(0, 8),
            userId: author.id,
            endUserId: null,
          }
        : founder(t.workspace_id),
      title: `Asked Euclid — ${t.title}`,
      detail: `${messagesByThread.get(t.id) ?? 0} messages`,
      workspaceId: t.workspace_id,
      workspaceName: wsName(t.workspace_id),
      boardId: t.board_id,
      boardName: boardName(t.board_id),
    });
  }

  for (const a of data.activity.rows) {
    // Only the two kinds no source row carries a timestamp for.
    if (a.kind !== "merge" && a.kind !== "export") continue;
    push({
      at: a.created_at,
      kind: a.kind === "merge" ? "merge" : "export",
      actor: founder(a.workspace_id),
      title: a.text,
      detail: a.meta,
      workspaceId: a.workspace_id,
      workspaceName: wsName(a.workspace_id),
      boardId: a.board_id,
      boardName: boardName(a.board_id),
    });
  }

  for (const t of data.topups.rows) {
    push({
      at: t.created_at,
      kind: "topup",
      actor: founder(t.workspace_id),
      title: `Bought ${t.quantity} ${t.kind}`,
      detail: t.refunded_at ? "refunded" : t.polar_order_id,
      workspaceId: t.workspace_id,
      workspaceName: wsName(t.workspace_id),
      boardId: null,
      boardName: null,
    });
  }

  for (const c of data.commissions.rows) {
    push({
      at: c.created_at,
      kind: "commission",
      actor: founder(c.referrer_id),
      title: `Earned ${c.quantity} credits from a referral`,
      detail: [
        `${c.code}`,
        `order $${(c.order_cents / 100).toFixed(2)}`,
        c.reversed_at ? "reversed" : null,
      ]
        .filter(Boolean)
        .join(" · "),
      workspaceId: c.referrer_id,
      workspaceName: wsName(c.referrer_id),
      boardId: null,
      boardName: null,
    });
  }

  for (const g of data.grants.rows) {
    push({
      at: g.created_at,
      kind: "grant",
      actor: founder(g.workspace_id),
      title: `Partner grant — ${g.partner}`,
      detail: g.code ? `code ${g.code}` : "owed, pool was empty",
      workspaceId: g.workspace_id,
      workspaceName: wsName(g.workspace_id),
      boardId: null,
      boardName: null,
    });
  }

  for (const m of data.magicLinks.rows) {
    const workspaceId = index.boardOwner.get(m.board_id) ?? null;
    push({
      at: m.created_at,
      kind: "magic_link",
      actor: {
        kind: "visitor",
        email: m.email,
        label: m.email,
        userId: null,
        endUserId: null,
      },
      title: "Requested a magic link",
      detail: m.used_at ? "used" : "unused",
      workspaceId,
      workspaceName: wsName(workspaceId),
      boardId: m.board_id,
      boardName: boardName(m.board_id),
    });
  }

  for (const s of data.students.rows) {
    push({
      at: s.created_at,
      kind: "student",
      actor: {
        kind: "founder",
        email: s.email,
        label: s.email,
        userId: index.ownerActor.get(s.workspace_id)?.userId ?? null,
        endUserId: null,
      },
      title: `Student verification (${s.kind})`,
      detail: s.used_at ? "redeemed" : "pending",
      workspaceId: s.workspace_id,
      workspaceName: wsName(s.workspace_id),
      boardId: null,
      boardName: null,
    });
  }

  for (const e of data.outbox.rows) {
    push({
      at: e.created_at,
      kind: "email",
      actor: { kind: "visitor", email: e.to_email, label: e.to_email, userId: null, endUserId: null },
      title: e.subject,
      detail: [e.kind, e.sent_at ? "sent" : "queued", e.last_error].filter(Boolean).join(" · "),
      workspaceId: null,
      workspaceName: null,
      boardId: null,
      boardName: null,
    });
  }

  for (const k of data.apiKeys.rows) {
    const workspaceId = index.boardOwner.get(k.board_id) ?? null;
    push({
      at: k.created_at,
      kind: "api_key",
      actor: founder(workspaceId),
      title: `API key — ${k.name}`,
      detail: [k.token_prefix, k.revoked_at ? "revoked" : null].filter(Boolean).join(" · "),
      workspaceId,
      workspaceName: wsName(workspaceId),
      boardId: k.board_id,
      boardName: boardName(k.board_id),
    });
  }

  for (const i of data.integrations.rows) {
    const workspaceId = index.boardOwner.get(i.board_id) ?? null;
    push({
      at: i.created_at,
      kind: "integration",
      actor: founder(workspaceId),
      title: `Connected ${i.kind}`,
      detail: [i.active ? "active" : "inactive", i.last_error].filter(Boolean).join(" · "),
      workspaceId,
      workspaceName: wsName(workspaceId),
      boardId: i.board_id,
      boardName: boardName(i.board_id),
    });
  }

  /*
    Captured events: the one branch here that reads a table written by a
    browser rather than by the product.

    They join the same stream deliberately. A screen view is activity, so
    retention and stickiness should count it; a person's timeline should show
    what they looked at next to what they did; and the Events tab should be
    one list rather than two. What the Behaviour tab adds is the breakdowns
    that only make sense for these rows — screens, sessions, onboarding
    steps — not a second copy of the feed.
  */
  for (const e of data.captured.rows) {
    const who = e.user_id ? index.users.get(e.user_id) : undefined;
    const props = e.props ?? {};
    const detail = Object.entries(props)
      .map(([key, value]) => `${key}=${value}`)
      .join(" · ");

    push({
      at: e.created_at,
      kind: "track",
      actor: who
        ? {
            kind: "founder",
            email: who.email,
            label: who.email ?? who.id.slice(0, 8),
            userId: who.id,
            endUserId: null,
          }
        : founder(e.workspace_id),
      title: eventLabel(e.name),
      detail: [e.path, detail].filter(Boolean).join(" · ") || null,
      workspaceId: e.workspace_id,
      workspaceName: wsName(e.workspace_id),
      boardId: e.board_id,
      boardName: boardName(e.board_id),
    });
  }

  for (const e of data.errors.rows) {
    push({
      at: e.last_seen,
      kind: "error",
      actor: SYSTEM,
      title: `${e.kind} — ${e.message}`,
      detail: [e.route, e.resolved_at ? "resolved" : "open"].filter(Boolean).join(" · "),
      workspaceId: null,
      workspaceName: null,
      boardId: null,
      boardName: null,
      count: e.count,
    });
  }

  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/* -------------------------------------------------------------------------- */
/* Trends                                                                     */
/* -------------------------------------------------------------------------- */

export interface Trend {
  kind: EventKind | "all";
  label: string;
  points: number[];
  total: number;
  /** The same length of window immediately before it, for the comparison. */
  previous: number;
}

/**
 * One metric over the window, with the window before it for comparison.
 *
 * The previous period is the honest denominator for "is this up": against the
 * same length of time ending where this window starts. A percentage against
 * all time would move every day for reasons that have nothing to do with the
 * last week.
 */
export function trend(
  events: AdminEvent[],
  kinds: EventKind[],
  label: string,
  days: number,
  now: Date,
): Trend {
  const wanted = new Set(kinds);
  const mine = events.filter((e) => wanted.has(e.kind));
  const points = countByDay(
    mine.map((e) => e.at),
    days,
    now,
  );

  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
    (days - 1) * DAY_MS;
  const prevStart = start - days * DAY_MS;
  const previous = mine.filter((e) => {
    const t = new Date(e.at).getTime();
    return t >= prevStart && t < start;
  }).length;

  return {
    kind: kinds.length === 1 ? kinds[0] : "all",
    label,
    points,
    total: points.reduce((a, b) => a + b, 0),
    previous,
  };
}

/** How many of each kind happened in the window, biggest first. */
export function kindCounts(events: AdminEvent[], days: number, now: Date): { kind: EventKind; label: string; count: number }[] {
  const since = now.getTime() - days * DAY_MS;
  const counts = new Map<EventKind, number>();
  for (const e of events) {
    if (new Date(e.at).getTime() < since) continue;
    counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  }
  return EVENT_ORDER.filter((k) => counts.has(k))
    .map((kind) => ({ kind, label: EVENT_LABELS[kind], count: counts.get(kind) ?? 0 }))
    .sort((a, b) => b.count - a.count);
}

/* -------------------------------------------------------------------------- */
/* Retention and stickiness                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Whether an event may count towards retention and stickiness.
 *
 * Captured events may not, and this is the subtlest decision in the file.
 * Opening a screen is obviously activity — it is better evidence somebody is
 * using the product than most state changes are — but capture began on
 * 2026-10-22 and the derived stream goes back to the first row ever written.
 * Counting both would make every cohort before that date look less retained
 * than every cohort after it, for no reason except when instrumentation
 * shipped, and a series whose meaning steps on a date is one nobody can
 * compare across it. That is the same failure as the funnel that printed
 * "Paid 200%": not a wrong number, a number that cannot be trusted.
 *
 * So the Retention tab measures what the product recorded, consistently, all
 * the way back; the Behaviour tab measures attention, and says what date it
 * starts from. "Last seen" on a person or a workspace **does** include
 * captured events, because nothing is being compared across a period there —
 * the question is only "when did we last see them", and a screen view is the
 * best answer to it.
 */
export function countsAsActivity(event: AdminEvent): boolean {
  return event.kind !== "track";
}

export interface RetentionRow {
  cohort: string;
  size: number;
  /** Retained count per week since the cohort week; null for a week not yet reached. */
  cells: (number | null)[];
}

/**
 * Weekly cohorts: of the workspaces created in week W, how many did anything
 * in week W+n.
 *
 * "Did anything" is any event attributed to the workspace, which includes its
 * own creation — so week 0 is 100% by construction, as it is in every
 * retention grid, and the column worth reading is week 1.
 */
export function retentionGrid(
  workspaces: WorkspaceRow[],
  events: AdminEvent[],
  weeks: number,
  now: Date,
): RetentionRow[] {
  const activeWeeks = new Map<string, Set<string>>();
  for (const e of events) {
    if (!e.workspaceId || !countsAsActivity(e)) continue;
    const set = activeWeeks.get(e.workspaceId) ?? new Set<string>();
    set.add(weekKey(e.at));
    activeWeeks.set(e.workspaceId, set);
  }

  const cohorts = new Map<string, WorkspaceRow[]>();
  for (const w of workspaces) {
    const key = weekKey(w.created_at);
    cohorts.set(key, [...(cohorts.get(key) ?? []), w]);
  }

  const thisWeek = weekKey(now);

  return [...cohorts.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([cohort, members]) => ({
      cohort,
      size: members.length,
      cells: Array.from({ length: weeks }, (_, n) => {
        const week = new Date(new Date(`${cohort}T00:00:00Z`).getTime() + n * 7 * DAY_MS)
          .toISOString()
          .slice(0, 10);
        // A week that has not happened yet is blank, not zero. Printing zero
        // there makes a young cohort look churned.
        if (week > thisWeek) return null;
        return members.filter((m) => activeWeeks.get(m.id)?.has(week)).length;
      }),
    }));
}

export interface Stickiness {
  dau: number;
  wau: number;
  mau: number;
  /** DAU over MAU: the share of the month that shows up on an average day. */
  ratio: number;
}

/** Distinct active workspaces over the three usual windows. */
export function stickiness(events: AdminEvent[], now: Date): Stickiness {
  const within = (days: number) => {
    const since = now.getTime() - days * DAY_MS;
    const set = new Set<string>();
    for (const e of events) {
      if (!e.workspaceId || !countsAsActivity(e)) continue;
      if (new Date(e.at).getTime() >= since) set.add(e.workspaceId);
    }
    return set.size;
  };

  const dau = within(1);
  const wau = within(7);
  const mau = within(30);
  return { dau, wau, mau, ratio: mau === 0 ? 0 : dau / mau };
}

/* -------------------------------------------------------------------------- */
/* Revenue                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What a workspace is worth a month, in cents.
 *
 * A yearly subscription is spread over the year rather than counted at the
 * amount charged, because the question this answers is "what does a month of
 * this business look like" — billing the whole year in January does not make
 * January worth twelve months.
 *
 * `PlanSpec.yearly` is the **annual total**, which is the figure on the card
 * statement; it stopped being a per-month equivalent in "Quote yearly the way
 * Polar charges it". So the division happens here, from the annual total,
 * rather than reading `yearlyPerMonth` — that is a display string rounded for
 * a price card ($8.33 × 12 is $99.96, not $100), and twelve of them would not
 * add up to the year.
 */
export function monthlyCents(w: Pick<WorkspaceRow, "plan" | "billing_period">): number {
  const spec = PLANS[w.plan];
  if (!spec) return 0;
  const cents = w.billing_period === "yearly" ? (spec.yearly * 100) / 12 : spec.monthly * 100;
  return Math.round(cents);
}

export interface RevenueLine {
  plan: PlanTier;
  name: string;
  monthly: number;
  yearly: number;
  cents: number;
}

export interface Revenue {
  /** Paying, by plan. */
  lines: RevenueLine[];
  mrrCents: number;
  arrCents: number;
  /** On a trial: not revenue yet, but the size of the question. */
  trialCents: number;
  trials: number;
  /** A paid plan with no live subscription — comped, seeded, or granted by hand. */
  compedCents: number;
  comped: number;
  /** Cancelling at period end, so MRR already has a date on it. */
  leavingCents: number;
  leaving: number;
  payers: number;
  arpaCents: number;
}

const PAYING = new Set(["active", "past_due", "unpaid"]);

export function revenue(workspaces: WorkspaceRow[]): Revenue {
  const lines = new Map<PlanTier, RevenueLine>();
  let mrrCents = 0;
  let trialCents = 0;
  let trials = 0;
  let compedCents = 0;
  let comped = 0;
  let leavingCents = 0;
  let leaving = 0;
  let payers = 0;

  for (const w of workspaces) {
    if (w.plan === "free") continue;
    const cents = monthlyCents(w);
    const status = w.subscription_status ?? null;

    if (status === "trialing") {
      trials += 1;
      trialCents += cents;
      continue;
    }

    if (!status || !PAYING.has(status)) {
      // A paid tier with no live subscription. `changePlan` allows this while
      // billing is unconfigured, and the seeded workspace is one — so it is
      // counted, named, and kept out of MRR.
      comped += 1;
      compedCents += cents;
      continue;
    }

    payers += 1;
    mrrCents += cents;
    if (w.cancel_at_period_end) {
      leaving += 1;
      leavingCents += cents;
    }

    const line = lines.get(w.plan) ?? {
      plan: w.plan,
      name: PLANS[w.plan].name,
      monthly: 0,
      yearly: 0,
      cents: 0,
    };
    if (w.billing_period === "yearly") line.yearly += 1;
    else line.monthly += 1;
    line.cents += cents;
    lines.set(w.plan, line);
  }

  return {
    lines: [...lines.values()].sort((a, b) => b.cents - a.cents),
    mrrCents,
    arrCents: mrrCents * 12,
    trialCents,
    trials,
    compedCents,
    comped,
    leavingCents,
    leaving,
    payers,
    arpaCents: payers === 0 ? 0 : Math.round(mrrCents / payers),
  };
}

/* -------------------------------------------------------------------------- */
/* The funnel                                                                 */
/* -------------------------------------------------------------------------- */

export interface FunnelStep<T> {
  label: string;
  count: number;
  /** Share of the step before it. Null on the first, which has nothing to compare to. */
  conversion: number | null;
  /** Everything that reached this step and every step before it. */
  reached: T[];
  /** Reached the step above and stopped here. Empty on the first step. */
  stuck: T[];
}

/**
 * Fold rows through an ordered list of stages.
 *
 * Separated from everything that knows what a workspace is, so the one
 * property that matters can be tested in isolation: **a step can never exceed
 * the step above it**. Counting each stage independently does not give you
 * that, and the first render of this panel reported "Paid 200%" because of
 * it — two workspaces were on a paid plan while only one had finished
 * onboarding, the seeded one having been created in SQL. A funnel that can
 * print 200% is one nobody can trust the rest of.
 */
export function funnelCounts<T>(
  rows: T[],
  stages: { label: string; reached: (row: T) => boolean }[],
): FunnelStep<T>[] {
  // Reached this stage *and* every stage before it. The prefix is what makes
  // the sequence monotonic by construction rather than by luck.
  const reachedBy = stages.map((_, i) =>
    rows.filter((row) => stages.slice(0, i + 1).every((stage) => stage.reached(row))),
  );

  return stages.map((stage, i) => {
    const here = reachedBy[i];
    const before = i === 0 ? rows : reachedBy[i - 1];
    return {
      label: stage.label,
      count: here.length,
      // Against the previous step rather than the first. Step-to-step is the
      // number that says where people stop, which is the only thing a funnel
      // is for; share-of-total just restates the shape of the curve.
      conversion: i === 0 ? null : before.length === 0 ? 0 : here.length / before.length,
      reached: here,
      stuck: i === 0 ? [] : before.filter((row) => !here.includes(row)),
    };
  });
}

export interface WorkspaceStages {
  onboarded: boolean;
  installed: boolean;
  posted: boolean;
  prompted: boolean;
  paid: boolean;
}

/** One workspace as the funnel sees it: a name, an address to write to, a ladder. */
export interface FunnelRow {
  id: string;
  name: string;
  email: string | null;
  since: string;
  stages: WorkspaceStages;
}

export const FUNNEL_STAGES: { label: string; reached: (r: FunnelRow) => boolean }[] = [
  { label: "Signed up", reached: () => true },
  { label: "Finished onboarding", reached: (r) => r.stages.onboarded },
  { label: "Installed the widget", reached: (r) => r.stages.installed },
  { label: "Received a request", reached: (r) => r.stages.posted },
  { label: "Generated a prompt", reached: (r) => r.stages.prompted },
  { label: "Paid", reached: (r) => r.stages.paid },
];

/**
 * Signup → onboarded → installed → first request → first prompt → paid.
 *
 * **Derived from state, not from captured events** — see the note at the top
 * of this file.
 *
 * The cost of being cumulative is that a workspace which skipped a step is
 * invisible from there on. That is the right trade for a funnel, and the
 * absolute counts that do not care about order are on the other panels.
 *
 * `stuck` is the part a general analytics tool cannot give you. It does not
 * know which row is a person, so the best it can offer is "38% dropped here".
 * This knows, so each step carries the addresses that stopped at it, and the
 * next action is an e-mail rather than another query.
 */
export function funnel(rows: FunnelRow[]): FunnelStep<FunnelRow>[] {
  return funnelCounts(rows, FUNNEL_STAGES);
}

/** The funnel rows for the whole estate, owner address attached. */
export function funnelRows(data: Estate, index: Index): FunnelRow[] {
  const stages = workspaceStages(data, index);
  return data.workspaces.rows.map((w) => ({
    id: w.id,
    name: w.name,
    email: index.ownerActor.get(w.id)?.email ?? null,
    since: w.created_at,
    stages: stages.get(w.id) ?? emptyStages(),
  }));
}

/* -------------------------------------------------------------------------- */
/* People                                                                     */
/* -------------------------------------------------------------------------- */

export interface PersonView {
  userId: string;
  email: string | null;
  name: string | null;
  provider: string | null;
  isAdmin: boolean;
  signedUpAt: string | null;
  lastSignInAt: string | null;
  confirmedAt: string | null;
  role: string | null;
  workspaces: { id: string; name: string; slug: string; plan: PlanTier; status: string | null }[];
  plan: PlanTier | null;
  status: string | null;
  mrrCents: number;
  boards: number;
  installedBoards: number;
  posts: number;
  votes: number;
  prompts: number;
  chats: number;
  events: number;
  lastSeenAt: string | null;
  stage: string;
}

const STAGE_LABELS = [
  "Signed up",
  "Onboarded",
  "Installed",
  "Got a request",
  "Prompted",
  "Paying",
];

/** The furthest step a workspace has reached, named. */
export function stageOf(stages: WorkspaceStages): string {
  const ladder = [true, stages.onboarded, stages.installed, stages.posted, stages.prompted, stages.paid];
  let furthest = 0;
  for (let i = 0; i < ladder.length; i++) {
    if (!ladder[i]) break;
    furthest = i;
  }
  return STAGE_LABELS[furthest];
}

/**
 * Every login, with the workspace it owns and what it has done.
 *
 * Founders with no membership are included rather than dropped: a login with
 * no workspace is the single most interesting failure the bootstrap can have,
 * and a list that hides it would make that invisible.
 */
export function people(
  data: Estate,
  users: AdminUser[],
  events: AdminEvent[],
  index: Index,
  isAdmin: (email: string | null) => boolean,
): PersonView[] {
  const membershipsByUser = new Map<string, { workspace_id: string; role: string }[]>();
  for (const m of data.members.rows) {
    membershipsByUser.set(m.user_id, [
      ...(membershipsByUser.get(m.user_id) ?? []),
      { workspace_id: m.workspace_id, role: m.role },
    ]);
  }

  const stages = workspaceStages(data, index);

  const byWorkspace = new Map<string, AdminEvent[]>();
  for (const e of events) {
    if (!e.workspaceId) continue;
    byWorkspace.set(e.workspaceId, [...(byWorkspace.get(e.workspaceId) ?? []), e]);
  }

  const boardsByWorkspace = new Map<string, BoardRow[]>();
  for (const b of data.boards.rows) {
    boardsByWorkspace.set(b.workspace_id, [...(boardsByWorkspace.get(b.workspace_id) ?? []), b]);
  }

  return users
    .map((u) => {
      const memberships = membershipsByUser.get(u.id) ?? [];
      const spaces = memberships
        .map((m) => index.workspaces.get(m.workspace_id))
        .filter((w): w is WorkspaceRow => Boolean(w));
      const primary = spaces[0] ?? null;

      const mine = spaces.flatMap((w) => byWorkspace.get(w.id) ?? []);
      const boards = spaces.flatMap((w) => boardsByWorkspace.get(w.id) ?? []);
      const boardIds = new Set(boards.map((b) => b.id));

      const count = (kind: EventKind) => mine.filter((e) => e.kind === kind).length;

      return {
        userId: u.id,
        email: u.email,
        name: u.name,
        provider: u.provider,
        isAdmin: isAdmin(u.email),
        signedUpAt: u.createdAt,
        lastSignInAt: u.lastSignInAt,
        confirmedAt: u.confirmedAt,
        role: memberships[0]?.role ?? null,
        workspaces: spaces.map((w) => ({
          id: w.id,
          name: w.name,
          slug: w.slug,
          plan: w.plan,
          status: w.subscription_status,
        })),
        plan: primary?.plan ?? null,
        status: primary?.subscription_status ?? null,
        mrrCents: spaces.reduce((sum, w) => sum + monthlyCents(w), 0),
        boards: boards.length,
        installedBoards: boards.filter((b) => b.installed_at).length,
        posts: data.posts.rows.filter((p) => boardIds.has(p.board_id)).length,
        votes: count("vote"),
        prompts: count("prompt"),
        chats: count("chat"),
        events: mine.length,
        lastSeenAt: lastOf([
          u.lastSignInAt,
          ...mine.map((e) => e.at),
        ]),
        stage: primary ? stageOf(stages.get(primary.id) ?? emptyStages()) : "No workspace",
      };
    })
    .sort((a, b) => (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? ""));
}

const emptyStages = (): WorkspaceStages => ({
  onboarded: false,
  installed: false,
  posted: false,
  prompted: false,
  paid: false,
});

function lastOf(stamps: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const s of stamps) {
    if (!s) continue;
    if (!best || s > best) best = s;
  }
  return best;
}

/** Which funnel stages each workspace has reached. */
export function workspaceStages(data: Estate, index: Index): Map<string, WorkspaceStages> {
  const installed = new Set(
    data.boards.rows.filter((b) => b.installed_at).map((b) => b.workspace_id),
  );
  const posted = new Set(
    data.posts.rows
      .map((p) => index.boardOwner.get(p.board_id))
      .filter((id): id is string => Boolean(id)),
  );
  const prompted = new Set(data.prompts.rows.map((p) => p.workspace_id));

  return new Map(
    data.workspaces.rows.map((w) => [
      w.id,
      {
        onboarded: Boolean(w.onboarded_at),
        installed: installed.has(w.id),
        posted: posted.has(w.id),
        prompted: prompted.has(w.id),
        // Plan rather than subscription status: a workspace moved to a paid
        // tier without Polar has converted by every meaning that matters here.
        paid: w.plan !== "free",
      },
    ]),
  );
}

/* -------------------------------------------------------------------------- */
/* Visitors — the people on the boards themselves                             */
/* -------------------------------------------------------------------------- */

export interface VisitorView {
  id: string;
  email: string | null;
  label: string;
  kind: string;
  emailVerified: boolean;
  name: string | null;
  boardId: string;
  board: string;
  workspace: string | null;
  votes: number;
  posts: number;
  comments: number;
  voteWeight: number;
  firstSeenAt: string;
  lastSeenAt: string | null;
}

/**
 * Everyone who has used a board, address first where there is one.
 *
 * This is the other half of "who is using Euclid", and the half a founder
 * never sees across workspaces: an anonymous voter is a fingerprint, an
 * e-mail voter is an address, and a JWT voter is whatever the host app said
 * they were.
 */
export function visitors(data: Estate, index: Index): VisitorView[] {
  const votesBy = new Map<string, number>();
  const lastBy = new Map<string, string>();
  for (const v of data.votes.rows) {
    votesBy.set(v.end_user_id, (votesBy.get(v.end_user_id) ?? 0) + 1);
    const prev = lastBy.get(v.end_user_id);
    if (!prev || v.created_at > prev) lastBy.set(v.end_user_id, v.created_at);
  }

  const postsBy = new Map<string, number>();
  for (const p of data.posts.rows) {
    if (!p.author_id) continue;
    postsBy.set(p.author_id, (postsBy.get(p.author_id) ?? 0) + 1);
    const prev = lastBy.get(p.author_id);
    if (!prev || p.created_at > prev) lastBy.set(p.author_id, p.created_at);
  }

  const commentsBy = new Map<string, number>();
  for (const c of data.comments.rows) {
    if (!c.end_user_id) continue;
    commentsBy.set(c.end_user_id, (commentsBy.get(c.end_user_id) ?? 0) + 1);
    const prev = lastBy.get(c.end_user_id);
    if (!prev || c.created_at > prev) lastBy.set(c.end_user_id, c.created_at);
  }

  return data.endUsers.rows
    .map((e) => {
      const board = index.boards.get(e.board_id);
      const workspace = board ? index.workspaces.get(board.workspace_id) : undefined;
      return {
        id: e.id,
        email: e.email,
        label: visitorLabel(e),
        kind: e.kind,
        emailVerified: e.email_verified,
        name: e.name,
        boardId: e.board_id,
        board: board?.name ?? "unknown board",
        workspace: workspace?.name ?? null,
        votes: votesBy.get(e.id) ?? 0,
        posts: postsBy.get(e.id) ?? 0,
        comments: commentsBy.get(e.id) ?? 0,
        voteWeight: e.vote_weight,
        firstSeenAt: e.created_at,
        lastSeenAt: lastBy.get(e.id) ?? null,
      };
    })
    .sort((a, b) => (b.lastSeenAt ?? b.firstSeenAt).localeCompare(a.lastSeenAt ?? a.firstSeenAt));
}

/* -------------------------------------------------------------------------- */
/* Workspaces                                                                 */
/* -------------------------------------------------------------------------- */

export interface WorkspaceView {
  id: string;
  name: string;
  slug: string;
  plan: PlanTier;
  planName: string;
  period: string;
  status: string | null;
  cancelAtPeriodEnd: boolean;
  periodEnd: string | null;
  mrrCents: number;
  owners: { email: string | null; userId: string; role: string }[];
  createdAt: string;
  onboardedAt: string | null;
  appName: string | null;
  appUrl: string | null;
  codingTools: string[];
  boards: number;
  installedBoards: number;
  posts: number;
  votes: number;
  comments: number;
  visitors: number;
  visitorsWithEmail: number;
  prompts: number;
  promptsCopied: number;
  chats: number;
  promptsUsed: number;
  promptLimit: number;
  extraPrompts: number;
  creditsUsed: number;
  creditLimit: number;
  extraCredits: number;
  topups: number;
  referredBy: string | null;
  referralCode: string | null;
  studentVerifiedAt: string | null;
  stage: string;
  lastSeenAt: string | null;
  events: number;
}

export function workspaceViews(
  data: Estate,
  events: AdminEvent[],
  index: Index,
): WorkspaceView[] {
  const stages = workspaceStages(data, index);

  const eventsBy = new Map<string, AdminEvent[]>();
  for (const e of events) {
    if (!e.workspaceId) continue;
    eventsBy.set(e.workspaceId, [...(eventsBy.get(e.workspaceId) ?? []), e]);
  }

  const codeByWorkspace = new Map(data.referralCodes.rows.map((r) => [r.workspace_id, r.code]));

  return data.workspaces.rows
    .map((w) => {
      const boards = data.boards.rows.filter((b) => b.workspace_id === w.id);
      const boardIds = new Set(boards.map((b) => b.id));
      const posts = data.posts.rows.filter((p) => boardIds.has(p.board_id));
      const postIds = new Set(posts.map((p) => p.id));
      const theirVisitors = data.endUsers.rows.filter((e) => boardIds.has(e.board_id));
      const prompts = data.prompts.rows.filter((p) => p.workspace_id === w.id);
      const mine = eventsBy.get(w.id) ?? [];
      const spec = PLANS[w.plan];

      return {
        id: w.id,
        name: w.name,
        slug: w.slug,
        plan: w.plan,
        planName: spec?.name ?? w.plan,
        period: w.billing_period,
        status: w.subscription_status,
        cancelAtPeriodEnd: Boolean(w.cancel_at_period_end),
        periodEnd: w.current_period_end,
        mrrCents: monthlyCents(w),
        owners: data.members.rows
          .filter((m) => m.workspace_id === w.id)
          .map((m) => ({
            email: index.users.get(m.user_id)?.email ?? null,
            userId: m.user_id,
            role: m.role,
          })),
        createdAt: w.created_at,
        onboardedAt: w.onboarded_at,
        appName: w.app_name,
        appUrl: w.app_url,
        codingTools: w.coding_tools ?? [],
        boards: boards.length,
        installedBoards: boards.filter((b) => b.installed_at).length,
        posts: posts.length,
        votes: data.votes.rows.filter((v) => postIds.has(v.post_id)).length,
        comments: data.comments.rows.filter((c) => postIds.has(c.post_id)).length,
        visitors: theirVisitors.length,
        visitorsWithEmail: theirVisitors.filter((v) => v.email).length,
        prompts: prompts.length,
        promptsCopied: prompts.filter((p) => p.copied).length,
        chats: data.threads.rows.filter((t) => t.workspace_id === w.id).length,
        promptsUsed: w.prompts_used ?? 0,
        promptLimit: spec?.buildPrompts ?? 0,
        extraPrompts: w.extra_prompts ?? 0,
        creditsUsed: w.chat_credits_used ?? 0,
        creditLimit: spec?.chatCredits ?? 0,
        extraCredits: w.extra_chat_credits ?? 0,
        topups: data.topups.rows.filter((t) => t.workspace_id === w.id && !t.refunded_at).length,
        referredBy: w.referred_by,
        referralCode: codeByWorkspace.get(w.id) ?? null,
        studentVerifiedAt: w.student_verified_at,
        stage: stageOf(stages.get(w.id) ?? emptyStages()),
        lastSeenAt: lastOf(mine.map((e) => e.at)),
        events: mine.length,
      };
    })
    .sort((a, b) => (b.lastSeenAt ?? b.createdAt).localeCompare(a.lastSeenAt ?? a.createdAt));
}

/* -------------------------------------------------------------------------- */
/* Boards and install health                                                  */
/* -------------------------------------------------------------------------- */

export interface BoardView {
  id: string;
  publicId: string;
  name: string;
  slug: string;
  workspaceId: string;
  workspace: string | null;
  ownerEmails: string[];
  plan: PlanTier | null;
  installedAt: string | null;
  identityMode: string;
  allowedDomains: string[];
  customDomain: string | null;
  showBadge: boolean;
  requireApproval: boolean;
  posts: number;
  held: number;
  votes: number;
  comments: number;
  visitors: number;
  visitorsWithEmail: number;
  lastPostAt: string | null;
  blocked: { origin: string; count: number; lastSeen: string }[];
  localOnly: number;
  apiKeys: number;
  integrations: string[];
  createdAt: string;
}

/**
 * Every board, with the reason it is not working where that is knowable.
 *
 * `blocked` is the one panel here that answers a support question before it is
 * asked: `install_signals` records a widget request refused by the allow-list,
 * so a board with traffic from an origin it does not allow is a founder about
 * to write in saying the widget is broken.
 */
export function boardViews(data: Estate, index: Index): BoardView[] {
  return data.boards.rows
    .map((b) => {
      const workspace = index.workspaces.get(b.workspace_id);
      const posts = data.posts.rows.filter((p) => p.board_id === b.id);
      const postIds = new Set(posts.map((p) => p.id));
      const theirVisitors = data.endUsers.rows.filter((e) => e.board_id === b.id);
      const signals = data.installSignals.rows.filter((s) => s.board_id === b.id);

      return {
        id: b.id,
        publicId: b.public_id,
        name: b.name,
        slug: b.slug,
        workspaceId: b.workspace_id,
        workspace: workspace?.name ?? null,
        ownerEmails: (index.owners.get(b.workspace_id) ?? [])
          .map((u) => u.email)
          .filter((e): e is string => Boolean(e)),
        plan: workspace?.plan ?? null,
        installedAt: b.installed_at,
        identityMode: b.identity_mode,
        allowedDomains: b.allowed_domains ?? [],
        customDomain: b.custom_domain,
        showBadge: b.show_badge,
        requireApproval: b.require_approval,
        posts: posts.length,
        held: posts.filter((p) => !p.approved).length,
        votes: data.votes.rows.filter((v) => postIds.has(v.post_id)).length,
        comments: data.comments.rows.filter((c) => postIds.has(c.post_id)).length,
        visitors: theirVisitors.length,
        visitorsWithEmail: theirVisitors.filter((v) => v.email).length,
        lastPostAt: lastOf(posts.map((p) => p.created_at)),
        blocked: signals
          .filter((s) => s.reason === "blocked")
          .map((s) => ({ origin: s.origin, count: s.count, lastSeen: s.last_seen }))
          .sort((a, b2) => b2.count - a.count),
        localOnly: signals.filter((s) => s.reason === "local").reduce((n, s) => n + s.count, 0),
        apiKeys: data.apiKeys.rows.filter((k) => k.board_id === b.id && !k.revoked_at).length,
        integrations: data.integrations.rows
          .filter((i) => i.board_id === b.id && i.active)
          .map((i) => i.kind),
        createdAt: b.created_at,
      };
    })
    .sort((a, b) => (b.lastPostAt ?? b.createdAt).localeCompare(a.lastPostAt ?? a.createdAt));
}

/* -------------------------------------------------------------------------- */
/* Queues, mail and jobs                                                      */
/* -------------------------------------------------------------------------- */

export interface QueueHealth {
  queued: number;
  failing: number;
  oldestQueued: string | null;
  lastError: string | null;
}

/**
 * A queue in one shape, whatever its columns are called.
 *
 * "Failing" is a row that has been attempted and is still unsent, which is
 * deliberately not the same state as queued: a backlog of fresh rows is a
 * slow drain and resolves itself, while a backlog of attempted ones is
 * something actually broken. Conflating them makes the common harmless case
 * look like an incident.
 */
export function queueHealth(
  rows: { sent: string | null; attempts: number | null; created_at: string; last_error: string | null }[],
): QueueHealth {
  const open = rows
    .filter((r) => !r.sent)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  return {
    queued: open.length,
    failing: open.filter((r) => (r.attempts ?? 0) > 0).length,
    oldestQueued: open[0]?.created_at ?? null,
    lastError: open.find((r) => r.last_error)?.last_error ?? null,
  };
}

export function emailQueue(data: Estate): QueueHealth {
  return queueHealth(
    data.outbox.rows.map((r) => ({
      sent: r.sent_at,
      attempts: r.attempts,
      created_at: r.created_at,
      last_error: r.last_error,
    })),
  );
}

export function deliveryQueue(data: Estate): QueueHealth {
  return queueHealth(
    data.deliveries.rows.map((r) => ({
      sent: r.delivered_at,
      attempts: r.attempts,
      created_at: r.created_at,
      last_error: r.last_error,
    })),
  );
}

export interface MailKind {
  kind: string;
  sent: number;
  queued: number;
  failing: number;
  lastAt: string | null;
}

export function mailByKind(rows: OutboxRow[]): MailKind[] {
  const out = new Map<string, MailKind>();
  for (const r of rows) {
    const line = out.get(r.kind) ?? { kind: r.kind, sent: 0, queued: 0, failing: 0, lastAt: null };
    if (r.sent_at) line.sent += 1;
    else {
      line.queued += 1;
      if ((r.attempts ?? 0) > 0) line.failing += 1;
    }
    if (!line.lastAt || r.created_at > line.lastAt) line.lastAt = r.created_at;
    out.set(r.kind, line);
  }
  return [...out.values()].sort((a, b) => b.sent + b.queued - (a.sent + a.queued));
}

export interface Recipient {
  email: string;
  sent: number;
  queued: number;
  lastAt: string;
  kinds: string[];
}

/** Who Euclid has written to, most recent first. Addresses, by design. */
export function recipients(rows: OutboxRow[]): Recipient[] {
  const out = new Map<string, Recipient>();
  for (const r of rows) {
    const key = r.to_email.toLowerCase();
    const line = out.get(key) ?? {
      email: r.to_email,
      sent: 0,
      queued: 0,
      lastAt: r.created_at,
      kinds: [],
    };
    if (r.sent_at) line.sent += 1;
    else line.queued += 1;
    if (r.created_at > line.lastAt) line.lastAt = r.created_at;
    if (!line.kinds.includes(r.kind)) line.kinds.push(r.kind);
    out.set(key, line);
  }
  return [...out.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export interface JobHealth {
  pending: number;
  running: number;
  done: number;
  failing: number;
  oldestPending: string | null;
  lastError: string | null;
  byKind: { kind: string; pending: number; done: number; failing: number }[];
}

export function jobHealth(data: Estate): JobHealth {
  const rows = data.jobs.rows;
  const open = rows.filter((j) => !j.done_at);
  const byKind = new Map<string, { kind: string; pending: number; done: number; failing: number }>();
  for (const j of rows) {
    const line = byKind.get(j.kind) ?? { kind: j.kind, pending: 0, done: 0, failing: 0 };
    if (j.done_at) line.done += 1;
    else {
      line.pending += 1;
      if (j.attempts > 0) line.failing += 1;
    }
    byKind.set(j.kind, line);
  }

  return {
    pending: open.length,
    running: open.filter((j) => j.locked_at).length,
    done: rows.length - open.length,
    failing: open.filter((j) => j.attempts > 0).length,
    oldestPending: open.map((j) => j.created_at).sort()[0] ?? null,
    lastError: open.find((j) => j.last_error)?.last_error ?? null,
    byKind: [...byKind.values()].sort((a, b) => b.pending - a.pending),
  };
}

export interface LinkHealth {
  total: number;
  used: number;
  pending: number;
  expired: number;
  rate: number;
}

/** How many magic links actually get clicked — the identity mode working or not. */
export function linkHealth(data: Estate, now: Date): LinkHealth {
  const rows = data.magicLinks.rows;
  const used = rows.filter((r) => r.used_at).length;
  const expired = rows.filter((r) => !r.used_at && new Date(r.expires_at) < now).length;
  return {
    total: rows.length,
    used,
    pending: rows.length - used - expired,
    expired,
    rate: rows.length === 0 ? 0 : used / rows.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Breakdowns                                                                 */
/* -------------------------------------------------------------------------- */

export interface Breakdown {
  label: string;
  rows: { key: string; count: number }[];
}

/** Counts by one property, biggest first — the shape every breakdown shares. */
export function breakdown<T>(label: string, rows: T[], key: (row: T) => string | string[]): Breakdown {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const keys = key(row);
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return {
    label,
    rows: [...counts.entries()]
      .map(([k, count]) => ({ key: k, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export interface AddressBook {
  /** Distinct addresses, case-folded, across every place one can appear. */
  total: number;
  founders: number;
  visitors: number;
  verifiedVisitors: number;
  recipients: number;
  /** Visitors with no address at all — the ceiling on how much can be known. */
  anonymous: number;
}

/**
 * How many people Euclid can actually name.
 *
 * Worth a figure of its own because it is the honest bound on this console:
 * an anonymous voter is a fingerprint and will never be an address, so the
 * gap between `total` and `anonymous` is the gap between the people an
 * operator can write to and the people who are merely counted.
 */
export function addressBook(data: Estate, users: AdminUser[]): AddressBook {
  const all = new Set<string>();
  const add = (email: string | null | undefined) => {
    if (email) all.add(email.trim().toLowerCase());
  };

  const founders = users.filter((u) => u.email);
  founders.forEach((u) => add(u.email));

  const visitors = data.endUsers.rows.filter((e) => e.email);
  visitors.forEach((e) => add(e.email));
  data.outbox.rows.forEach((e) => add(e.to_email));
  data.magicLinks.rows.forEach((m) => add(m.email));
  data.students.rows.forEach((s) => add(s.email));
  data.workspaces.rows.forEach((w) => add(w.student_email));

  return {
    total: all.size,
    founders: founders.length,
    visitors: visitors.length,
    verifiedVisitors: visitors.filter((v) => v.email_verified).length,
    recipients: new Set(data.outbox.rows.map((e) => e.to_email.toLowerCase())).size,
    anonymous: data.endUsers.rows.length - visitors.length,
  };
}

export function estateBreakdowns(data: Estate): Breakdown[] {
  return [
    breakdown("Plan", data.workspaces.rows, (w) => w.plan),
    breakdown("Subscription", data.workspaces.rows, (w) => w.subscription_status ?? "none"),
    breakdown("Billing period", data.workspaces.rows, (w) => w.billing_period),
    breakdown("Coding tools", data.workspaces.rows, (w) =>
      (w.coding_tools ?? []).length ? (w.coding_tools ?? []) : ["none given"],
    ),
    breakdown("Referred by", data.workspaces.rows, (w) => w.referred_by ?? "direct"),
    breakdown("Identity mode", data.boards.rows, (b) => b.identity_mode),
    breakdown("Visitor kind", data.endUsers.rows, (e) => e.kind),
    breakdown("Post status", data.posts.rows, (p) => p.status),
    breakdown("Post category", data.posts.rows, (p) => p.category ?? "uncategorised"),
    breakdown("Prompt target", data.prompts.rows, (p) => p.target),
  ];
}

/* -------------------------------------------------------------------------- */
/* Captured behaviour                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Everything in this section reads `analytics_events` — the one table in the
 * console that was *sent* rather than derived.
 *
 * It exists because state has exactly one blind spot, and that blind spot is
 * attention. Opening a screen writes no row; abandoning an onboarding step
 * writes no row; copying the install snippet and never installing writes no
 * row. Those are the questions here and nothing else is — see 0032 for the
 * three candidate events that were cut because the database already answered
 * them better.
 *
 * Two honesty rules run through the section. **Captured data starts when
 * capture was deployed**, so every panel is dated by `captureSince` rather
 * than implying the coverage the derived panels genuinely have. And **the
 * operator's own clicking is excluded by default** on the page: a console
 * whose busiest screen is always the one the operator was last debugging is
 * measuring itself.
 */

export interface NameStat {
  name: string;
  label: string;
  events: number;
  /** Distinct logins. Twelve views by one person is one person. */
  people: number;
  /** Distinct per-tab session ids. */
  sessions: number;
  workspaces: number;
  lastAt: string | null;
  points: number[];
}

/** When capture actually started, so no panel implies more history than exists. */
export function captureSince(rows: AnalyticsRow[]): string | null {
  let earliest: string | null = null;
  for (const row of rows) {
    if (!earliest || row.created_at < earliest) earliest = row.created_at;
  }
  return earliest;
}

/**
 * One row per event name, with people and sessions beside the raw count.
 *
 * Events alone would be the wrong headline. A founder who reloads the designer
 * twenty times while building something is not twenty founders, and the
 * question behind "did anyone use this" is always about people.
 */
export function capturedStats(
  rows: AnalyticsRow[],
  days: number,
  now: Date,
  include: (name: string) => boolean = () => true,
): NameStat[] {
  const since = now.getTime() - days * DAY_MS;
  const groups = new Map<
    string,
    { events: AnalyticsRow[]; people: Set<string>; sessions: Set<string>; workspaces: Set<string> }
  >();

  for (const row of rows) {
    if (!include(row.name)) continue;
    if (new Date(row.created_at).getTime() < since) continue;

    const group = groups.get(row.name) ?? {
      events: [],
      people: new Set<string>(),
      sessions: new Set<string>(),
      workspaces: new Set<string>(),
    };
    group.events.push(row);
    if (row.user_id) group.people.add(row.user_id);
    if (row.session_id) group.sessions.add(row.session_id);
    if (row.workspace_id) group.workspaces.add(row.workspace_id);
    groups.set(row.name, group);
  }

  return [...groups.entries()]
    .map(([name, group]) => ({
      name,
      label: eventLabel(name),
      events: group.events.length,
      people: group.people.size,
      sessions: group.sessions.size,
      workspaces: group.workspaces.size,
      lastAt: lastOf(group.events.map((e) => e.created_at)),
      points: countByDay(
        group.events.map((e) => e.created_at),
        days,
        now,
      ),
    }))
    .sort((a, b) => b.people - a.people || b.events - a.events);
}

export interface SessionStats {
  sessions: number;
  events: number;
  /** Screens per session, to one decimal: the shape of a visit, roughly. */
  screensPerSession: number;
  /** The busiest single visit, which is usually the most interesting one. */
  deepest: number;
}

export function sessionStats(rows: AnalyticsRow[], days: number, now: Date): SessionStats {
  const since = now.getTime() - days * DAY_MS;
  const screensBySession = new Map<string, number>();
  let events = 0;

  for (const row of rows) {
    if (new Date(row.created_at).getTime() < since) continue;
    events += 1;
    if (!row.session_id || !row.name.startsWith("screen.")) continue;
    screensBySession.set(row.session_id, (screensBySession.get(row.session_id) ?? 0) + 1);
  }

  const counts = [...screensBySession.values()];
  const total = counts.reduce((a, b) => a + b, 0);
  return {
    sessions: counts.length,
    events,
    screensPerSession: counts.length === 0 ? 0 : Math.round((total / counts.length) * 10) / 10,
    deepest: counts.length === 0 ? 0 : Math.max(...counts),
  };
}

/** Where people are, by route rather than by screen name. */
export function pathStats(rows: AnalyticsRow[], days: number, now: Date): NameStat[] {
  const since = now.getTime() - days * DAY_MS;
  const groups = new Map<string, { events: AnalyticsRow[]; people: Set<string> }>();

  for (const row of rows) {
    if (!row.path) continue;
    if (new Date(row.created_at).getTime() < since) continue;
    const group = groups.get(row.path) ?? { events: [], people: new Set<string>() };
    group.events.push(row);
    if (row.user_id) group.people.add(row.user_id);
    groups.set(row.path, group);
  }

  return [...groups.entries()]
    .map(([path, group]) => ({
      name: path,
      label: path,
      events: group.events.length,
      people: group.people.size,
      sessions: 0,
      workspaces: 0,
      lastAt: lastOf(group.events.map((e) => e.created_at)),
      points: [],
    }))
    .sort((a, b) => b.events - a.events);
}

/** How one property was answered, for the events that carry one. */
export function propBreakdown(rows: AnalyticsRow[], name: string, key: string): Breakdown {
  return breakdown(
    `${eventLabel(name)} · ${key}`,
    rows.filter((r) => r.name === name),
    (row) => {
      const value = (row.props ?? {})[key];
      return value === undefined ? "not given" : String(value);
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Onboarding, step by step                                                   */
/* -------------------------------------------------------------------------- */

export interface OnboardingRow {
  userId: string;
  email: string | null;
  workspace: string | null;
  reached: Set<string>;
  onboarded: boolean;
  installed: boolean;
  firstSeen: string;
}

/**
 * The step-by-step onboarding funnel, which is the question captured events
 * were added for.
 *
 * The activation funnel on the Overview can say three workspaces never
 * finished onboarding. It cannot say *which step* they stopped on, because an
 * abandoned step writes nothing at all — so this is the one panel in the whole
 * console that could not have been derived from state.
 *
 * Two decisions about the population, both deliberate:
 *
 * - **Only logins that have sent at least one event.** Anyone who onboarded
 *   before capture shipped has no rows, and including them would stack the
 *   entire history of the product at step one.
 * - **The last two steps are state, not capture.** "Finished onboarding" is
 *   `workspaces.onboarded_at` and "installed the widget" is
 *   `boards.installed_at`, because the database already holds both and a
 *   captured event for either could only be a less reliable copy.
 */
export function onboardingProgress(
  data: Estate,
  index: Index,
  users: AdminUser[],
): FunnelStep<OnboardingRow>[] {
  const logins = new Map(users.map((u) => [u.id, u]));
  const seen = new Map<string, OnboardingRow>();

  const membershipOf = new Map<string, string>();
  for (const m of data.members.rows) {
    if (!membershipOf.has(m.user_id)) membershipOf.set(m.user_id, m.workspace_id);
  }

  const installedWorkspaces = new Set(
    data.boards.rows.filter((b) => b.installed_at).map((b) => b.workspace_id),
  );

  for (const row of data.captured.rows) {
    if (!row.user_id) continue;

    const existing = seen.get(row.user_id);
    if (existing) {
      existing.reached.add(row.name);
      if (row.created_at < existing.firstSeen) existing.firstSeen = row.created_at;
      continue;
    }

    // The row carries a workspace only once one exists, which is exactly what
    // an onboarding event cannot assume — so fall back to the membership.
    const workspaceId = row.workspace_id ?? membershipOf.get(row.user_id) ?? null;
    const workspace = workspaceId ? index.workspaces.get(workspaceId) : undefined;

    seen.set(row.user_id, {
      userId: row.user_id,
      email: logins.get(row.user_id)?.email ?? null,
      workspace: workspace?.name ?? null,
      reached: new Set([row.name]),
      onboarded: Boolean(workspace?.onboarded_at),
      installed: workspaceId ? installedWorkspaces.has(workspaceId) : false,
      firstSeen: row.created_at,
    });
  }

  const steps: { label: string; reached: (r: OnboardingRow) => boolean }[] = [
    { label: "Seen since capture began", reached: () => true },
    ...ONBOARDING_STEPS.map((name: EventName) => ({
      label: eventLabel(name),
      reached: (r: OnboardingRow) => r.reached.has(name),
    })),
    { label: "Finished onboarding", reached: (r: OnboardingRow) => r.onboarded },
    { label: "Installed the widget", reached: (r: OnboardingRow) => r.installed },
  ];

  return funnelCounts([...seen.values()], steps);
}

/* -------------------------------------------------------------------------- */
/* Intent without action                                                      */
/* -------------------------------------------------------------------------- */

export interface IntentGap {
  label: string;
  note: string;
  people: {
    userId: string | null;
    email: string | null;
    workspace: string | null;
    at: string;
    detail: string | null;
  }[];
}

/**
 * Captured intent that product state says never happened.
 *
 * This is the panel that justifies the table existing. A general analytics
 * tool can say how many people clicked a button; a database can say how many
 * subscriptions exist. Only something holding both can hand over the
 * addresses of the people who tried and did not arrive — which is a list to
 * act on rather than a number to look at.
 */
export function intentGaps(data: Estate, index: Index): IntentGap[] {
  const membershipOf = new Map<string, string>();
  for (const m of data.members.rows) {
    if (!membershipOf.has(m.user_id)) membershipOf.set(m.user_id, m.workspace_id);
  }

  const installedWorkspaces = new Set(
    data.boards.rows.filter((b) => b.installed_at).map((b) => b.workspace_id),
  );

  /** The most recent of these events per login, with the workspace it belongs to. */
  const latest = (names: string[]) => {
    const out = new Map<string, { row: AnalyticsRow; workspaceId: string | null }>();
    for (const row of data.captured.rows) {
      if (!row.user_id || !names.includes(row.name)) continue;
      const workspaceId = row.workspace_id ?? membershipOf.get(row.user_id) ?? null;
      const existing = out.get(row.user_id);
      if (!existing || row.created_at > existing.row.created_at) {
        out.set(row.user_id, { row, workspaceId });
      }
    }
    return out;
  };

  const describe = (userId: string, workspaceId: string | null, row: AnalyticsRow) => {
    const workspace = workspaceId ? index.workspaces.get(workspaceId) : undefined;
    const props = Object.entries(row.props ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join(" · ");
    return {
      userId,
      email: index.users.get(userId)?.email ?? null,
      workspace: workspace?.name ?? null,
      at: row.created_at,
      detail: props || null,
    };
  };

  const copiedNotInstalled = [
    ...latest(["install.snippet_copied", "install.agent_prompt_copied"]),
  ]
    .filter(([, { workspaceId }]) => !workspaceId || !installedWorkspaces.has(workspaceId))
    .map(([userId, { row, workspaceId }]) => describe(userId, workspaceId, row));

  const clickedNotPaying = [...latest(["billing.upgrade_clicked"])]
    .filter(([, { workspaceId }]) => {
      const workspace = workspaceId ? index.workspaces.get(workspaceId) : undefined;
      if (!workspace) return true;
      // Free, or a paid tier whose subscription never came good. A trial
      // counts as arrived: they clicked, Polar took them, and nothing has
      // gone wrong yet.
      const status = workspace.subscription_status;
      return workspace.plan === "free" || !(status === "active" || status === "trialing");
    })
    .map(([userId, { row, workspaceId }]) => describe(userId, workspaceId, row));

  return [
    {
      label: "Copied the install snippet, never installed",
      note:
        "The widget has never been served from a real page for this workspace. installed_at is " +
        "null whether they pasted it badly or never pasted it at all, so the copy is the only " +
        "sign they tried.",
      people: copiedNotInstalled.sort((a, b) => b.at.localeCompare(a.at)),
    },
    {
      label: "Clicked upgrade, never subscribed",
      note:
        "The next hop after that click is polar.sh, so without the captured event nothing " +
        "anywhere would record that they tried. A trial counts as arrived.",
      people: clickedNotPaying.sort((a, b) => b.at.localeCompare(a.at)),
    },
  ];
}
