import type { Page } from "@playwright/test";
import { OPERATOR_EMAIL, expect, test, type E2EFounder } from "./fixture";
import { adminEmails } from "@/server/admin";

/**
 * The operator console, in a browser.
 *
 * Ten tabs, a person page and a gate, none of which had a test that opened
 * them. The derivations behind them are unit-tested and the reads are
 * integration-tested, so what is left is exactly what only a browser can
 * catch: a page that throws while rendering, a server component that trips
 * over a null in real data, a tab that 404s because its folder is named
 * wrongly. Those fail identically in a type check — they pass it.
 *
 * The gate is the first test for a reason. Everything behind it reads every
 * workspace's data, so a bug that opens it leaks every founder's operational
 * data at once, and "404 for a founder who is not an operator" is the single
 * most important assertion in this file.
 *
 * It needs the operator's address on the `ADMIN_EMAILS` allow-list, which is
 * an environment variable read at request time:
 *
 *   ADMIN_EMAILS="$(grep ^ADMIN_EMAILS .env.local | cut -d= -f2),e2e-operator@euclid.test" \
 *     npx playwright test tests/e2e/admin.spec.ts
 *
 * Without it the console tests skip rather than fail, because a machine that
 * has not opted in is not broken — but the gate test runs either way, since a
 * founder must be refused whatever the list says.
 */

const allowListed = adminEmails().includes(OPERATOR_EMAIL);

/** Signed in *and* landed: see the note in analytics.spec.ts for why both. */
async function signedIn(page: Page, who: E2EFounder, next?: string): Promise<void> {
  await who.signIn(page, next);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test("the console is closed to a founder who is not an operator", async ({ page, founder }) => {
  await signedIn(page, founder);
  await page.goto("/admin");

  // 404, not 403: a founder who stumbles on /admin learns nothing from a page
  // that is not there, where "forbidden" would confirm there is something
  // worth getting at.
  await expect(page.getByText(/could not be found/i)).toBeVisible();
  await expect(page.getByText("Euclid · Operations")).toBeHidden();
});

test.describe("signed in as an operator", () => {
  test.skip(
    !allowListed,
    `${OPERATOR_EMAIL} is not in ADMIN_EMAILS — see the note at the top of this file`,
  );

  /** Every tab, with something on it that only that tab renders. */
  const TABS: { path: string; heading: string; proof: RegExp }[] = [
    { path: "/admin", heading: "Overview", proof: /Activation funnel/i },
    { path: "/admin/people", heading: "People", proof: /Anonymous visitors/i },
    { path: "/admin/workspaces", heading: "Workspaces", proof: /Installed but silent/i },
    { path: "/admin/events", heading: "Events", proof: /Filter by kind/i },
    { path: "/admin/behaviour", heading: "Behaviour", proof: /Captured, not derived/i },
    { path: "/admin/retention", heading: "Retention", proof: /Cohort grid/i },
    { path: "/admin/boards", heading: "Boards", proof: /Blocked by allow-list/i },
    { path: "/admin/billing", heading: "Billing", proof: /ARR run rate/i },
    { path: "/admin/mail", heading: "Mail and queues", proof: /Magic links/i },
    { path: "/admin/errors", heading: "Errors", proof: /Open by route/i },
  ];

  for (const tab of TABS) {
    test(`${tab.heading} renders`, async ({ page, operator }) => {
      /*
        Both channels, because the same fault speaks through different ones.

        A built app throws React's minified #418 as a page error; a dev server
        logs the unminified "In HTML, <a> cannot be a child of <a>" to the
        console instead. Listening to only one of them is how four tabs
        shipped with nested anchors in the first place — the server HTML was
        fine, the hydrated tree was not, and nothing in a type check or a
        screenshot shows it.
      */
      const failures: string[] = [];
      page.on("pageerror", (err) => failures.push(err.message));
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        if (/hydrat|cannot be a child|#418|#423|#425/i.test(text)) failures.push(text);
      });

      await signedIn(page, operator, tab.path);

      await expect(page.getByRole("heading", { level: 1, name: tab.heading })).toBeVisible();
      await expect(page.getByText(tab.proof).first()).toBeVisible();

      // The frame, which is the whole point of the rebuild: the operator bar
      // is there and the founder sidebar is not.
      await expect(page.getByText("Euclid · Operations")).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
      await expect(page.getByRole("navigation", { name: "Operations" })).toBeVisible();

      expect(failures, failures.join("; ")).toEqual([]);
    });
  }

  test("the tab strip reaches every tab without touching a URL", async ({ page, operator }) => {
    await signedIn(page, operator, "/admin");

    for (const tab of TABS.slice(1)) {
      await page.getByRole("navigation", { name: "Operations" }).getByText(tab.heading.split(" ")[0], { exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: tab.heading })).toBeVisible();
    }
  });

  test("People names the operator's own address, and opens their person page", async ({
    page,
    operator,
  }) => {
    await signedIn(page, operator, "/admin/people");

    // The point of the whole console: the row names the person. The operator
    // is in it because they are a founder too, with the workspace the fixture
    // made.
    const address = page.getByRole("link", { name: OPERATOR_EMAIL }).first();
    await expect(address).toBeVisible();
    await expect(address).toHaveAttribute("href", `mailto:${OPERATOR_EMAIL}`);

    // And the chip that says this login is on the allow-list.
    await expect(page.getByText("operator", { exact: true }).first()).toBeVisible();

    await page
      .getByRole("row")
      .filter({ hasText: OPERATOR_EMAIL })
      .getByRole("link", { name: "open" })
      .first()
      .click();

    await expect(page.getByRole("heading", { level: 1 })).toContainText(OPERATOR_EMAIL);
    await expect(page.getByText("Sign-in provider")).toBeVisible();
    await expect(page.getByText("Timeline")).toBeVisible();
  });

  test("the funnel hands over the addresses that stopped at a step", async ({ page, operator }) => {
    await signedIn(page, operator, "/admin");

    // The fixture workspace is onboarded but has no installed widget, so
    // there is always at least one step with somebody behind it. Opening the
    // disclosure is what proves the addresses are there rather than a count.
    const stuck = page.getByText(/stopped before this step/).first();
    await expect(stuck).toBeVisible();
    await stuck.click();
    await expect(page.getByRole("link", { name: /@/ }).first()).toBeVisible();
  });

  test("Behaviour excludes the operator's own clicking by default", async ({ page, operator }) => {
    // Whoever reads this screen also opens every other screen all day. With
    // them counted, the busiest screen is always whichever one was last being
    // debugged — so the default must be to leave them out, and the toggle
    // must say which way it is set.
    await signedIn(page, operator, "/admin/behaviour");

    const toggle = page.getByRole("link", { name: /Operators (excluded|included)/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText("excluded");

    await toggle.click();
    await expect(page.getByRole("link", { name: /Operators included/ })).toBeVisible();
  });
});
