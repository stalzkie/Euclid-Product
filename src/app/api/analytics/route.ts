import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getJwks } from "@/lib/supabase/jwks";
import { BOARD_COOKIE } from "@/server/context";
import { readBatch, recordEvents, type EventIdentity } from "@/server/analytics";
import { withinLimit } from "@/server/limits";

/**
 * Capture endpoint for the dashboard.
 *
 * The browser sends a name, a path and some properties. It does **not** send
 * who it is: the user comes from the session, the workspace and board are
 * read back under RLS, and the timestamp is the database's. A route that took
 * a `workspace_id` from its caller would let any signed-in founder write
 * events into another workspace's numbers — the same mistake the checkout
 * route is written to avoid, with the same fix.
 *
 * It answers 204 to everything it accepts and 204 to most of what it does
 * not. That is deliberate: this is called by `sendBeacon`, which reads no
 * response and retries nothing, and a 400 on a stale bundle's unknown event
 * name would be an error in a founder's console with no action behind it. The
 * body says how many rows were written for anyone debugging by hand.
 *
 * Sign-in is the one hard requirement. Capture is only reachable with a
 * session, so there is no anonymous write path into a table that spans every
 * workspace — which also means nothing before signup is captured, and the
 * top of the funnel stays derived from `workspaces.created_at`.
 */
export const dynamic = "force-dynamic";

/** The session's user, workspace and selected board — all read, never taken. */
async function identify(request: NextRequest): Promise<EventIdentity | null> {
  const supabase = await supabaseServer();

  // Verified against the project's key set in process, as the middleware does,
  // rather than by asking the auth server on every flush.
  const jwks = await getJwks();
  const { data: claimed } = await supabase.auth.getClaims(
    undefined,
    jwks ? ({ jwks } as Parameters<typeof supabase.auth.getClaims>[1]) : undefined,
  );

  let userId = typeof claimed?.claims?.sub === "string" ? claimed.claims.sub : "";
  if (!userId) {
    // Symmetric signing, or an unreadable cookie. Fall back to the
    // authoritative check rather than dropping the event.
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return null;
    userId = auth.user.id;
  }

  /*
    The selected board, read through RLS, which is what makes it safe to take
    the workspace from it: the cookie is attacker-controlled, and the query
    returns a row only if this founder can see that board. One round trip for
    both ids in the common case.
  */
  const preferred = request.cookies.get(BOARD_COOKIE)?.value;
  if (preferred) {
    const { data: board } = await supabase
      .from("boards")
      .select("id,workspace_id")
      .eq("id", preferred)
      .maybeSingle();

    if (board) {
      return {
        userId,
        workspaceId: board.workspace_id as string,
        boardId: board.id as string,
      };
    }
  }

  // No cookie, or it pointed at a board that is not theirs. The membership is
  // the fallback — and a founder part-way through onboarding has neither,
  // which is a legal row: `onboarding.*` events are exactly the ones that
  // happen before a workspace exists.
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return {
    userId,
    workspaceId: (membership?.workspace_id as string | undefined) ?? null,
    boardId: null,
  };
}

export async function POST(request: NextRequest) {
  const identity = await identify(request);
  // 204 rather than 401: a session that expired in an open tab is a normal
  // thing, and the answer to it is to lose the event quietly.
  if (!identity) return new NextResponse(null, { status: 204 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const events = readBatch(body);
  if (events.length === 0) return new NextResponse(null, { status: 204 });

  /*
    A ceiling on how fast one founder can write, not on how much they may.

    Sixty flushes a minute is far above a person reading screens and far below
    a script, which is the only separation this has to make. It fails open: a
    limiter that is down is not a reason to lose analytics, and the batch size
    already bounds what any single request can do.
  */
  if (identity.workspaceId) {
    const allowed = await withinLimit(identity.workspaceId, "analytics", identity.userId);
    if (!allowed) return new NextResponse(null, { status: 204 });
  }

  const written = await recordEvents(identity, events);
  return NextResponse.json({ written }, { status: 200 });
}
