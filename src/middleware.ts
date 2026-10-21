import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isOwnHost } from "@/lib/domains";
import { getJwks } from "@/lib/supabase/jwks";
import {
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_DAYS,
  normaliseCode,
} from "@/lib/referrals";
import {
  PROMO_COOKIE,
  PROMO_COOKIE_DAYS,
  normalisePromo,
  shouldWritePromo,
} from "@/lib/polar";

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
    What came in on the URL and has to outlive it: a referral code, and the
    launch promotion.

    Captured here because middleware is the only place that sees the request
    before anything renders and can still set a cookie — a server component
    cannot. Both are written on every matched route rather than only on
    /signup, since a shared link may point at any page and the sign-up
    redirect below would otherwise drop the value on the way.

    That last sentence was written for referrals and was true of the promotion
    the whole time nothing carried it: `?promo=indie3` on a marketing link
    reached `/api/billing/checkout`, which redirects a signed-out visitor to
    /setup, and the promotion was lost with no trace — the founder paid list
    price and no Bernn code was ever granted. Every return path below goes
    through `carry`, which is what makes that unrepeatable.

    First write wins for referrals. That is a fairness rule: someone who
    arrives through one person's link and later clicks another's stays with
    the first, so a referrer cannot overwrite a colleague's attribution by
    sending a link at the right moment.

    The promotion is not the same rule, and the sentence that used to be here
    said why without noticing: "it barely matters, since there is only one".
    There are two now, and it matters. A founder on the waitlist who had
    clicked a 4-for-3 link at any point in the previous thirty days opened
    their free-month e-mail, arrived with `?promo=waitlist`, and was shown
    the launch offer — the cookie still said `indie3` and first-write-wins
    kept it there. The e-mail promised a month at zero and the billing page
    offered 25% off, which is the one failure this capture exists to prevent.

    So: a *different* promotion overwrites, and the same one does not. The
    first half honours the most recent thing the founder was actually
    promised, which is what the link they just clicked says. The second half
    keeps the original reason intact — re-writing on every visit would
    quietly extend the window for anyone who keeps clicking the same link,
    and the window is meant to be the window.

    The rule itself is `shouldWritePromo`, in polar.ts, so that it can be
    stated once and tested. It lived here as a condition and was wrong for a
    day without anything noticing.
  */
  const incoming = normaliseCode(request.nextUrl.searchParams.get("ref"));
  const promo = normalisePromo(request.nextUrl.searchParams.get("promo"));
  const carry = (res: NextResponse) => {
    const cookie = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: request.nextUrl.protocol === "https:",
      path: "/",
    };
    if (incoming && !request.cookies.get(REFERRAL_COOKIE)) {
      res.cookies.set(REFERRAL_COOKIE, incoming, {
        ...cookie,
        maxAge: REFERRAL_COOKIE_DAYS * 24 * 60 * 60,
      });
    }
    if (promo && shouldWritePromo(request.cookies.get(PROMO_COOKIE)?.value, promo)) {
      res.cookies.set(PROMO_COOKIE, promo, {
        ...cookie,
        maxAge: PROMO_COOKIE_DAYS * 24 * 60 * 60,
      });
    }
    return res;
  };

  // Before the envs are wired up, let everything through so the app can
  // render its own setup notice.
  if (!url || !anon) return carry(response);

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
    return carry(NextResponse.redirect(to));
  }

  return carry(response);
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
