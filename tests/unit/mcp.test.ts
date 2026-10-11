import { describe, expect, it } from "vitest";
import {
  ERRORS,
  PROTOCOL_VERSION,
  TOOLS,
  failure,
  isNotification,
  negotiateVersion,
  parseMessage,
  readLimit,
  readNumber,
  result,
  toolText,
} from "@/lib/mcp";

describe("parseMessage", () => {
  it("accepts a well-formed request", () => {
    expect(parseMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" })).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: undefined,
    });
  });

  it("keeps an id of 0, which is valid and falsy", () => {
    const parsed = parseMessage({ jsonrpc: "2.0", id: 0, method: "ping" });
    expect(parsed?.id).toBe(0);
  });

  it("keeps an explicit null id distinct from a missing one", () => {
    expect(parseMessage({ jsonrpc: "2.0", id: null, method: "ping" })?.id).toBeNull();
    expect(parseMessage({ jsonrpc: "2.0", method: "ping" })).not.toHaveProperty("id");
  });

  it.each([
    [{ id: 1, method: "x" }, "no jsonrpc field"],
    [{ jsonrpc: "1.0", id: 1, method: "x" }, "wrong version"],
    [{ jsonrpc: "2.0", id: 1 }, "no method"],
    [{ jsonrpc: "2.0", id: 1, method: "" }, "empty method"],
    [{ jsonrpc: "2.0", id: {}, method: "x" }, "object id"],
    [null, "null body"],
    ["a string", "string body"],
    [[{ jsonrpc: "2.0", method: "x" }], "array body"],
  ])("rejects %j (%s)", (body, _label) => {
    expect(parseMessage(body)).toBeNull();
  });

  it("ignores params that are not an object", () => {
    expect(parseMessage({ jsonrpc: "2.0", id: 1, method: "x", params: "no" })?.params).toBeUndefined();
  });
});

describe("isNotification", () => {
  it("is true only when there is no id at all", () => {
    expect(isNotification({ jsonrpc: "2.0", method: "notifications/initialized" })).toBe(true);
  });

  it("is false for id 0, which would fool a truthiness check", () => {
    expect(isNotification({ jsonrpc: "2.0", id: 0, method: "ping" })).toBe(false);
  });

  it("is false for an explicit null id", () => {
    expect(isNotification({ jsonrpc: "2.0", id: null, method: "ping" })).toBe(false);
  });
});

describe("envelopes", () => {
  it("builds a result", () => {
    expect(result(7, { ok: true })).toEqual({ jsonrpc: "2.0", id: 7, result: { ok: true } });
  });

  it("builds an error without a data field when none is given", () => {
    expect(failure(7, ERRORS.methodNotFound, "nope")).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: -32601, message: "nope" },
    });
  });
});

describe("negotiateVersion", () => {
  it("echoes a version we speak", () => {
    expect(negotiateVersion("2024-11-05")).toBe("2024-11-05");
  });

  it("falls back to ours for one we do not", () => {
    expect(negotiateVersion("1999-01-01")).toBe(PROTOCOL_VERSION);
    expect(negotiateVersion(undefined)).toBe(PROTOCOL_VERSION);
    expect(negotiateVersion(42)).toBe(PROTOCOL_VERSION);
  });
});

describe("TOOLS", () => {
  it("exposes the four an agent needs", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([
      "get_build_prompt",
      "get_request",
      "list_requests",
      "mark_shipped",
    ]);
  });

  it("gives every tool a schema and a description", () => {
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("requires a number wherever one is needed", () => {
    for (const name of ["get_request", "get_build_prompt", "mark_shipped"]) {
      const tool = TOOLS.find((t) => t.name === name);
      expect(tool?.inputSchema.required).toContain("number");
    }
  });

  it("says plainly that marking shipped does not email anyone", () => {
    // An agent must not believe it is about to notify users.
    const tool = TOOLS.find((t) => t.name === "mark_shipped");
    expect(tool?.description).toMatch(/does not publish|not.*email/i);
  });
});

describe("toolText", () => {
  it("wraps text in a content block", () => {
    expect(toolText("hello")).toEqual({ content: [{ type: "text", text: "hello" }] });
  });

  it("flags an error rather than throwing", () => {
    expect(toolText("bad", true).isError).toBe(true);
  });
});

describe("readNumber", () => {
  it("reads a number", () => {
    expect(readNumber({ number: 142 }, "number")).toEqual({ ok: true, value: 142 });
  });

  it("accepts a numeric string, which agents send often", () => {
    expect(readNumber({ number: "142" }, "number")).toEqual({ ok: true, value: 142 });
  });

  it.each([
    [{}, "missing"],
    [{ number: null }, "null"],
    [{ number: "abc" }, "not a number"],
    [{ number: 1.5 }, "fractional"],
    [{ number: 0 }, "zero"],
    [{ number: -3 }, "negative"],
    [{ number: "" }, "empty string"],
    [{ number: true }, "boolean"],
  ])("refuses %j (%s)", (params, _label) => {
    expect(readNumber(params, "number").ok).toBe(false);
  });

  it("names the field in the error, so the agent can correct itself", () => {
    const outcome = readNumber({}, "number");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("number");
  });
});

describe("readLimit", () => {
  it("defaults when absent or unusable", () => {
    expect(readLimit(undefined)).toBe(10);
    expect(readLimit({ limit: "lots" })).toBe(10);
  });

  it("clamps rather than refusing, because a limit is a preference", () => {
    expect(readLimit({ limit: 500 })).toBe(50);
    expect(readLimit({ limit: 0 })).toBe(1);
    expect(readLimit({ limit: -5 })).toBe(1);
  });

  it("floors a fractional limit", () => {
    expect(readLimit({ limit: 7.9 })).toBe(7);
  });
});
