import { describe, expect, it } from "vitest";
import {
  STUDENT_VERIFICATION_DAYS,
  classifyStudentEmail,
  emailDomain,
  studentVerificationActive,
  studentVerificationExpiry,
} from "@/lib/student";

/**
 * The asymmetry here is the opposite of billing's. Wrongly refusing a student
 * is the common failure and the invisible one — they do not complain, they
 * leave — so the classifier is built to send doubtful addresses to a human
 * rather than reject them. Wrongly granting is bounded: 50% off, and it lapses.
 */

describe("emailDomain", () => {
  it("extracts and lowercases the domain", () => {
    expect(emailDomain("  Ada@Example.AC.UK ")).toBe("example.ac.uk");
  });

  it("rejects an address with more than one @", () => {
    // Quoted local parts containing @ are legal but vanishingly rare, and
    // accepting them means loosening the check that keeps "a@b@evil.com" out.
    expect(emailDomain('"weird@local"@cam.ac.uk')).toBeNull();
    expect(emailDomain("ada@mit.edu@evil.com")).toBeNull();
  });

  it("rejects things that are not addresses", () => {
    for (const bad of ["", "   ", "ada", "ada@", "@example.edu", "ada@localhost", "a b@c.edu"]) {
      expect(emailDomain(bad)).toBeNull();
    }
  });
});

describe("classifyStudentEmail", () => {
  it("auto-accepts a bare .edu", () => {
    expect(classifyStudentEmail("ada@mit.edu")).toBe("auto");
    expect(classifyStudentEmail("ada@sub.dept.stanford.edu")).toBe("auto");
  });

  it("auto-accepts the ac/edu-under-country shape worldwide", () => {
    // The point of matching a shape rather than listing countries: these all
    // pass without anyone having had to think of them.
    for (const email of [
      "ada@cam.ac.uk",
      "ada@unimelb.edu.au",
      "ada@auckland.ac.nz",
      "ada@u-tokyo.ac.jp",
      "ada@iitb.ac.in",
      "ada@tsinghua.edu.cn",
      "ada@uct.ac.za",
      "ada@usp.edu.br",
      "ada@nus.edu.sg",
      "ada@snu.ac.kr",
    ]) {
      expect(classifyStudentEmail(email)).toBe("auto");
    }
  });

  it("sends an ordinary national university domain to review, not rejection", () => {
    // This is the case a strict list gets wrong. Heidelberg, the Sorbonne and
    // most of Latin America sit on plain national domains and are perfectly
    // real universities.
    for (const email of [
      "ada@uni-heidelberg.de",
      "ada@sorbonne-universite.fr",
      "ada@unam.mx",
      "ada@ntnu.no",
    ]) {
      expect(classifyStudentEmail(email)).toBe("review");
    }
  });

  it("sends ordinary consumer mail to review rather than auto-accepting it", () => {
    for (const email of ["ada@gmail.com", "ada@hotmail.co.uk", "ada@proton.me"]) {
      expect(classifyStudentEmail(email)).toBe("review");
    }
  });

  it("does not auto-accept a lookalike domain", () => {
    // `edu.com` and `ac.io` are ordinary registrable domains anyone can buy.
    // Treating the second level as academic without checking that the last
    // label is a country would hand them an automatic 50%.
    for (const email of [
      "ada@school.edu.com",
      "ada@dept.ac.io",
      "ada@dept.edu.co",
      "ada@notreally.edu.xyz",
    ]) {
      expect(classifyStudentEmail(email)).toBe("review");
    }
  });

  it("recognises the hard-coded exceptions", () => {
    expect(classifyStudentEmail("ada@ethz.ch")).toBe("auto");
  });

  it("reports an unusable address as invalid rather than review", () => {
    expect(classifyStudentEmail("not-an-email")).toBe("invalid");
    expect(classifyStudentEmail("")).toBe("invalid");
  });
});

describe("studentVerificationActive", () => {
  const verified = "2026-01-01T00:00:00.000Z";

  it("is active the day it is granted", () => {
    expect(studentVerificationActive(verified, new Date("2026-01-01T00:00:01Z"))).toBe(true);
  });

  it("is active the day before it lapses", () => {
    expect(studentVerificationActive(verified, new Date("2026-12-30T00:00:00Z"))).toBe(true);
  });

  it("has lapsed once the window is over", () => {
    // 2027-01-01 is exactly 365 days later: the boundary is exclusive, so this
    // is the first moment the discount stops.
    expect(studentVerificationActive(verified, new Date("2027-01-01T00:00:00Z"))).toBe(false);
    expect(studentVerificationActive(verified, new Date("2028-01-01T00:00:00Z"))).toBe(false);
  });

  it("is inactive when never verified", () => {
    expect(studentVerificationActive(null, new Date())).toBe(false);
    expect(studentVerificationActive(undefined, new Date())).toBe(false);
    expect(studentVerificationActive("", new Date())).toBe(false);
  });

  it("is inactive for an unparseable timestamp rather than throwing", () => {
    expect(studentVerificationActive("not a date", new Date())).toBe(false);
  });

  it("tolerates a verification timestamped slightly in the future", () => {
    // The database's clock and this machine's disagree by about two minutes.
    // A verification written a moment ago can read as "future" here, and that
    // must not revoke someone's discount.
    const now = new Date("2026-01-01T00:00:00Z");
    const slightlyAhead = new Date(now.getTime() + 2 * 60_000).toISOString();
    expect(studentVerificationActive(slightlyAhead, now)).toBe(true);
  });
});

describe("studentVerificationExpiry", () => {
  it("lands exactly one window after verification", () => {
    const expiry = studentVerificationExpiry("2026-01-01T00:00:00.000Z");
    const days = (expiry.getTime() - Date.parse("2026-01-01T00:00:00.000Z")) / 86_400_000;
    expect(days).toBe(STUDENT_VERIFICATION_DAYS);
  });
});
