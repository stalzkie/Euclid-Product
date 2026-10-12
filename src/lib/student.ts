/**
 * Student eligibility.
 *
 * Two jobs: decide whether an address *looks* academic, and decide whether a
 * verification is still current. Neither is proof of anything — ownership of
 * the address is proved separately, by clicking a link sent to it — and a
 * school address never proves current enrolment, which is why verifications
 * expire.
 */

/**
 * How long a verification lasts before it has to be done again.
 *
 * Most institutions let alumni keep their address for life, so a one-time check
 * would hand someone who graduated years ago a permanent half-price plan. A
 * year is long enough that a real student does this once per degree year, and
 * short enough that it lapses before the discount becomes a pension.
 */
export const STUDENT_VERIFICATION_DAYS = 365;

/**
 * Academic domains, as a shape rather than a list of countries.
 *
 * Nearly every country puts universities under `ac` or `edu` as the second
 * level of a two-letter country domain — `ac.uk`, `edu.au`, `ac.nz`, `ac.jp`,
 * `edu.br`, `ac.za`. Matching the shape covers all of them, including the ones
 * nobody thinks to enumerate, and keeps this from becoming a list that silently
 * rots as it misses countries.
 *
 * The United States is the exception worth hard-coding: a bare `.edu` with no
 * country after it.
 */
const ACADEMIC_SECOND_LEVEL = new Set(["ac", "edu", "sch", "school", "uni"]);

/**
 * Institutions that are unambiguously academic but do not fit the shape above.
 * Deliberately short. This is a safety valve, not the mechanism — anything not
 * matched here goes to human review rather than being refused.
 */
const ACADEMIC_EXTRAS = new Set(["ethz.ch", "epfl.ch"]);

/**
 * Two-letter domains that are sold as generic names rather than used as
 * country domains.
 *
 * The shape rule below trusts "two letters at the end" to mean a country, which
 * is what makes `ac.uk` and `edu.au` work without a list. These break that
 * assumption: anyone can buy `anything.ac.io` or `anything.edu.co` for a few
 * pounds, and without this they would be auto-accepted as a university.
 */
const VANITY_CC = new Set(["io", "ai", "co", "me", "tv", "cc", "gg", "sh", "fm", "ly", "to", "ws"]);

export type StudentEmailKind =
  /** Looks academic. Send the link straight to the student. */
  | "auto"
  /** A real address, but not recognisably academic. Needs a human. */
  | "review"
  /** Not a usable email address at all. */
  | "invalid";

/** The domain part of an address, lowercased. Null if it is not an address. */
export function emailDomain(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  // One @, something either side, a dot in the domain, no whitespace. Deliberately
  // not an RFC-complete validator: the link we send is the real check.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed.slice(trimmed.lastIndexOf("@") + 1);
}

/**
 * Classify an address.
 *
 * Returns `review` rather than `invalid` for an ordinary-looking domain, which
 * is the whole point: a strict list turns away genuine students across most of
 * Europe and Latin America, where universities sit on a plain national domain —
 * Heidelberg is `uni-heidelberg.de`. Those people do not write in to complain,
 * they just leave. So an unrecognised domain becomes a question for a human
 * instead of a closed door.
 */
export function classifyStudentEmail(email: string): StudentEmailKind {
  const domain = emailDomain(email);
  if (!domain) return "invalid";

  if (ACADEMIC_EXTRAS.has(domain)) return "auto";

  const parts = domain.split(".");
  const tld = parts[parts.length - 1];

  // United States: anything under a bare .edu.
  if (tld === "edu") return "auto";

  // Everywhere else: <something>.<ac|edu|sch|...>.<cc>, where cc is a
  // two-letter country. The length check keeps `edu.com` style lookalikes out.
  if (parts.length >= 3 && tld.length === 2 && !VANITY_CC.has(tld)) {
    const secondLevel = parts[parts.length - 2];
    if (ACADEMIC_SECOND_LEVEL.has(secondLevel)) return "auto";
  }

  return "review";
}

/**
 * Whether a verification is still current.
 *
 * `now` is a parameter rather than read from the clock because this machine's
 * clock runs ahead of the database's, and a test that computed its own "now"
 * and compared it against a stored timestamp would be comparing two different
 * clocks. HANDOFF.md has the story; one test already failed on exactly this.
 */
export function studentVerificationActive(
  verifiedAt: string | null | undefined,
  now: Date,
): boolean {
  if (!verifiedAt) return false;
  const verified = new Date(verifiedAt);
  if (Number.isNaN(verified.getTime())) return false;
  // A timestamp in the future is a clock disagreement, not a forgery worth
  // refusing over — it is still inside the window by any reading.
  const elapsedDays = (now.getTime() - verified.getTime()) / 86_400_000;
  return elapsedDays < STUDENT_VERIFICATION_DAYS;
}

/** When a current verification lapses, for the UI to show. */
export function studentVerificationExpiry(verifiedAt: string): Date {
  return new Date(new Date(verifiedAt).getTime() + STUDENT_VERIFICATION_DAYS * 86_400_000);
}
