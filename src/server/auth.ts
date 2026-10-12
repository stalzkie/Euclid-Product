import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Where a freshly signed-in founder belongs: the dashboard if they already
 * have a workspace, onboarding if this is their first visit.
 *
 * `client` exists for the one caller that has just created a session whose
 * cookies have not been written yet — the auth callback. Building a fresh
 * client there would read the request's cookies, which do not include the
 * session, and send a founder who just signed in back to sign-up.
 */
export async function destinationFor(
  next?: string | null,
  client?: SupabaseClient,
): Promise<string> {
  const supabase = client ?? (await supabaseServer());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return "/signup";

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", auth.user.id)
    .limit(1)
    .maybeSingle();

  return membership ? (next || "/") : "/onboarding/app";
}
