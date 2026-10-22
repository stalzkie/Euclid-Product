import { describe, expect, it } from "vitest";
import type {
  AdminUser,
  AnalyticsRow,
  BoardRow,
  CommentRow,
  EndUserRow,
  Estate,
  MemberRow,
  OutboxRow,
  PostRow,
  PromptRow,
  Slice,
  VoteRow,
  WorkspaceRow,
} from "@/server/admin-data";
import {
  addressBook,
  buildIndex,
  captureSince,
  capturedStats,
  countByDay,
  daySpan,
  dayKey,
  deriveEvents,
  funnel,
  funnelRows,
  intentGaps,
  mailByKind,
  monthlyCents,
  onboardingProgress,
  pathStats,
  propBreakdown,
  queueHealth,
  recipients,
  retentionGrid,
  revenue,
  sessionStats,
  stageOf,
  stickiness,
  trend,
  weekKey,
  workspaceStages,
} from "@/server/admin-model";

/**
 * The operator console's derivations.
 *
 * Every panel on /admin is a pure function over one read of the database, so
 * this file is where the console is actually verified — the screen only shows
 * what these return. The tests are about the mistakes that would be *silent*:
 * a funnel that can exceed 100%, a yearly subscription counted as twelve
 * months of revenue, a retention grid that prints 0% for a week that has not
 * happened yet, an address attributed to the wrong person.
 */

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const slice = <T>(rows: T[] = []): Slice<T> => ({
  rows,
  truncated: false,
  error: null,
  missing: false,
});

function estate(over: Partial<Estate> = {}): Estate {
  return {
    workspaces: slice<WorkspaceRow>(),
    members: slice<MemberRow>(),
    boards: slice<BoardRow>(),
    posts: slice<PostRow>(),
    votes: slice<VoteRow>(),
    comments: slice<CommentRow>(),
    endUsers: slice<EndUserRow>(),
    prompts: slice<PromptRow>(),
    activity: slice(),
    threads: slice(),
    threadMessages: slice(),
    outbox: slice<OutboxRow>(),
    magicLinks: slice(),
    students: slice(),
    topups: slice(),
    commissions: slice(),
    referralCodes: slice(),
    grants: slice(),
    installSignals: slice(),
    apiKeys: slice(),
    integrations: slice(),
    deliveries: slice(),
    jobs: slice(),
    errors: slice(),
    captured: slice(),
    ...over,
  };
}

function workspace(over: Partial<WorkspaceRow> = {}): WorkspaceRow {
  return {
    id: "w1",
    name: "Acme",
    slug: "acme",
    plan: "free",
    billing_period: "monthly",
    app_name: null,
    app_url: null,
    coding_tools: [],
    prompts_used: 0,
    chat_credits_used: 0,
    extra_prompts: 0,
    extra_chat_credits: 0,
    usage_period_start: null,
    onboarded_at: null,
    setup_dismissed_at: null,
    polar_customer_id: null,
    polar_subscription_id: null,
    subscription_status: null,
    current_period_end: null,
    cancel_at_period_end: false,
    trial_reminder_sent_at: null,
    student_email: null,
    student_verified_at: null,
    referred_by: null,
    referred_at: null,
    created_at: "2026-01-05T10:00:00.000Z",
    ...over,
  };
}

function board(over: Partial<BoardRow> = {}): BoardRow {
  return {
    id: "b1",
    workspace_id: "w1",
    public_id: "pub1",
    name: "Roadmap",
    slug: "roadmap",
    identity_mode: "anonymous",
    allowed_domains: [],
    custom_domain: null,
    show_badge: true,
    require_approval: false,
    installed_at: null,
    created_at: "2026-01-05T11:00:00.000Z",
    ...over,
  };
}

function post(over: Partial<PostRow> = {}): PostRow {
  return {
    id: "p1",
    board_id: "b1",
    number: 1,
    title: "Dark mode",
    status: "under_review",
    category: "Feature",
    author_id: null,
    vote_count: 0,
    comment_count: 0,
    approved: true,
    spam_score: 0,
    injection_flagged: false,
    external_url: null,
    shipped_at: null,
    created_at: "2026-01-06T09:00:00.000Z",
    ...over,
  };
}

function endUser(over: Partial<EndUserRow> = {}): EndUserRow {
  return {
    id: "e1",
    board_id: "b1",
    kind: "email",
    external_key: "key-abcdef123456",
    email: "voter@example.com",
    email_verified: true,
    name: null,
    vote_weight: 1,
    created_at: "2026-01-06T08:00:00.000Z",
    ...over,
  };
}

function user(over: Partial<AdminUser> = {}): AdminUser {
  return {
    id: "u1",
    email: "founder@example.com",
    name: "Founder",
    provider: "email",
    createdAt: "2026-01-05T09:00:00.000Z",
    lastSignInAt: "2026-01-07T09:00:00.000Z",
    confirmedAt: "2026-01-05T09:05:00.000Z",
    ...over,
  };
}

const member = (over: Partial<MemberRow> = {}): MemberRow => ({
  workspace_id: "w1",
  user_id: "u1",
  role: "owner",
  name: "Founder",
  created_at: "2026-01-05T10:00:00.000Z",
  ...over,
});

const outbox = (over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: "m1",
  to_email: "someone@example.com",
  subject: "Your magic link",
  kind: "magic_link",
  attempts: 0,
  last_error: null,
  sent_at: "2026-01-06T09:01:00.000Z",
  created_at: "2026-01-06T09:00:00.000Z",
  ...over,
});

/* -------------------------------------------------------------------------- */
/* Time                                                                      */
/* -------------------------------------------------------------------------- */

describe("day and week keys", () => {
  it("buckets in UTC, so a chart does not shift by timezone", () => {
    // 23:30 UTC is "tomorrow" in Sydney, where this app's database lives. The
    // bucket must still be the UTC day or every daily count would differ
    // depending on who was reading it.
    expect(dayKey("2026-03-01T23:30:00.000Z")).toBe("2026-03-01");
    expect(dayKey("2026-03-02T00:30:00.000Z")).toBe("2026-03-02");
  });

  it("starts a week on Monday", () => {
    expect(weekKey("2026-10-22T12:00:00.000Z")).toBe("2026-10-19"); // Thursday
    expect(weekKey("2026-10-19T00:00:00.000Z")).toBe("2026-10-19"); // Monday itself
    expect(weekKey("2026-10-18T23:59:00.000Z")).toBe("2026-10-12"); // Sunday
  });

  it("spans days ending today, oldest first", () => {
    const span = daySpan(3, new Date("2026-10-22T06:00:00.000Z"));
    expect(span).toEqual(["2026-10-20", "2026-10-21", "2026-10-22"]);
  });
});

describe("countByDay", () => {
  const now = new Date("2026-10-22T06:00:00.000Z");

  it("drops anything outside the window rather than piling it on the edge", () => {
    // The bug this prevents: clamping out-of-window stamps into the first
    // bucket, which makes the oldest bar in every chart a spike.
    const points = countByDay(
      [
        "2026-10-22T01:00:00.000Z",
        "2026-10-22T05:00:00.000Z",
        "2026-10-21T10:00:00.000Z",
        "2026-01-01T10:00:00.000Z",
      ],
      3,
      now,
    );
    expect(points).toEqual([0, 1, 2]);
  });

  it("returns a zero for every day when nothing happened", () => {
    expect(countByDay([], 4, now)).toEqual([0, 0, 0, 0]);
  });
});

describe("trend", () => {
  const now = new Date("2026-10-22T06:00:00.000Z");
  const at = (iso: string) =>
    ({
      at: iso,
      kind: "post" as const,
      actor: { kind: "system" as const, email: null, label: "x", userId: null, endUserId: null },
      title: "t",
      detail: null,
      workspaceId: null,
      workspaceName: null,
      boardId: null,
      boardName: null,
      count: 1,
    });

  it("compares against the window immediately before, not all time", () => {
    const events = [
      at("2026-10-22T01:00:00.000Z"), // in window
      at("2026-10-21T01:00:00.000Z"), // in window
      at("2026-10-19T01:00:00.000Z"), // previous window
      at("2026-10-01T01:00:00.000Z"), // older than both
    ];
    const t = trend(events, ["post"], "Requests", 3, now);
    expect(t.total).toBe(2);
    expect(t.previous).toBe(1);
  });

  it("ignores kinds it was not asked for", () => {
    const events = [{ ...at("2026-10-22T01:00:00.000Z"), kind: "vote" as const }];
    expect(trend(events, ["post"], "Requests", 7, now).total).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Revenue                                                                   */
/* -------------------------------------------------------------------------- */

describe("revenue", () => {
  it("counts a yearly subscription at its per-month price", () => {
    // Billing a whole year in January does not make January worth twelve
    // months. Indie is $12 monthly and $10 a month billed yearly.
    expect(monthlyCents(workspace({ plan: "indie", billing_period: "monthly" }))).toBe(1200);
    expect(monthlyCents(workspace({ plan: "indie", billing_period: "yearly" }))).toBe(1000);
  });

  it("keeps trials and comped workspaces out of MRR", () => {
    const rows = [
      workspace({ id: "a", plan: "indie", subscription_status: "active" }),
      workspace({ id: "b", plan: "pro", subscription_status: "trialing" }),
      // A paid tier with no subscription at all: what `changePlan` leaves
      // behind while billing is unconfigured, and what the seeded workspace
      // looks like. Counted, named, and not revenue.
      workspace({ id: "c", plan: "pro", subscription_status: null }),
      workspace({ id: "d", plan: "free", subscription_status: null }),
    ];
    const r = revenue(rows);

    expect(r.mrrCents).toBe(1200);
    expect(r.payers).toBe(1);
    expect(r.trials).toBe(1);
    expect(r.trialCents).toBe(2900);
    expect(r.comped).toBe(1);
    expect(r.compedCents).toBe(2900);
    expect(r.arrCents).toBe(14400);
    expect(r.arpaCents).toBe(1200);
  });

  it("counts a cancelling subscription as revenue, and as leaving", () => {
    // It is still being paid this month. Dropping it from MRR would show the
    // churn before it happens; ignoring `cancel_at_period_end` would hide it
    // until it did.
    const r = revenue([
      workspace({ plan: "pro", subscription_status: "active", cancel_at_period_end: true }),
    ]);
    expect(r.mrrCents).toBe(2900);
    expect(r.leaving).toBe(1);
    expect(r.leavingCents).toBe(2900);
  });

  it("has no ARPA to divide when nobody pays", () => {
    expect(revenue([workspace()]).arpaCents).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Funnel                                                                    */
/* -------------------------------------------------------------------------- */

describe("the funnel over real estate rows", () => {
  const data = estate({
    workspaces: slice([
      // Reached everything.
      workspace({ id: "w1", onboarded_at: "2026-01-05T12:00:00.000Z", plan: "indie" }),
      // Onboarded, installed, but nobody has posted.
      workspace({ id: "w2", name: "Beta", onboarded_at: "2026-01-05T12:00:00.000Z" }),
      // Never onboarded, yet on a paid plan — the shape that once printed
      // "Paid 200%".
      workspace({ id: "w3", name: "Seeded", plan: "pro" }),
    ]),
    members: slice([
      member({ workspace_id: "w1", user_id: "u1" }),
      member({ workspace_id: "w2", user_id: "u2" }),
    ]),
    boards: slice([
      board({ id: "b1", workspace_id: "w1", installed_at: "2026-01-05T13:00:00.000Z" }),
      board({ id: "b2", workspace_id: "w2", installed_at: "2026-01-05T13:00:00.000Z" }),
      board({ id: "b3", workspace_id: "w3" }),
    ]),
    posts: slice([post({ id: "p1", board_id: "b1" })]),
    prompts: slice([
      {
        id: "bp1",
        workspace_id: "w1",
        post_id: "p1",
        theme_id: null,
        target: "claude",
        title: "Dark mode",
        version: 1,
        copied: true,
        token_estimate: 100,
        created_by: "u1",
        created_at: "2026-01-07T09:00:00.000Z",
      },
    ]),
  });

  const users = [
    user({ id: "u1", email: "one@example.com" }),
    user({ id: "u2", email: "two@example.com" }),
  ];
  const index = buildIndex(data, users);

  it("never lets a step exceed the one above it", () => {
    const steps = funnel(funnelRows(data, index));
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].count).toBeLessThanOrEqual(steps[i - 1].count);
    }
    expect(steps.map((s) => s.count)).toEqual([3, 2, 2, 1, 1, 1]);
  });

  it("names who stopped at each step, with an address to write to", () => {
    const steps = funnel(funnelRows(data, index));

    // The seeded workspace stops at onboarding and never reappears, even
    // though it is on a paid plan.
    expect(steps[1].stuck.map((s) => s.name)).toEqual(["Seeded"]);
    // Beta installed but never received a request.
    expect(steps[3].stuck.map((s) => s.name)).toEqual(["Beta"]);
    expect(steps[3].stuck.map((s) => s.email)).toEqual(["two@example.com"]);
    // Nobody is stuck at the first step by definition.
    expect(steps[0].stuck).toEqual([]);
  });

  it("walks posts back through their board to find the workspace", () => {
    // Posts carry a board id and nothing else. Comparing the two id columns
    // directly matches nothing and the step silently reads zero.
    const stages = workspaceStages(data, index);
    expect(stages.get("w1")?.posted).toBe(true);
    expect(stages.get("w2")?.posted).toBe(false);
  });

  it("names the furthest contiguous stage reached", () => {
    expect(
      stageOf({ onboarded: true, installed: true, posted: false, prompted: true, paid: true }),
    ).toBe("Installed");
    expect(
      stageOf({ onboarded: false, installed: false, posted: false, prompted: false, paid: true }),
    ).toBe("Signed up");
  });
});

/* -------------------------------------------------------------------------- */
/* Events                                                                    */
/* -------------------------------------------------------------------------- */

describe("deriveEvents", () => {
  const data = estate({
    workspaces: slice([workspace({ id: "w1", onboarded_at: "2026-01-05T12:00:00.000Z" })]),
    members: slice([member()]),
    boards: slice([board({ installed_at: "2026-01-05T13:00:00.000Z" })]),
    endUsers: slice([endUser({ id: "e1", email: "voter@example.com" })]),
    posts: slice([
      post({ id: "p1", author_id: "e1", created_at: "2026-01-06T09:00:00.000Z" }),
      // Authored by the founder from inside the dashboard: no end user.
      post({ id: "p2", number: 2, author_id: null, created_at: "2026-01-06T10:00:00.000Z" }),
    ]),
    votes: slice([{ post_id: "p1", end_user_id: "e1", weight: 1, created_at: "2026-01-06T09:30:00.000Z" }]),
    activity: slice([
      // A ship is already derived from `posts.shipped_at`; counting the
      // activity row too would show every ship twice.
      {
        workspace_id: "w1",
        board_id: "b1",
        post_id: "p1",
        kind: "ship",
        text: "Shipped: Dark mode",
        meta: null,
        created_at: "2026-01-08T09:00:00.000Z",
      },
      {
        workspace_id: "w1",
        board_id: "b1",
        post_id: "p1",
        kind: "merge",
        text: 'Merged "a" into "b"',
        meta: "3 votes combined",
        created_at: "2026-01-08T10:00:00.000Z",
      },
    ]),
  });

  const index = buildIndex(data, [user()]);
  const events = deriveEvents(data, index);

  it("attributes a visitor post to the visitor address", () => {
    const e = events.find((x) => x.kind === "post" && x.title.startsWith("#1"));
    expect(e?.actor.kind).toBe("visitor");
    expect(e?.actor.email).toBe("voter@example.com");
  });

  it("attributes a founder-authored post to the workspace owner", () => {
    const e = events.find((x) => x.kind === "post" && x.title.startsWith("#2"));
    expect(e?.actor.kind).toBe("founder");
    expect(e?.actor.email).toBe("founder@example.com");
    expect(e?.actor.userId).toBe("u1");
  });

  it("attributes a vote to the voter and names the board it was on", () => {
    const e = events.find((x) => x.kind === "vote");
    expect(e?.actor.email).toBe("voter@example.com");
    expect(e?.boardName).toBe("Roadmap");
    expect(e?.workspaceName).toBe("Acme");
  });

  it("takes only merges and exports from the activity table", () => {
    // Everything else there restates a row that already has its own
    // timestamp, so including it would double-count.
    expect(events.filter((e) => e.kind === "merge")).toHaveLength(1);
    expect(events.filter((e) => e.kind === "ship")).toHaveLength(0);
  });

  it("derives signup, onboarding and install without any capture", () => {
    expect(events.filter((e) => e.kind === "signup")).toHaveLength(1);
    expect(events.filter((e) => e.kind === "onboarded")).toHaveLength(1);
    expect(events.filter((e) => e.kind === "install")).toHaveLength(1);
  });

  it("comes back newest first", () => {
    const stamps = events.map((e) => e.at);
    expect([...stamps].sort((a, b) => b.localeCompare(a))).toEqual(stamps);
  });

  it("labels an anonymous visitor by the start of their key, never blank", () => {
    const anon = estate({
      workspaces: slice([workspace()]),
      boards: slice([board()]),
      endUsers: slice([endUser({ id: "e9", kind: "anonymous", email: null, name: null })]),
      posts: slice([post({ author_id: "e9" })]),
    });
    const e = deriveEvents(anon, buildIndex(anon, []))[0];
    expect(e.actor.email).toBeNull();
    expect(e.actor.label).toBe("anonymous · key-abcd");
  });
});

/* -------------------------------------------------------------------------- */
/* Retention and stickiness                                                  */
/* -------------------------------------------------------------------------- */

describe("retentionGrid", () => {
  const now = new Date("2026-10-22T06:00:00.000Z"); // week of 2026-10-19
  const event = (workspaceId: string, at: string) => ({
    at,
    kind: "post" as const,
    actor: { kind: "system" as const, email: null, label: "x", userId: null, endUserId: null },
    title: "t",
    detail: null,
    workspaceId,
    workspaceName: null,
    boardId: null,
    boardName: null,
    count: 1,
  });

  it("leaves a week that has not happened yet blank rather than zero", () => {
    // Printing 0% there makes every young cohort look churned.
    const rows = retentionGrid(
      [workspace({ id: "w1", created_at: "2026-10-20T10:00:00.000Z" })],
      [event("w1", "2026-10-20T10:00:00.000Z")],
      4,
      now,
    );
    expect(rows[0].cells[0]).toBe(1);
    expect(rows[0].cells[1]).toBeNull();
    expect(rows[0].cells[2]).toBeNull();
  });

  it("counts a workspace as retained only in weeks it did something", () => {
    const rows = retentionGrid(
      [
        workspace({ id: "w1", created_at: "2026-10-05T10:00:00.000Z" }),
        workspace({ id: "w2", created_at: "2026-10-05T11:00:00.000Z" }),
      ],
      [
        event("w1", "2026-10-05T10:00:00.000Z"),
        event("w2", "2026-10-05T11:00:00.000Z"),
        // Only w1 comes back the following week.
        event("w1", "2026-10-13T10:00:00.000Z"),
      ],
      3,
      now,
    );

    expect(rows[0].cohort).toBe("2026-10-05");
    expect(rows[0].size).toBe(2);
    expect(rows[0].cells[0]).toBe(2);
    expect(rows[0].cells[1]).toBe(1);
    expect(rows[0].cells[2]).toBe(0);
  });

  it("groups by the week a workspace was created, newest cohort first", () => {
    const rows = retentionGrid(
      [
        workspace({ id: "old", created_at: "2026-09-28T10:00:00.000Z" }),
        workspace({ id: "new", created_at: "2026-10-19T10:00:00.000Z" }),
      ],
      [],
      2,
      now,
    );
    expect(rows.map((r) => r.cohort)).toEqual(["2026-10-19", "2026-09-28"]);
  });
});

describe("stickiness", () => {
  const now = new Date("2026-10-22T06:00:00.000Z");
  const event = (workspaceId: string, at: string) => ({
    at,
    kind: "post" as const,
    actor: { kind: "system" as const, email: null, label: "x", userId: null, endUserId: null },
    title: "t",
    detail: null,
    workspaceId,
    workspaceName: null,
    boardId: null,
    boardName: null,
    count: 1,
  });

  it("counts distinct workspaces, not events", () => {
    const s = stickiness(
      [
        event("w1", "2026-10-22T01:00:00.000Z"),
        event("w1", "2026-10-22T02:00:00.000Z"),
        event("w2", "2026-10-18T02:00:00.000Z"),
        event("w3", "2026-10-01T02:00:00.000Z"),
      ],
      now,
    );
    expect(s.dau).toBe(1);
    expect(s.wau).toBe(2);
    expect(s.mau).toBe(3);
    expect(s.ratio).toBeCloseTo(1 / 3);
  });

  it("has no ratio to report with no activity", () => {
    expect(stickiness([], now)).toEqual({ dau: 0, wau: 0, mau: 0, ratio: 0 });
  });
});

/* -------------------------------------------------------------------------- */
/* Queues and addresses                                                      */
/* -------------------------------------------------------------------------- */

describe("queueHealth", () => {
  it("separates a slow drain from something actually broken", () => {
    // A backlog of fresh rows resolves itself; a backlog of attempted ones is
    // an incident. Conflating them makes the harmless case look urgent.
    const q = queueHealth([
      { sent: null, attempts: 0, created_at: "2026-10-20T09:00:00.000Z", last_error: null },
      { sent: null, attempts: 3, created_at: "2026-10-21T09:00:00.000Z", last_error: "smtp 550" },
      { sent: "2026-10-21T10:00:00.000Z", attempts: 1, created_at: "2026-10-19T09:00:00.000Z", last_error: null },
    ]);

    expect(q.queued).toBe(2);
    expect(q.failing).toBe(1);
    // The oldest *unsent* row, not the oldest row.
    expect(q.oldestQueued).toBe("2026-10-20T09:00:00.000Z");
    expect(q.lastError).toBe("smtp 550");
  });

  it("is clear when everything has gone out", () => {
    expect(
      queueHealth([
        { sent: "2026-10-21T10:00:00.000Z", attempts: 1, created_at: "x", last_error: "old" },
      ]),
    ).toEqual({ queued: 0, failing: 0, oldestQueued: null, lastError: null });
  });
});

describe("mail", () => {
  const rows = [
    outbox({ id: "1", to_email: "A@Example.com", kind: "magic_link", sent_at: "2026-10-20T09:00:00.000Z" }),
    outbox({ id: "2", to_email: "a@example.com", kind: "ship", sent_at: null, attempts: 2, last_error: "bounced", created_at: "2026-10-21T09:00:00.000Z" }),
    outbox({ id: "3", to_email: "b@example.com", kind: "ship", sent_at: "2026-10-22T09:00:00.000Z", created_at: "2026-10-22T09:00:00.000Z" }),
  ];

  it("treats one address as one recipient regardless of case", () => {
    const list = recipients(rows);
    const a = list.find((r) => r.email.toLowerCase() === "a@example.com");
    expect(a?.sent).toBe(1);
    expect(a?.queued).toBe(1);
    expect(a?.kinds).toEqual(["magic_link", "ship"]);
  });

  it("counts a failing message as queued and failing, never as sent", () => {
    const ship = mailByKind(rows).find((k) => k.kind === "ship");
    expect(ship).toMatchObject({ sent: 1, queued: 1, failing: 1 });
  });
});

describe("addressBook", () => {
  it("de-duplicates one person across every place their address appears", () => {
    const data = estate({
      workspaces: slice([workspace({ student_email: "FOUNDER@example.com" })]),
      boards: slice([board()]),
      endUsers: slice([
        endUser({ id: "e1", email: "voter@example.com", email_verified: true }),
        endUser({ id: "e2", email: "voter@example.com", email_verified: false }),
        endUser({ id: "e3", kind: "anonymous", email: null }),
      ]),
      outbox: slice([outbox({ to_email: "Voter@Example.com" })]),
      magicLinks: slice([
        {
          board_id: "b1",
          email: "voter@example.com",
          used_at: null,
          expires_at: "2026-10-23T09:00:00.000Z",
          created_at: "2026-10-22T09:00:00.000Z",
        },
      ]),
    });

    const book = addressBook(data, [user({ email: "founder@example.com" })]);

    // founder@ and voter@ — two people, six rows mentioning them.
    expect(book.total).toBe(2);
    expect(book.founders).toBe(1);
    expect(book.visitors).toBe(2);
    expect(book.verifiedVisitors).toBe(1);
    expect(book.anonymous).toBe(1);
    expect(book.recipients).toBe(1);
  });

  it("counts a login with no address as a login, not as an address", () => {
    const book = addressBook(estate(), [user({ email: null })]);
    expect(book.founders).toBe(0);
    expect(book.total).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Ownership                                                                 */
/* -------------------------------------------------------------------------- */

describe("buildIndex", () => {
  it("prefers the owner over an earlier-joined member as the workspace address", () => {
    // The address an operator wants first is the one that pays and gets the
    // e-mail, not whoever happened to join earliest.
    const data = estate({
      workspaces: slice([workspace()]),
      members: slice([
        member({ user_id: "u2", role: "member", created_at: "2026-01-01T00:00:00.000Z" }),
        member({ user_id: "u1", role: "owner", created_at: "2026-02-01T00:00:00.000Z" }),
      ]),
    });

    const index = buildIndex(data, [
      user({ id: "u1", email: "owner@example.com" }),
      user({ id: "u2", email: "member@example.com" }),
    ]);

    expect(index.ownerActor.get("w1")?.email).toBe("owner@example.com");
    expect(index.owners.get("w1")?.map((u) => u.email)).toEqual([
      "owner@example.com",
      "member@example.com",
    ]);
  });

  it("leaves a workspace with no known login without an actor rather than guessing", () => {
    const data = estate({ workspaces: slice([workspace()]), members: slice([member()]) });
    const index = buildIndex(data, []);
    expect(index.ownerActor.get("w1")).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Captured behaviour                                                        */
/* -------------------------------------------------------------------------- */

const captured = (over: Partial<AnalyticsRow> = {}): AnalyticsRow => ({
  id: 1,
  name: "screen.home",
  source: "dashboard",
  user_id: "u1",
  workspace_id: "w1",
  board_id: null,
  end_user_id: null,
  path: "/",
  session_id: "s1",
  props: {},
  created_at: "2026-10-22T05:00:00.000Z",
  ...over,
});

describe("capturedStats", () => {
  const now = new Date("2026-10-22T06:00:00.000Z");

  it("counts people, not page views", () => {
    /*
      The headline on every behaviour panel. One founder reloading the
      designer twenty times while building something is one founder, and
      reading events as people is how a screen nobody uses looks popular.
    */
    const rows = [
      captured({ id: 1, name: "screen.designer", user_id: "u1", session_id: "s1" }),
      captured({ id: 2, name: "screen.designer", user_id: "u1", session_id: "s1" }),
      captured({ id: 3, name: "screen.designer", user_id: "u1", session_id: "s2" }),
      captured({ id: 4, name: "screen.designer", user_id: "u2", session_id: "s3" }),
    ];

    const [designer] = capturedStats(rows, 7, now);
    expect(designer.events).toBe(4);
    expect(designer.people).toBe(2);
    expect(designer.sessions).toBe(3);
  });

  it("leaves out anything older than the window", () => {
    const rows = [
      captured({ id: 1, created_at: "2026-10-22T01:00:00.000Z" }),
      captured({ id: 2, created_at: "2026-08-01T01:00:00.000Z" }),
    ];
    expect(capturedStats(rows, 7, now)[0].events).toBe(1);
  });

  it("filters by name so screens and actions are separate panels", () => {
    const rows = [
      captured({ id: 1, name: "screen.install" }),
      captured({ id: 2, name: "install.snippet_copied" }),
    ];
    expect(capturedStats(rows, 7, now, (n) => n.startsWith("screen.")).map((s) => s.name)).toEqual([
      "screen.install",
    ]);
    expect(capturedStats(rows, 7, now, (n) => !n.startsWith("screen.")).map((s) => s.name)).toEqual([
      "install.snippet_copied",
    ]);
  });

  it("dates itself by the earliest row, so no panel implies more history than exists", () => {
    expect(
      captureSince([
        captured({ id: 1, created_at: "2026-10-22T01:00:00.000Z" }),
        captured({ id: 2, created_at: "2026-10-20T01:00:00.000Z" }),
      ]),
    ).toBe("2026-10-20T01:00:00.000Z");
    expect(captureSince([])).toBeNull();
  });
});

describe("sessionStats", () => {
  const now = new Date("2026-10-22T06:00:00.000Z");

  it("measures a visit in screens, not in events", () => {
    // An action is part of the visit but is not a screen, so it counts
    // towards `events` and not towards the depth of the visit.
    const rows = [
      captured({ id: 1, name: "screen.home", session_id: "s1" }),
      captured({ id: 2, name: "screen.install", session_id: "s1" }),
      captured({ id: 3, name: "install.snippet_copied", session_id: "s1" }),
      captured({ id: 4, name: "screen.home", session_id: "s2" }),
    ];

    const stats = sessionStats(rows, 7, now);
    expect(stats.sessions).toBe(2);
    expect(stats.events).toBe(4);
    expect(stats.screensPerSession).toBe(1.5);
    expect(stats.deepest).toBe(2);
  });

  it("has no average to report with nothing captured", () => {
    expect(sessionStats([], 7, now)).toEqual({
      sessions: 0,
      events: 0,
      screensPerSession: 0,
      deepest: 0,
    });
  });
});

describe("pathStats", () => {
  const now = new Date("2026-10-22T06:00:00.000Z");

  it("groups by the stored route, which already has its ids collapsed", () => {
    const rows = [
      captured({ id: 1, path: "/posts/:n", user_id: "u1" }),
      captured({ id: 2, path: "/posts/:n", user_id: "u2" }),
      captured({ id: 3, path: "/install", user_id: "u1" }),
      captured({ id: 4, path: null }),
    ];
    const stats = pathStats(rows, 7, now);
    expect(stats.map((p) => [p.name, p.events, p.people])).toEqual([
      ["/posts/:n", 2, 2],
      ["/install", 1, 1],
    ]);
  });
});

describe("propBreakdown", () => {
  it("counts how one property was answered, and names the gap", () => {
    const rows = [
      captured({ id: 1, name: "install.snippet_copied", props: { framework: "next" } }),
      captured({ id: 2, name: "install.snippet_copied", props: { framework: "next" } }),
      captured({ id: 3, name: "install.snippet_copied", props: { framework: "nocode" } }),
      // An older deploy that sent no framework at all.
      captured({ id: 4, name: "install.snippet_copied", props: {} }),
      // A different event must not be mixed in.
      captured({ id: 5, name: "screen.install", props: { framework: "vue" } }),
    ];

    const out = propBreakdown(rows, "install.snippet_copied", "framework");
    expect(out.rows).toEqual([
      { key: "next", count: 2 },
      { key: "nocode", count: 1 },
      { key: "not given", count: 1 },
    ]);
  });
});

describe("onboardingProgress", () => {
  const data = estate({
    workspaces: slice([
      // Finished, and installed.
      workspace({ id: "w1", onboarded_at: "2026-10-20T10:00:00.000Z" }),
      // Stopped on the install step.
      workspace({ id: "w2", name: "Beta" }),
      // Never got past the first screen.
      workspace({ id: "w3", name: "Gamma" }),
    ]),
    members: slice([
      member({ workspace_id: "w1", user_id: "u1" }),
      member({ workspace_id: "w2", user_id: "u2" }),
      member({ workspace_id: "w3", user_id: "u3" }),
    ]),
    boards: slice([
      board({ id: "b1", workspace_id: "w1", installed_at: "2026-10-20T11:00:00.000Z" }),
      board({ id: "b2", workspace_id: "w2" }),
    ]),
    captured: slice([
      captured({ id: 1, user_id: "u1", workspace_id: "w1", name: "onboarding.app" }),
      captured({ id: 2, user_id: "u1", workspace_id: "w1", name: "onboarding.profile" }),
      captured({ id: 3, user_id: "u1", workspace_id: "w1", name: "onboarding.install" }),
      captured({ id: 4, user_id: "u2", workspace_id: "w2", name: "onboarding.app" }),
      captured({ id: 5, user_id: "u2", workspace_id: "w2", name: "onboarding.profile" }),
      captured({ id: 6, user_id: "u3", workspace_id: "w3", name: "onboarding.app" }),
    ]),
  });

  const users = [
    user({ id: "u1", email: "one@example.com" }),
    user({ id: "u2", email: "two@example.com" }),
    user({ id: "u3", email: "three@example.com" }),
  ];
  const index = buildIndex(data, users);

  it("says which step people stopped on, which no derived panel can", () => {
    const steps = onboardingProgress(data, index, users);
    expect(steps.map((s) => `${s.label}=${s.count}`)).toEqual([
      "Seen since capture began=3",
      "Onboarding · your app=3",
      "Onboarding · project profile=2",
      "Onboarding · install=1",
      "Finished onboarding=1",
      "Installed the widget=1",
    ]);
  });

  it("names the people who stopped, with addresses", () => {
    const steps = onboardingProgress(data, index, users);
    expect(steps[2].stuck.map((p) => p.email)).toEqual(["three@example.com"]);
    expect(steps[3].stuck.map((p) => p.email)).toEqual(["two@example.com"]);
  });

  it("counts only logins seen since capture began", () => {
    // Everyone who onboarded before this shipped has no rows at all, and
    // including them would stack the product's whole history at step one.
    const steps = onboardingProgress(data, index, [
      ...users,
      user({ id: "u9", email: "ancient@example.com" }),
    ]);
    expect(steps[0].count).toBe(3);
  });

  it("takes the last two steps from state rather than from capture", () => {
    // A workspace whose founder fired every step but whose `onboarded_at` is
    // null has not finished, whatever the events say.
    const lying = estate({
      workspaces: slice([workspace({ id: "w1" })]),
      members: slice([member()]),
      captured: slice(
        ["onboarding.app", "onboarding.profile", "onboarding.install"].map((name, i) =>
          captured({ id: i + 1, name }),
        ),
      ),
    });
    const steps = onboardingProgress(lying, buildIndex(lying, [user()]), [user()]);
    expect(steps.at(-2)?.count).toBe(0);
    expect(steps.at(-1)?.count).toBe(0);
  });

  it("attributes an event sent before a workspace existed", () => {
    /*
      The route can only stamp a workspace once there is one, so the first
      onboarding event often carries none. Falling back to the membership is
      what ties that founder to their workspace afterwards — without it the
      row would show no workspace and neither state-derived step could ever
      be true for them.

      The step counts stay at zero here because the funnel is cumulative and
      this founder only fired the first step; what is asserted is the
      attribution on the row itself.
    */
    const early = estate({
      workspaces: slice([workspace({ id: "w1", onboarded_at: "2026-10-21T10:00:00.000Z" })]),
      members: slice([member()]),
      captured: slice([captured({ id: 1, workspace_id: null, name: "onboarding.app" })]),
    });
    const steps = onboardingProgress(early, buildIndex(early, [user()]), [user()]);

    const [founder] = steps[1].reached;
    expect(founder.workspace).toBe("Acme");
    expect(founder.onboarded).toBe(true);
    expect(founder.email).toBe("founder@example.com");
  });
});

describe("intentGaps", () => {
  it("names who copied the install snippet and never installed", () => {
    const data = estate({
      workspaces: slice([workspace({ id: "w1" }), workspace({ id: "w2", name: "Beta" })]),
      members: slice([
        member({ workspace_id: "w1", user_id: "u1" }),
        member({ workspace_id: "w2", user_id: "u2" }),
      ]),
      boards: slice([
        board({ id: "b1", workspace_id: "w1", installed_at: "2026-10-21T10:00:00.000Z" }),
        board({ id: "b2", workspace_id: "w2" }),
      ]),
      captured: slice([
        captured({
          id: 1,
          user_id: "u1",
          workspace_id: "w1",
          name: "install.snippet_copied",
          props: { framework: "next" },
        }),
        captured({
          id: 2,
          user_id: "u2",
          workspace_id: "w2",
          name: "install.snippet_copied",
          props: { framework: "nocode" },
        }),
      ]),
    });

    const users = [
      user({ id: "u1", email: "installed@example.com" }),
      user({ id: "u2", email: "stalled@example.com" }),
    ];
    const [copied] = intentGaps(data, buildIndex(data, users));

    expect(copied.people.map((p) => p.email)).toEqual(["stalled@example.com"]);
    expect(copied.people[0].detail).toBe("framework=nocode");
    expect(copied.people[0].workspace).toBe("Beta");
  });

  it("names who clicked upgrade and never subscribed, and leaves trials alone", () => {
    const data = estate({
      workspaces: slice([
        // Clicked and paid.
        workspace({ id: "w1", plan: "indie", subscription_status: "active" }),
        // Clicked and is on a trial: arrived, nothing owed yet.
        workspace({ id: "w2", name: "Trying", plan: "pro", subscription_status: "trialing" }),
        // Clicked and is still on free.
        workspace({ id: "w3", name: "Free" }),
        // Clicked, moved to a paid tier, and the subscription never came good.
        workspace({ id: "w4", name: "Lapsed", plan: "pro", subscription_status: "canceled" }),
      ]),
      members: slice([
        member({ workspace_id: "w1", user_id: "u1" }),
        member({ workspace_id: "w2", user_id: "u2" }),
        member({ workspace_id: "w3", user_id: "u3" }),
        member({ workspace_id: "w4", user_id: "u4" }),
      ]),
      captured: slice(
        ["w1", "w2", "w3", "w4"].map((workspaceId, i) =>
          captured({
            id: i + 1,
            user_id: `u${i + 1}`,
            workspace_id: workspaceId,
            name: "billing.upgrade_clicked",
          }),
        ),
      ),
    });

    const users = ["paid", "trying", "free", "lapsed"].map((who, i) =>
      user({ id: `u${i + 1}`, email: `${who}@example.com` }),
    );
    const [, clicked] = intentGaps(data, buildIndex(data, users));

    expect(clicked.people.map((p) => p.email).sort()).toEqual([
      "free@example.com",
      "lapsed@example.com",
    ]);
  });

  it("reports the most recent attempt when somebody tried twice", () => {
    const data = estate({
      workspaces: slice([workspace()]),
      members: slice([member()]),
      captured: slice([
        captured({
          id: 1,
          name: "billing.upgrade_clicked",
          props: { tier: "indie" },
          created_at: "2026-10-20T10:00:00.000Z",
        }),
        captured({
          id: 2,
          name: "billing.upgrade_clicked",
          props: { tier: "pro" },
          created_at: "2026-10-21T10:00:00.000Z",
        }),
      ]),
    });

    const [, clicked] = intentGaps(data, buildIndex(data, [user()]));
    expect(clicked.people).toHaveLength(1);
    expect(clicked.people[0].detail).toBe("tier=pro");
  });

  it("finds nobody when there is nothing captured", () => {
    const gaps = intentGaps(estate(), buildIndex(estate(), []));
    expect(gaps.every((g) => g.people.length === 0)).toBe(true);
  });
});

describe("captured events in the derived stream", () => {
  it("joins the one timeline, attributed to the login that sent them", () => {
    /*
      Deliberately one stream rather than two. A screen view is activity, so
      retention and stickiness should count it; a person's timeline should
      show what they looked at beside what they did; and the Events tab
      should be one list.
    */
    const data = estate({
      workspaces: slice([workspace()]),
      members: slice([member()]),
      captured: slice([
        captured({ id: 1, name: "screen.designer", path: "/designer", props: { framework: "next" } }),
      ]),
    });

    const events = deriveEvents(data, buildIndex(data, [user()]));
    const track = events.find((e) => e.kind === "track");

    expect(track?.actor.email).toBe("founder@example.com");
    expect(track?.actor.userId).toBe("u1");
    expect(track?.title).toBe("Board designer");
    expect(track?.detail).toBe("/designer · framework=next");
    expect(track?.workspaceName).toBe("Acme");
  });

  it("counts as activity for retention and stickiness", () => {
    const data = estate({
      workspaces: slice([workspace({ created_at: "2026-10-05T10:00:00.000Z" })]),
      members: slice([member()]),
      captured: slice([captured({ id: 1, created_at: "2026-10-22T05:00:00.000Z" })]),
    });

    const events = deriveEvents(data, buildIndex(data, [user()]));
    expect(stickiness(events, new Date("2026-10-22T06:00:00.000Z")).dau).toBe(1);
  });
});
