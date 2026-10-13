import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixture";

/**
 * The public board, used the way an end user uses it: vote, post, comment.
 *
 * The integration suite already asserts what `/api/public/*` returns. These
 * specs are about the half of that flow that lives in the browser — the
 * optimistic vote that has to survive a reload, the duplicate nudge that only
 * appears after a debounce, the honeypot that no person can see, and the
 * visitor cookie that ties all three to one anonymous identity.
 *
 * Each test gets its own browser context, so each arrives as a visitor who has
 * never been here before. That is deliberate: a shared cookie would make the
 * vote counts depend on the order the tests happened to run in.
 */

/**
 * The count inside a vote button. The visible digits are animated cells with
 * old values still on their way out, so the number is read from the
 * screen-reader copy, which is always exactly one value.
 */
function voteCount(scope: Page | Locator, title: string): Locator {
  return scope.getByRole("button", { name: `Vote for ${title}` }).locator(".sr-only");
}

/** Types into a React-controlled input that no person can reach. */
async function fillHidden(page: Page, selector: string, value: string): Promise<void> {
  await page.evaluate(
    ({ selector, value }) => {
      const input = document.querySelector(selector) as HTMLInputElement | null;
      if (!input) throw new Error(`no element matched ${selector}`);
      // React listens for the native `input` event and ignores a plain value
      // assignment, so the value goes in through the prototype's setter.
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { selector, value },
  );
}

test("the board opens on the roadmap, and the ideas tab lists the posts", async ({
  page,
  board,
}) => {
  // The hosted board's own default is the roadmap — a shared link is meant to
  // answer "what are you building" before it asks for anything. Every other
  // spec here goes straight to `?tab=ideas` rather than clicking through.
  await page.goto(`/b/${board.publicId}`);
  await expect(page.getByRole("tab", { name: "Roadmap" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText(board.exportPost.title, { exact: true })).toHaveCount(0);

  await page.getByRole("tab", { name: "Ideas" }).click();

  await expect(page.getByRole("heading", { name: "What should we build next?" })).toBeVisible();
  for (const post of board.posts) {
    await expect(page.getByText(post.title, { exact: true })).toBeVisible();
  }

  // Every seeded post carries its author's own vote, so none of them reads
  // zero — which is the whole reason `submitPost` inserts that vote.
  await expect(voteCount(page, board.exportPost.title)).toHaveText("1");
});

test("a vote counts, toggles back, and survives a reload", async ({ page, board }) => {
  const title = board.exportPost.title;

  /*
    The board updates the digits before the request has gone anywhere and rolls
    them back if it fails, so the visible count says nothing about what was
    stored. Reloading on the strength of it raced the POST and cancelled the
    very vote the next assertion was about — so each click here waits for its
    own response.
  */
  const vote = async () => {
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/public/vote")),
      page.getByRole("button", { name: `Vote for ${title}` }).click(),
    ]);
    expect(response.status()).toBe(200);
  };

  await page.goto(`/b/${board.publicId}?tab=ideas`);

  await expect(page.getByRole("button", { name: `Vote for ${title}` })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(voteCount(page, title)).toHaveText("1");

  await vote();
  await expect(page.getByRole("button", { name: `Vote for ${title}` })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(voteCount(page, title)).toHaveText("2");

  // The vote was written against a visitor cookie the response set, so a
  // reload has to come back still pressed. This is the assertion that fails if
  // that cookie's `Secure`/`SameSite=None` attributes ever stop being accepted
  // by a browser: the optimistic update would still look right.
  await page.reload();
  await expect(page.getByRole("button", { name: `Vote for ${title}` })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(voteCount(page, title)).toHaveText("2");

  await vote();
  await expect(voteCount(page, title)).toHaveText("1");
  await page.reload();
  await expect(page.getByRole("button", { name: `Vote for ${title}` })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(voteCount(page, title)).toHaveText("1");
});

test("typing a near-duplicate nudges toward the existing post", async ({ page, board }) => {
  await page.goto(`/b/${board.publicId}?tab=ideas`);

  const panel = page.getByRole("complementary");
  await panel.getByLabel("Your idea").fill("Export entries to Markdown");

  // Two passes run behind a 300ms debounce: a keyword match that lands almost
  // at once, then a semantic one that replaces it. Both have to find this post
  // or the nudge appears and then vanishes, which is why the fixture's posts
  // are submitted through the API and carry an embedding.
  const nudge = panel.getByText("Already suggested? Vote instead, it counts more.");
  await expect(nudge).toBeVisible();
  await expect(panel.getByRole("button", { name: `Vote for ${board.exportPost.title}` })).toBeVisible();

  // The nudge is derived from the title, so clearing the box hides it again
  // without a round trip.
  await panel.getByLabel("Your idea").fill("");
  await expect(nudge).not.toBeVisible();
});

test("an end user posts an idea and it joins the list", async ({ page, board }) => {
  await page.goto(`/b/${board.publicId}?tab=ideas`);

  const panel = page.getByRole("complementary");
  const title = `Weekly email summary of my entries ${Date.now() % 100000}`;

  await panel.getByLabel("Your idea").fill(title);
  await panel.getByLabel(/^Details/).fill("Every Sunday morning, with the week's word count.");
  await panel.getByRole("button", { name: "Post idea" }).click();

  await expect(panel.getByRole("status")).toContainText(/^Posted as #\d+\./);
  // The list is updated from the response rather than a refetch, so the new
  // post has to appear without a reload.
  await expect(page.getByText(title, { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
});

test("the honeypot refuses a bot", async ({ page, board }) => {
  await page.goto(`/b/${board.publicId}?tab=ideas`);

  const panel = page.getByRole("complementary");
  await panel.getByLabel("Your idea").fill("Buy cheap followers now");

  // The field is a one-pixel, aria-hidden, pointer-events-none label that no
  // person can type into — which is exactly why a filled one is a bot.
  await fillHidden(page, 'aside input[tabindex="-1"]', "http://spam.example");

  await panel.getByRole("button", { name: "Post idea" }).click();

  await expect(panel.getByRole("alert")).toHaveText("Could not post that.");
  await expect(page.getByText("Buy cheap followers now", { exact: true })).toHaveCount(0);
});

test("a visitor comments on a permalink", async ({ page, board }) => {
  const post = board.exportPost;

  // Commenting needs a viewer, and on an anonymous board one is minted for
  // whoever shows up — so a visitor who arrives cold at a shared permalink can
  // still say something, which is the point of sharing it.
  await page.goto(`/b/${board.publicId}/p/${post.number}`);
  await expect(page.getByRole("heading", { name: post.title })).toBeVisible();

  const body = `Dates in the filename, please. ${Date.now() % 100000}`;
  await page.getByPlaceholder("Add what you are trying to do").fill(body);
  await page.getByRole("button", { name: "Comment" }).click();

  await expect(page.getByText(body, { exact: true })).toBeVisible();
  await expect(page.getByText(/1 comment$/)).toBeVisible();

  // And it is stored, not just rendered.
  await page.reload();
  await expect(page.getByText(body, { exact: true })).toBeVisible();
});
