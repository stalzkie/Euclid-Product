import { describe, expect, it } from "vitest";
import {
  isOwnHost,
  isReserved,
  normaliseDomain,
  tokenMatches,
  verificationRecord,
} from "@/lib/domains";

describe("normaliseDomain", () => {
  it("accepts an ordinary subdomain", () => {
    expect(normaliseDomain("feedback.yourapp.com")).toEqual({
      ok: true,
      host: "feedback.yourapp.com",
    });
  });

  it.each([
    ["  Feedback.YourApp.com  ", "feedback.yourapp.com"],
    ["https://feedback.yourapp.com", "feedback.yourapp.com"],
    ["http://feedback.yourapp.com/board", "feedback.yourapp.com"],
    ["feedback.yourapp.com/", "feedback.yourapp.com"],
  ])("forgives %s", (input, expected) => {
    expect(normaliseDomain(input)).toEqual({ ok: true, host: expected });
  });

  it.each([
    ["", "empty"],
    ["localhost", "single label"],
    ["feedback", "no dot"],
    ["feedback..com", "empty label"],
    ["-feedback.com", "leading hyphen"],
    ["feedback-.com", "trailing hyphen"],
    ["feed back.com", "space"],
    ["feedback.yourapp.com:3000", "port"],
    ["me@yourapp.com", "email"],
    ["feedback.under_score.com", "underscore"],
  ])("refuses %s (%s)", (input) => {
    expect(normaliseDomain(input).ok).toBe(false);
  });

  it("refuses a label over 63 characters", () => {
    expect(normaliseDomain(`${"a".repeat(64)}.com`).ok).toBe(false);
  });

  it("refuses our own domain, which a board must never answer for", () => {
    expect(normaliseDomain("euclidhq.com").ok).toBe(false);
    expect(normaliseDomain("anything.euclidhq.com").ok).toBe(false);
  });

  it("explains the problem rather than just refusing", () => {
    const result = normaliseDomain("feedback.yourapp.com:3000");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/port/i);
  });
});

describe("isReserved", () => {
  it("covers the name and everything under it", () => {
    expect(isReserved("euclidhq.com")).toBe(true);
    expect(isReserved("board.euclidhq.com")).toBe(true);
  });

  it("does not catch a domain that merely contains the name", () => {
    expect(isReserved("euclidhq.com.attacker.net")).toBe(false);
    expect(isReserved("noteuclidhq.com")).toBe(false);
  });
});

describe("verificationRecord", () => {
  it("names the record and its value", () => {
    expect(verificationRecord("abc123")).toEqual({
      name: "_euclid",
      value: "euclid-verify=abc123",
    });
  });
});

describe("tokenMatches", () => {
  const token = "s3cr3t-token";

  it("finds the token among unrelated records", () => {
    expect(
      tokenMatches([["v=spf1 include:_spf.google.com ~all"], [`euclid-verify=${token}`]], token),
    ).toBe(true);
  });

  it("joins a record the resolver split into chunks", () => {
    expect(tokenMatches([["euclid-verify=", "s3cr3t-token"]], token)).toBe(true);
  });

  it("tolerates surrounding whitespace", () => {
    expect(tokenMatches([[`  euclid-verify=${token}  `]], token)).toBe(true);
  });

  it("refuses a different token", () => {
    expect(tokenMatches([["euclid-verify=someone-elses-token"]], token)).toBe(false);
  });

  it("refuses a record that merely contains the token", () => {
    // Someone else's TXT quoting our value must not verify their domain.
    expect(tokenMatches([[`note: euclid-verify=${token} seen elsewhere`]], token)).toBe(false);
  });

  it("refuses when there are no records at all", () => {
    expect(tokenMatches([], token)).toBe(false);
  });
});

describe("isOwnHost", () => {
  const app = "euclidhq.com";

  it.each([
    ["euclidhq.com", "the apex"],
    ["www.euclidhq.com", "www"],
    ["euclidhq.com:3000", "with a port"],
    ["localhost", "development"],
    ["127.0.0.1", "loopback"],
    ["", "missing header"],
  ])("treats %s as ours (%s)", (host) => {
    expect(isOwnHost(host, app)).toBe(true);
  });

  it.each([
    ["feedback.someapp.com", "a customer domain"],
    ["euclidhq.com.attacker.net", "our name as a prefix"],
    ["noteuclidhq.com", "our name as a suffix"],
  ])("treats %s as someone else's (%s)", (host) => {
    expect(isOwnHost(host, app)).toBe(false);
  });

  it("matches the apex when the app is configured with www", () => {
    expect(isOwnHost("euclidhq.com", "www.euclidhq.com")).toBe(true);
  });
});
