import { describe, expect, it } from "vitest";
import { clientIp, ipBucket, ipPrefix } from "@/server/ip";

/**
 * The IP rate-limit key.
 *
 * Two kinds of mistake matter here and they fail in opposite directions. Too
 * narrow and an IPv6 visitor rotates inside their own /64 and is effectively
 * unlimited. Too wide and unrelated people share a bucket and rate-limit each
 * other, which looks exactly like the service being broken.
 */

const headers = (map: Record<string, string>) => (name: string) => map[name] ?? null;

describe("clientIp", () => {
  it("prefers the headers a caller cannot forge", () => {
    // If the platform sets either of these, the forgeable list is never read.
    expect(
      clientIp(headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" })),
    ).toBe("203.0.113.7");
    expect(
      clientIp(headers({ "x-vercel-forwarded-for": "203.0.113.9", "x-real-ip": "198.51.100.1" })),
    ).toBe("203.0.113.9");
  });

  it("takes the first entry of a forwarded list", () => {
    expect(clientIp(headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18" }))).toBe("203.0.113.7");
  });

  it("returns null when nothing offers an address", () => {
    // Local development. The caller skips the IP check rather than blocking.
    expect(clientIp(headers({}))).toBeNull();
    expect(clientIp(headers({ "x-forwarded-for": "   " }))).toBeNull();
  });
});

describe("ipPrefix", () => {
  it("keeps an IPv4 address whole", () => {
    expect(ipPrefix("203.0.113.7")).toBe("203.0.113.7");
  });

  it("cuts IPv6 to its /64", () => {
    // One customer is routinely handed a whole /64 and rotates inside it.
    expect(ipPrefix("2001:db8:85a3:1234:5678:8a2e:370:7334")).toBe("2001:0db8:85a3:1234");
  });

  it("groups addresses from the same /64 together", () => {
    const a = ipPrefix("2001:db8:85a3:1234:aaaa:0:0:1");
    const b = ipPrefix("2001:db8:85a3:1234:ffff:0:0:9");
    expect(a).toBe(b);
  });

  it("keeps different /64s apart", () => {
    expect(ipPrefix("2001:db8:85a3:1234::1")).not.toBe(ipPrefix("2001:db8:85a3:9999::1"));
  });

  it("expands :: compression", () => {
    expect(ipPrefix("2001:db8::1")).toBe("2001:0db8:0000:0000");
  });

  it("treats an IPv4-mapped address as IPv4", () => {
    // The case that would otherwise collapse the entire IPv4 internet into a
    // single ::/64 bucket, rate-limiting every visitor against every other.
    expect(ipPrefix("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("strips a zone id and brackets", () => {
    expect(ipPrefix("[2001:db8::1]")).toBe("2001:0db8:0000:0000");
    expect(ipPrefix("fe80::1%eth0")).toBe("fe80:0000:0000:0000");
  });

  it("refuses nonsense rather than inventing a shared bucket", () => {
    for (const bad of ["", "   ", "not-an-ip", "999.1.1.1", "2001:zzzz::1"]) {
      expect(ipPrefix(bad)).toBeNull();
    }
  });
});

describe("ipBucket", () => {
  const SECRET = "test-secret";

  it("is stable for one address and distinct between two", () => {
    expect(ipBucket("203.0.113.7", SECRET)).toBe(ipBucket("203.0.113.7", SECRET));
    expect(ipBucket("203.0.113.7", SECRET)).not.toBe(ipBucket("203.0.113.8", SECRET));
  });

  it("never contains the address it was built from", () => {
    const key = ipBucket("203.0.113.7", SECRET)!;
    expect(key).not.toContain("203.0.113.7");
    expect(key.startsWith("ip_")).toBe(true);
  });

  it("depends on the secret, so the hash is not a lookup table", () => {
    // IPv4 is four billion addresses: an unkeyed digest would be enumerable.
    expect(ipBucket("203.0.113.7", "one")).not.toBe(ipBucket("203.0.113.7", "two"));
  });

  it("returns null when there is no address or no secret", () => {
    expect(ipBucket(null, SECRET)).toBeNull();
    expect(ipBucket("203.0.113.7", undefined)).toBeNull();
    expect(ipBucket("nonsense", SECRET)).toBeNull();
  });
});
