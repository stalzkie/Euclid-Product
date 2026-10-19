import { plural } from "@/lib/format";
import { enqueueIntegrationEvent } from "@/server/integrations";
import { appOrigin } from "@/lib/origin";
import { supabaseAdmin, hasServiceRole } from "@/lib/supabase/server";
import { mergeDesign } from "@/lib/design-presets";
import { boardLimit } from "@/server/limits";
import { embed, postEmbeddingText } from "@/lib/ai/embeddings";
import { scanForInjection } from "@/lib/ai/safety";
import { DUPLICATE_SUGGESTION, SIMILAR_NUDGE } from "@/lib/ai/thresholds";
import {
  JwtError,
  newVisitorKey,
  segmentsFrom,
  spamScore,
  verifyJwt,
  voteWeightFor,
} from "./identity";
import type { Board, BoardDesign, PostStatus } from "@/lib/types";
import type { WidgetChangelog, WidgetPost } from "@/components/board-widget";

/**
 * The public side of a board: what the widget, the hosted page and the public
 * API read and write. Everything here runs with the service role, so each
 * function authorises the board itself — nothing trusts the caller.
 */

export const VISITOR_COOKIE = "euclid_visitor";

export interface PublicBoard {
  id: string;
  publicId: string;
  name: string;
  workspaceName: string;
  appName: string | null;
  appUrl: string | null;
  design: BoardDesign;
  identityMode: Board["identity_mode"];
  allowedDomains: string[];
  anonVoteLimit: number;
  requireApproval: boolean;
  showBadge: boolean;
  categories: string[];
  /** First time the widget was served to a page that is not one of ours. */
  installedAt: string | null;
}

export async function getPublicBoard(publicId: string): Promise<PublicBoard | null> {
  if (!hasServiceRole()) return null;

  const db = supabaseAdmin();
  const { data } = await db
    .from("boards")
    .select("*, workspaces(name, app_name, app_url)")
    .eq("public_id", publicId)
    .maybeSingle();

  if (!data) return null;

  const ws = Array.isArray(data.workspaces)
    ? data.workspaces[0]
    : (data.workspaces as { name: string; app_name: string | null; app_url: string | null } | null);

  return {
    id: data.id,
    publicId: data.public_id,
    name: data.name,
    workspaceName: ws?.name ?? data.name,
    appName: ws?.app_name ?? null,
    appUrl: ws?.app_url ?? null,
    design: mergeDesign(data.design),
    identityMode: data.identity_mode,
    allowedDomains: data.allowed_domains,
    anonVoteLimit: data.anon_vote_limit,
    requireApproval: data.require_approval,
    showBadge: data.show_badge,
    categories: data.categories,
    installedAt: data.installed_at ?? null,
  };
}

/**
 * Whether one board read should be treated as the widget going live.
 *
 * Pure, and kept separate from the write below, because this is the part with
 * the judgement in it.
 *
 * Three things it refuses to count, because the question is "is this live on
 * the founder's site" and not "has this endpoint been hit":
 *
 *   - a board already stamped, which is almost every call. The early return is
 *     what keeps the write off the hot path: one per board, ever.
 *   - a request with no Origin or Referer. A browser on a real page sends one;
 *     something without one is a script, and a script is not an install.
 *   - our own pages. The founder previewing the hosted board at /b/:id, or the
 *     designer's live preview, would otherwise mark the widget installed on a
 *     site it has never been near — the indicator would turn green while they
 *     were still reading the snippet.
 *   - loopback. See below; this one is load-bearing for `originAllowed`.
 *
 * "Installed" means **live on a real site**, not "worked once on the founder's
 * laptop", and the two are worth separating because `originAllowed` keys off
 * this column. It lets loopback past a non-empty allow-list only while the
 * board has never been served live — which is the whole point, a founder
 * testing before they deploy. If a localhost request also *stamped* the
 * board, the first such request would close the door on the second: one
 * successful local test, then 403 for the rest of the afternoon.
 *
 * So the two have to agree on what loopback means, and "still setting up" is
 * the reading that makes both correct. The cost is that the indicator stays
 * grey while a founder tests locally and turns green when they deploy, which
 * is arguably what the install screen should be confirming anyway.
 *
 * Deliberately NOT `isOwnHost`, which answers a different question: it decides
 * whether a request arrived on a custom domain, so it folds loopback in with
 * our own hostnames and treats every other subdomain as somebody else's. The
 * overlap here is a coincidence of this particular pair of rules, not a shared
 * meaning, and tying them together would couple the install signal to custom
 * domain routing.
 *
 * A preview deployment of Euclid itself still counts as an install, which is a
 * false positive worth accepting: the only person who ever opens one is us.
 */
export function countsAsInstall(
  installedAt: string | null,
  origin: string | null,
  appHost: string,
): boolean {
  // Already stamped. Almost every call lands here, which is what keeps the
  // write off the hot path: one per board, ever.
  if (installedAt) return false;

  // A browser on a real page sends one of these; something without one is a
  // script, and a script is not an install.
  if (!origin) return false;

  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }

  // Loopback is a founder still setting up, not a live install. `originAllowed`
  // depends on this: stamping here would revoke the loopback allowance that
  // let the request through in the first place.
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost")) {
    return false;
  }

  const own = appHost.split(":")[0].toLowerCase();
  return host !== own && host !== `www.${own}` && `www.${host}` !== own;
}

/**
 * Stamp the first time this board's widget was served to someone else's page.
 *
 * Called from the public board read, the widget's one round trip and so the
 * only moment the server hears from an install at all.
 *
 * Failures are swallowed. This is a progress indicator, and a board read must
 * not fail because a nicety could not be recorded.
 */
export async function noteWidgetServed(
  board: PublicBoard,
  origin: string | null,
  appHost: string,
): Promise<void> {
  if (!countsAsInstall(board.installedAt, origin, appHost)) return;

  // `is("installed_at", null)` rather than a plain update, so two first loads
  // racing each other keep the earlier stamp instead of the later one.
  const { error } = await supabaseAdmin()
    .from("boards")
    .update({ installed_at: new Date().toISOString() })
    .eq("id", board.id)
    .is("installed_at", null);

  if (error) console.error(`[install] could not stamp board ${board.id}: ${error.message}`);
}

/**
 * Domain allow-list check. An empty list means the founder has not locked the
 * board down yet, which is allowed but flagged in the dashboard.
 *
 * **This is not an authentication boundary and must never be relied on as
 * one.** `Origin` and `Referer` are set by browsers; anything that is not a
 * browser sets them to whatever it likes, so a script that wants to post to
 * this board simply sends the founder's own domain and passes. What the list
 * actually buys is that a *browser* on someone else's site cannot embed the
 * widget and write to the board — real, and worth having, and much narrower
 * than it looks.
 *
 * The controls that bound a determined caller are the ones that do not depend
 * on a header it controls: the rate limits in `limitBoth`, the spam score and
 * approval queue in `submitPost`, and the identity mode. Tightening this
 * function helps; it does not move the board behind a door.
 */
export function originAllowed(board: PublicBoard, origin: string | null): boolean {
  if (board.allowedDomains.length === 0) return true;
  if (!origin) return false;

  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (
    board.allowedDomains.some((allowed) => {
      const clean = allowed.toLowerCase().replace(/^\*\./, "");
      return host === clean || host.endsWith(`.${clean}`);
    })
  ) {
    return true;
  }

  /*
    Loopback, but only until the board has been served to a real page.

    This used to be an unconditional `return true` placed *before* the
    allow-list, which meant one header — `Origin: http://localhost` — opted any
    caller out of the list entirely, from anywhere. The board's public id is in
    the snippet on the founder's own site, so it is not a secret, and that made
    the allow-list trivially skippable by anything that was not a browser.

    The stated reason for it was "so a founder can test before deploying", and
    `installed_at` is now a record of exactly when that stops being true. A
    board that has never been served live is still being set up, and there is
    nothing on it to reach; once the widget has been seen on a real page,
    loopback is no longer a convenience, it is the easiest way in.

    A founder who genuinely develops against a live board after launch puts
    `localhost` in their allow-list, which the check above honours — saying so
    explicitly is better than a permanent hole that nobody opted into.
  */
  const loopback =
    host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
  return loopback && board.installedAt === null;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function listPublicPosts(
  boardId: string,
  viewerId: string | null,
  opts: { limit?: number; status?: PostStatus } = {},
): Promise<WidgetPost[]> {
  const db = supabaseAdmin();
  let q = db
    .from("posts")
    .select("id,number,title,body,status,vote_count,comment_count")
    .eq("board_id", boardId)
    .is("merged_into", null)
    .eq("approved", true)
    .order("vote_count", { ascending: false })
    .limit(opts.limit ?? 50);

  if (opts.status) q = q.eq("status", opts.status);

  const { data } = await q;
  const posts = data ?? [];

  // Which of these has the viewer already voted for?
  let voted = new Set<string>();
  if (viewerId && posts.length) {
    const { data: votes } = await db
      .from("votes")
      .select("post_id")
      .eq("end_user_id", viewerId)
      .in(
        "post_id",
        posts.map((p) => p.id),
      );
    voted = new Set((votes ?? []).map((v) => v.post_id));
  }

  return posts.map((p) => ({
    id: p.id,
    number: p.number,
    title: p.title,
    body: p.body,
    status: p.status as PostStatus,
    votes: p.vote_count,
    comments: p.comment_count,
    voted: voted.has(p.id),
  }));
}

export async function listPublicChangelog(boardId: string): Promise<WidgetChangelog[]> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("changelog_entries")
    .select("id,title,body,published_at")
    .eq("board_id", boardId)
    .eq("published", true)
    .order("published_at", { ascending: false })
    .limit(20);

  return (data ?? []).map((e) => ({
    id: e.id,
    title: e.title,
    body: e.body,
    publishedAt: e.published_at,
  }));
}

/* -------------------------------------------------------------------------- */
/* Viewer resolution                                                          */
/* -------------------------------------------------------------------------- */

export interface Viewer {
  id: string;
  kind: "anonymous" | "email" | "jwt";
  label: string | null;
  weight: number;
  /** Set when a new anonymous visitor key had to be minted. */
  newCookie?: string;
  /**
   * The request's rate-limit bucket for its network, or null when no proxy
   * header offered a usable address.
   *
   * Request provenance, not identity — it says where this call came from, not
   * who made it. Nothing may join on it, store it on a row, or show it to a
   * founder: it exists so a limit survives someone clearing their cookies,
   * and its one legitimate reader is `limitBoth` below.
   */
  ipKey?: string | null;
  /**
   * Why a signed token was not honoured. A board on JWT identity whose tokens
   * are being rejected looks exactly like a board with no signed-in users, so
   * the reason is surfaced rather than swallowed — otherwise a broken
   * integration is invisible until the segment analytics come back empty.
   */
  identityWarning?: string;
}

/**
 * The `external_key` the viewer's row is stored under, worked out without
 * asking the database anything.
 *
 * `resolveViewer` has to write — it creates the row for a first-time visitor —
 * so it is a round trip, and anything that waits for its result is a second
 * one. The viewer's votes do not need the row's id, only its key, and that is
 * knowable from the cookie or the token alone. Returns null when the viewer
 * cannot be named yet, which only happens for someone who has never been here
 * and therefore has no votes to find.
 */
export function externalKeyFor(
  board: PublicBoard,
  args: { cookieKey: string | null; token: string | null; email: string | null },
): string | null {
  if (args.token && board.identityMode === "jwt") {
    const secret = process.env.EUCLID_SECRET;
    if (secret) {
      try {
        return `jwt:${verifyJwt(args.token, secret).sub}`;
      } catch {
        // A token that will not verify is one `resolveViewer` will also
        // refuse; it reports the reason, this just finds no votes.
      }
    }
  }

  if (args.email) return `email:${args.email.toLowerCase()}`;
  return args.cookieKey;
}

/** Which posts on this board the viewer with that key has already voted for. */
export async function listViewerVotes(
  boardId: string,
  externalKey: string | null,
): Promise<Set<string>> {
  if (!externalKey || !hasServiceRole()) return new Set();

  const { data } = await supabaseAdmin()
    .from("votes")
    .select("post_id, end_users!inner(board_id, external_key)")
    .eq("end_users.board_id", boardId)
    .eq("end_users.external_key", externalKey);

  return new Set((data ?? []).map((v) => v.post_id as string));
}

/**
 * Everything one render of a board needs: who is looking, the posts, which of
 * them they have voted for, and the changelog.
 *
 * All four are asked for at once. They used to run in three waves — resolve
 * the viewer, then read the posts, then read the votes for those posts — and
 * against a remote database that is most of a second each, paid by every
 * person who opens the widget.
 */
export async function readBoardView(args: {
  board: PublicBoard;
  cookieKey: string | null;
  token: string | null;
  email: string | null;
  limit: number;
  changelog?: boolean;
  ipKey?: string | null;
}): Promise<{ viewer: Viewer | null; posts: WidgetPost[]; changelog: WidgetChangelog[] }> {
  const { board, cookieKey, token, email, limit } = args;
  const wantsChangelog = args.changelog ?? true;

  const [viewer, posts, voted, changelog] = await Promise.all([
    resolveViewer({ board, cookieKey, token, email, ipKey: args.ipKey }),
    listPublicPosts(board.id, null, { limit }),
    listViewerVotes(board.id, externalKeyFor(board, { cookieKey, token, email })),
    wantsChangelog ? listPublicChangelog(board.id) : Promise.resolve([]),
  ]);

  return {
    viewer,
    posts: voted.size ? posts.map((p) => ({ ...p, voted: voted.has(p.id) })) : posts,
    changelog,
  };
}

/**
 * Resolves whoever is using the board right now into an end_users row,
 * creating one if needed. The three identity levels all land here.
 */
export async function resolveViewer(args: {
  board: PublicBoard;
  cookieKey: string | null;
  token: string | null;
  email: string | null;
  ipKey?: string | null;
}): Promise<Viewer | null> {
  // Attached here rather than at each of the identify paths' four return
  // sites. The bucket has nothing to do with how someone was identified, and
  // threading it through every branch is how one branch quietly ends up
  // without it and loses its IP limit.
  const viewer = await identifyViewer(args);
  return viewer && { ...viewer, ipKey: args.ipKey ?? null };
}

async function identifyViewer(args: {
  board: PublicBoard;
  cookieKey: string | null;
  token: string | null;
  email: string | null;
}): Promise<Viewer | null> {
  const db = supabaseAdmin();

  // Signed JWT from the host app.
  let identityWarning: string | undefined;

  if (args.token && args.board.identityMode === "jwt") {
    const secret = process.env.EUCLID_SECRET;

    if (!secret) {
      identityWarning =
        "This board uses signed identity but EUCLID_SECRET is not set on the " +
        "Euclid server, so the token could not be checked.";
      console.warn(`[euclid] board ${args.board.publicId}: ${identityWarning}`);
    } else {
      let claims;
      try {
        claims = verifyJwt(args.token, secret);
      } catch (err) {
        if (!(err instanceof JwtError)) throw err;
        identityWarning = `Signed token rejected: ${err.message.toLowerCase()}.`;
        console.warn(
          `[euclid] board ${args.board.publicId}: ${identityWarning} ` +
            "Check that EUCLID_SECRET matches on both sides.",
        );
        claims = null;
      }

      if (claims) {
        return jwtViewer(args.board, claims);
      }
    }
  }

  // Verified email, from a magic link.
  if (args.email) {
    const { data } = await db
      .from("end_users")
      .upsert(
        {
          board_id: args.board.id,
          kind: "email",
          external_key: `email:${args.email.toLowerCase()}`,
          email: args.email.toLowerCase(),
          email_verified: true,
        },
        { onConflict: "board_id,external_key" },
      )
      .select("id")
      .single();

    return data
      ? {
          id: data.id,
          kind: "email",
          label: args.email.toLowerCase(),
          weight: 1,
          identityWarning,
        }
      : null;
  }

  // Anonymous, cookie-based.
  const key = args.cookieKey ?? newVisitorKey();
  const { data } = await db
    .from("end_users")
    .upsert(
      { board_id: args.board.id, kind: "anonymous", external_key: key },
      { onConflict: "board_id,external_key" },
    )
    .select("id")
    .single();

  if (!data) return null;
  return {
    id: data.id,
    kind: "anonymous",
    label: null,
    weight: 1,
    newCookie: args.cookieKey ? undefined : key,
    identityWarning,
  };
}

/** Upserts the end user a verified token describes. */
async function jwtViewer(
  board: PublicBoard,
  claims: Awaited<ReturnType<typeof verifyJwt>>,
): Promise<Viewer | null> {
  const segments = segmentsFrom(claims);
  const weight = voteWeightFor(segments.plan);

  const { data } = await supabaseAdmin()
    .from("end_users")
    .upsert(
      {
        board_id: board.id,
        kind: "jwt",
        external_key: `jwt:${claims.sub}`,
        email: claims.email ?? null,
        email_verified: Boolean(claims.email),
        name: claims.name ?? null,
        segments,
        vote_weight: weight,
      },
      { onConflict: "board_id,external_key" },
    )
    .select("id")
    .single();

  return data
    ? {
        id: data.id,
        kind: "jwt",
        label: claims.email ?? claims.name ?? null,
        weight,
      }
    : null;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export type WriteResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

/** Toggles one vote. Anonymous visitors are capped per board. */
export async function toggleVote(
  board: PublicBoard,
  viewer: Viewer,
  postId: string,
): Promise<WriteResult<{ voted: boolean; votes: number }>> {
  const db = supabaseAdmin();

  const allowed = await limitBoth(board.id, "vote", viewer, 60, 300, "1 hour");
  if (!allowed) {
    return { ok: false, error: "Too many votes too quickly. Try again shortly.", status: 429 };
  }

  const { data: post } = await db
    .from("posts")
    .select("id,board_id,merged_into")
    .eq("id", postId)
    .maybeSingle();
  if (!post || post.board_id !== board.id) {
    return { ok: false, error: "That post is not on this board.", status: 404 };
  }

  // A vote on a merged post lands on the post it merged into.
  const target = post.merged_into ?? post.id;

  // Anonymous visitors get a small allowance, so that one cookie cannot vote
  // for everything. Checked before the toggle: a visitor at the limit may
  // still remove a vote, which this count permits because removal is a
  // toggle-off of a vote they already hold.
  if (viewer.kind === "anonymous") {
    const { count } = await db
      .from("votes")
      .select("id", { count: "exact", head: true })
      .eq("end_user_id", viewer.id);
    const held = count ?? 0;

    if (held >= board.anonVoteLimit) {
      const { data: owned } = await db
        .from("votes")
        .select("id")
        .eq("post_id", target)
        .eq("end_user_id", viewer.id)
        .maybeSingle();

      if (!owned) {
        return {
          ok: false,
          error: `Anonymous visitors can vote for up to ${plural(board.anonVoteLimit, "idea")}. Sign in with email to vote for more.`,
          status: 403,
        };
      }
    }
  }

  // Toggle and count in one transaction. Reading the count in a second
  // request would let the visitor see a total that predates their own vote.
  const { data: result, error } = await db
    .rpc("toggle_vote", {
      p_post: target,
      p_user: viewer.id,
      p_weight: viewer.weight,
    })
    .maybeSingle<{ voted: boolean; vote_count: number; weighted_score: number }>();

  if (error || !result) {
    return { ok: false, error: "Could not record that vote.", status: 500 };
  }

  return { ok: true, data: { voted: result.voted, votes: result.vote_count } };
}

/** A new post from an end user, with moderation and duplicate detection. */
export async function submitPost(
  board: PublicBoard,
  viewer: Viewer,
  input: { title: string; body: string; category?: string | null; honeypot?: string },
): Promise<WriteResult<{ number: number; id: string; held: boolean }>> {
  const db = supabaseAdmin();

  // The honeypot field is invisible to people and irresistible to bots.
  if (input.honeypot && input.honeypot.trim()) {
    return { ok: false, error: "Could not post that.", status: 400 };
  }

  const title = input.title.trim();
  if (title.length < 3) {
    return { ok: false, error: "Give your idea a title first.", status: 400 };
  }
  if (title.length > 140) {
    return { ok: false, error: "Keep the title under 140 characters.", status: 400 };
  }

  const allowed = await limitBoth(board.id, "post", viewer, 5, 20, "1 hour");
  if (!allowed) {
    return {
      ok: false,
      error: "You have posted a few ideas already. Try again in an hour.",
      status: 429,
    };
  }

  const body = input.body.trim().slice(0, 4000) || null;
  const score = spamScore(title, body);
  const injection = scanForInjection(title, body);
  const held = board.requireApproval || score >= 0.8;

  const vector = await embed(postEmbeddingText(title, body));

  const { data, error } = await db
    .from("posts")
    .insert({
      board_id: board.id,
      title,
      body,
      category: input.category ?? board.categories[0] ?? null,
      author_id: viewer.id,
      embedding: vector,
      approved: !held,
      spam_score: score,
      injection_flagged: injection.flagged,
    })
    .select("id,number")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not post that.", status: 500 };
  }

  // The author's own vote, so a post never shows zero.
  await db.from("votes").insert({
    post_id: data.id,
    end_user_id: viewer.id,
    weight: viewer.weight,
  });

  // Duplicate suggestions for the founder's merge queue.
  const { data: matches } = await db.rpc("match_posts", {
    p_board: board.id,
    p_embedding: vector,
    p_exclude: data.id,
    p_threshold: DUPLICATE_SUGGESTION,
    p_limit: 4,
  });

  const nearby = (matches ?? []) as { id: string; similarity: number }[];
  if (nearby.length) {
    await db.from("duplicate_suggestions").upsert(
      nearby.map((m) => ({
        board_id: board.id,
        post_id: data.id,
        target_id: m.id,
        similarity: Number(m.similarity.toFixed(3)),
      })),
      { onConflict: "post_id,target_id", ignoreDuplicates: true },
    );
  }

  // Activity for the founder's Home screen.
  const { data: board_row } = await db
    .from("boards")
    .select("workspace_id,name")
    .eq("id", board.id)
    .single();

  if (board_row) {
    const { data: author } = await db
      .from("end_users")
      .select("email")
      .eq("id", viewer.id)
      .maybeSingle();

    await db.from("activity").insert({
      workspace_id: board_row.workspace_id,
      board_id: board.id,
      post_id: data.id,
      kind: "post",
      text: `New post: ${title}`,
      meta: `${board_row.name} · via widget · ${author?.email ?? "anonymous"}${
        held ? " · held for approval" : ""
      }`,
    });
  }

  // A held post is not public yet, so announcing it would leak a submission
  // the founder has not seen. Notify on approval instead.
  if (!held && board_row) {
    await enqueueIntegrationEvent(board.id, "post.created", {
      number: data.number,
      title,
      body: body || null,
      category: input.category ?? null,
      status: "under_review",
      votes: 1,
      url: `${await appOrigin()}/b/${board.publicId}`,
      boardName: board_row.name,
    });
  }

  return { ok: true, data: { number: data.number, id: data.id, held } };
}

export async function submitComment(
  board: PublicBoard,
  viewer: Viewer,
  postId: string,
  body: string,
): Promise<WriteResult<{ id: string }>> {
  const db = supabaseAdmin();

  const text = body.trim();
  if (text.length < 2) {
    return { ok: false, error: "Write something first.", status: 400 };
  }

  const allowed = await limitBoth(board.id, "comment", viewer, 20, 80, "1 hour");
  if (!allowed) {
    return { ok: false, error: "Slow down a moment, then try again.", status: 429 };
  }

  const { data: post } = await db
    .from("posts")
    .select("id,board_id")
    .eq("id", postId)
    .maybeSingle();
  if (!post || post.board_id !== board.id) {
    return { ok: false, error: "That post is not on this board.", status: 404 };
  }

  const { data: author } = await db
    .from("end_users")
    .select("email,name")
    .eq("id", viewer.id)
    .maybeSingle();

  const { data, error } = await db
    .from("comments")
    .insert({
      post_id: postId,
      end_user_id: viewer.id,
      author_name: author?.name ?? author?.email ?? null,
      body: text.slice(0, 4000),
      internal: false,
    })
    .select("id")
    .single();

  return error || !data
    ? { ok: false, error: error?.message ?? "Could not post that.", status: 500 }
    : { ok: true, data: { id: data.id } };
}

/**
 * Similar posts while the submitter types. This is the nudge that catches the
 * majority of repeat requests before they are posted, so it has to feel
 * instant — a suggestion that lands after the person has already hit Post is
 * worth nothing.
 *
 * Two passes: a keyword match that returns in milliseconds, and a semantic
 * match behind an embeddings round-trip. `mode` lets the caller take the fast
 * one first and the good one a moment later.
 */
export async function findSimilarForSubmitter(
  board: PublicBoard,
  viewerId: string | null,
  title: string,
  mode: "fast" | "semantic" = "semantic",
): Promise<WidgetPost[]> {
  const query = title.trim();
  if (query.length < 4) return [];

  const rows =
    mode === "fast"
      ? await keywordMatches(board.id, query)
      : await semanticMatches(board.id, query);

  return withViewerVotes(viewerId, rows);
}

/** Keyword pass: no embedding, just the words that carry meaning. */
async function keywordMatches(boardId: string, query: string): Promise<MatchRow[]> {
  const db = supabaseAdmin();

  // Short words and filler match everything, so they are dropped.
  const terms = query
    .toLowerCase()
    .match(/[a-z0-9]{4,}/g)
    ?.filter((w) => !FILLER.has(w))
    .slice(0, 6);
  if (!terms?.length) return [];

  const { data } = await db
    .from("posts")
    .select("id,number,title,status,vote_count,comment_count")
    .eq("board_id", boardId)
    .is("merged_into", null)
    .eq("approved", true)
    .or(terms.map((t) => `title.ilike.%${t}%`).join(","))
    .order("vote_count", { ascending: false })
    .limit(3);

  return (data ?? []) as MatchRow[];
}

/** Semantic pass: what actually catches a reworded duplicate. */
async function semanticMatches(boardId: string, query: string): Promise<MatchRow[]> {
  const db = supabaseAdmin();
  const vector = await embed(postEmbeddingText(query));
  const { data } = await db.rpc("match_posts", {
    p_board: boardId,
    p_embedding: vector,
    p_exclude: null,
    p_threshold: SIMILAR_NUDGE,
    p_limit: 3,
  });
  return (data ?? []) as MatchRow[];
}

/** What both passes return: everything a row needs except the viewer's vote. */
interface MatchRow {
  id: string;
  number: number;
  title: string;
  status: PostStatus;
  vote_count: number;
  comment_count: number;
}

/**
 * Marks which of the matches the viewer has already voted for. An anonymous
 * first-time visitor has none, so that case costs no query at all.
 */
async function withViewerVotes(
  viewerId: string | null,
  rows: MatchRow[],
): Promise<WidgetPost[]> {
  if (!rows.length) return [];

  let voted = new Set<string>();
  if (viewerId) {
    const { data } = await supabaseAdmin()
      .from("votes")
      .select("post_id")
      .eq("end_user_id", viewerId)
      .in(
        "post_id",
        rows.map((r) => r.id),
      );
    voted = new Set((data ?? []).map((v) => v.post_id));
  }

  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    title: r.title,
    status: r.status,
    votes: r.vote_count,
    comments: r.comment_count,
    voted: voted.has(r.id),
  }));
}

/** Words that appear in almost every feature request. */
const FILLER = new Set([
  "would", "could", "should", "please", "want", "like", "need", "make", "have",
  "that", "this", "with", "from", "when", "what", "where", "there", "their",
  "able", "also", "just", "some", "more", "much", "very", "really", "maybe",
  "feature", "request", "idea", "support", "option", "thing", "stuff",
]);

/**
 * Both keys, checked together: the visitor, and the network they came from.
 *
 * The per-viewer budget is the real one and the per-IP budget is deliberately
 * several times larger, because an address is shared in ways a cookie is not —
 * an office, a university, a phone network behind CGNAT. Setting them equal
 * would mean the second person on an office wifi is rate-limited by the first.
 *
 * `ipKey` is null in local development and anywhere no proxy sets an address
 * header. That skips the second check rather than failing: an unknown address
 * is not evidence of abuse, and one shared "unknown" bucket would limit
 * strangers against each other.
 *
 * Checked after the viewer budget so the cheaper, more specific limit answers
 * first, and so a visitor who is over their own limit does not also burn a
 * slot in the shared one.
 */
async function limitBoth(
  boardId: string,
  bucket: string,
  viewer: Viewer,
  perViewer: number,
  perIp: number,
  window: string,
): Promise<boolean> {
  if (!(await boardLimit(boardId, bucket, viewer.id, perViewer, window))) return false;
  if (!viewer.ipKey) return true;
  return boardLimit(boardId, `${bucket}_ip`, viewer.ipKey, perIp, window);
}


