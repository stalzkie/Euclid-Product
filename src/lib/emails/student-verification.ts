import { button, esc, gap, paragraph, render, TOKENS } from "./shell";

/**
 * "Confirm your student discount."
 *
 * Sent to the student, at the school address they typed, when the domain is
 * recognisably academic. Opening the link applies the discount.
 *
 * WHY ONLY THIS ONE GETS THE CHROME
 *
 * `requestStudentVerification` sends two different emails and only this one
 * is customer-facing. The other goes to `STUDENT_REVIEW_EMAIL` when the
 * domain is not recognisably academic, and it is an internal triage note —
 * a workspace id, a claimed address, and a link to approve. Dressing that in
 * a branded card would make an operator's worklist look like marketing and
 * would bury the two facts it exists to carry. It stays plain, deliberately.
 *
 * The magic link stays plain for a different reason: a sign-in link is the
 * single most impersonated email a product sends, and a plain-text one is
 * both harder to fake convincingly and easier for a cautious reader to
 * check. That decision is recorded in ROADMAP.md §4 and is not revisited
 * here.
 *
 * This email sits between the two. It carries a link that grants something,
 * so it says exactly what the link does, that it works once, and when it
 * dies — and it tells someone who did not ask for it that ignoring it is
 * enough, because a verification mail nobody requested is the one case where
 * the recipient needs to know that inaction is safe.
 */

export interface StudentVerificationEmail {
  /** The link that applies the discount. Works once. */
  link: string;
  /** How long the link is good for, in hours. */
  expiresInHours: number;
  /** The address the student claimed, for the footer line. */
  recipient: string;
  signOff: string;
  origin: string;
}

export const STUDENT_VERIFICATION_SUBJECT = "Confirm your Euclid student discount";

export function studentVerificationHtml(email: StudentVerificationEmail): string {
  const body = [
    paragraph(
      "You asked for the student rate on Euclid. One click confirms it, and the discount applies to your workspace straight away.",
    ),
    gap(22),
    button(email.link, "Confirm my student discount"),
    gap(22),
    paragraph(
      `The link works once and expires in ${email.expiresInHours} hours. After that you can ask for a new one from your billing page.`,
    ),
    gap(10),
    // The one line that matters to someone who did not ask for this. An
    // unrequested verification mail is alarming precisely because it looks
    // like someone is partway into your account; saying that nothing has
    // happened yet, and that nothing will, is the whole reassurance.
    paragraph(
      `<span style="color:${TOKENS.meta};">Didn&rsquo;t ask for this? Ignore it. Nothing changes unless the link is opened, and it expires on its own.</span>`,
    ),
  ].join("\n");

  return render({
    subject: STUDENT_VERIFICATION_SUBJECT,
    preheader: `One click applies the student rate — the link works once and expires in ${email.expiresInHours} hours.`,
    badge: "Student rate",
    title: "Confirm your student discount.",
    body,
    signOff: email.signOff,
    why: `You're getting this because ${esc(
      email.recipient,
    )} was entered as a school address on Euclid.`,
    origin: email.origin,
  });
}

/**
 * The text part. Always sent alongside the HTML.
 *
 * The URL is on its own line and unwrapped, because this is the half a
 * cautious reader will look at before clicking anything.
 */
export function studentVerificationText(email: StudentVerificationEmail): string {
  return [
    "You asked for the student rate on Euclid.",
    "",
    "Open this link to apply the student discount to your workspace:",
    "",
    email.link,
    "",
    `The link works once and expires in ${email.expiresInHours} hours. After that`,
    "you can ask for a new one from your billing page.",
    "",
    "Didn't ask for this? Ignore it. Nothing changes unless the link is",
    "opened, and it expires on its own.",
    "",
    "Talk soon,",
    email.signOff,
    "",
    "Reply to this email if you have questions. A real person reads every reply.",
  ].join("\n");
}
