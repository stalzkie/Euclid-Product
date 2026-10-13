import Anthropic from "@anthropic-ai/sdk";

/**
 * One LLM provider for everything. Two models: a strong one for Build Prompt
 * and the chat assistant, a cheap one for routine jobs like naming clusters —
 * the PRD's AI cost-control note.
 *
 * The strong model is Sonnet 5 rather than Opus 5, decided on 2026-10-13 on
 * cost. At $3/$15 per MTok against Opus's $5/$25 it is a little over half the
 * price, and it is a true drop-in: same adaptive thinking, same `effort`
 * surface, so nothing else in this directory changes. Haiku 4.5 is cheaper
 * again but is not a drop-in — it has no adaptive thinking and rejects
 * `effort` — and the chat assistant's answers come out of a loop of up to
 * twelve reasoning steps, which is precisely what it would lose.
 *
 * The number that drove this: one real Ask Euclid question took 7 steps, and
 * every step is a full call to this model.
 */
export const MODEL_STRONG = "claude-sonnet-5";
export const MODEL_CHEAP = "claude-haiku-4-5";

let cached: Anthropic | null = null;

export function hasAnthropic(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function anthropic(): Anthropic {
  if (!cached) {
    const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
    cached = new Anthropic({
      // An org-level key has no workspace of its own and the API rejects it
      // unless the workspace is named explicitly. A workspace-scoped key
      // already carries one, and setting no header is correct there.
      defaultHeaders: workspaceId ? { "anthropic-workspace-id": workspaceId } : undefined,
    });
  }
  return cached;
}

/** Thrown when an AI route is hit before the key is configured. */
export class AiUnavailableError extends Error {
  constructor() {
    super(
      "No Anthropic credentials configured. Set ANTHROPIC_API_KEY to enable " +
        "Build Prompt, Ask Euclid and the AI drafts.",
    );
    this.name = "AiUnavailableError";
  }
}

export function requireAnthropic(): Anthropic {
  if (!hasAnthropic()) throw new AiUnavailableError();
  return anthropic();
}

/**
 * Turns an SDK failure into something a founder can act on. The raw errors are
 * JSON blobs; these say what to do about it.
 */
export function explainAiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  if (/anthropic-workspace-id/i.test(raw)) {
    return (
      "Your Anthropic API key belongs to the organisation rather than a " +
      "workspace. Either create a workspace-scoped key in the Anthropic " +
      "Console, or set ANTHROPIC_WORKSPACE_ID to the workspace you want to " +
      "bill this to."
    );
  }
  if (/401|authentication_error|invalid x-api-key/i.test(raw)) {
    return "Anthropic rejected the API key. Check ANTHROPIC_API_KEY.";
  }
  if (/429|rate_limit/i.test(raw)) {
    return "Anthropic is rate limiting this key right now. Try again in a moment.";
  }
  if (/credit balance|billing/i.test(raw)) {
    return "The Anthropic account is out of credit. Top it up in the Console.";
  }
  if (/overloaded|529/i.test(raw)) {
    return "Anthropic is overloaded. Try again in a moment.";
  }
  return raw;
}

/** Rough token estimate for the prompt length cap and the usage meter. */
export function estimateTokens(text: string): number {
  return Math.round(text.length / 4);
}
