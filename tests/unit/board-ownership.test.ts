import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Two dashboard reads take a board id from their caller and then read with the
 * service-role client, which RLS does not constrain. A server action is a
 * network endpoint, so that id is attacker-controlled: without an ownership
 * check these would answer for any board in the database.
 *
 * These tests exist to fail if that check is ever removed.
 */

const boards = [{ id: "board-mine", name: "Mine" }];

vi.mock("@/server/context", async () => {
  const actual = await vi.importActual<typeof import("@/server/context")>("@/server/context");
  const ctx = { boards, board: boards[0], workspace: { id: "ws" } };
  return {
    ...actual,
    requireFounder: vi.fn(async () => ctx),
    founderBoard: vi.fn(async (id: string) => boards.find((b) => b.id === id) ?? null),
  };
});

/** A query builder that records what it was asked for and resolves to rows. */
function stubDb(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "maybeSingle"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
  return builder;
}

const from = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: () => ({ from }),
  supabaseServer: async () => ({ from }),
  isConfigured: () => true,
  hasServiceRole: () => true,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeEach(() => {
  from.mockReset();
  from.mockImplementation(() => stubDb([]));
});

describe("listApiKeys", () => {
  it("reads the keys of a board the founder owns", async () => {
    const { listApiKeys } = await import("@/app/(dashboard)/install/key-actions");
    from.mockImplementation(() =>
      stubDb([
        {
          id: "k1",
          name: "Claude Code",
          token_prefix: "euc_abcd",
          created_at: "2026-10-01",
          last_used_at: null,
        },
      ]),
    );

    const keys = await listApiKeys("board-mine");
    expect(keys).toHaveLength(1);
    expect(keys[0].prefix).toBe("euc_abcd");
  });

  it("reads nothing, and asks the database nothing, for someone else's board", async () => {
    const { listApiKeys } = await import("@/app/(dashboard)/install/key-actions");
    expect(await listApiKeys("board-theirs")).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("readRepoStatus", () => {
  it("reports the repo of a board the founder owns", async () => {
    const { readRepoStatus } = await import("@/app/(dashboard)/profile/repo-actions");
    from.mockImplementation(() => stubDb({ config: { repo: "acme/app" } } as never));

    const status = await readRepoStatus("board-mine");
    expect(from).toHaveBeenCalled();
    expect(status.connected).toBe(true);
  });

  it("reports nothing, and asks the database nothing, for someone else's board", async () => {
    const { readRepoStatus } = await import("@/app/(dashboard)/profile/repo-actions");
    const status = await readRepoStatus("board-theirs");
    expect(status).toEqual({
      connected: false,
      repo: null,
      branch: null,
      fileCount: 0,
      truncated: false,
      fetchedAt: null,
      lastError: null,
    });
    expect(from).not.toHaveBeenCalled();
  });
});
