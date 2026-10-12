import { describe, expect, it } from "vitest";
import { changedLines } from "@/lib/motion/lines";

describe("changedLines", () => {
  it("highlights nothing on a first generation", () => {
    expect(changedLines(null, "## Goal\nShip it")).toEqual(new Set());
  });

  it("highlights a line that was not there before", () => {
    const before = "## Goal\nShip it";
    const after = "## Goal\nShip it\n- Behind a feature flag";
    expect(changedLines(before, after)).toEqual(new Set([2]));
  });

  it("leaves a line that only moved alone", () => {
    const before = "a\nb\nc";
    const after = "c\na\nb";
    expect(changedLines(before, after)).toEqual(new Set());
  });

  it("highlights the new copy when a line is duplicated", () => {
    expect(changedLines("a\nb", "a\na\nb")).toEqual(new Set([1]));
  });

  it("ignores blank lines, which carry nothing to report", () => {
    expect(changedLines("a", "a\n\n\nb")).toEqual(new Set([3]));
  });

  it("highlights every line when the document is replaced wholesale", () => {
    expect(changedLines("a\nb", "x\ny")).toEqual(new Set([0, 1]));
  });

  it("reports nothing when the text is unchanged", () => {
    expect(changedLines("a\nb\nc", "a\nb\nc")).toEqual(new Set());
  });
});
