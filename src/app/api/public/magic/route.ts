import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hasServiceRole, supabaseAdmin } from "@/lib/supabase/server";
import { getPublicBoard, originAllowed } from "@/server/public-board";
import { EMAIL_COOKIE, newMagicToken } from "@/server/identity";
import { cors, preflight } from "../cors";

/**
 * Email identity for end users. Requesting a link queues an email; following
 * it sets a verified-email cookie for that board.
 *
 * This is deliberately separate from Supabase Auth: end users are the
 * founder's customers, not Euclid accounts.
 */

const Request = z.object({
  board: z.string().min(3),
  email: z.string().email(),
});

export async function POST(request: NextRequest) {
  const parsed = Request.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return cors(NextResponse.json({ error: "Enter a valid email." }, { status: 400 }));
  }
  if (!hasServiceRole()) {
    return cors(NextResponse.json({ error: "Email sign-in is not configured." }, { status: 503 }));
  }

  const board = await getPublicBoard(parsed.data.board);
  if (!board) {
    return cors(NextResponse.json({ error: "Unknown board" }, { status: 404 }));
  }
  if (!originAllowed(board, request.headers.get("origin") ?? request.headers.get("referer"))) {
    return cors(NextResponse.json({ error: "Domain not allowed" }, { status: 403 }));
  }

  const db = supabaseAdmin();
  const email = parsed.data.email.toLowerCase();

  // One link request per email per 15 minutes, so the endpoint cannot be used
  // to mail-bomb somebody.
  const { data: allowed } = await db.rpc("check_rate_limit", {
    p_board: board.id,
    p_bucket: "magic",
    p_actor: email,
    p_max: 3,
    p_window: "15 minutes",
  });
  if (allowed === false) {
    return cors(
      NextResponse.json({ error: "A link is already on its way. Check your inbox." }, { status: 429 }),
    );
  }

  const token = newMagicToken();
  const expires = new Date(Date.now() + 60 * 60 * 1000);

  await db.from("magic_links").insert({
    token,
    board_id: board.id,
    email,
    expires_at: expires.toISOString(),
  });

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const link = `${origin}/api/public/magic?token=${token}`;

  await db.from("email_outbox").insert({
    to_email: email,
    subject: `Confirm your email for ${board.appName ?? board.name}`,
    body: [
      "Tap the link below to confirm your email. It expires in an hour.",
      "",
      link,
      "",
      `You are getting this because you asked to post or vote on ${
        board.appName ?? board.name
      }'s feedback board.`,
    ].join("\n"),
    kind: "magic_link",
  });

  return cors(NextResponse.json({ ok: true, sent: true }));
}

/** Following the link. Sets the per-board verified-email cookie. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token || !hasServiceRole()) {
    return NextResponse.redirect(new URL("/", url.origin));
  }

  const db = supabaseAdmin();
  const { data: link } = await db
    .from("magic_links")
    .select("token,board_id,email,used_at,expires_at, boards(public_id)")
    .eq("token", token)
    .maybeSingle();

  if (!link || link.used_at || new Date(link.expires_at) < new Date()) {
    return NextResponse.redirect(new URL("/?magic=expired", url.origin));
  }

  await db.from("magic_links").update({ used_at: new Date().toISOString() }).eq("token", token);

  await db.from("end_users").upsert(
    {
      board_id: link.board_id,
      kind: "email",
      external_key: `email:${link.email}`,
      email: link.email,
      email_verified: true,
    },
    { onConflict: "board_id,external_key" },
  );

  const publicId = Array.isArray(link.boards)
    ? link.boards[0]?.public_id
    : (link.boards as { public_id?: string } | null)?.public_id;

  const response = NextResponse.redirect(
    new URL(publicId ? `/b/${publicId}?verified=1` : "/", url.origin),
  );
  response.cookies.set(`${EMAIL_COOKIE}_${link.board_id}`, link.email, {
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
  return response;
}

export const OPTIONS = preflight;
