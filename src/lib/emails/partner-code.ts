import { button, codeBox, esc, gap, paragraph, render, TOKENS } from "./shell";

/**
 * "Here is your Bernn Pro code."
 *
 * Sent once, to a founder who bought Indie through the 4-for-3 offer. It is a
 * receipt for something already paid for, so it is written as one: no offer,
 * no second ask, one thing to do with the code.
 *
 * WHY THE SUBJECT CHANGED
 *
 * The first version went out as "Your free month of Bernn" and Gmail filed it
 * under Promotions. "Free" in a subject line is one of the clearer signals a
 * classifier has, and it was doing nothing for the reader: by the time this
 * arrives they have already bought the thing that earned it, so the word is
 * selling to somebody who has finished buying. "Your Bernn Pro code" says
 * what the email contains, which is what a receipt should do.
 *
 * The other half of staying out of Promotions is not in this file: a sender
 * with a human name, a real Reply-To, and a multipart body. See
 * `sendPartnerCode` and `0029_email_html.sql`.
 */

export interface PartnerCodeEmail {
  code: string;
  /** Where the founder can see it again. */
  billingUrl: string;
  /** Appears on the footer line explaining why they got this. */
  recipient: string;
  signOff: string;
  origin: string;
}

export const PARTNER_CODE_SUBJECT = "Your Bernn Pro code";

export function partnerCodeHtml(email: PartnerCodeEmail): string {
  const body = [
    paragraph(
      "Thanks for taking the four-months-for-three offer on Indie. Here is the other half of it: a month of Bernn Pro, on us.",
    ),
    gap(22),
    `<p style="margin:0 0 8px;font-family:'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:13.5px;line-height:20px;font-weight:600;color:${TOKENS.ink};">Your code</p>`,
    codeBox(email.code),
    gap(14),
    button(email.billingUrl, "See it on your billing page"),
    gap(22),
    paragraph(
      "Open Bernn, go to Settings &mdash; or tap &ldquo;Have a code?&rdquo; on the paywall &mdash; and enter it. It works once.",
    ),
    gap(10),
    // The question this email would otherwise generate, answered before it is
    // asked. Trying a code while already subscribed is refused before the
    // code is consumed, so it survives for later.
    paragraph(
      `<span style="color:${TOKENS.meta};">Already on Bernn Pro? Trying it does not spend it &mdash; keep it for whenever your subscription lapses.</span>`,
    ),
  ].join("\n");

  return render({
    subject: PARTNER_CODE_SUBJECT,
    preheader: `${email.code} — one month of Bernn Pro, from your Euclid Indie plan.`,
    badge: "Indie · 4 months for 3",
    title: "Here is your Bernn code.",
    body,
    signOff: email.signOff,
    why: `You're getting this because ${esc(email.recipient)} bought Euclid Indie through the 4-for-3 offer.`,
    origin: email.origin,
  });
}

/**
 * The text part. Always sent alongside the HTML — a message with only one of
 * the two is itself a spam signal, and some clients still prefer text.
 *
 * Written to read properly on its own rather than as a stripped-down copy of
 * the markup.
 */
export function partnerCodeText(email: PartnerCodeEmail): string {
  return [
    "Thanks for taking the four-months-for-three offer on Indie.",
    "Here is the other half of it: a month of Bernn Pro, on us.",
    "",
    "Your code:",
    "",
    `    ${email.code}`,
    "",
    'Open Bernn, go to Settings - or tap "Have a code?" on the paywall - and',
    "enter it. It works once.",
    "",
    "Already on Bernn Pro? Trying it does not spend it, so keep it for",
    "whenever your subscription lapses.",
    "",
    `It is also on your billing page: ${email.billingUrl}`,
    "",
    "Talk soon,",
    email.signOff,
    "",
    "Reply to this email if you have questions. A real person reads every reply.",
  ].join("\n");
}
