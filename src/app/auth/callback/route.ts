import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { destinationFor } from "@/server/auth";

/**
 * Where every sign-in lands. Supabase hands the session back in one of two
 * shapes depending on the flow:
 *
 *   PKCE     — `?code=...` in the query, exchanged here.
 *   Implicit — `#access_token=...` in the fragment, which never reaches a
 *              server at all, so the browser has to finish the job.
 *
 * This is a route handler and not a page for one reason: exchanging the code
 * produces session cookies, and a Server Component render cannot set a cookie.
 * As a page it established the session, silently failed to persist it, sent
 * the founder to the dashboard, and the next request — carrying no session —
 * bounced them back to sign-up.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = params.get("next");

  const failure = params.get("error_description") ?? params.get("error");
  if (failure) return toSignup(request, failure);

  const code = params.get("code");

  if (!code) {
    // No code: the token is in the fragment. Browsers carry a fragment across
    // a redirect whose Location has none of its own, so it survives this hop
    // and the page on the other side can read it.
    const to = request.nextUrl.clone();
    to.pathname = "/auth/hash";
    to.search = next ? `?next=${encodeURIComponent(next)}` : "";
    return NextResponse.redirect(to);
  }

  /*
    The session cookies arrive during the exchange but the destination is not
    known until after it, so they are collected here and written onto the
    redirect once there is one to write them onto.
  */
  const pending: { name: string; value: string; options: CookieOptions }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        // Reading matters as much as writing: the PKCE verifier was stored by
        // the browser when the sign-in started, and the exchange fails
        // without it.
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          pending.push(...list);
        },
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return toSignup(request, error.message);

  // This client holds the new session; a fresh one built from `cookies()`
  // would not, because the cookies are still sitting in `pending`.
  const to = request.nextUrl.clone();
  to.pathname = await destinationFor(next, supabase);
  to.search = "";

  const response = NextResponse.redirect(to);
  for (const { name, value, options } of pending) {
    response.cookies.set(name, value, options);
  }

  return response;
}

/** Back to sign-up, carrying the reason so the page can show it. */
function toSignup(request: NextRequest, reason: string) {
  const to = request.nextUrl.clone();
  to.pathname = "/signup";
  to.search = `?error=${encodeURIComponent(reason)}`;
  return NextResponse.redirect(to);
}
