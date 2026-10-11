import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { BOARD_COOKIE } from "@/server/context";

/** Remembers which board the founder is looking at. */
export async function POST(request: NextRequest) {
  const { boardId } = (await request.json()) as { boardId?: string };
  if (!boardId) {
    return NextResponse.json({ error: "Missing boardId" }, { status: 400 });
  }

  // Confirm the caller actually has access before trusting the cookie later.
  const db = await supabaseServer();
  const { data } = await db.from("boards").select("id").eq("id", boardId).maybeSingle();
  if (!data) return NextResponse.json({ error: "Unknown board" }, { status: 404 });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(BOARD_COOKIE, boardId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
  return response;
}
