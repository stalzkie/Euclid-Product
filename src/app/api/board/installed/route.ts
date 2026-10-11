import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin, hasServiceRole } from "@/lib/supabase/server";

/**
 * Has the widget been served to a real page yet? The install screen polls this
 * so a successful install needs no refresh.
 */
export async function GET(request: NextRequest) {
  const publicId = new URL(request.url).searchParams.get("board");
  if (!publicId || !hasServiceRole()) {
    return NextResponse.json({ installed: false });
  }

  const db = supabaseAdmin();
  const { data: board } = await db
    .from("boards")
    .select("id")
    .eq("public_id", publicId)
    .maybeSingle();
  if (!board) return NextResponse.json({ installed: false });

  // A served widget writes a rate-limit row under the "load" bucket.
  const { count } = await db
    .from("rate_limits")
    .select("id", { count: "exact", head: true })
    .eq("board_id", board.id)
    .eq("bucket", "load");

  return NextResponse.json({ installed: (count ?? 0) > 0 }, {
    headers: { "Cache-Control": "no-store" },
  });
}
