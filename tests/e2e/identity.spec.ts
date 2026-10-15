import { createHmac } from "node:crypto";
import { db } from "../integration/setup";
import { expect, test } from "./fixture";

/**
 * JWT identity, through the browser.
 *
 * `tests/unit/identity.test.ts` already proves `verifyJwt` rejects what it
 * should, and `scripts/test-identity.mjs` drives the API with a token in hand.
 * Neither touches the hand-off, which is where the feature actually lives:
 * the host page defines `window.EuclidIdentity`, the loader resolves it,
 * appends `&token=` to the frame URL, and the board inside the frame says who
 * you are. Four links, three of them only existing in a browser.
 *
 * The loader swallows a failing `EuclidIdentity` on purpose — a host app
 * whose token endpoint is down should get an anonymous board, not no board.
 * That silence is why the chain needs a test: every link can break quietly.
 */

const HOST = "/demo/host.html";
const SECRET = "e2e-jwt-secret-not-used-anywhere-else";

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

function sign(claims: Record<string, unknown>, secret = SECRET): string {
  const header = b64({ alg: "HS256", typ: "JWT" });
  const payload = b64({ iat: Math.floor(Date.now() / 1000), ...claims });
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/**
 * The fixture board is anonymous, because most specs want a visitor who can
 * post without a mailbox. These specs need it in JWT mode, and must hand it
 * back: the suite runs serially against one board.
 */
async function withJwtMode(boardId: string, run: () => Promise<void>): Promise<void> {
  await db.patch(`boards?id=eq.${boardId}`, {
    identity_mode: "jwt",
    jwt_secret: SECRET,
  });
  try {
    await run();
  } finally {
    await db.patch(`boards?id=eq.${boardId}`, {
      identity_mode: "anonymous",
      jwt_secret: null,
    });
  }
}

async function openPanel(page: import("@playwright/test").Page) {
  const launcher = page.locator(".launcher");
  await expect(launcher).toBeVisible();
  await launcher.click();
  await expect(page.locator(".panel")).toHaveAttribute("data-ready", "true");
}

test("a signed token reaches the frame and names the person posting", async ({
  page,
  board,
}) => {
  await withJwtMode(board.boardId, async () => {
    const token = sign({ sub: "host-user-88", email: "rosa@driftnote.test", name: "Rosa" });
    await page.goto(`${HOST}?board=${board.publicId}&token=${encodeURIComponent(token)}`);

    await openPanel(page);

    // Link one: the loader resolved window.EuclidIdentity and put the token on
    // the frame URL. Asserted on the attribute rather than inferred from the
    // contents, so a board that identifies someone by another route cannot
    // make this pass.
    const frame = page.locator(".panel iframe");
    await expect(frame).toHaveAttribute("src", new RegExp(`&token=${encodeURIComponent(token)}$`));

    // Link two: the frame verified it and resolved a viewer. The label falls
    // back email -> name -> null, so the email proves the claims were read and
    // not merely the signature checked.
    const inside = page.frameLocator(".panel iframe");
    await expect(inside.getByText("Posting as rosa@driftnote.test")).toBeVisible();
  });
});

test("a post made with a token is attributed to that person", async ({ page, board }) => {
  await withJwtMode(board.boardId, async () => {
    const token = sign({ sub: "host-user-91", email: "ivo@driftnote.test", name: "Ivo" });
    await page.goto(`${HOST}?board=${board.publicId}&token=${encodeURIComponent(token)}`);
    await openPanel(page);

    const inside = page.frameLocator(".panel iframe");
    const title = `Weekly digest of new entries ${Date.now()}`;

    // The compose form is the Ideas tab itself, not behind a button.
    await inside.getByLabel("Your idea").fill(title);
    await inside.getByRole("button", { name: "Post idea" }).click();

    await expect(inside.getByText(/Posted as #\d+\. We read every post\./)).toBeVisible();

    // The row, not the screen. A viewer resolved for the duration of a render
    // and then dropped would look identical in the panel.
    const rows = await db.select<{ title: string; author: { external_key: string } | null }>(
      `posts?title=eq.${encodeURIComponent(title)}&select=title,author:end_users(external_key)`,
    );
    expect(rows[0]?.author?.external_key).toBe("jwt:host-user-91");
  });
});

test("a token signed with the wrong secret leaves an anonymous, working board", async ({
  page,
  board,
}) => {
  await withJwtMode(board.boardId, async () => {
    const forged = sign({ sub: "intruder", email: "mallory@driftnote.test" }, "not-the-secret");
    await page.goto(`${HOST}?board=${board.publicId}&token=${encodeURIComponent(forged)}`);

    await openPanel(page);
    const inside = page.frameLocator(".panel iframe");

    // The board still loads. A rejected token must degrade to anonymous, not
    // to a broken widget on someone's marketing site.
    await expect(inside.getByRole("region", { name: /feedback/i })).toBeVisible();

    // But it must not name them. This is the assertion that would catch a
    // verifier that decoded the claims before checking the signature.
    await expect(inside.getByText("mallory@driftnote.test")).toHaveCount(0);
    await expect(inside.getByText(/^Posting as/)).toHaveCount(0);
  });
});

test("no EuclidIdentity on the host page means no token on the frame", async ({
  page,
  board,
}) => {
  await withJwtMode(board.boardId, async () => {
    await page.goto(`${HOST}?board=${board.publicId}`);
    await openPanel(page);

    const frame = page.locator(".panel iframe");
    await expect(frame).toHaveAttribute("src", /mode=floating$/);
    await expect(page.frameLocator(".panel iframe").getByText(/^Posting as/)).toHaveCount(0);
  });
});
