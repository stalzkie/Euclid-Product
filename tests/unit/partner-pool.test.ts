import { describe, expect, it } from "vitest";
import { codesToMint } from "@/server/partner";

/**
 * How many Bernn codes to ask for.
 *
 * The two failure directions are not symmetric. Asking for too many wastes
 * rows nobody will ever see — an unredeemed code costs a row in two tables.
 * Asking for too few leaves a founder who paid for a promotion holding half
 * of it, and leaves them holding it until the next run. So the arithmetic
 * leans towards over-ordering, and the cases below are mostly about not
 * under-ordering.
 */

describe("codesToMint", () => {
  it("orders nothing when the pool is already at target", () => {
    expect(codesToMint({ available: 50, owed: 0 }, 50)).toBe(0);
  });

  it("orders nothing when the pool is over target", () => {
    // Possible after a manual import. Not a reason to order more, and not a
    // reason to error either.
    expect(codesToMint({ available: 80, owed: 0 }, 50)).toBe(0);
  });

  it("tops the pool back up to target", () => {
    expect(codesToMint({ available: 12, owed: 0 }, 50)).toBe(38);
  });

  it("covers the people already waiting, on top of the target", () => {
    /*
      The case worth being careful about. Three workspaces are owed a code and
      the pool is empty. Ordering only `target` would refill the shelf and
      settle them from it — which works, but leaves the shelf three short the
      moment they are paid out. Adding `owed` means the pool ends at target
      *after* everyone waiting has been settled.
    */
    expect(codesToMint({ available: 0, owed: 3 }, 50)).toBe(53);
  });

  it("orders for the waiting even when the pool looks healthy", () => {
    // Can happen between a claim and a fill: stock exists but somebody is
    // still recorded as owed.
    expect(codesToMint({ available: 50, owed: 2 }, 50)).toBe(2);
  });

  it("never asks for more than the per-request cap", () => {
    // Bernn refuses a count above its own ceiling, so a request this builds
    // must never exceed it — otherwise a big backlog produces a request that
    // is rejected outright and refills nothing at all.
    expect(codesToMint({ available: 0, owed: 400 }, 50, 200)).toBe(200);
  });

  it("still makes progress when the backlog is larger than the cap", () => {
    // Capped, not abandoned: each run clears what it can and the next picks
    // up the rest.
    const first = codesToMint({ available: 0, owed: 400 }, 50, 200);
    expect(first).toBeGreaterThan(0);
    const second = codesToMint({ available: 0, owed: 400 - first }, 50, 200);
    expect(second).toBeGreaterThan(0);
  });
});
