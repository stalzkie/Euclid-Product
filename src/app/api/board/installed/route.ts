import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin, hasServiceRole } from "@/lib/supabase/server";

/**
 * Has the widget been served to a real page yet? The install screen polls this
 * so a successful install needs no refresh.
 *
 * "A real page" means one that is not ours: the founder previewing their own
 * hosted board does not count. `noteWidgetServed` is where that is decided.
 */
export async function GET(request: NextRequest) {
  const publicId = new URL(request.url).searchParams.get("board");
  if (!publicId || !hasServiceRole()) {
    return NextResponse.json({ installed: false });
  }

  const db = supabaseAdmin();

  /*
    `installed_at`, stamped by the public board read the first time the widget
    is served to someone else's page. See 0024_board_installed.sql.

    This used to count rate_limits rows with `bucket = "load"` — a bucket
    nothing has ever written, so the poll could only answer false and the
    indicator never turned green on its own. It was also the wrong place to
    keep the answer: 0023 prunes that table after a day, so an install would
    have expired over a quiet weekend.
  */
  const { data: board } = await db
    .from("boards")
    .select("installed_at")
    .eq("public_id", publicId)
    .maybeSingle();

  return NextResponse.json({ installed: Boolean(board?.installed_at) }, {
    headers: { "Cache-Control": "no-store" },
  });
}
