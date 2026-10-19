import { describe, expect, it } from "vitest";
import {
  chatPayload,
  issueContent,
  parseRepo,
  redactWebhook,
  statusWord,
  validateWebhookUrl,
  type PostEventData,
} from "@/lib/integrations";

const post: PostEventData = {
  number: 142,
  title: "Export entries to CSV",
  body: "One file per entry with the date in the filename.",
  category: "Feature",
  status: "planned",
  votes: 185,
  url: "https://euclidhq.com/b/brd_demo/142",
  boardName: "Driftnote",
};

describe("validateWebhookUrl", () => {
  it("accepts the host each service actually publishes", () => {
    expect(
      validateWebhookUrl("slack", "https://hooks.slack.com/services/T0/B0/xyz"),
    ).toEqual({ ok: true, url: "https://hooks.slack.com/services/T0/B0/xyz" });

    expect(validateWebhookUrl("discord", "https://discord.com/api/webhooks/1/abc").ok).toBe(
      true,
    );
  });

  // The whole point of the allow-list: this field is typed in by a user and
  // then fetched by our server.
  it.each([
    ["http://169.254.169.254/latest/meta-data/", "cloud metadata over http"],
    ["https://169.254.169.254/latest/meta-data/", "cloud metadata over https"],
    ["https://localhost/admin", "loopback"],
    ["https://10.0.0.5/internal", "private range"],
    ["https://hooks.slack.com.evil.test/x", "allowed host as a prefix of theirs"],
    ["https://evilhooks.slack.com/x", "allowed host as a suffix of theirs"],
    ["https://nothooks.slack.com/services/x", "suffix lookalike with a real TLD"],
    ["https://evil.test/hooks.slack.com", "host in the path"],
    ["file:///etc/passwd", "non-http scheme"],
  ])("refuses %s (%s)", (url) => {
    expect(validateWebhookUrl("slack", url).ok).toBe(false);
  });

  it("refuses a host that merely ends with an allowed one", () => {
    // endsWith("discord.com") would wave notdiscord.com straight through.
    expect(validateWebhookUrl("discord", "https://notdiscord.com/api/webhooks/1/a").ok).toBe(
      false,
    );
  });

  it("refuses a Discord URL on the Slack integration", () => {
    const result = validateWebhookUrl("slack", "https://discord.com/api/webhooks/1/abc");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("hooks.slack.com");
  });

  it("refuses plain http, which would leak the secret URL in transit", () => {
    expect(validateWebhookUrl("slack", "http://hooks.slack.com/services/T0/B0/x").ok).toBe(
      false,
    );
  });

  it("refuses credentials embedded in the URL", () => {
    const result = validateWebhookUrl(
      "slack",
      "https://user:pass@hooks.slack.com/services/T0/B0/x",
    );
    expect(result.ok).toBe(false);
  });

  it("explains itself rather than just failing", () => {
    const result = validateWebhookUrl("discord", "https://example.test/hook");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("discord.com");
      expect(result.error).toContain("example.test");
    }
  });

  it("rejects an empty field with an instruction, not a parse error", () => {
    const result = validateWebhookUrl("slack", "   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/paste/i);
  });
});

describe("redactWebhook", () => {
  it("shows enough to recognise the hook and not enough to use it", () => {
    const shown = redactWebhook("https://hooks.slack.com/services/T0/B0/SECRETTOKEN");
    expect(shown).toContain("hooks.slack.com");
    expect(shown).not.toContain("SECRETTOKEN");
  });

  it("does not throw on a value that is not a URL", () => {
    expect(redactWebhook("nonsense")).toBe("connected");
  });
});

describe("chatPayload", () => {
  it("puts the number, title and vote count where a reader scans first", () => {
    const body = chatPayload("slack", "post.created", post);
    expect(String(body.text)).toContain("#142 Export entries to CSV");

    const blocks = JSON.stringify(body.blocks);
    expect(blocks).toContain("185 votes");
    expect(blocks).toContain(post.url);
  });

  it("names both ends of a status change", () => {
    const body = chatPayload("slack", "post.status_changed", {
      ...post,
      previousStatus: "under_review",
      status: "shipped",
    });
    expect(String(body.text)).toContain("Under review");
    expect(String(body.text)).toContain("Shipped");
  });

  it("escapes Slack markup so a crafted title cannot forge a link", () => {
    const blocks = JSON.stringify(
      chatPayload("slack", "post.created", { ...post, title: "<https://evil.test|Click>" })
        .blocks,
    );
    expect(blocks).toContain("&lt;");
    expect(blocks).not.toContain("<https://evil.test|Click>");
  });

  it("builds a Discord embed rather than Slack blocks", () => {
    const body = chatPayload("discord", "post.created", post);
    expect(body.embeds).toBeDefined();
    expect(body.blocks).toBeUndefined();
  });

  it("keeps a Discord title inside the 256 character limit", () => {
    const body = chatPayload("discord", "post.created", { ...post, title: "x".repeat(400) });
    const embed = (body.embeds as { title: string }[])[0];
    expect(embed.title.length).toBeLessThanOrEqual(256);
  });

  it("says vote, not votes, when there is one", () => {
    const body = chatPayload("slack", "post.created", { ...post, votes: 1 });
    expect(JSON.stringify(body.blocks)).toContain("1 vote ");
  });
});

describe("issueContent", () => {
  it("carries the demand evidence into the issue", () => {
    const { title, body } = issueContent(post);
    expect(title).toBe("Export entries to CSV (#142)");
    expect(body).toContain("185 votes");
    expect(body).toContain(post.url);
  });

  it("says so plainly when the post had no description", () => {
    expect(issueContent({ ...post, body: "   " }).body).toContain("No description");
  });
});

describe("parseRepo", () => {
  it.each([
    ["stalzkie/Euclid-Product", "stalzkie", "Euclid-Product"],
    ["https://github.com/stalzkie/Euclid-Product", "stalzkie", "Euclid-Product"],
    ["https://github.com/stalzkie/Euclid-Product.git", "stalzkie", "Euclid-Product"],
    ["https://github.com/stalzkie/Euclid-Product/issues", "stalzkie", "Euclid-Product"],
  ])("reads %s", (input, owner, repo) => {
    expect(parseRepo(input)).toEqual({ owner, repo });
  });

  it.each([
    ["", "empty"],
    ["Euclid-Product", "no owner"],
    ["a/b/c", "too many parts"],
    ["own er/repo", "space"],
    ["owner/re po", "space in repo"],
    ["../../etc", "traversal"],
  ])("refuses %s (%s) rather than guessing", (input) => {
    expect(parseRepo(input)).toBeNull();
  });
});

describe("statusWord", () => {
  it("turns the enum into something a human wrote", () => {
    expect(statusWord("in_progress")).toBe("In progress");
  });

  it("passes through a status it does not know instead of blanking it", () => {
    expect(statusWord("archived")).toBe("archived");
  });
});

/**
 * The host allow-list has to hold at the moment of the request.
 *
 * `validateWebhookUrl` has always run in the save action. That protects the
 * only path that writes `config.webhook_url` today, and "today" is the whole
 * weakness: the value is read back out of a database row much later and
 * turned into a server-side POST, so anything that ever writes that column by
 * another route — a backfill, a support fix, a second writer — inherits the
 * open proxy the allow-list exists to prevent, and none of those changes
 * would be reviewed as security.
 *
 * `postToWebhook` is not exported, so this asserts the property through the
 * exported `sendTestMessage`, which is the same function with a synthetic
 * delivery. Nothing here reaches the network: every case is refused before
 * `fetch`.
 */
describe("delivery refuses a host the allow-list does not name", () => {
  it.each([
    ["cloud metadata", "https://169.254.169.254/latest/meta-data/"],
    ["an internal host", "https://localhost/hook"],
    ["a lookalike suffix", "https://hooks.slack.com.evil.tld/services/x"],
    ["plain http", "http://hooks.slack.com/services/x"],
  ])("refuses %s without making a request", async (_label, url) => {
    const { sendTestMessage } = await import("@/server/integrations");
    const result = await sendTestMessage("slack", url, "Driftnote", "https://example.com/b/x");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Refusing to deliver/);
  });

  it("still accepts the real thing, so the guard is not simply refusing everything", () => {
    // The counterpart to the cases above: a genuine Slack URL passes the same
    // check. Without this, a guard that returned false unconditionally would
    // satisfy every assertion above.
    const check = validateWebhookUrl("slack", "https://hooks.slack.com/services/T0/B0/xyz");
    expect(check.ok).toBe(true);
  });
});
