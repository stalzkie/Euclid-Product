import { button, esc, gap, paragraph, render, TOKENS } from "./shell";

/**
 * "Your trial ends soon."
 *
 * Sent once, 48 hours out, to the owner of a workspace that is still
 * trialing and has not cancelled. The person who cancelled already knows;
 * telling them to add a card would be arguing with a decision they made, and
 * `remindExpiringTrials` filters them out before this is ever built.
 *
 * THE THING THIS EMAIL HAS TO GET RIGHT
 *
 * Polar's trial takes no card. So the default outcome is not "you will be
 * charged unless you act" — it is the opposite: nothing is charged, ever,
 * and the workspace quietly drops to free. A reminder written in the usual
 * "your card will be billed" shape would be factually wrong and would
 * frighten someone into cancelling something that was never going to take
 * their money.
 *
 * So the reassurance comes first and the ask second, and the last line says
 * plainly that doing nothing is a valid choice. The one thing a founder
 * could lose track of is that their boards stay up on free — only the
 * allowances shrink — so that is stated rather than implied.
 *
 * No badge count, no urgency, no countdown. It is a notice, not a campaign.
 */

export interface TrialEndingEmail {
  /** The workspace whose trial is ending, for the opening line. */
  workspaceName: string;
  /** Already formatted for a human — see `remindExpiringTrials`. */
  endsAt: string;
  /** Whether an exact end date was known, which changes the subject. */
  exact: boolean;
  billingUrl: string;
  /** Appears on the footer line explaining why they got this. */
  recipient: string;
  signOff: string;
  origin: string;
}

export function trialEndingSubject(exact: boolean): string {
  return `Your Euclid trial ends ${exact ? "soon" : "shortly"}`;
}

export function trialEndingHtml(email: TrialEndingEmail): string {
  const body = [
    paragraph(
      `Your <strong style="font-weight:600;color:${TOKENS.ink};">${esc(
        email.workspaceName,
      )}</strong> trial ends ${esc(email.endsAt)}.`,
    ),
    gap(18),
    // Said before the ask, because it is the part that is actually surprising
    // and the part that stops this reading as a threat.
    paragraph(
      "There is no card on file &mdash; the trial never asked for one &mdash; so nothing will be charged. When the trial runs out the workspace moves to the free plan.",
    ),
    gap(18),
    paragraph(
      "Your boards stay up on free, and so does everything your users have posted. What gets smaller is the allowances.",
    ),
    gap(22),
    button(email.billingUrl, "Add a card to stay on your plan"),
    gap(22),
    paragraph(
      `<span style="color:${TOKENS.meta};">If you would rather not continue, do nothing. The trial will end on its own and you will not hear from us about it again.</span>`,
    ),
  ].join("\n");

  return render({
    subject: trialEndingSubject(email.exact),
    preheader: `No card on file, so nothing will be charged — ${esc(
      email.workspaceName,
    )} moves to free when the trial ends.`,
    badge: "Trial ending",
    title: "Your trial is nearly up.",
    body,
    signOff: email.signOff,
    why: `You're getting this because you own the ${esc(
      email.workspaceName,
    )} workspace on Euclid.`,
    origin: email.origin,
  });
}

/**
 * The text part. Always sent alongside the HTML — a message carrying only one
 * of the two is a spam signal in its own right, and some clients still prefer
 * text. Written to read properly on its own rather than as stripped markup.
 */
export function trialEndingText(email: TrialEndingEmail): string {
  return [
    `Your ${email.workspaceName} trial ends ${email.endsAt}.`,
    "",
    "There is no card on file - the trial never asked for one - so nothing",
    "will be charged. When the trial runs out the workspace moves to the free",
    "plan.",
    "",
    "Your boards stay up on free, and so does everything your users have",
    "posted. What gets smaller is the allowances.",
    "",
    "To stay on your current plan, add a card here:",
    email.billingUrl,
    "",
    "If you would rather not continue, do nothing. The trial will end on its",
    "own and you will not hear from us about it again.",
    "",
    "Talk soon,",
    email.signOff,
    "",
    "Reply to this email if you have questions. A real person reads every reply.",
  ].join("\n");
}
