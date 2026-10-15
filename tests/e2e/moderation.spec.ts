import { APP_URL, db } from "../integration/setup";
import { expect, test } from "./fixture";

/**
 * The approval queue.
 *
 * This is the spec that would have caught the queue being missing. Holding a
 * post always worked — `submitPost` writes `approved: false` and every read
 * path filters `approved = true` — so a unit test of the hold would have
 * passed happily while the post sat invisible for ever. The only question
 * worth asking is the one a browser can ask: having held it, can the founder
 * actually get to it, and does approving put it on the board?
 *
 * Each test turns `require_approval` on for the fixture board and off again,
 * rather than asking for a second board. The specs run serially, and leaving
 * the flag on would hold every later spec's posts.
 */

async function setApproval(boardId: string, on: boolean): Promise<void> {
  await db.patch(`boards?id=eq.${boardId}`, { require_approval: on });
}

/** Posts as a fresh anonymous visitor, the way the widget does. */
async function post(
  publicId: string,
  title: string,
  body: string,
): Promise<{ number: number; held: boolean }> {
  const res = await fetch(`${APP_URL}/api/public/post`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP_URL },
    body: JSON.stringify({ board: publicId, title, body, category: "Feature" }),
  });
  const json = (await res.json()) as { number?: number; held?: boolean; error?: string };
  if (!res.ok || typeof json.number !== "number") {
    throw new Error(`posting "${title}" failed: ${res.status} ${json.error ?? ""}`);
  }
  return { number: json.number, held: json.held === true };
}

test("a held post is invisible publicly, and the founder can approve it onto the board", async ({
  page,
  board,
  founder,
}) => {
  const title = `Keyboard shortcuts for the entry list ${Date.now()}`;
  await setApproval(board.boardId, true);
  let held: { number: number; held: boolean };
  try {
    held = await post(board.publicId, title, "Arrow keys to move, enter to open.");
  } finally {
    await setApproval(board.boardId, false);
  }

  expect(held.held).toBe(true);

  // Invisible to the public first, because that is the promise being kept
  // while it waits — and the state the old code never came back from.
  //
  // `?tab=ideas` matters: the board opens on the roadmap, which lists nothing
  // under review. Without it this would pass on a board that had published
  // the post immediately, which is the opposite of what is being checked.
  await page.goto(`/b/${board.publicId}?tab=ideas`);
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);

  await founder.signIn(page, "/feedback");

  // The inbox cannot list it, so the banner is the only route in. It is
  // deliberately not dismissible; if this assertion ever has to be relaxed,
  // the queue has become unreachable again.
  const banner = page.getByRole("note").filter({ hasText: "held for approval" });
  await expect(banner).toBeVisible();
  await banner.getByRole("link", { name: /Review/ }).click();

  await expect(page).toHaveURL(/\/feedback\?view=held/);
  await expect(page.getByRole("heading", { name: "Held for approval" })).toBeVisible();

  // The body, not just the title. A spam post's title is the part written to
  // look legitimate, so a queue that showed only titles would not be a review.
  await expect(page.getByText("Arrow keys to move, enter to open.")).toBeVisible();

  await page.getByRole("button", { name: "Approve" }).first().click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();

  await page.goto(`/b/${board.publicId}?tab=ideas`);
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
});

test("rejecting a held post removes it, and it never reaches the board", async ({
  page,
  board,
  founder,
}) => {
  const title = `Buy cheap followers now ${Date.now()}`;
  await setApproval(board.boardId, true);
  try {
    await post(board.publicId, title, "Visit our site for a special offer.");
  } finally {
    await setApproval(board.boardId, false);
  }

  await founder.signIn(page, "/feedback?view=held");

  const card = page.locator("article, div").filter({ hasText: title }).last();
  await expect(card).toBeVisible();

  await page.getByRole("button", { name: "Reject" }).first().click();
  await expect(page.getByText("Rejected", { exact: true })).toBeVisible();

  // Gone from the queue on a fresh load, not merely crossed out in this one.
  await page.goto("/feedback?view=held");
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);

  await page.goto(`/b/${board.publicId}?tab=ideas`);
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
});

test("the banner stays away when nothing is held", async ({ page, board, founder }) => {
  await founder.signIn(page, "/feedback");
  await expect(page.getByText(board.posts[0].title, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("note").filter({ hasText: "held for approval" })).toHaveCount(0);
});
