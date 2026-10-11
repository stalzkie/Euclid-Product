import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session cookie on navigation and keeps signed-out
 * visitors out of the dashboard. Public board pages, the widget and the
 * public API are deliberately excluded.
 */
export async function middleware(request: NextRequest) {
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
