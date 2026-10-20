import { NextResponse, type NextRequest } from "next/server";
import { getFounderContext } from "@/server/context";
import { supabaseServer } from "@/lib/supabase/server";
import type { InstallSignal } from "@/lib/install-doctor";

/**
 * What the server has seen of this board's install, and why it has not
 * happened. The install screen polls this instead of `/api/board/installed`.
 *
 * SIGNED IN, UNLIKE THE POLL IT REPLACES
 *
 * `/api/board/installed` answers a bare boolean for any public board id and
 * needs no session, which is fine for a boolean. This answers with hostnames —
 * a staging domain, an internal tool's address, whatever the founder has the
 * widget on — and the board's public id is in the snippet on their own site,
 * so it is known to anyone who views source. Serving this to that audience
 * would turn a public identifier into a list of the founder's infrastructure.
 *
 * So: a session, and a board that belongs to it. The board is matched against
 * the founder's own list rather than queried by the id in the request, which
 * is the same rule the rest of the dashboard follows — an id in a request is
 * a claim, not a permission.
 */
export async function GET(request: NextRequest) {
  const ctx = await getFounderContext();
  if (!ctx) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const publicId = new URL(request.url).searchParams.get("board");
  const board = ctx.boards.find((b) => b.public_id === publicId);
  if (!board) {
    return NextResponse.json({ error: "Unknown board." }, { status: 404 });
  }

  // Through the session client, so `install_signals_read` is what authorises
  // the read rather than this route being the only thing standing between a
  // caller and the table.
  const db = await supabaseServer();
  const { data } = await db
    .from("install_signals")
    .select("origin,reason,count,last_seen")
    .eq("board_id", board.id)
    .order("last_seen", { ascending: false })
    // The cap in `note_install_signal` is 10, so this can only trim a board
    // whose rows predate it. Here anyway: a query with no limit is a query
    // waiting for a reason to be slow.
    .limit(10);

  const signals: InstallSignal[] = (data ?? []).map((row) => ({
    origin: row.origin as string,
    reason: row.reason as InstallSignal["reason"],
    count: row.count as number,
    lastSeen: row.last_seen as string,
  }));

  return NextResponse.json(
    { installed: board.installed_at !== null, signals },
    { headers: { "Cache-Control": "no-store" } },
  );
}
