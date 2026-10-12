import { describe, expect, it } from "vitest";
import { hasRoll, rollDigits } from "@/lib/motion/digits";

const chars = (text: string, next: string) =>
  rollDigits(Number(text), Number(next)).slots.map((s) => s.char).join("");

describe("rollDigits", () => {
  it("rolls up when the value rises", () => {
    const roll = rollDigits(41, 42);
    expect(roll.direction).toBe("up");
    expect(chars("41", "42")).toBe("42");
    expect(roll.slots.map((s) => s.changed)).toEqual([false, true]);
    expect(roll.slots[1].direction).toBe("up");
  });

  it("rolls down when the value falls, which is what un-voting does", () => {
    const roll = rollDigits(42, 41);
    expect(roll.direction).toBe("down");
    expect(roll.slots.map((s) => s.changed)).toEqual([false, true]);
    expect(roll.slots[1].direction).toBe("down");
  });

  it("leaves unchanged digits alone", () => {
    const roll = rollDigits(1234, 1239);
    expect(roll.slots.filter((s) => s.changed)).toHaveLength(1);
    expect(roll.slots.every((s) => (s.changed ? s.direction === "up" : s.direction === "none")))
      .toBe(true);
  });

  it("keeps the units place when the number gains a digit (99 to 100)", () => {
    const roll = rollDigits(99, 100);
    expect(roll.width).toBe(3);
    expect(roll.slots.map((s) => s.key)).toEqual(["p2", "p1", "p0"]);
    expect(roll.slots.map((s) => s.char)).toEqual(["1", "0", "0"]);
    // The leading cell is new, so it has nothing to roll out of.
    expect(roll.slots[0].previous).toBeNull();
    expect(roll.slots.every((s) => s.changed)).toBe(true);
  });

  it("keeps the units place when the number loses a digit (100 to 99)", () => {
    const roll = rollDigits(100, 99);
    expect(roll.width).toBe(3);
    expect(roll.slots.map((s) => s.char)).toEqual(["", "9", "9"]);
    expect(roll.slots[0].previous).toBe("1");
    expect(roll.direction).toBe("down");
  });

  it("pads to minWidth so neighbours never shift as the value grows", () => {
    const roll = rollDigits(7, 8, { minWidth: 4 });
    expect(roll.width).toBe(4);
    expect(roll.slots.map((s) => s.char)).toEqual(["", "", "", "8"]);
    // Empty cells are not "changes" — they were empty before too.
    expect(roll.slots.filter((s) => s.changed).map((s) => s.key)).toEqual(["p0"]);
  });

  it("treats a grouping separator as a cell of its own", () => {
    const format = (value: number) => value.toLocaleString("en-US");
    const roll = rollDigits(999, 1000, { format });
    expect(roll.slots.map((s) => s.char).join("")).toBe("1,000");
    expect(roll.width).toBe(5);
  });

  it("reports no roll when the value did not change", () => {
    const roll = rollDigits(42, 42);
    expect(roll.direction).toBe("none");
    expect(roll.slots.some((s) => s.changed)).toBe(false);
    expect(hasRoll(roll)).toBe(false);
  });

  it("reports a roll when something moved", () => {
    expect(hasRoll(rollDigits(1, 2))).toBe(true);
  });

  it("handles negative values without losing the sign", () => {
    const roll = rollDigits(1, -1);
    expect(roll.slots.map((s) => s.char).join("")).toBe("-1");
    expect(roll.direction).toBe("down");
  });
});
