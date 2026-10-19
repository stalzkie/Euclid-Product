import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { uuid } from "@/lib/validation";
import {
  VISITOR_COOKIE,
  getPublicBoard,
  originAllowed,
  resolveViewer,
  submitComment,
} from "@/server/public-board";
import { cors, preflight } from "../cors";
import { requestIpBucket } from "@/server/ip";

const Body = z.object({
  board: z.string().min(3),
  postId: uuid(),
  body: z.string().min(1).max(4000),
  token: z.string().optional().nullable(),
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
  if (!originAllowed(board, request.headers.get("origin") ?? request.headers.get("referer"))) {
    return cors(NextResponse.json({ error: "Domain not allowed" }, { status: 403 }));
  }

  const viewer = await resolveViewer({
    board,
    cookieKey: request.cookies.get(VISITOR_COOKIE)?.value ?? null,
    token: parsed.data.token ?? null,
    email: null,
    // Second rate-limit key, so a budget survives someone clearing cookies.
    ipKey: requestIpBucket(request.headers),
  });
  if (!viewer) {
    return cors(NextResponse.json({ error: "Could not identify you" }, { status: 401 }));
  }

  const result = await submitComment(board, viewer, parsed.data.postId, parsed.data.body);
  return cors(
    result.ok
      ? NextResponse.json(result.data)
      : NextResponse.json({ error: result.error }, { status: result.status }),
  );
}

export const OPTIONS = preflight;
