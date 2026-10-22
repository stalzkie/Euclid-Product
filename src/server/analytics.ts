import { supabaseAdmin, hasServiceRole } from "@/lib/supabase/server";
import { cleanBatch, type CleanEvent, type EventName, type Props } from "@/lib/analytics/events";
import { normalisePath } from "@/lib/analytics/events";

/**
 * Storing captured events.
 *
 * The identity on every row comes from this side of the wire. The browser
 * sends a name, a path and some properties; the workspace, the board and the
 * user are read from the founder's session, and the timestamp is the
 * database's default. A route that accepted a `workspace_id` from its caller
 * would let any signed-in founder write events into somebody else's numbers,
 * which is the same class of mistake the checkout route exists not to make.
 *
 * Writes go through the service role because `analytics_events` has no RLS
 * policies at all — see 0032. That is the same arrangement as `error_events`:
 * one writer, no readers but the operator console.
 */

export interface EventIdentity {
  userId: string;
  workspaceId: string | null;
  boardId: string | null;
}

/**
 * Store a batch. Returns how many rows were written.
 *
 * Never throws. The caller is a route whose own failure would surface as a
 * console error on a dashboard screen, and losing a screen view is not worth
 * that. A failure is logged and counted as zero.
 */
export async function recordEvents(
  identity: EventIdentity,
  events: CleanEvent[],
): Promise<number> {
  if (events.length === 0) return 0;
  if (!hasServiceRole()) return 0;

  const rows = events.map((event) => ({
    name: event.name,
    source: "dashboard",
    user_id: identity.userId,
    workspace_id: identity.workspaceId,
    board_id: identity.boardId,
    path: event.path,
    session_id: event.session,
    props: event.props,
  }));

  const { error } = await supabaseAdmin().from("analytics_events").insert(rows);

  if (error) {
    // The expected failure is the migration not being applied yet, which is a
    // deployment state rather than a bug — so it is a warning, and capture
    // stays silent and harmless until the table exists.
    console.warn(`[analytics] could not record ${rows.length} events: ${error.message}`);
    return 0;
  }
  return rows.length;
}

/** Parse and scrub a request body, whatever arrived in it. */
export function readBatch(body: unknown): CleanEvent[] {
  if (!body || typeof body !== "object") return [];
  const events = (body as { events?: unknown }).events;
  return cleanBatch(events);
}

/**
 * Record one event from the server.
 *
 * For the handful of things that happen without a browser — a job, a webhook,
 * a server action whose effect is not a row anyone would notice. Unused today
 * and deliberately exported: the alternative, when the first caller appears,
 * is a second insert that spells the row shape differently.
 */
export async function recordServerEvent(
  name: EventName,
  identity: Partial<EventIdentity> & { endUserId?: string | null },
  props: Props = {},
  path?: string,
): Promise<void> {
  if (!hasServiceRole()) return;

  const { error } = await supabaseAdmin()
    .from("analytics_events")
    .insert({
      name,
      source: "server",
      user_id: identity.userId ?? null,
      workspace_id: identity.workspaceId ?? null,
      board_id: identity.boardId ?? null,
      end_user_id: identity.endUserId ?? null,
      path: normalisePath(path) ?? null,
      props,
    });

  if (error) console.warn(`[analytics] could not record ${name}: ${error.message}`);
}

/** Delete rows past the retention window. Called by the daily job. */
export async function pruneAnalytics(days = 180): Promise<number> {
  if (!hasServiceRole()) return 0;
  const { data, error } = await supabaseAdmin().rpc("prune_analytics_events", { p_days: days });
  if (error) {
    console.warn(`[analytics] prune failed: ${error.message}`);
    return 0;
  }
  return (data as number | null) ?? 0;
}
