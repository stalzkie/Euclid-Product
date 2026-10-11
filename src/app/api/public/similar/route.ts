import { NextResponse, type NextRequest } from "next/server";
import {
  VISITOR_COOKIE,
  findSimilarForSubmitter,
  getPublicBoard,
  originAllowed,
  resolveViewer,
} from "@/server/public-board";
import { cors, preflight } from "../cors";

/**
 * Similar posts while the submitter types. This is the nudge that stops most
 * duplicates before they are posted, so it has to be fast and forgiving.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const publicId = url.searchParams.get("board");
  const title = url.searchParams.get("title") ?? "";
  if (!publicId) {
    return cors(NextResponse.json({ posts: [] }));
  }

  const board = await getPublicBoard(publicId);
  if (!board) return cors(NextResponse.json({ posts: [] }));
  if (!originAllowed(board, request.headers.get("origin") ?? request.headers.get("referer"))) {
    return cors(NextResponse.json({ posts: [] }));
  }

  const viewer = await resolveViewer({
    board,
    cookieKey: request.cookies.get(VISITOR_COOKIE)?.value ?? null,
    token: url.searchParams.get("token"),
    email: null,
  });

  const mode = url.searchParams.get("mode") === "fast" ? "fast" : "semantic";
  const posts = await findSimilarForSubmitter(board, viewer?.id ?? null, title, mode);
  return cors(NextResponse.json({ posts }));
}

export const OPTIONS = preflight;
