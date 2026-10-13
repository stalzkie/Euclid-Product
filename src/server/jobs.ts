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
        text: email.body,
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
