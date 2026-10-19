import { notFound } from "next/navigation";
import { supabaseAdmin, hasServiceRole } from "@/lib/supabase/server";
import { requireFounder } from "@/server/context";

/**
 * The operator's view. Not a founder feature — this reads across every
 * workspace, so it is gated on an explicit allow-list rather than on a role
 * in the database.
 *
 * `ADMIN_EMAILS` and not a column, for two reasons. A column is a thing
 * somebody can be granted by a bug — a bad RLS policy, a careless update —
 * whereas an environment variable can only change by deploying. And the
 * answer to "who can see everything" should be visible in the deployment
 * config, not discoverable by querying.
 *
 * Unset means nobody, including in development. An admin surface that opens
 * itself when unconfigured is the wrong default for the one page that can
 * read every workspace's data.
 */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowed = adminEmails();
  return allowed.length > 0 && allowed.includes(email.trim().toLowerCase());
}

/**
 * Require an operator, or pretend the page does not exist.
 *
 * `notFound()` rather than a 403: a signed-in founder who stumbles on /admin
 * learns nothing from a 404, where "forbidden" confirms there is something
 * there worth getting at.
 */
export async function requireAdmin() {
  const ctx = await requireFounder();
  if (!isAdminEmail(ctx.email)) notFound();
  if (!hasServiceRole()) notFound();
  return ctx;
}

/* -------------------------------------------------------------------------- */
/* The panels                                                                 */
/* -------------------------------------------------------------------------- */

export interface QueueHealth {
  queued: number;
  failing: number;
  oldestQueued: string | null;
  lastError: string | null;
}

/**
 * One queue's state, from the retry columns `0015_email_retry` added and that
 * nothing has ever read back.
 *
 * "Failing" is a row that has been attempted and is still unsent, which is
 * different from queued — a backlog of fresh rows is a slow drain, a backlog
 * of attempted ones is something actually broken.
 */
async function queueHealth(table: string): Promise<QueueHealth> {
  const db = supabaseAdmin();

  const [queued, failing, oldest] = await Promise.all([
    db.from(table).select("id", { count: "exact", head: true }).is("sent_at", null),
    db
      .from(table)
      .select("id", { count: "exact", head: true })
      .is("sent_at", null)
      .gt("attempts", 0),
    db
      .from(table)
      .select("created_at,last_error")
      .is("sent_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    queued: queued.count ?? 0,
    failing: failing.count ?? 0,
    oldestQueued: (oldest.data?.created_at as string | undefined) ?? null,
    lastError: (oldest.data?.last_error as string | undefined) ?? null,
  };
}

export interface FunnelStep {
  label: string;
  count: number;
  /** Share of the step before it. Null on the first, which has nothing to compare to. */
  conversion: number | null;
}

export interface AdminSnapshot {
  funnel: FunnelStep[];
  emails: QueueHealth;
  deliveries: QueueHealth;
  billing: {
    byStatus: Record<string, number>;
    trialsEndingSoon: { name: string; endsAt: string | null }[];
    topups: number;
    commissions: { granted: number; reversed: number };
  };
  partner: { available: number; owed: number };
  ai: {
    workspace: string;
    plan: string;
    prompts: number;
    credits: number;
    extraPrompts: number;
    extraCredits: number;
  }[];
  boards: { total: number; neverInstalled: number; openAllowList: number };
  errors: {
    fingerprint: string;
    kind: string;
    message: string;
    route: string | null;
    count: number;
    lastSeen: string;
  }[];
}

/**
 * Fold rows through an ordered list of stages.
 *
 * Separated from the queries so the one property that matters can be tested:
 * **a step can never exceed the step above it**. Counting each stage
 * independently does not give you that, and the first render of this panel
 * reported "Paid 200%" because of it — two workspaces were on a paid plan
 * while only one had finished onboarding, the seeded one having been created
 * in SQL. A funnel that can print 200% is one nobody can trust the rest of.
 */
export function funnelCounts<T>(
  rows: T[],
  stages: { label: string; reached: (row: T) => boolean }[],
): FunnelStep[] {
  const counts = stages.map((_, i) => ({
    label: stages[i].label,
    // Reached this stage *and* every stage before it. The prefix is what
    // makes the sequence monotonic by construction rather than by luck.
    count: rows.filter((row) => stages.slice(0, i + 1).every((stage) => stage.reached(row)))
      .length,
  }));

  return counts.map((step, i) => ({
    ...step,
    // Against the previous step rather than the first. Step-to-step is the
    // number that says where people stop, which is the only thing a funnel is
    // for; share-of-total just restates the shape of the curve.
    conversion:
      i === 0 ? null : counts[i - 1].count === 0 ? 0 : step.count / counts[i - 1].count,
  }));
}

/**
 * Signup → onboarded → installed → first post → first prompt → paid.
 *
 * **Derived from state, not from captured events.** The original plan was an
 * `analytics_events` table with capture at six points, which is how a general
 * analytics tool has to work because it cannot know what the rows mean. This
 * one does: every step here is already a timestamp or the existence of a row,
 * so a second record of the same fact would only be a thing to keep in sync.
 *
 * Three things fall out of that, all of them good. It needs no migration and
 * no capture. It cannot double-count or miss an event because a deploy went
 * out mid-signup. And it is **retroactive** — it describes every workspace
 * that has ever existed rather than only those created after instrumentation
 * shipped, which is the usual reason a new funnel is useless for a month.
 *
 * What it gives up is arbitrary events: there is no way to ask this "how many
 * people opened the designer". When that question actually comes up, that is
 * the moment to add the table — not before.
 */
async function funnel(): Promise<FunnelStep[]> {
  const db = supabaseAdmin();

  const [workspaces, boards, posts, prompts] = await Promise.all([
    db.from("workspaces").select("id,plan,onboarded_at"),
    db.from("boards").select("id,workspace_id,installed_at"),
    db.from("posts").select("board_id"),
    db.from("build_prompts").select("workspace_id"),
  ]);

  const rows = workspaces.data ?? [];
  const boardRows = boards.data ?? [];

  // Posts carry a board id, not a workspace id, so they have to be walked
  // back through the board. Getting this wrong is silent: comparing the two
  // id columns directly matches nothing and the step simply reads zero.
  const ownerOfBoard = new Map(
    boardRows.map((b) => [b.id as string, b.workspace_id as string]),
  );

  const installed = new Set(
    boardRows.filter((b) => b.installed_at).map((b) => b.workspace_id as string),
  );
  const posted = new Set(
    (posts.data ?? [])
      .map((p) => ownerOfBoard.get(p.board_id as string))
      .filter((id): id is string => Boolean(id)),
  );
  const prompted = new Set((prompts.data ?? []).map((p) => p.workspace_id as string));

  const has = (set: Set<string>) => (w: { id: unknown }) => set.has(w.id as string);

  /*
    Cumulative, not independent counts.

    Each step counts workspaces that have reached it *and every step before
    it*, which is what makes this a funnel rather than six unrelated numbers.
    Without that, a step can exceed the one above it and report a conversion
    over 100% — which it did the first time this was rendered: two workspaces
    were on a paid plan while only one had an `onboarded_at`, because the
    seeded workspace was created in SQL and never went through onboarding.
    A chart that can say 200% is a chart nobody can trust the rest of.

    The cost is that a workspace which skipped a step is invisible from there
    on, even if it later did something further down. That is the right trade
    for a funnel — and the absolute counts that do not care about order are
    on the Billing panel above.
  */
  const stages: { label: string; reached: (w: (typeof rows)[number]) => boolean }[] = [
    { label: "Signed up", reached: () => true },
    { label: "Finished onboarding", reached: (w) => Boolean(w.onboarded_at) },
    { label: "Installed the widget", reached: has(installed) },
    { label: "Received a request", reached: has(posted) },
    { label: "Generated a prompt", reached: has(prompted) },
    // Plan rather than subscription status: a workspace moved to a paid tier
    // without Polar -- which `changePlan` still allows while billing is
    // unconfigured -- has converted by every meaning that matters here.
    { label: "Paid", reached: (w) => (w.plan as string) !== "free" },
  ];

  return funnelCounts(rows, stages);
}

/**
 * Everything the admin page shows, in one pass.
 *
 * Assembled here rather than in the page so it can be read as a whole: this
 * is the list of questions the operator can currently answer, and a gap in it
 * is a gap in what the product can tell us about itself.
 */
export async function adminSnapshot(): Promise<AdminSnapshot> {
  const db = supabaseAdmin();
  const soon = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  const [steps, emails, deliveries, workspaces, trials, topups, commissions, pool, boards, errors] =
    await Promise.all([
      funnel(),
      queueHealth("email_outbox"),
      queueHealth("integration_outbox"),
      db
        .from("workspaces")
        .select(
          "name,plan,subscription_status,prompts_used,chat_credits_used,extra_prompts,extra_chat_credits",
        ),
      db
        .from("workspaces")
        .select("name,current_period_end")
        .eq("subscription_status", "trialing")
        .lt("current_period_end", soon)
        .order("current_period_end", { ascending: true }),
      db.from("credit_topups").select("id,refunded_at"),
      db.from("referral_commissions").select("quantity,reversed_at"),
      db.rpc("partner_pool_status", { p_partner: "bernn" }).maybeSingle<{
        available: number;
        owed: number;
      }>(),
      db.from("boards").select("installed_at,allowed_domains"),
      db
        .from("error_events")
        .select("fingerprint,kind,message,route,count,last_seen")
        .is("resolved_at", null)
        .order("last_seen", { ascending: false })
        .limit(20),
    ]);

  const rows = workspaces.data ?? [];
  const byStatus: Record<string, number> = {};
  for (const w of rows) {
    // A workspace that has never been to checkout has no status, which is
    // still an answer worth counting rather than dropping.
    const key = (w.subscription_status as string | null) ?? "none";
    byStatus[key] = (byStatus[key] ?? 0) + 1;
  }

  const boardRows = boards.data ?? [];
  const commissionRows = commissions.data ?? [];

  return {
    funnel: steps,
    emails,
    deliveries,
    billing: {
      byStatus,
      trialsEndingSoon: (trials.data ?? []).map((t) => ({
        name: t.name as string,
        endsAt: (t.current_period_end as string | null) ?? null,
      })),
      topups: (topups.data ?? []).filter((t) => !t.refunded_at).length,
      commissions: {
        granted: commissionRows.filter((c) => !c.reversed_at).length,
        reversed: commissionRows.filter((c) => c.reversed_at).length,
      },
    },
    partner: { available: pool.data?.available ?? 0, owed: pool.data?.owed ?? 0 },
    ai: rows.map((w) => ({
      workspace: w.name as string,
      plan: w.plan as string,
      prompts: (w.prompts_used as number) ?? 0,
      credits: (w.chat_credits_used as number) ?? 0,
      extraPrompts: (w.extra_prompts as number) ?? 0,
      extraCredits: (w.extra_chat_credits as number) ?? 0,
    })),
    boards: {
      total: boardRows.length,
      neverInstalled: boardRows.filter((b) => !b.installed_at).length,
      openAllowList: boardRows.filter(
        (b) => ((b.allowed_domains as string[] | null) ?? []).length === 0,
      ).length,
    },
    errors: (errors.data ?? []).map((e) => ({
      fingerprint: e.fingerprint as string,
      kind: e.kind as string,
      message: e.message as string,
      route: (e.route as string | null) ?? null,
      count: e.count as number,
      lastSeen: e.last_seen as string,
    })),
  };
}
