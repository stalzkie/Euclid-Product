import { NextResponse, type NextRequest } from "next/server";
import {
  VISITOR_COOKIE,
  getPublicBoard,
  originAllowed,
  readBoardView,
} from "@/server/public-board";
import { cors, preflight } from "../cors";

/**
 * The widget's one read: design config, posts, changelog and who the viewer
 * is. Everything the board needs to render in a single round trip.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const publicId = url.searchParams.get("board");
  if (!publicId) {
    return cors(NextResponse.json({ error: "Missing board" }, { status: 400 }));
  }

  const board = await getPublicBoard(publicId);
  if (!board) {
    return cors(NextResponse.json({ error: "Unknown board" }, { status: 404 }));
  }

  const origin = request.headers.get("origin") ?? request.headers.get("referer");
  if (!originAllowed(board, origin)) {
    return cors(
      NextResponse.json(
        { error: "This board is not allowed to load on that domain." },
        { status: 403 },
      ),
    );
  }

  const { viewer, posts, changelog } = await readBoardView({
    board,
    cookieKey: request.cookies.get(VISITOR_COOKIE)?.value ?? null,
    token: url.searchParams.get("token"),
    email: null,
    limit: 60,
    changelog: board.design.showChangelog,
  });

  const response = cors(
    NextResponse.json({
      board: {
        publicId: board.publicId,
        name: board.name,
        appName: board.appName,
        design: board.design,
        showBadge: board.showBadge,
        categories: board.categories,
        identityMode: board.identityMode,
      },
      viewer: viewer
        ? {
            kind: viewer.kind,
            label: viewer.label,
            // Present only when a signed token was offered and not honoured.
            warning: viewer.identityWarning ?? null,
          }
        : { kind: "anonymous", label: null, warning: null },
      posts,
      changelog,
    }),
  );

  if (viewer?.newCookie) {
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
