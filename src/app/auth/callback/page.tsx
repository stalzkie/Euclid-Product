import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { destinationFor } from "@/server/auth";
import { HashCallback } from "./hash-callback";

/**
 * Where every sign-in lands. Supabase hands the session back in one of two
 * shapes depending on the flow:
 *
 *   PKCE     — `?code=...` in the query, exchanged here on the server.
 *   Implicit — `#access_token=...` in the fragment, which never reaches the
 *              server, so a small client component finishes the job.
 *
 * Handling both means a link works whether it came from the sign-in form, an
 * OAuth provider, or an admin-generated link.
 */
export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; next?: string; error?: string; error_description?: string }>;
}) {
  const params = await searchParams;

  if (params.error) {
    redirect(`/signup?error=${encodeURIComponent(params.error_description ?? params.error)}`);
  }

  if (params.code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) {
      redirect(`/signup?error=${encodeURIComponent(error.message)}`);
    }
    redirect(await destinationFor(params.next));
  }

  // No code in the query: the token is in the fragment, which only the browser
  // can read. Hand over to the client.
  return <HashCallback next={params.next ?? null} />;
}

