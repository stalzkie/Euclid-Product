import { describe, expect, it } from "vitest";
import {
  PARTNER_CODE_SUBJECT,
  partnerCodeHtml,
  partnerCodeText,
} from "@/lib/emails/partner-code";
import {
  trialEndingHtml,
  trialEndingSubject,
  trialEndingText,
} from "@/lib/emails/trial-ending";
import {
  studentVerificationHtml,
  studentVerificationText,
} from "@/lib/emails/student-verification";
import { esc } from "@/lib/emails/shell";

/**
 * The partner-code email.
 *
 * The first version of this landed in Gmail's Promotions tab, which is not a
 * styling problem but a signals problem: who it is from, whether a human can
 * reply, whether the subject reads like an offer, and whether the message is
 * multipart. The assertions below cover the ones that live in this file.
 */

const content = {
  code: "BERN-ABCD-1234",
  billingUrl: "https://app.euclidhq.com/billing",
  recipient: "founder@example.test",
  signOff: "Stal from Euclid",
  origin: "https://app.euclidhq.com",
};

describe("the partner code email", () => {
  it("does not sell in the subject line", () => {
    /*
      It used to read "Your free month of Bernn". "Free" is one of the
      clearer signals a Promotions classifier has, and it was doing no work:
      by the time this arrives the reader has already bought the thing that
      earned it, so the word is selling to someone who has finished buying.
    */
    expect(PARTNER_CODE_SUBJECT.toLowerCase()).not.toContain("free");
    expect(PARTNER_CODE_SUBJECT).toBe("Your Bernn Pro code");
  });

  it("carries the code in both parts", () => {
    // A message with only one of the two parts is itself a spam signal.
    expect(partnerCodeHtml(content)).toContain(content.code);
    expect(partnerCodeText(content)).toContain(content.code);
  });

  it("links the billing page absolutely", () => {
    // Relative links are meaningless in an inbox, and the origin comes from
    // appOrigin() rather than the request that happened to trigger the send.
    expect(partnerCodeHtml(content)).toContain(content.billingUrl);
    expect(partnerCodeText(content)).toContain(content.billingUrl);
  });

  it("signs off as a person", () => {
    expect(partnerCodeHtml(content)).toContain("Stal from Euclid");
    expect(partnerCodeText(content)).toContain("Stal from Euclid");
  });

  it("offers no unsubscribe", () => {
    /*
      Deliberate. Unsubscribe belongs on bulk mail, and Gmail reads it as a
      bulk signal — on a receipt for something just paid for it would both
      invite the Promotions tab and offer to unsubscribe someone from their
      own purchase.
    */
    expect(partnerCodeHtml(content).toLowerCase()).not.toContain("unsubscribe");
  });

  it("sets a preheader so body copy does not leak into the preview", () => {
    const html = partnerCodeHtml(content);
    expect(html).toContain("max-height:0");
    // The preheader leads with the code, which is what the reader wants from
    // the inbox list without opening anything.
    expect(html).toMatch(/max-height:0[^>]*>[^<]*BERN-ABCD-1234/);
  });

  it("uses tables and inline styles, not flexbox", () => {
    const html = partnerCodeHtml(content);
    expect(html).toContain('role="presentation"');
    expect(html).not.toContain("display:flex");
    expect(html).not.toContain("<svg");
  });

  it("declares a light colour scheme and locks the hero against inversion", () => {
    const html = partnerCodeHtml(content);
    expect(html).toContain('name="color-scheme" content="light"');
    expect(html).toContain("wash-lock");
  });
});

describe("esc", () => {
  it("escapes anything interpolated into markup", () => {
    // Codes and names are data. A workspace called `<script>` must not become
    // one, even in an email nobody executes.
    expect(esc('<b>&"')).toBe("&lt;b&gt;&amp;&quot;");
  });
});

/**
 * The two emails that gained an HTML part on 2026-10-19.
 *
 * The properties worth holding are the same ones the partner-code email
 * taught: both parts carry the same facts, nothing interpolated can become
 * markup, and the message is multipart rather than HTML-only. What is
 * specific to each is the thing it must not get wrong — for the trial
 * reminder, that no card exists; for the verification, that ignoring it is
 * safe.
 */

const trial = {
  workspaceName: "Driftnote",
  endsAt: "Wed, 21 Oct 2026 12:00:00 GMT",
  exact: true,
  billingUrl: "https://app.euclidhq.com/billing",
  recipient: "founder@example.test",
  signOff: "Stal from Euclid",
  origin: "https://app.euclidhq.com",
};

describe("the trial-ending email", () => {
  it("says there is no card, in both parts", () => {
    /*
      The one fact this email cannot get wrong. Polar's trial collects no
      card, so the default outcome is *not* "you will be charged unless you
      act" — it is that nothing is charged and the workspace drops to free.
      Written in the usual billing-reminder shape it would be false, and it
      would frighten someone into cancelling something that was never going
      to take their money.
    */
    for (const part of [trialEndingHtml(trial), trialEndingText(trial)]) {
      expect(part).toMatch(/no card/i);
      expect(part).toMatch(/nothing\s+will\s+be\s+charged/i);
    }
  });

  it("says boards survive the drop to free, so nobody cancels to save them", () => {
    for (const part of [trialEndingHtml(trial), trialEndingText(trial)]) {
      expect(part).toMatch(/boards\s+stay\s+up/i);
    }
  });

  it("tells someone who does not want to continue that doing nothing is enough", () => {
    for (const part of [trialEndingHtml(trial), trialEndingText(trial)]) {
      expect(part).toMatch(/do\s+nothing|not\s+need\s+to\s+do\s+anything/i);
    }
  });

  it("links billing absolutely, because an email has no origin", () => {
    expect(trialEndingHtml(trial)).toContain("https://app.euclidhq.com/billing");
    expect(trialEndingText(trial)).toContain("https://app.euclidhq.com/billing");
  });

  it("escapes a workspace name rather than letting it become markup", () => {
    const html = trialEndingHtml({ ...trial, workspaceName: '<img src=x onerror="alert(1)">' });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain(esc('<img src=x onerror="alert(1)">'));
  });

  it("changes the subject when the end date is not known exactly", () => {
    expect(trialEndingSubject(true)).toMatch(/soon$/);
    expect(trialEndingSubject(false)).toMatch(/shortly$/);
  });
});

const student = {
  link: "https://app.euclidhq.com/api/billing/student?token=abc123",
  expiresInHours: 24,
  recipient: "ada@uni.example.test",
  signOff: "Stal from Euclid",
  origin: "https://app.euclidhq.com",
};

describe("the student verification email", () => {
  it("carries the link in both parts", () => {
    expect(studentVerificationHtml(student)).toContain(esc(student.link));
    expect(studentVerificationText(student)).toContain(student.link);
  });

  it("says the link works once and when it dies", () => {
    for (const part of [studentVerificationHtml(student), studentVerificationText(student)]) {
      expect(part).toMatch(/works\s+once/i);
      expect(part).toMatch(/24 hours/);
    }
  });

  it("tells someone who did not ask for it that ignoring it is safe", () => {
    /*
      An unrequested verification mail is alarming precisely because it looks
      like somebody is partway into your account. The reassurance that
      nothing has happened yet, and that nothing will, is the whole job of
      that line — so it is asserted rather than left to survive a rewrite.
    */
    for (const part of [studentVerificationHtml(student), studentVerificationText(student)]) {
      expect(part).toMatch(/ignore it/i);
      expect(part).toMatch(/nothing\s+changes\s+unless\s+the\s+link\s+is\s+opened/i);
    }
  });

  it("puts the raw URL on its own line in the text part", () => {
    // The half a cautious reader inspects before clicking. Wrapped or
    // prefixed, it is harder to check and easier to misread.
    expect(studentVerificationText(student).split("\n")).toContain(student.link);
  });

  it("escapes the claimed address rather than letting it become markup", () => {
    const html = studentVerificationHtml({ ...student, recipient: '"><script>x</script>' });
    expect(html).not.toContain("<script>x</script>");
  });
});

describe("every customer-facing email is multipart", () => {
  it("has a text part that is not merely the markup stripped", () => {
    /*
      A message carrying only HTML is a spam signal in its own right, and
      some clients still prefer text — so the text part is the canonical copy
      rather than a fallback. Asserting it contains no tags is what stops
      someone "simplifying" these by running the HTML through a stripper.
    */
    const texts = [
      partnerCodeText(content),
      trialEndingText(trial),
      studentVerificationText(student),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/<[a-z/][^>]*>/i);
      expect(text.length).toBeGreaterThan(200);
      // Every one of them promises a reply, which is why EMAIL_REPLY_TO has
      // to reach a human.
      expect(text).toMatch(/reply/i);
    }
  });
});
