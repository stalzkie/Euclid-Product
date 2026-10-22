import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { EndUserKind, IdentityMode, PlanTier, PostStatus, PromptTarget } from "@/lib/types";

/**
 * Everything the operator console reads, in one pass, as flat rows.
 *
 * The console answers a few dozen questions — who signed up, who installed,
 * who is stuck, what broke, what is owed — and almost all of them are the
 * same handful of tables sliced differently. Fetching those tables once per
 * request and deriving every panel in memory buys three things:
 *
 * 1. **The derivations become pure.** `admin-model.ts` is functions over this
 *    shape, so retention, cohorts, funnels and the event feed are unit-tested
 *    without a database. That is the only reason a console this size stays
 *    maintainable.
 * 2. **One round-trip budget.** Against a remote Supabase every query is most
 *    of a second from a dev machine; the alternative was forty of them.
 * 3. **No new schema.** Nothing here needs a migration, a capture endpoint or
 *    an events table — see the note on `funnel()` in admin.ts for why that is
 *    deliberate rather than lazy.
 *
 * What it gives up is scale, and it gives it up loudly rather than quietly:
 * every slice carries `truncated`, the console shows a banner when any of them
 * is, and the number to change is `ROW_CAP`. A silent cap would make a
 * half-read table look like the whole truth, which is the one failure mode an
 * analytics screen must not have.
 */

/**
 * Rows per table per request.
 *
 * At 20 000 the heaviest tables (votes, posts) are a few megabytes in the
 * worst case and nothing in practice. When a slice starts truncating for
 * real, the answer is not a bigger number — it is an aggregate in the
 * database, the way `board_daily_series` already does it for one board.
 */
export const ROW_CAP = 20000;

/** A table, as much of it as the cap allows, and whether that was all of it. */
export interface Slice<T> {
  rows: T[];
  /** True when the cap was hit, so every count derived from this is a floor. */
  truncated: boolean;
  /** Set when the read itself failed, so a panel can say so rather than show zero. */
  error: string | null;
  /**
   * The table is not in the database yet.
   *
   * Kept apart from `error` because it is a deployment state rather than a
   * fault: migrations here are applied by hand through the Supabase SQL
   * editor, so a console deployed ahead of its migration is normal for a few
   * minutes. "Apply 0032" is an instruction; "could not read
   * analytics_events" is an alarm, and an alarm for something the operator is
   * about to do themselves trains them to ignore alarms.
   */
  missing: boolean;
}

/* -------------------------------------------------------------------------- */
/* Row shapes                                                                 */
/* -------------------------------------------------------------------------- */

export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  plan: PlanTier;
  billing_period: string;
  app_name: string | null;
  app_url: string | null;
  coding_tools: string[] | null;
  prompts_used: number;
  chat_credits_used: number;
  extra_prompts: number;
  extra_chat_credits: number;
  usage_period_start: string | null;
  onboarded_at: string | null;
  setup_dismissed_at: string | null;
  polar_customer_id: string | null;
  polar_subscription_id: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  trial_reminder_sent_at: string | null;
  student_email: string | null;
  student_verified_at: string | null;
  referred_by: string | null;
  referred_at: string | null;
  created_at: string;
}

export interface MemberRow {
  workspace_id: string;
  user_id: string;
  role: string;
  name: string | null;
  created_at: string;
}

export interface BoardRow {
  id: string;
  workspace_id: string;
  public_id: string;
  name: string;
  slug: string;
  identity_mode: IdentityMode;
  allowed_domains: string[] | null;
  custom_domain: string | null;
  show_badge: boolean;
  require_approval: boolean;
  installed_at: string | null;
  created_at: string;
}

export interface PostRow {
  id: string;
  board_id: string;
  number: number;
  title: string;
  status: PostStatus;
  category: string | null;
  author_id: string | null;
  vote_count: number;
  comment_count: number;
  approved: boolean;
  spam_score: number | null;
  injection_flagged: boolean;
  external_url: string | null;
  shipped_at: string | null;
  created_at: string;
}

export interface VoteRow {
  post_id: string;
  end_user_id: string;
  weight: number;
  created_at: string;
}

export interface CommentRow {
  post_id: string;
  end_user_id: string | null;
  author_user_id: string | null;
  author_name: string | null;
  internal: boolean;
  created_at: string;
}

export interface EndUserRow {
  id: string;
  board_id: string;
  kind: EndUserKind;
  external_key: string;
  email: string | null;
  email_verified: boolean;
  name: string | null;
  vote_weight: number;
  created_at: string;
}

export interface PromptRow {
  id: string;
  workspace_id: string;
  post_id: string | null;
  theme_id: string | null;
  target: PromptTarget;
  title: string;
  version: number;
  copied: boolean;
  token_estimate: number;
  created_by: string | null;
  created_at: string;
}

export interface ActivityRow {
  workspace_id: string;
  board_id: string | null;
  post_id: string | null;
  kind: string;
  text: string;
  meta: string | null;
  created_at: string;
}

export interface ThreadRow {
  id: string;
  workspace_id: string;
  board_id: string | null;
  title: string;
  created_by: string | null;
  created_at: string;
}

export interface ThreadMessageRow {
  thread_id: string;
  role: string;
  created_at: string;
}

export interface OutboxRow {
  id: string;
  to_email: string;
  subject: string;
  kind: string;
  attempts: number | null;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface MagicLinkRow {
  board_id: string;
  email: string;
  used_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface StudentRow {
  workspace_id: string;
  email: string;
  kind: string;
  used_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface TopupRow {
  id: string;
  workspace_id: string;
  polar_order_id: string;
  kind: string;
  quantity: number;
  refunded_at: string | null;
  created_at: string;
}

export interface CommissionRow {
  code: string;
  referrer_id: string;
  referred_id: string;
  polar_order_id: string;
  quantity: number;
  order_cents: number;
  reversed_at: string | null;
  created_at: string;
}

export interface ReferralCodeRow {
  code: string;
  workspace_id: string;
  created_at: string;
}

export interface GrantRow {
  workspace_id: string;
  partner: string;
  code: string | null;
  polar_order_id: string | null;
  filled_at: string | null;
  created_at: string;
}

export interface InstallSignalRow {
  board_id: string;
  origin: string;
  reason: string;
  count: number;
  first_seen: string;
  last_seen: string;
}

export interface ApiKeyRow {
  board_id: string;
  name: string;
  token_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface IntegrationRow {
  id: string;
  board_id: string;
  kind: string;
  events: string[] | null;
  active: boolean;
  last_delivered_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface DeliveryRow {
  integration_id: string;
  event: string;
  attempts: number;
  delivered_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface JobRow {
  id: string;
  kind: string;
  run_after: string;
  attempts: number;
  locked_at: string | null;
  done_at: string | null;
  last_error: string | null;
  created_at: string;
}

/**
 * One captured event — the only rows in this console that were *sent* rather
 * than derived. See 0032 for why there is a table at all, and
 * `src/lib/analytics/events.ts` for what may be in it.
 */
export interface AnalyticsRow {
  id: number;
  name: string;
  source: string;
  user_id: string | null;
  workspace_id: string | null;
  board_id: string | null;
  end_user_id: string | null;
  path: string | null;
  session_id: string | null;
  props: Record<string, string | number | boolean> | null;
  created_at: string;
}

export interface ErrorRow {
  fingerprint: string;
  kind: string;
  message: string;
  route: string | null;
  stack: string | null;
  count: number;
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
}

/* -------------------------------------------------------------------------- */
/* The read                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Rows per response, which is **PostgREST's ceiling and not ours**.
 *
 * This is the one number here that was learned the hard way. A `.limit(20000)`
 * on `votes` returned exactly 1 000 rows out of 1 085, because the server
 * applies its own `db-max-rows` after the limit — so a table could be read
 * short while every count derived from it looked complete, and the
 * `truncated` flag that exists to prevent exactly that said nothing, since
 * 1 000 is not 20 000. Hence paging, and hence measuring against the exact
 * count rather than against our own cap.
 */
const PAGE = 1000;

/**
 * One table, newest first, paged to `ROW_CAP`.
 *
 * Newest-first matters: when a slice truncates it is the recent end that is
 * kept, which is the end every panel here is about. The cost is that an
 * all-time first-ever timestamp can be missed on a truncated table, which is
 * what `truncated` exists to admit.
 *
 * `order` is a list because paging by a timestamp alone is not deterministic:
 * seeded rows share a `created_at` to the microsecond, and Postgres is free to
 * return tied rows in a different order per query — which, across two pages,
 * silently duplicates some rows and drops others. The trailing columns are a
 * unique key for the table, and they are ordered but never selected.
 */
async function read<T>(table: string, columns: string, order: string[]): Promise<Slice<T>> {
  const rows: T[] = [];
  let total: number | null = null;

  while (rows.length < ROW_CAP) {
    // The exact count comes back with every page. It is a second scan
    // server-side and the answer does not change between pages, but asking
    // only on the first page means two differently-typed builders here, and
    // the union of those two is a type TypeScript gives up on — see the
    // explicit chain below for the same reason.
    const selected = supabaseAdmin().from(table).select(columns, { count: "exact" });

    // Chained explicitly rather than folded over the array: supabase-js does
    // not re-export its builder types, so a loop would need the accumulator
    // to be `any` — and this function is the one every panel depends on.
    const [first, second, third, fourth] = order;
    const desc = { ascending: false } as const;
    let query = selected.order(first, desc);
    if (second) query = query.order(second, desc);
    if (third) query = query.order(third, desc);
    if (fourth) query = query.order(fourth, desc);

    const { data, error, count } = await query.range(
      rows.length,
      Math.min(rows.length + PAGE, ROW_CAP) - 1,
    );

    if (error) {
      // PGRST205 is "no such table in the schema cache"; 42P01 is Postgres
      // saying the same thing. Both mean a migration has not been applied,
      // which the console reports as a next action rather than as a failure.
      const absent = error.code === "PGRST205" || error.code === "42P01";
      return {
        rows: [],
        truncated: false,
        error: absent ? null : error.message,
        missing: absent,
      };
    }

    if (typeof count === "number") total = count;
    const batch = (data ?? []) as T[];
    rows.push(...batch);

    if (batch.length === 0) break;
    if (total !== null && rows.length >= total) break;
  }

  return {
    rows,
    truncated: total === null ? rows.length >= ROW_CAP : rows.length < total,
    error: null,
    missing: false,
  };
}

export interface Estate {
  workspaces: Slice<WorkspaceRow>;
  members: Slice<MemberRow>;
  boards: Slice<BoardRow>;
  posts: Slice<PostRow>;
  votes: Slice<VoteRow>;
  comments: Slice<CommentRow>;
  endUsers: Slice<EndUserRow>;
  prompts: Slice<PromptRow>;
  activity: Slice<ActivityRow>;
  threads: Slice<ThreadRow>;
  threadMessages: Slice<ThreadMessageRow>;
  outbox: Slice<OutboxRow>;
  magicLinks: Slice<MagicLinkRow>;
  students: Slice<StudentRow>;
  topups: Slice<TopupRow>;
  commissions: Slice<CommissionRow>;
  referralCodes: Slice<ReferralCodeRow>;
  grants: Slice<GrantRow>;
  installSignals: Slice<InstallSignalRow>;
  apiKeys: Slice<ApiKeyRow>;
  integrations: Slice<IntegrationRow>;
  deliveries: Slice<DeliveryRow>;
  jobs: Slice<JobRow>;
  errors: Slice<ErrorRow>;
  captured: Slice<AnalyticsRow>;
}

/**
 * Memoised for the request: the overview asks for the funnel, the trends, the
 * queues and the estate totals, and all four are this one read.
 */
export const estate = cache(async function estate(): Promise<Estate> {
  const [
    workspaces,
    members,
    boards,
    posts,
    votes,
    comments,
    endUsers,
    prompts,
    activity,
    threads,
    threadMessages,
    outbox,
    magicLinks,
    students,
    topups,
    commissions,
    referralCodes,
    grants,
    installSignals,
    apiKeys,
    integrations,
    deliveries,
    jobs,
    errors,
    captured,
  ] = await Promise.all([
    read<WorkspaceRow>(
      "workspaces",
      "id,name,slug,plan,billing_period,app_name,app_url,coding_tools,prompts_used," +
        "chat_credits_used,extra_prompts,extra_chat_credits,usage_period_start,onboarded_at," +
        "setup_dismissed_at,polar_customer_id,polar_subscription_id,subscription_status," +
        "current_period_end,cancel_at_period_end,trial_reminder_sent_at,student_email," +
        "student_verified_at,referred_by,referred_at,created_at",
      ["created_at", "id"],
    ),
    read<MemberRow>("workspace_members", "workspace_id,user_id,role,name,created_at", ["created_at", "workspace_id", "user_id"]),
    read<BoardRow>(
      "boards",
      "id,workspace_id,public_id,name,slug,identity_mode,allowed_domains,custom_domain," +
        "show_badge,require_approval,installed_at,created_at",
      ["created_at", "id"],
    ),
    read<PostRow>(
      "posts",
      "id,board_id,number,title,status,category,author_id,vote_count,comment_count,approved," +
        "spam_score,injection_flagged,external_url,shipped_at,created_at",
      ["created_at", "id"],
    ),
    read<VoteRow>("votes", "post_id,end_user_id,weight,created_at", ["created_at", "id"]),
    read<CommentRow>(
      "comments",
      "post_id,end_user_id,author_user_id,author_name,internal,created_at",
      ["created_at", "id"],
    ),
    read<EndUserRow>(
      "end_users",
      "id,board_id,kind,external_key,email,email_verified,name,vote_weight,created_at",
      ["created_at", "id"],
    ),
    read<PromptRow>(
      "build_prompts",
      "id,workspace_id,post_id,theme_id,target,title,version,copied,token_estimate," +
        "created_by,created_at",
      ["created_at", "id"],
    ),
    read<ActivityRow>(
      "activity",
      "workspace_id,board_id,post_id,kind,text,meta,created_at",
      ["created_at", "id"],
    ),
    read<ThreadRow>(
      "chat_threads",
      "id,workspace_id,board_id,title,created_by,created_at",
      ["created_at", "id"],
    ),
    read<ThreadMessageRow>("chat_messages", "thread_id,role,created_at", ["created_at", "id"]),
    read<OutboxRow>(
      "email_outbox",
      "id,to_email,subject,kind,attempts,last_error,sent_at,created_at",
      ["created_at", "id"],
    ),
    read<MagicLinkRow>("magic_links", "board_id,email,used_at,expires_at,created_at", ["created_at", "token"]),
    read<StudentRow>(
      "student_verifications",
      "workspace_id,email,kind,used_at,expires_at,created_at",
      ["created_at", "token"],
    ),
    read<TopupRow>(
      "credit_topups",
      "id,workspace_id,polar_order_id,kind,quantity,refunded_at,created_at",
      ["created_at", "id"],
    ),
    read<CommissionRow>(
      "referral_commissions",
      "code,referrer_id,referred_id,polar_order_id,quantity,order_cents,reversed_at,created_at",
      ["created_at", "polar_order_id"],
    ),
    read<ReferralCodeRow>("referral_codes", "code,workspace_id,created_at", ["created_at", "code"]),
    read<GrantRow>(
      "partner_grants",
      "workspace_id,partner,code,polar_order_id,filled_at,created_at",
      ["created_at", "id"],
    ),
    read<InstallSignalRow>(
      "install_signals",
      "board_id,origin,reason,count,first_seen,last_seen",
      ["last_seen", "board_id", "origin", "reason"],
    ),
    read<ApiKeyRow>(
      "api_keys",
      "board_id,name,token_prefix,last_used_at,revoked_at,created_at",
      ["created_at", "id"],
    ),
    read<IntegrationRow>(
      "integrations",
      "id,board_id,kind,events,active,last_delivered_at,last_error,created_at",
      ["created_at", "id"],
    ),
    read<DeliveryRow>(
      "integration_deliveries",
      "integration_id,event,attempts,delivered_at,last_error,created_at",
      ["created_at", "id"],
    ),
    read<JobRow>(
      "jobs",
      "id,kind,run_after,attempts,locked_at,done_at,last_error,created_at",
      ["created_at", "id"],
    ),
    read<ErrorRow>(
      "error_events",
      "fingerprint,kind,message,route,stack,count,first_seen,last_seen,resolved_at",
      ["last_seen", "fingerprint"],
    ),
    read<AnalyticsRow>(
      "analytics_events",
      "id,name,source,user_id,workspace_id,board_id,end_user_id,path,session_id,props,created_at",
      ["created_at", "id"],
    ),
  ]);

  return {
    workspaces,
    members,
    boards,
    posts,
    votes,
    comments,
    endUsers,
    prompts,
    activity,
    threads,
    threadMessages,
    outbox,
    magicLinks,
    students,
    topups,
    commissions,
    referralCodes,
    grants,
    installSignals,
    apiKeys,
    integrations,
    deliveries,
    jobs,
    errors,
    captured,
  };
});

/** Which slices came back short, for the banner that says so. */
export function truncatedSlices(data: Estate): string[] {
  return Object.entries(data)
    .filter(([, slice]) => (slice as Slice<unknown>).truncated)
    .map(([name]) => name);
}

/** Which tables are not in the database yet — by migration rather than by fault. */
export function missingSlices(data: Estate): string[] {
  return Object.entries(data)
    .filter(([, slice]) => (slice as Slice<unknown>).missing)
    .map(([name]) => name);
}

/** Which slices failed to read at all. */
export function failedSlices(data: Estate): { name: string; error: string }[] {
  return Object.entries(data)
    .map(([name, slice]) => ({ name, error: (slice as Slice<unknown>).error }))
    .filter((s): s is { name: string; error: string } => Boolean(s.error));
}

/* -------------------------------------------------------------------------- */
/* Identity                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A founder login, which is the only place their e-mail address lives.
 *
 * `workspace_members` carries a display name and nothing else; the address is
 * in `auth.users`, which no select from this client can reach — it is behind
 * the auth admin API. That is the whole reason this is a second read.
 */
export interface AdminUser {
  id: string;
  email: string | null;
  name: string | null;
  provider: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  confirmedAt: string | null;
}

const USERS_PER_PAGE = 200;
const MAX_USER_PAGES = 25;

/**
 * Every login, paged out of the auth admin API.
 *
 * Stops at `MAX_USER_PAGES` and says so through `truncated`, for the same
 * reason the table reads do: 5 000 founders is well past the point where this
 * console should be the thing answering the question.
 */
export const authUsers = cache(async function authUsers(): Promise<Slice<AdminUser>> {
  const db = supabaseAdmin();
  const out: AdminUser[] = [];

  for (let page = 1; page <= MAX_USER_PAGES; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE });
    if (error) return { rows: out, truncated: false, error: error.message, missing: false };

    const users = data?.users ?? [];
    for (const u of users) {
      const meta = (u.user_metadata ?? {}) as { full_name?: string; name?: string };
      out.push({
        id: u.id,
        email: u.email ?? null,
        name: meta.full_name ?? meta.name ?? null,
        provider: (u.app_metadata as { provider?: string } | undefined)?.provider ?? null,
        createdAt: u.created_at ?? null,
        lastSignInAt: u.last_sign_in_at ?? null,
        confirmedAt: u.email_confirmed_at ?? null,
      });
    }

    // A short page is the last page. Asking for one more would be a wasted
    // round trip on every single load of every panel.
    if (users.length < USERS_PER_PAGE)
      return { rows: out, truncated: false, error: null, missing: false };
  }

  return { rows: out, truncated: true, error: null, missing: false };
});

/** Logins by id, for attributing a row that carries only a `user_id`. */
export function usersById(users: AdminUser[]): Map<string, AdminUser> {
  return new Map(users.map((u) => [u.id, u]));
}
