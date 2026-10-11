/**
 * Integration plumbing that involves no database and no network, so it can be
 * tested directly: which hosts a webhook may point at, and what we send them.
 */

export type IntegrationKind = "slack" | "discord" | "github" | "linear";

export const CHAT_KINDS = ["slack", "discord"] as const;
export const ISSUE_KINDS = ["github", "linear"] as const;

export const INTEGRATION_EVENTS = ["post.created", "post.status_changed"] as const;
export type IntegrationEvent = (typeof INTEGRATION_EVENTS)[number];

export const INTEGRATION_LABELS: Record<IntegrationKind, string> = {
  slack: "Slack",
  discord: "Discord",
  github: "GitHub issues",
  linear: "Linear",
};

/**
 * A webhook URL is typed in by a founder, and we then make a server-side
 * request to it. Without a host allow-list that is an open proxy into
 * anything our server can reach, including cloud metadata endpoints and
 * whatever else shares its network. Slack and Discord each publish exactly
 * where their webhooks live, so there is no reason to accept anything else.
 */
const WEBHOOK_HOSTS: Record<"slack" | "discord", string[]> = {
  slack: ["hooks.slack.com"],
  discord: ["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"],
};

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

export function validateWebhookUrl(kind: "slack" | "discord", raw: string): UrlCheck {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Paste the webhook URL." };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "That is not a URL." };
  }

  // http: would send the secret in the URL over the wire in clear text.
  if (parsed.protocol !== "https:") {
    return { ok: false, error: "The webhook URL must start with https://." };
  }

  const allowed = WEBHOOK_HOSTS[kind];
  // Exact host match only. A suffix check would accept hooks.slack.com.evil.tld.
  if (!allowed.includes(parsed.hostname.toLowerCase())) {
    return {
      ok: false,
      error: `${INTEGRATION_LABELS[kind]} webhooks live on ${allowed[0]}, and that URL points at ${parsed.hostname}.`,
    };
  }

  // Credentials in the URL would be sent along with every delivery.
  if (parsed.username || parsed.password) {
    return { ok: false, error: "Remove the username and password from the URL." };
  }

  return { ok: true, url: parsed.toString() };
}

/** What the dashboard may show about a connected integration. Never the secret. */
export function redactWebhook(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    const tail = pathname.split("/").filter(Boolean).at(-1) ?? "";
    return `${hostname}/…${tail.slice(-4)}`;
  } catch {
    return "connected";
  }
}

export interface PostEventData {
  number: number;
  title: string;
  body?: string | null;
  category?: string | null;
  status: string;
  votes: number;
  url: string;
  boardName: string;
  /** Present on post.status_changed. */
  previousStatus?: string;
}

const STATUS_WORDS: Record<string, string> = {
  under_review: "Under review",
  planned: "Planned",
  in_progress: "In progress",
  shipped: "Shipped",
  declined: "Declined",
};

export function statusWord(status: string): string {
  return STATUS_WORDS[status] ?? status;
}

function headline(event: IntegrationEvent, data: PostEventData): string {
  if (event === "post.status_changed") {
    const from = data.previousStatus ? `${statusWord(data.previousStatus)} → ` : "";
    return `#${data.number} is now ${from}${statusWord(data.status)}`;
  }
  return `New feedback on ${data.boardName}`;
}

/**
 * Chat payloads. Deliberately plain: a wall of blocks is harder to scan in a
 * busy channel than one line with the number, the title and the vote count.
 */
export function chatPayload(
  kind: "slack" | "discord",
  event: IntegrationEvent,
  data: PostEventData,
): Record<string, unknown> {
  const title = `#${data.number} ${data.title}`;
  const meta = [
    `${data.votes} ${data.votes === 1 ? "vote" : "votes"}`,
    statusWord(data.status),
    data.category ?? null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (kind === "slack") {
    return {
      text: `${headline(event, data)}: ${title}`,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `*<${data.url}|${escapeSlack(title)}>*\n${meta}` },
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: headline(event, data) }],
        },
      ],
    };
  }

  return {
    content: headline(event, data),
    embeds: [
      {
        title: title.slice(0, 256),
        url: data.url,
        description: (data.body ?? "").slice(0, 400) || undefined,
        footer: { text: meta },
      },
    ],
  };
}

/** Slack reads &, < and > as markup, so they have to be escaped in link text. */
function escapeSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The issue a founder exports a post into. */
export function issueContent(data: PostEventData): { title: string; body: string } {
  const lines = [
    data.body?.trim() || "_No description given._",
    "",
    "---",
    `${data.votes} ${data.votes === 1 ? "vote" : "votes"} · ${statusWord(data.status)}${
      data.category ? ` · ${data.category}` : ""
    }`,
    `Requested by users on [${data.boardName}](${data.url}).`,
  ];

  return { title: `${data.title} (#${data.number})`, body: lines.join("\n") };
}

/**
 * Accepts `owner/repo`, or a GitHub URL pointing at one. Anything else is
 * rejected rather than guessed at, because a wrong repo means an issue
 * opened somewhere the founder is not looking.
 */
export function parseRepo(raw: string): { owner: string; repo: string } | null {
  const trimmed = raw.trim().replace(/\.git$/, "");
  if (!trimmed) return null;

  const fromUrl = trimmed.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/?#]+)/i);
  const pair = fromUrl ? [fromUrl[1], fromUrl[2]] : trimmed.split("/");
  if (pair.length !== 2) return null;

  const [owner, repo] = pair.map((part) => part.trim());
  const valid = /^[A-Za-z0-9._-]+$/;
  if (!owner || !repo || !valid.test(owner) || !valid.test(repo)) return null;

  return { owner, repo };
}
