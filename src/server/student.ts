import { supabaseAdmin } from "@/lib/supabase/server";
import { newMagicToken } from "@/server/identity";
import { classifyStudentEmail, type StudentEmailKind } from "@/lib/student";
import {
  STUDENT_VERIFICATION_SUBJECT,
  studentVerificationHtml,
  studentVerificationText,
} from "@/lib/emails/student-verification";
import { replyTo, signOff } from "@/lib/emails/sender";

/**
 * Sending and redeeming student verification links.
 *
 * The two paths differ only in who receives the link. An academic-looking
 * address gets it directly; anything else sends it to the operator to approve,
 * because refusing outright turns away the many real universities that sit on
 * an ordinary national domain.
 */

/** How long a verification link is good for. Long enough to find the email. */
const LINK_HOURS = 24;

/** Where review requests go. Falls back to the sender address. */
function reviewAddress(): string | null {
  const explicit = process.env.STUDENT_REVIEW_EMAIL;
  if (explicit) return explicit;
  // `EMAIL_FROM` is usually "Euclid <feedback@domain>"; take the address.
  const from = process.env.EMAIL_FROM ?? "";
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from || null;
}

export type StudentRequestResult =
  | { ok: true; kind: Exclude<StudentEmailKind, "invalid">; sentTo: string }
  | { ok: false; error: string };

/**
 * Start a verification for a workspace.
 *
 * The caller must already have established that the session owns the workspace —
 * this takes an id, not a request, and does no authorisation of its own.
 */
export async function requestStudentVerification(
  workspaceId: string,
  rawEmail: string,
  origin: string,
): Promise<StudentRequestResult> {
  const email = rawEmail.trim().toLowerCase();
  const kind = classifyStudentEmail(email);
  if (kind === "invalid") {
    return { ok: false, error: "That does not look like an email address." };
  }

  const db = supabaseAdmin();

  // Three attempts an hour per workspace. Without this the form is a way to
  // mail a link to any address repeatedly, using our sender reputation.
  const { count } = await db
    .from("student_verifications")
    .select("token", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .gt("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
  if ((count ?? 0) >= 3) {
    return { ok: false, error: "Too many attempts. Try again in an hour." };
  }

  const recipient = kind === "auto" ? email : reviewAddress();
  if (!recipient) {
    return { ok: false, error: "Verification by review is not configured." };
  }

  const token = newMagicToken();
  const { error } = await db.from("student_verifications").insert({
    token,
    workspace_id: workspaceId,
    email,
    kind,
    expires_at: new Date(Date.now() + LINK_HOURS * 60 * 60 * 1000).toISOString(),
  });
  if (error) return { ok: false, error: error.message };

  const link = `${origin}/api/billing/student?token=${token}`;

  /*
    Two emails, and only one of them is customer-facing.

    `auto` goes to the student at the address they typed, so it gets the
    shared chrome and a text part beside it. `review` goes to
    `STUDENT_REVIEW_EMAIL` and is an operator's triage note — a workspace
    id, a claimed address and a link to approve. Branding that would make a
    worklist look like marketing and bury the two facts it carries, so it
    stays plain. `email_outbox.html` is nullable precisely so one row can
    have one and the next can not.
  */
  if (kind === "auto") {
    const content = {
      link,
      expiresInHours: LINK_HOURS,
      recipient,
      signOff: signOff(),
      origin,
    };

    await db.from("email_outbox").insert({
      to_email: recipient,
      subject: STUDENT_VERIFICATION_SUBJECT,
      body: studentVerificationText(content),
      html: studentVerificationHtml(content),
      reply_to: replyTo(),
      kind: "student_verification",
    });
  } else {
    await db.from("email_outbox").insert({
      to_email: recipient,
      subject: "Euclid: student discount to review",
      body: [
        "A student discount needs review",
        "",
        `Workspace: ${workspaceId}`,
        `Claimed address: ${email}`,
        "",
        "That domain is not recognisably academic, which does not mean it is",
        "not a university — most of Europe and Latin America sit on ordinary",
        "national domains. Check it, then open this link to approve:",
        link,
        "",
        `Expires in ${LINK_HOURS} hours. Ignore it to refuse.`,
      ].join("\n"),
      kind: "student_verification",
    });
  }

  return { ok: true, kind, sentTo: recipient };
}

/** Redeem a token. Returns the workspace it verified, or null. */
export async function redeemStudentVerification(token: string): Promise<string | null> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("verify_student", { p_token: token });
  return error ? null : ((data as string | null) ?? null);
}
