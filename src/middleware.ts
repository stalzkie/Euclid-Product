import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isOwnHost } from "@/lib/domains";
import { getJwks } from "@/lib/supabase/jwks";
import {
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_DAYS,
  normaliseCode,
} from "@/lib/referrals";

/**
 * Refreshes the Supabase session cookie on navigation and keeps signed-out
 * visitors out of the dashboard. Public board pages, the widget and the
 * public API are deliberately excluded.
 */
export async function middleware(request: NextRequest) {
  const configuredApp = process.env.NEXT_PUBLIC_APP_URL;
  // Behind a proxy the Host header carries the internal hostname and the
  // real one arrives in x-forwarded-host, which is what appOrigin() already
  // reads. Disagreeing with it here would mean custom domains work in
  // development and silently stop working once deployed.
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";

  // A request whose Host is not this deployment arrived on a board's custom
  // domain. It is rewritten to the hosted board and returns here, so the
  // dashboard is never served on a customer's hostname whatever the path.
  //
  // Only when NEXT_PUBLIC_APP_URL is set: without it we cannot tell our own
  // host from anyone else's, and guessing would make the dashboard
  // unreachable rather than fail safe.
  if (configuredApp) {
    let appHost = "";
    try {
      appHost = new URL(configuredApp).host;
    } catch {
      appHost = "";
    }

    if (appHost && !isOwnHost(host, appHost)) {
      const to = request.nextUrl.clone();
      const path = request.nextUrl.pathname;
      to.pathname = `/hosted/${encodeURIComponent(host.split(":")[0].toLowerCase())}${
        path === "/" ? "" : path
      }`;
      return NextResponse.rewrite(to);
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let response = NextResponse.next({ request });

  /*
    A referral code, if one came in on the URL.

    Captured here because middleware is the only place that sees the request
    before anything renders and can still set a cookie — a server component
    cannot. It is written on every matched route rather than only on /signup,
    since a shared link may point at any page and the sign-up redirect below
    would otherwise drop the code on the way.

    First write wins: someone who arrives through one person's link and later
    clicks another's stays with the first. The alternative rewards whoever
    sends the most recent link rather than whoever actually did the
    convincing, and it lets a referrer overwrite a colleague's attribution by
    sending a link at the right moment.
  */
  const incoming = normaliseCode(request.nextUrl.searchParams.get("ref"));
  const attribute = (res: NextResponse) => {
    if (!incoming || request.cookies.get(REFERRAL_COOKIE)) return res;
    res.cookies.set(REFERRAL_COOKIE, incoming, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: REFERRAL_COOKIE_DAYS * 24 * 60 * 60,
    });
    return res;
  };

  // Before the envs are wired up, let everything through so the app can
  // render its own setup notice.
  if (!url || !anon) return attribute(response);

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // The access token is signed with an asymmetric key, so this verifies it
  // against the project's public key set in-process. An expired token is still
  // refreshed against the auth server on the way through, and the rotated
  // cookie is written to the response as before; a valid one costs nothing.
  // `getUser`, which this replaced, called the auth server on every single
  // navigation.
  const jwks = await getJwks();
  const { data } = await supabase.auth.getClaims(
    undefined,
    // supabase-js does not export its JWK type.
    jwks ? ({ jwks } as Parameters<typeof supabase.auth.getClaims>[1]) : undefined,
  );
  const signedIn = Boolean(data?.claims?.sub);
  const path = request.nextUrl.pathname;

  if (!signedIn && !path.startsWith("/signup") && !path.startsWith("/login")) {
    const to = request.nextUrl.clone();
    to.pathname = "/signup";
    to.searchParams.set("next", path);
    return attribute(NextResponse.redirect(to));
  }

  return attribute(response);
}

export const config = {
  // Dashboard and onboarding only. /b (public board), /embed, /api and the
  // widget script stay open.
  matcher: [
    "/",
    "/feedback/:path*",
    "/posts/:path*",
    "/themes/:path*",
    "/insights/:path*",
    "/prompts/:path*",
    "/changelog/:path*",
    "/designer/:path*",
    "/install/:path*",
    "/profile/:path*",
    "/billing/:path*",
    "/ask/:path*",
    // Not a founder screen, but it is still a dashboard route: without it the
    // session cookie is never refreshed here, so an operator with an expired
    // access token is bounced to /signup instead of being rotated through.
    "/admin/:path*",
    "/onboarding/:path*",
    // Added for referrals: a shared link points at /signup, which was not
    // matched before, so nothing ran there to capture the code. The auth
    // redirect above already excludes both paths, so matching them changes
    // nothing else.
    "/signup",
    "/login",
  ],
};
