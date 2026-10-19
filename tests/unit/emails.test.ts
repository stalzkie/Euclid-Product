import { describe, expect, it } from "vitest";
import {
  PARTNER_CODE_SUBJECT,
  partnerCodeHtml,
  partnerCodeText,
} from "@/lib/emails/partner-code";
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
