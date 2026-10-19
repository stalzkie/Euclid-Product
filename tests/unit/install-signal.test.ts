import { describe, expect, it } from "vitest";
import { countsAsInstall } from "@/server/public-board";

/**
 * What counts as the widget going live.
 *
 * The cases that matter are the false positives, because the indicator is a
 * one-way door: once a board is stamped it never un-stamps, so marking one
 * installed wrongly cannot be taken back by the next request.
 */

const APP = "app.euclidhq.com";

describe("countsAsInstall", () => {
  it("counts a first load from the founder's own site", () => {
    expect(countsAsInstall(null, "https://driftnote.app", APP)).toBe(true);
  });

  it("counts a subdomain of the founder's site", () => {
    expect(countsAsInstall(null, "https://www.driftnote.app/pricing", APP)).toBe(true);
  });

  it("does NOT count loopback — that is a founder still setting up", () => {
    /*
      Load-bearing for originAllowed, not a judgement about tidiness.

      It lets loopback past a non-empty allow-list only while the board has
      never been served live. If a localhost request also stamped the board,
      the first local test would revoke the very allowance that let it
      through, and every request after it would be a 403.
    */
    for (const origin of [
      "http://localhost:3000",
      "http://127.0.0.1:5173",
      "http://[::1]:8080",
      "http://app.localhost:3000",
    ]) {
      expect(countsAsInstall(null, origin, APP)).toBe(false);
    }
  });

  it("does nothing once the board is already stamped", () => {
    // The hot path: every load after the first.
    expect(countsAsInstall("2026-10-13T09:32:47Z", "https://driftnote.app", APP)).toBe(false);
  });

  it("refuses a request with no origin or referer", () => {
    // curl, a crawler, anything that is not a browser on a page.
    expect(countsAsInstall(null, null, APP)).toBe(false);
  });

  it("refuses an unparseable origin", () => {
    expect(countsAsInstall(null, "not a url", APP)).toBe(false);
  });

  it("refuses our own host — the founder previewing their hosted board", () => {
    // /b/:id renders the same board. Without this the indicator turns green
    // while the founder is still reading the install snippet.
    expect(countsAsInstall(null, `https://${APP}/b/brd_test`, APP)).toBe(false);
  });

  it("refuses the www form of our own host", () => {
    expect(countsAsInstall(null, `https://www.${APP}`, APP)).toBe(false);
  });

  it("counts a preview deployment of Euclid itself, and that is fine", () => {
    // An accepted false positive: enumerating our own preview hosts is a
    // losing game, and the only person who opens one is us.
    expect(countsAsInstall(null, "https://euclid-product-abc123.vercel.app", APP)).toBe(true);
  });

  it("is case-insensitive about the host", () => {
    expect(countsAsInstall(null, `https://${APP.toUpperCase()}/b/x`, APP)).toBe(false);
  });

  it("is not fooled by a host that merely contains ours", () => {
    // The near miss the allow-list tests also guard: a different domain that
    // happens to end in our name is somebody else's site, and a real install.
    expect(countsAsInstall(null, "https://notapp.euclidhq.com.evil.test", APP)).toBe(true);
  });
});

/**
 * The e2e suite cannot stamp a board, in either configuration it runs in.
 *
 * ROADMAP.md carried this as an open defect — "the e2e suite stamps
 * `installed_at` on any board it drives with a non-loopback Origin, because
 * it runs against the production database". It does not, and the reason is
 * worth pinning rather than rediscovering.
 *
 * `widget.spec.ts` drives `/demo/host.html`, which Next serves from the app
 * itself. So the Origin is always the app's own: `http://localhost:3000`
 * when `TEST_APP_URL` is unset, and the deployed host when it is pointed at
 * one. The first is refused as loopback; the second is refused as our own
 * host. There is no third configuration — the host page has no other origin
 * to be served from.
 *
 * This matters more than tidiness because the stamp is a one-way door that
 * also revokes the loopback allowance in `originAllowed`. A suite that
 * stamped its own fixture board would start 403ing itself partway through a
 * run, and that would read as a flaky product rather than a flaky suite.
 */
describe("the e2e host page never counts as an install", () => {
  it.each([
    ["the default local target", "http://localhost:3000", "localhost:3000"],
    ["a deployed target", "https://app.euclidhq.com", "app.euclidhq.com"],
  ])("%s", (_label, origin, appHost) => {
    expect(countsAsInstall(null, origin, appHost)).toBe(false);
  });

  it("would count if the host page were ever served from somewhere else", () => {
    // The counterpart, so the two above cannot pass by `countsAsInstall`
    // having quietly started refusing everything. If someone moves the demo
    // host page onto its own domain, this is the line that says the stamp
    // comes back with it.
    expect(countsAsInstall(null, "https://demo.example.test", "localhost:3000")).toBe(true);
  });
});
