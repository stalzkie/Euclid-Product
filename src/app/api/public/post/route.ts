import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  VISITOR_COOKIE,
  getPublicBoard,
  originAllowed,
  resolveViewer,
  submitPost,
} from "@/server/public-board";
import { cors, preflight } from "../cors";

const Body = z.object({
  board: z.string().min(3),
  title: z.string().min(1).max(200),
  body: z.string().max(4000).default(""),
  category: z.string().max(40).optional().nullable(),
  token: z.string().optional().nullable(),
  /** Invisible field; bots fill it in, people do not. */
  website: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return cors(NextResponse.json({ error: "Bad request" }, { status: 400 }));
  }

  const board = await getPublicBoard(parsed.data.board);
  if (!board) {
    return cors(NextResponse.json({ error: "Unknown board" }, { status: 404 }));
  }

  const origin = request.headers.get("origin") ?? request.headers.get("referer");
  if (!originAllowed(board, origin)) {
    return cors(NextResponse.json({ error: "Domain not allowed" }, { status: 403 }));
  }

  const viewer = await resolveViewer({
    board,
    cookieKey: request.cookies.get(VISITOR_COOKIE)?.value ?? null,
    token: parsed.data.token ?? null,
    email: null,
  });
  if (!viewer) {
    return cors(NextResponse.json({ error: "Could not identify you" }, { status: 401 }));
  }

  const result = await submitPost(board, viewer, {
    title: parsed.data.title,
    body: parsed.data.body,
    category: parsed.data.category ?? null,
    honeypot: parsed.data.website,
  });

  const response = cors(
    result.ok
      ? NextResponse.json(result.data)
      : NextResponse.json({ error: result.error }, { status: result.status }),
  );

  if (viewer.newCookie) {
    response.cookies.set(VISITOR_COOKIE, viewer.newCookie, {
      httpOnly: true,
      sameSite: "none",
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return response;
}

export const OPTIONS = preflight;
