import { NextResponse, type NextRequest } from "next/server";
import { hasServiceRole } from "@/lib/supabase/server";
import { redeemStudentVerification } from "@/server/student";
import { appOrigin } from "@/lib/origin";

/**
 * Redeem a student verification link.
 *
 * No session required, and that is deliberate: the student may open the link in
 * whichever browser their school mail is in, and the operator approving a
 * review certainly will. The token *is* the authorisation — it is single-use,
 * expiring, and was only ever sent to the address being proved.
 *
 * It names the workspace it verifies, so a leaked token cannot be pointed at
 * somebody else's.
 */
export async function GET(request: NextRequest) {
  const base = await appOrigin();
  const token = request.nextUrl.searchParams.get("token");

  if (!token || !hasServiceRole()) {
    return NextResponse.redirect(`${base}/billing?student=failed`);
  }

  const workspace = await redeemStudentVerification(token);

  // Unknown, expired and already-used all land here and look identical, which
  // is intended: distinguishing them tells a stranger which tokens exist.
  return NextResponse.redirect(`${base}/billing?student=${workspace ? "verified" : "failed"}`);
}
