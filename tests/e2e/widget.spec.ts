import { expect, test } from "./fixture";

/**
 * The widget, mounted on a host page.
 *
 * Nothing else in the repo opens a browser at it. `scripts/widget-e2e.mjs`
 * drives the public API with `fetch`, and the integration suite does the same;
 * both would pass unchanged if the loader never attached a shadow root, or if
 * the host page's stylesheet reached straight through it. That is what these
 * specs are for.
 *
 * `public/demo/host.html` is the host page, and it is deliberately hostile: it
 * forces Comic Sans onto every button with `!important`.
 */

const HOST = "/demo/host.html";

test.describe("floating mode", () => {
  test("mounts inside a shadow root the host page cannot style", async ({ page, board }) => {
    await page.goto(`${HOST}?board=${board.publicId}`);

    const host = page.locator(`div[data-euclid="${board.publicId}"]`);
    await expect(host).toBeAttached();

    // Everything the loader renders must be behind the shadow boundary. A
    // light-DOM mount would still show a working launcher, so this asks the
    // page directly rather than trusting a locator that pierces shadow roots
    // transparently.
    const placement = await host.evaluate((el) => ({
      hasShadowRoot: Boolean(el.shadowRoot),
      launcherInShadow: Boolean(el.shadowRoot?.querySelector(".launcher")),
      panelInShadow: Boolean(el.shadowRoot?.querySelector(".panel")),
      launcherInDocument: Boolean(document.querySelector(".launcher")),
    }));
    expect(placement).toEqual({
      hasShadowRoot: true,
      launcherInShadow: true,
      panelInShadow: true,
      // `document.querySelector` does not cross a shadow boundary, so this
      // being false is the boundary existing.
      launcherInDocument: false,
    });

    // The host page's `button { font-family: "Comic Sans MS" !important }`
    // must not reach the launcher.
    //
    // A button in the host's own light DOM first, so this cannot pass by the
    // rule having quietly stopped applying to anything: if Comic Sans is not
    // reaching a plain button either, the next assertion proves nothing.
    const hostButtonFont = await page.evaluate(() => {
      const probe = document.createElement("button");
      probe.textContent = "probe";
      document.querySelector("main")?.appendChild(probe);
      const font = getComputedStyle(probe).fontFamily;
      probe.remove();
      return font;
    });
    expect(hostButtonFont.toLowerCase()).toContain("comic sans");

    const font = await page
      .locator(".launcher")
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(font.toLowerCase()).not.toContain("comic sans");
    expect(font).toContain("Geist");

    // And the widget's own styles must not leak outwards.
    const hostHeading = await page
      .locator("main h1")
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(hostHeading).toContain("Georgia");
  });

  test("the launcher opens the board, and Escape closes it", async ({ page, board }) => {
    await page.goto(`${HOST}?board=${board.publicId}`);

    const launcher = page.locator(".launcher");
    const panel = page.locator(".panel");

    await expect(launcher).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toHaveAttribute("data-open", "false");

    await launcher.click();
    await expect(launcher).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toHaveAttribute("data-open", "true");
    // Clicks are swallowed for the first 100ms of the entrance; `data-ready`
    // is the loader saying the panel will now accept them.
    await expect(panel).toHaveAttribute("data-ready", "true");

    const frame = page.locator(".panel iframe");
    await expect(frame).toHaveAttribute(
      "src",
      new RegExp(`/embed/${board.publicId}\\?mode=floating$`),
    );

    // The board itself renders inside the frame, with the seeded posts.
    const inside = page.frameLocator(".panel iframe");
    await expect(inside.getByRole("region", { name: "Driftnote feedback" })).toBeVisible();
    await expect(inside.getByText("What should we build next?")).toBeVisible();
    await expect(
      inside.getByRole("button", { name: `Vote for ${board.exportPost.title}` }),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(panel).toHaveAttribute("data-open", "false");
    await expect(launcher).toHaveAttribute("aria-expanded", "false");
    await expect(panel).not.toHaveAttribute("data-ready", "true");
  });

  test("loading the script twice mounts one widget", async ({ page, board }) => {
    await page.goto(`${HOST}?board=${board.publicId}`);
    await expect(page.locator(".launcher")).toBeVisible();

    await page.evaluate((publicId) => {
      const second = document.createElement("script");
      second.src = "/widget.js";
      second.dataset.board = publicId;
      document.body.appendChild(second);
      return new Promise<void>((resolve) => {
        second.addEventListener("load", () => resolve());
        second.addEventListener("error", () => resolve());
      });
    }, board.publicId);

    // `window.__euclidLoaded` is the guard. Without it a host page with the
    // snippet in two places gets two launchers stacked on each other.
    await expect(page.locator(`div[data-euclid="${board.publicId}"]`)).toHaveCount(1);
    await expect(page.locator(".launcher")).toHaveCount(1);
  });
});

test.describe("inline mode", () => {
  test("mounts into the founder's own container and is sized by the frame", async ({
    page,
    board,
  }) => {
    // Recorded before the loader runs, so the handshake can be asserted on
    // rather than inferred from a pixel measurement that might coincide with
    // the loader's own starting height.
    await page.addInitScript(() => {
      (window as unknown as { __heights: number[] }).__heights = [];
      window.addEventListener("message", (event) => {
        const data = event.data as { type?: string; height?: number } | null;
        if (data?.type === "euclid:height" && typeof data.height === "number") {
          (window as unknown as { __heights: number[] }).__heights.push(data.height);
        }
      });
    });

    await page.goto(`${HOST}?board=${board.publicId}&mode=inline`);

    // The host element goes inside the container the founder put on the page,
    // not at the end of the document.
    const slotted = await page
      .locator("#euclid-board")
      .evaluate(
        (slot, publicId) => Boolean(slot.querySelector(`div[data-euclid="${publicId}"]`)),
        board.publicId,
      );
    expect(slotted).toBe(true);

    const frame = page.locator("#euclid-board iframe");
    await expect(frame).toHaveAttribute(
      "src",
      new RegExp(`/embed/${board.publicId}\\?mode=inline$`),
    );

    // Inline mode has no launcher: the board is just there.
    await expect(page.locator(".launcher")).toHaveCount(0);
    await expect(page.frameLocator("#euclid-board iframe").getByText("What should we build next?")).toBeVisible();

    // The loader starts the frame at 620px and then resizes it to whatever
    // height the embedded board reports over postMessage. Nothing else covers
    // that protocol — it cannot be seen without two documents.
    await expect
      .poll(
        () => page.evaluate(() => (window as unknown as { __heights: number[] }).__heights.length),
        { message: "no euclid:height message ever reached the host page" },
      )
      .toBeGreaterThan(0);

    // And the loader does with it exactly what it promises: `max(320, height)`.
    // Read in one evaluate, because the embedded board keeps reporting as it
    // settles and a measurement taken either side of a message would compare
    // two different moments.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const heights = (window as unknown as { __heights: number[] }).__heights;
          const frame = document.querySelector("#euclid-board div[data-euclid]")
            ?.shadowRoot?.querySelector("iframe");
          if (!frame || !heights.length) return null;
          const expected = Math.max(320, Math.round(heights[heights.length - 1]));
          return Math.round(frame.getBoundingClientRect().height) - expected;
        }),
      )
      .toBe(0);
  });
});
