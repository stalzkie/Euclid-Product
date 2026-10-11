/**
 * The MCP wire format, with no database and no network in sight.
 *
 * MCP is JSON-RPC 2.0. Getting the envelope right matters more than it
 * looks: a notification must produce no response at all, an unknown method
 * must produce an error rather than silence, and an id of `0` is a perfectly
 * valid id that a truthiness check would throw away.
 */

export const PROTOCOL_VERSION = "2025-06-18";

/** Versions we know how to speak, newest first. */
const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];

export const SERVER_INFO = { name: "euclid", version: "1.0.0" };

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export type JsonRpcId = string | number | null;

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export const ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

export function result(id: JsonRpcId, value: unknown) {
  return { jsonrpc: "2.0" as const, id, result: value };
}

export function failure(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0" as const, id, error: { code, message, ...(data ? { data } : {}) } };
}

/**
 * A request with no id is a notification: the spec says send nothing back,
 * not even success. Checking `id !== undefined` rather than truthiness
 * matters because 0 and "" are legal ids.
 */
export function isNotification(message: JsonRpcRequest): boolean {
  return message.id === undefined;
}

export function parseMessage(body: unknown): JsonRpcRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const candidate = body as Record<string, unknown>;
  if (candidate.jsonrpc !== "2.0") return null;
  if (typeof candidate.method !== "string" || !candidate.method) return null;

  const id = candidate.id;
  if (id !== undefined && id !== null && typeof id !== "string" && typeof id !== "number") {
    return null;
  }

  return {
    jsonrpc: "2.0",
    method: candidate.method,
    ...(id === undefined ? {} : { id: id as JsonRpcId }),
    params:
      candidate.params && typeof candidate.params === "object" && !Array.isArray(candidate.params)
        ? (candidate.params as Record<string, unknown>)
        : undefined,
  };
}

/** Agree a protocol version: the client's if we speak it, otherwise ours. */
export function negotiateVersion(requested: unknown): string {
  return typeof requested === "string" && SUPPORTED.includes(requested)
    ? requested
    : PROTOCOL_VERSION;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * The tools a coding agent gets. Descriptions are written for the agent
 * reading them, which is why they say what the numbers mean rather than
 * just naming the field.
 */
export const TOOLS: ToolDefinition[] = [
  {
    name: "list_requests",
    description:
      "List feature requests from the board, most wanted first. Use this to decide what to build next. " +
      "Vote counts are a headcount of distinct users, not a score.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["under_review", "planned", "in_progress", "shipped", "declined"],
          description: "Only requests with this status. Omit for every open request.",
        },
        limit: { type: "number", description: "How many to return. 1-50, default 10." },
      },
    },
  },
  {
    name: "get_request",
    description:
      "Full detail for one request: its description, what users said in the comments, " +
      "and how many people asked for it.",
    inputSchema: {
      type: "object",
      properties: {
        number: { type: "number", description: "The request number, as shown on the board." },
      },
      required: ["number"],
    },
  },
  {
    name: "get_build_prompt",
    description:
      "The implementation brief a founder generated for a request: what to build, why, " +
      "and which assumptions still need checking. Returns nothing if none has been generated yet.",
    inputSchema: {
      type: "object",
      properties: {
        number: { type: "number", description: "The request number." },
      },
      required: ["number"],
    },
  },
  {
    name: "mark_shipped",
    description:
      "Mark a request as shipped once the work is merged. This creates a draft changelog " +
      "entry for the founder to review — it does not publish anything or email anyone.",
    inputSchema: {
      type: "object",
      properties: {
        number: { type: "number", description: "The request number." },
      },
      required: ["number"],
    },
  },
];

/** MCP tool results are content blocks, and an error is a flag, not an exception. */
export function toolText(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], ...(isError ? { isError: true } : {}) };
}

export type NumberArg = { ok: true; value: number } | { ok: false; error: string };

/**
 * Agents send numbers as strings surprisingly often, so a numeric string is
 * accepted — but anything that is not actually a whole number is refused
 * rather than coerced into something arbitrary.
 */
export function readNumber(params: Record<string, unknown> | undefined, key: string): NumberArg {
  const raw = params?.[key];
  if (raw === undefined || raw === null) return { ok: false, error: `${key} is required.` };

  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return { ok: false, error: `${key} must be a whole number.` };
  }
  if (value <= 0) return { ok: false, error: `${key} must be greater than zero.` };

  return { ok: true, value };
}

export function readLimit(params: Record<string, unknown> | undefined, fallback = 10): number {
  const raw = params?.limit;
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(50, Math.max(1, Math.floor(value)));
}
