/**
 * Who signs the customer-facing mail, and where a reply lands.
 *
 * A person rather than "the Euclid team", because a named human sender is
 * one of the clearer signals that a message is correspondence rather than a
 * campaign — and every template's sign-off promises a reply, so
 * `EMAIL_REPLY_TO` has to reach somewhere a human actually looks.
 *
 * Both fall back rather than fail. An unset reply-to simply means replies go
 * to the sender, which is the correct degradation: the alternative is an
 * email that does not send because a cosmetic variable is missing.
 *
 * These lived in `server/partner.ts`, which was the only sender with an HTML
 * body. Three templates now need the same two answers, and three copies of
 * "who are we and where do replies go" is three places for them to drift —
 * the visible symptom of which would be one email signed by a person and
 * another by nobody.
 */

/** The name under every customer-facing email. */
export function signOff(): string {
  return process.env.EMAIL_SIGN_OFF || "Stal from Euclid";
}

/** Where a reply should land, or null to let it go to the sender. */
export function replyTo(): string | null {
  return process.env.EMAIL_REPLY_TO || null;
}
