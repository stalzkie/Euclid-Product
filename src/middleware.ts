import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isOwnHost } from "@/lib/domains";

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

  // Before the envs are wired up, let everything through so the app can
  // render its own setup notice.
  if (!url || !anon) return response;

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

  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;

  if (!data.user && !path.startsWith("/signup") && !path.startsWith("/login")) {
    const to = request.nextUrl.clone();
    to.pathname = "/signup";
    to.searchParams.set("next", path);
    return NextResponse.redirect(to);
  }

  return response;
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
    "/onboarding/:path*",
  ],
};
