import { supabaseAdmin } from "@/lib/supabase/server";
import { embed, postEmbeddingText } from "@/lib/ai/embeddings";
import { generateDigest } from "@/lib/ai/clustering";
import { hasAnthropic } from "@/lib/ai/client";
import { retryAfter, retriesLeft } from "@/lib/retry";

/**
 * Background work. Anything slow or expensive runs here so board reads stay
 * fast: email sending, embedding backfill, and the weekly recommendation.
 */

export interface EmailResult {
  sent: number;
  failed: number;
}

/** One claimed row, as `claim_queued_emails` returns it. */
interface ClaimedEmail {
  id: string;
  to_email: string;
  subject: string;
  body: string;
  html: string | null;
  reply_to: string | null;
  kind: string;
  attempts: number;
}

/**
 * Drains the email outbox. Without a provider configured it logs instead of
 * sending, so the loop is testable end to end before a mailer exists.
 *
 * Rows are claimed rather than selected. `drainAfterResponse` runs on every
 * post, magic link and changelog publish, so two overlapping requests could
 * otherwise pick up the same unsent row and both send it — two sign-in links
 * to one person, or the same voter told twice that their request shipped.
 *
 * A failure is left with a backoff rather than retried on the very next pass,
 * which is what makes recovery independent of how often the scheduler runs.
 * `src/lib/retry.ts` holds the schedule and the reasoning behind it.
 */
export async function sendQueuedEmails(limit = 50): Promise<EmailResult> {
  const db = supabaseAdmin();
  const { data: claimed } = await db.rpc("claim_queued_emails", { p_limit: limit });
  const batch = (claimed ?? []) as ClaimedEmail[];

  if (!batch.length) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;

  for (const email of batch) {
    const outcome = await deliver(email);

    if (outcome.ok) {
      await db
        .from("email_outbox")
        .update({ sent_at: new Date().toISOString(), last_error: null })
        .eq("id", email.id);
      sent += 1;
      continue;
    }

    failed += 1;

    // The claim already counted this attempt, so `attempts` includes the one
    // that just failed. Past the limit the row stops being claimable and the
    // error it died of is what is left behind: there is nothing to deactivate
    // the way a dead webhook deactivates its integration, and a mailbox that
    // has refused five times is not one more attempt away from working.
    await db
      .from("email_outbox")
      .update({
        last_error: outcome.error.slice(0, 500),
        deliver_after: retryAfter(email.attempts),
      })
      .eq("id", email.id);

    if (!retriesLeft(email.attempts)) {
      console.warn(
        `[euclid] email abandoned after ${email.attempts} attempts: ${outcome.error}`,
      );
    }
  }

  return { sent, failed };
}

/** What one attempt did. The reason is stored, so it has to come back. */
type Delivery = { ok: true } | { ok: false; error: string };

/**
 * One delivery. Resend is the provider when RESEND_API_KEY is set; otherwise
 * the email is logged and marked sent, which keeps local development honest
 * about what would have gone out.
 */
async function deliver(email: {
  to_email: string;
  subject: string;
  body: string;
  html?: string | null;
  reply_to?: string | null;
}): Promise<Delivery> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!key || !from) {
    console.info(
      `[euclid] email not sent (no provider configured)\n  to: ${email.to_email}\n  subject: ${email.subject}`,
    );
    return { ok: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        from,
        to: email.to_email,
        subject: email.subject,
        /*
          Always both parts when there is an HTML one.

          A message carrying only HTML is a spam signal in its own right, and
          some clients still prefer text — so `text` stays the canonical copy
          and `html` is added beside it rather than instead of it. A row with
          no html sends exactly as it did before, which is what keeps the
          magic link plain.
        */
        text: email.body,
        ...(email.html ? { html: email.html } : {}),
        // A transactional mail a human answers is one of the stronger signals
        // against Gmail filing it under Promotions, and the sign-off promises
        // exactly that. See 0029_email_html.sql.
        ...(email.reply_to ? { reply_to: email.reply_to } : {}),
      }),
    });
    if (!res.ok) {
      const error = `${res.status} ${await res.text()}`;
      console.warn(`[euclid] email failed: ${error}`);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (err) {
    console.warn("[euclid] email failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Backfills embeddings for posts that have none — posts written before an
 * embeddings provider was configured, or whose text changed.
 */
export async function backfillEmbeddings(boardId: string, limit = 50): Promise<number> {
  const db = supabaseAdmin();
  const { data: posts } = await db
    .from("posts")
    .select("id,title,body")
    .eq("board_id", boardId)
    .is("embedding", null)
    .limit(limit);

  let done = 0;
  for (const post of posts ?? []) {
    const vector = await embed(postEmbeddingText(post.title, post.body));
    await db.from("posts").update({ embedding: vector }).eq("id", post.id);
    done += 1;
  }
  return done;
}

/**
 * The weekly digest. Ranks what to build next with reasons, and links each
 * reason back to its source posts.
 */
export async function buildWeeklyDigest(boardId: string): Promise<boolean> {
  if (!hasAnthropic()) return false;

  const db = supabaseAdmin();

  const { data: themeRows } = await db
    .from("themes")
    .select("id,name,posts(id,vote_count,comment_count)")
    .eq("board_id", boardId);

  const { data: postRows } = await db
    .from("posts")
    .select("id,number,title,vote_count")
    .eq("board_id", boardId)
    .is("merged_into", null)
    .eq("approved", true)
    .order("vote_count", { ascending: false })
    .limit(8);

  if (!postRows?.length) return false;

  const { data: velocity } = await db.rpc("post_vote_velocity", {
    p_board: boardId,
    p_days: 7,
  });
  const recentById = new Map(
    ((velocity ?? []) as { post_id: string; recent: number }[]).map((v) => [
      v.post_id,
      Number(v.recent),
    ]),
  );

  const topPosts: {
    number: number;
    title: string;
    votes: number;
    payingShare: number;
    recent: number;
  }[] = [];
  for (const post of postRows) {
    const { data: share } = await db.rpc("post_paying_share", { p_post: post.id });
    topPosts.push({
      number: post.number,
      title: post.title,
      votes: post.vote_count,
      payingShare: Number(share ?? 0),
      recent: recentById.get(post.id) ?? 0,
    });
  }

  const themes = (themeRows ?? []).map((t) => {
    const posts = (t.posts as { vote_count: number }[] | null) ?? [];
    return {
      name: t.name,
      votes: posts.reduce((a, p) => a + p.vote_count, 0),
      posts: posts.length,
      payingShare: 0,
      growth: 0,
    };
  });

  // Comments that read like churn risk sharpen the recommendation.
  const { data: churn } = await db
    .from("comments")
    .select("body, posts!inner(board_id)")
    .eq("posts.board_id", boardId)
    .eq("internal", false)
    .or(
      "body.ilike.%cancel%,body.ilike.%switch%,body.ilike.%leave%,body.ilike.%refund%",
    )
    .limit(6);

  try {
    const digest = await generateDigest({
      themes: themes.sort((a, b) => b.votes - a.votes).slice(0, 6),
      topPosts,
      churnSignals: (churn ?? []).map((c) => c.body),
    });

    const sources = digest.source_post_numbers
      .map((number) => topPosts.find((p) => p.number === number))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({ number: p.number, title: p.title }));

    await db.from("recommendations").insert({
      board_id: boardId,
      headline: digest.headline,
      reasons: digest.reasons,
      source_posts: sources,
      theme_id: null,
    });

    return true;
  } catch (err) {
    console.warn("[euclid] digest failed:", err);
    return false;
  }
}

/* --------------------------------------------------------------------------
 * Trials ending
 *
 * Polar's trial checkout collects no card — verified on production, where
 * starting a real trial asked only for an email and a country while the $5
 * top-up checkout a minute later asked for a card. There is no "require
 * payment method" setting on the product to change that.
 *
 * So every trial arrives at day 7 with nothing to charge. Polar fails the
 * payment, moves the subscription to `past_due`, retries for a few days and
 * then revokes it. `ENTITLED` deliberately keeps the founder's features on
 * through `past_due`, which is right for an expiring card and wrong here: it
 * means the whole thing happens silently and the workspace is simply on free
 * one morning.
 *
 * This is the one message that interrupts that. It is not marketing — it is
 * the only notice a founder gets that the thing they are using is about to
 * stop.
 * ------------------------------------------------------------------------ */

/**
 * How long before the end of a trial to send the reminder.
 *
 * Two days on a seven-day trial: long enough to act on a weekday, late enough
 * that the trial has been used rather than arriving before the founder has
 * seen the product. A longer window on a trial this short would land while
 * they are still setting up, which reads as a sales email rather than a
 * warning.
 */
const TRIAL_REMINDER_HOURS = 48;

export interface TrialReminderResult {
  queued: number;
  skipped: number;
}

/**
 * Queue "your trial is ending" for every trial inside the window.
 *
 * Deliberately does not send: the row goes in `email_outbox` like every other
 * message and the existing drain delivers it, so retries, backoff and the
 * abandon-after-five-attempts rule are inherited rather than reimplemented.
 *
 * Nothing here reads a founder's email from a table, because no table has it
 * — the session is the only place it normally appears. The admin API is the
 * supported way to ask, and it is asked once per workspace, only for
 * workspaces already inside the window.
 */
export async function remindExpiringTrials(origin: string): Promise<TrialReminderResult> {
  const db = supabaseAdmin();
  const now = Date.now();
  const cutoff = new Date(now + TRIAL_REMINDER_HOURS * 60 * 60 * 1000).toISOString();

  const { data: due } = await db
    .from("workspaces")
    .select("id,name,plan,current_period_end")
    .eq("subscription_status", "trialing")
    // Someone who has already cancelled knows the plan is ending; telling them
    // to add a card to keep it would be arguing with a decision they made.
    .eq("cancel_at_period_end", false)
    .is("trial_reminder_sent_at", null)
    .gt("current_period_end", new Date(now).toISOString())
    .lte("current_period_end", cutoff);

  let queued = 0;
  let skipped = 0;

  for (const workspace of due ?? []) {
    const email = await founderEmail(workspace.id);
    if (!email) {
      // No reachable owner. Left unmarked on purpose: if the membership is
      // repaired tomorrow the reminder can still go out, and a trial with
      // nobody to tell is worth noticing rather than silently skipping.
      console.warn(`[euclid] trial ending for ${workspace.id} but no founder email found`);
      skipped += 1;
      continue;
    }

    const ends = workspace.current_period_end
      ? new Date(workspace.current_period_end).toUTCString()
      : "in the next couple of days";

    await db.from("email_outbox").insert({
      to_email: email,
      subject: `Your Euclid trial ends ${workspace.current_period_end ? "soon" : "shortly"}`,
      body: [
        `Your ${workspace.name} trial ends ${ends}.`,
        "",
        "Euclid does not have a card for you yet — the trial did not ask for",
        "one — so nothing will be charged, and the workspace will drop to the",
        "free plan when the trial runs out. Boards stay up on free; the",
        "allowances get smaller.",
        "",
        "To stay on your current plan, add a card here:",
        `${origin}/billing`,
        "",
        "If you would rather not continue, you do not need to do anything.",
      ].join("\n"),
      kind: "trial_ending",
    });

    await db
      .from("workspaces")
      .update({ trial_reminder_sent_at: new Date().toISOString() })
      .eq("id", workspace.id);

    queued += 1;
  }

  return { queued, skipped };
}

/**
 * The owner's email address, from Supabase auth.
 *
 * `workspace_members` carries a user id and a display name but no address, and
 * `context.ts` reads the email off the session — which a scheduled job does
 * not have. Falls back to any member when there is no owner, because a
 * workspace with one non-owner member is still somebody's trial.
 */
async function founderEmail(workspaceId: string): Promise<string | null> {
  const db = supabaseAdmin();

  const { data: members } = await db
    .from("workspace_members")
    .select("user_id,role")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  const ordered = [...(members ?? [])].sort((a, b) =>
    a.role === "owner" ? -1 : b.role === "owner" ? 1 : 0,
  );

  for (const member of ordered) {
    const { data, error } = await db.auth.admin.getUserById(member.user_id);
    if (error) continue;
    const email = data.user?.email;
    if (email) return email;
  }

  return null;
}
