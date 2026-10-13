import { supabaseAdmin } from "@/lib/supabase/server";
import {
  chatPayload,
  issueContent,
  parseRepo,
  type IntegrationEvent,
  type IntegrationKind,
  type PostEventData,
} from "@/lib/integrations";
import { RETRY_MAX_ATTEMPTS, retryAfter } from "@/lib/retry";

/**
 * Delivering integration events.
 *
 * Chat notifications go through an outbox and are drained by the queue. A
 * visitor submitting feedback must not wait on Slack, and must not see their
 * post fail because someone's webhook was revoked last week.
 */

/** Chat webhooks are small; a slow one should not hold a worker for long. */
const DELIVERY_TIMEOUT_MS = 8_000;

/**
 * Give up after this many tries, so a dead webhook stops costing us work.
 *
 * Shared with the email outbox rather than kept here: both queues are drained
 * by the same `drainAfterResponse`, and two different ideas of how long to
 * keep trying would be two different answers to the same question.
 */
const MAX_ATTEMPTS = RETRY_MAX_ATTEMPTS;

interface ClaimedDelivery {
  id: string;
  integration_id: string;
  kind: IntegrationKind;
  config: Record<string, string>;
  event: IntegrationEvent;
  payload: PostEventData;
  attempts: number;
}

/**
 * Queue an event for every active integration on the board that wants it.
 * Never throws: a failure here must not roll back the post that caused it.
 */
export async function enqueueIntegrationEvent(
  boardId: string,
  event: IntegrationEvent,
  payload: PostEventData,
): Promise<number> {
  try {
    const db = supabaseAdmin();

    const { data: targets } = await db
      .from("integrations")
      .select("id")
      .eq("board_id", boardId)
      .eq("active", true)
      .in("kind", ["slack", "discord"])
      .contains("events", [event]);

    if (!targets?.length) return 0;

    const { error } = await db.from("integration_deliveries").insert(
      targets.map((target) => ({
        integration_id: target.id,
        event,
        payload: payload as unknown as Record<string, unknown>,
      })),
    );

    return error ? 0 : targets.length;
  } catch {
    return 0;
  }
}

export interface DeliveryResult {
  delivered: number;
  failed: number;
}

/** Drain the delivery outbox. Called by the queue, not by a request path. */
export async function deliverIntegrationEvents(limit = 20): Promise<DeliveryResult> {
  const db = supabaseAdmin();
  const result: DeliveryResult = { delivered: 0, failed: 0 };

  const { data: claimed } = await db.rpc("claim_integration_deliveries", { p_limit: limit });
  const batch = (claimed ?? []) as ClaimedDelivery[];

  for (const delivery of batch) {
    const outcome = await postToWebhook(delivery);
    const now = new Date().toISOString();

    if (outcome.ok) {
      await db
        .from("integration_deliveries")
        .update({ delivered_at: now, last_error: null })
        .eq("id", delivery.id);
      await db
        .from("integrations")
        .update({ last_delivered_at: now, last_error: null })
        .eq("id", delivery.integration_id);
      result.delivered += 1;
      continue;
    }

    result.failed += 1;
    const exhausted = delivery.attempts >= MAX_ATTEMPTS;

    await db
      .from("integration_deliveries")
      .update({
        last_error: outcome.error.slice(0, 500),
        // Back off so a service having a bad hour is retried later, not
        // hammered. 1, 4, 9, 16 minutes.
        deliver_after: retryAfter(delivery.attempts),
      })
      .eq("id", delivery.id);

    await db
      .from("integrations")
      .update({
        last_error: outcome.error.slice(0, 500),
        // A webhook that has failed five times is gone, not slow. Leaving it
        // on would keep queueing deliveries nobody receives.
        ...(exhausted ? { active: false } : {}),
      })
      .eq("id", delivery.integration_id);
  }

  return result;
}

async function postToWebhook(
  delivery: ClaimedDelivery,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = delivery.config.webhook_url;
  if (!url) return { ok: false, error: "No webhook URL stored for this integration." };
  if (delivery.kind !== "slack" && delivery.kind !== "discord") {
    return { ok: false, error: `${delivery.kind} is not a chat integration.` };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(chatPayload(delivery.kind, delivery.event, delivery.payload)),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      // A webhook that answers with a redirect is not one we should follow.
      redirect: "error",
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      return { ok: false, error: `${response.status} ${response.statusText} ${detail}`.trim() };
    }

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

/**
 * Send one webhook immediately, so "Send a test message" tells the founder
 * whether the URL works while they are still looking at the field.
 */
export async function sendTestMessage(
  kind: "slack" | "discord",
  url: string,
  boardName: string,
  boardUrl: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return postToWebhook({
    id: "test",
    integration_id: "test",
    kind,
    config: { webhook_url: url },
    event: "post.created",
    attempts: 0,
    payload: {
      number: 1,
      title: "Euclid is connected",
      body: "This is a test message. Real feedback will look like this.",
      category: null,
      status: "under_review",
      votes: 1,
      url: boardUrl,
      boardName,
    },
  });
}

export interface IssueResult {
  ok: boolean;
  url?: string;
  error?: string;
}

/** Open a GitHub issue for a post and hand back its URL. */
export async function createGithubIssue(
  config: Record<string, string>,
  data: PostEventData,
): Promise<IssueResult> {
  const repo = parseRepo(config.repo ?? "");
  if (!repo) return { ok: false, error: "That repository is not in owner/repo form." };
  if (!config.token) return { ok: false, error: "No GitHub token stored." };

  const { title, body } = issueContent(data);

  try {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/issues`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${config.token}`,
          "x-github-api-version": "2022-11-28",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title,
          body,
          labels: config.label ? [config.label] : undefined,
        }),
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      },
    );

    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: "GitHub refused the token. It needs Issues: write on that repo." };
    }
    if (response.status === 404) {
      return { ok: false, error: "GitHub cannot see that repository with this token." };
    }
    if (!response.ok) {
      return { ok: false, error: `GitHub returned ${response.status}.` };
    }

    const issue = (await response.json()) as { html_url?: string };
    return { ok: true, url: issue.html_url };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "GitHub is unreachable." };
  }
}

/** Open a Linear issue for a post and hand back its URL. */
export async function createLinearIssue(
  config: Record<string, string>,
  data: PostEventData,
): Promise<IssueResult> {
  if (!config.token) return { ok: false, error: "No Linear API key stored." };
  if (!config.team_id) return { ok: false, error: "No Linear team chosen." };

  const { title, body } = issueContent(data);

  try {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { authorization: config.token, "content-type": "application/json" },
      body: JSON.stringify({
        query: `mutation Create($input: IssueCreateInput!) {
          issueCreate(input: $input) { success issue { url } }
        }`,
        variables: { input: { teamId: config.team_id, title, description: body } },
      }),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });

    if (response.status === 401 || response.status === 400) {
      return { ok: false, error: "Linear refused the API key." };
    }
    if (!response.ok) return { ok: false, error: `Linear returned ${response.status}.` };

    const json = (await response.json()) as {
      data?: { issueCreate?: { success: boolean; issue?: { url: string } } };
      errors?: { message: string }[];
    };

    if (json.errors?.length) return { ok: false, error: json.errors[0].message };
    if (!json.data?.issueCreate?.success) return { ok: false, error: "Linear declined the issue." };

    return { ok: true, url: json.data.issueCreate.issue?.url };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Linear is unreachable." };
  }
}
