/**
 * The app's own promotion logic, re-exported for `check-waitlist-promo.mjs`.
 *
 * It exists because that script is a `.mjs` and these are TypeScript modules
 * behind an `@/` alias: esbuild bundles this one file and the script imports
 * the result. The alternative is a check that reimplements the rules it is
 * meant to be checking, which would pass while the app was broken.
 *
 * Underscore-prefixed because it is a build input rather than a command.
 */
export { discountForCheckout, promoEligible, WAITLIST, INDIE3 } from "@/lib/polar";
export { onWaitlist } from "@/server/waitlist";

import { supabaseAdmin } from "@/lib/supabase/server";

/** Any address actually on the waitlist, so the check is not hard-coded. */
export async function firstWaitlistEmail(): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("waitlist_signups")
    .select("email")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data?.email as string | undefined) ?? null;
}
