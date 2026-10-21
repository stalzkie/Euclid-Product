import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Who is on the waitlist.
 *
 * `waitlist_signups` is the marketing site's table, not this app's: nothing in
 * `supabase/migrations` creates it, the sign-up form on euclidhq.com writes
 * it, and the two projects happen to share one Supabase. So this file reads
 * and never writes, and it asks for one column — a write here would be the
 * app reaching into another service's schema, and a schema it does not own is
 * a schema it must not reshape.
 *
 * The consequence worth knowing: there is no `claimed_at` to stamp, so this
 * cannot be the thing that makes the free month redeemable once. Three other
 * things bound it instead — `max_redemptions` and
 * `max_redemptions_per_customer` on the Polar discount, and the fact that a
 * workspace already subscribed cannot check out again. If one-per-address
 * ever has to be exact, that is a column on the marketing side and a decision
 * for whoever owns it.
 */

/**
 * Whether this address asked for an invite.
 *
 * Matched with `ilike` rather than `eq`: the form stored whatever the visitor
 * typed, Supabase auth stores whatever they signed up with, and "Dstalingrad@"
 * in one and "dstalingrad@" in the other is the same person. The value is
 * escaped for the two LIKE wildcards before it goes near the filter, because
 * an address containing `%` would otherwise match more rows than itself.
 *
 * Fails closed. An unreachable database means nobody is on the waitlist as far
 * as this is concerned, which prices Indie at list — the founder pays what the
 * page says and can be given the month by hand. The alternative, failing open,
 * hands a free month to anyone who can make the query time out.
 */
export async function onWaitlist(email: string | null | undefined): Promise<boolean> {
  const address = email?.trim();
  if (!address) return false;

  const pattern = address.replace(/[\\%_]/g, (ch) => `\\${ch}`);

  try {
    const { data, error } = await supabaseAdmin()
      .from("waitlist_signups")
      .select("id")
      .ilike("email", pattern)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn(`[waitlist] lookup failed for ${address}: ${error.message}`);
      return false;
    }
    return Boolean(data);
  } catch (err) {
    console.warn("[waitlist] lookup failed:", err);
    return false;
  }
}
