import { bullets, button, esc, gap, paragraph, render, TOKENS } from "./shell";

/**
 * "Your month of Indie, for joining the waitlist."
 *
 * Sent once, to somebody who put their email down before Euclid had a
 * sign-up page. It is the only email in the set that is making an offer
 * rather than confirming something already done, which is exactly why it is
 * written as flatly as it is: the reader is owed a thing they were promised
 * months ago, so the email's whole job is to hand it over and get out of the
 * way.
 *
 * WHAT THE COPY IS NOT ALLOWED TO DO
 *
 *   - Bury the renewal. The subject is "Claim your Free Euclid Indie on us",
 *     which is a deliberate departure from the partner-code email: that one
 *     dropped "free" because it was a receipt for something already bought,
 *     and "free" in a subject is one of the clearer signals a Promotions
 *     classifier has. This email is the opposite case — an offer nobody has
 *     acted on yet, where the word is the news — so the trade was made
 *     knowingly: Promotions is a worse place to land, and a waitlist that
 *     cannot tell what it is being handed is worse still. Watch where it
 *     lands; the sender name, the real Reply-To and the multipart body are
 *     what are left arguing for Primary.
 *   - Hide the renewal. A month at $0 that silently becomes $12 is the shape
 *     of every offer anybody has learned to distrust, so the price after the
 *     month, and where to cancel it, are in the body rather than a footnote.
 *   - Imply the link is personal. It is one promotion link, not a per-
 *     recipient token — so nothing here says "yours alone", and the expiry is
 *     the promotion's own window rather than a countdown aimed at one reader.
 *
 * THE MECHANIC THIS ASSUMES
 *
 * `claimUrl` points at `/signup?promo=<slug>`, the same shape the 4-for-3
 * promotion uses: `middleware.ts` captures the parameter into a cookie so it
 * survives the sign-up redirect, and `discountForCheckout` names the
 * discount when the checkout is created. A free month is a 100%-off
 * repeating discount of one month on Indie Monthly — see `polar.ts`, which
 * today recognises `indie3` and nothing else. Until that slug is recognised
 * and its discount id configured, this link sells Indie at list price, so
 * the template is not wired into any job: it is rendered and sent
 * deliberately.
 */

/**
 * The promotion's slug in the `?promo=` link.
 *
 * Lives here rather than in `polar.ts` because the email is the only thing
 * that knows it yet. It moves there the moment `normalisePromo` learns it.
 */
export const WAITLIST_PROMO = "waitlist";

export interface WaitlistOfferEmail {
  /** The `/signup?promo=` link that applies the free month. */
  claimUrl: string;
  /** What Indie costs once the free month is over, in whole dollars. */
  monthlyPrice: number;
  /** How long the promotion's link is good for, in days. */
  expiresInDays: number;
  /** Appears on the footer line explaining why they got this. */
  recipient: string;
  signOff: string;
  origin: string;
}

export const WAITLIST_OFFER_SUBJECT = "Claim your Free Euclid Indie on us";

export function waitlistOfferHtml(email: WaitlistOfferEmail): string {
  const body = [
    paragraph(
      "You put your name down before Euclid had a sign-up page. It has one now &mdash; and the month of Indie we promised the waitlist is on the other side of this link.",
    ),
    gap(22),
    `<p style="margin:0 0 12px;font-family:'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:13.5px;line-height:20px;font-weight:600;color:${TOKENS.ink};">What the month gives you</p>`,
    bullets([
      "3 boards, with anonymous and email voting",
      "50 Build Prompts a month — the brief your coding agent actually reads",
      "Signed JWT identity and segments",
      "Duplicate merging, themes and analytics",
      "No Euclid badge on your widget",
    ]),
    gap(22),
    button(email.claimUrl, "Claim your month of Indie"),
    gap(22),
    // The renewal, said plainly and before it is asked about. An offer that
    // buries what happens on day 31 is the offer nobody trusts.
    paragraph(
      `Your first month is $0. After that Indie renews at $${email.monthlyPrice} a month, and you can cancel from your billing page any time before it does.`,
    ),
    gap(10),
    paragraph(
      `<span style="color:${TOKENS.meta};">The link is good for ${email.expiresInDays} days. If you have changed your mind about Euclid, ignore it &mdash; nothing happens until you open it, and this is the only email you will get about it.</span>`,
    ),
  ].join("\n");

  return render({
    subject: WAITLIST_OFFER_SUBJECT,
    preheader:
      "One month of Indie, for joining the waitlist — 3 boards, 50 Build Prompts, no badge.",
    badge: "Waitlist · one month of Indie",
    title: "Your month of Indie is ready.",
    body,
    signOff: email.signOff,
    why: `You're getting this because ${esc(
      email.recipient,
    )} joined the Euclid waitlist.`,
    origin: email.origin,
  });
}

/**
 * The text part. Always sent alongside the HTML — a message carrying only one
 * of the two is a spam signal in its own right, and some clients still prefer
 * text. Written to read properly on its own rather than as stripped markup.
 *
 * The URL sits on its own line and unwrapped, because this is the half a
 * cautious reader checks before clicking anything.
 */
export function waitlistOfferText(email: WaitlistOfferEmail): string {
  return [
    "You put your name down before Euclid had a sign-up page.",
    "",
    "It has one now - and the month of Indie we promised the waitlist is on",
    "the other side of this link:",
    "",
    email.claimUrl,
    "",
    "What the month gives you:",
    "",
    "  - 3 boards, with anonymous and email voting",
    "  - 50 Build Prompts a month, the brief your coding agent actually reads",
    "  - Signed JWT identity and segments",
    "  - Duplicate merging, themes and analytics",
    "  - No Euclid badge on your widget",
    "",
    `Your first month is $0. After that Indie renews at $${email.monthlyPrice} a month, and`,
    "you can cancel from your billing page any time before it does.",
    "",
    `The link is good for ${email.expiresInDays} days. If you have changed your mind about`,
    "Euclid, ignore it - nothing happens until you open it, and this is the",
    "only email you will get about it.",
    "",
    "Talk soon,",
    email.signOff,
    "",
    "Reply to this email if you have questions. A real person reads every reply.",
  ].join("\n");
}
