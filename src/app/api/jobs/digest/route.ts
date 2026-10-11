import { NextResponse, type NextRequest } from "next/server";
import { hasServiceRole, supabaseAdmin } from "@/lib/supabase/server";
import { backfillEmbeddings, buildWeeklyDigest } from "@/server/jobs";
import { authorizeCron } from "@/server/cron";

/**
 * The weekly digest, for every board on a plan that includes it. Point a
 * weekly cron at this.
 */
export async function POST(request: NextRequest) {
  const auth = authorizeCron(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!hasServiceRole()) {
    return NextResponse.json({ error: "No service role configured" }, { status: 503 });
  }

  const db = supabaseAdmin();
  const { data: boards } = await db
    .from("boards")
    .select("id, workspaces!inner(plan)")
    .in("workspaces.plan", ["pro"]);

  let built = 0;
  let embedded = 0;
  for (const board of boards ?? []) {
    embedded += await backfillEmbeddings(board.id, 100);
    if (await buildWeeklyDigest(board.id)) built += 1;
  }

  return NextResponse.json({ ok: true, digests: built, embeddings: embedded });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
