import { describe, expect, it } from "vitest";
import { setupProgress, setupSteps, showSetup, type SetupFacts } from "@/lib/setup";

/**
 * The setup checklist.
 *
 * Its one real risk is telling a founder to do something they have already
 * done, which is worse than not having a checklist: it says the app is not
 * watching. So the cases below are mostly about steps going `done` from the
 * state that actually implies them.
 */

const nothing: SetupFacts = {
  hasProfile: false,
  installed: false,
  domainsLocked: false,
  hasPosts: false,
  hasPrompt: false,
  hasShipped: false,
};

const everything: SetupFacts = {
  hasProfile: true,
  installed: true,
  domainsLocked: true,
  hasPosts: true,
  hasPrompt: true,
  hasShipped: true,
};

const byId = (facts: SetupFacts) =>
  Object.fromEntries(setupSteps(facts).map((s) => [s.id, s.done]));

describe("setupSteps", () => {
  it("starts with everything to do", () => {
    expect(setupProgress(setupSteps(nothing))).toEqual({ done: 0, total: 6 });
  });

  it("ends with nothing to do", () => {
    expect(setupProgress(setupSteps(everything))).toEqual({ done: 6, total: 6 });
  });

  it("puts install before locking domains", () => {
    /*
      Order matters here and is not cosmetic. A founder who locks the
      allow-list first and then installs on a domain they forgot to add gets a
      widget that silently refuses to load — which reads as a broken install
      rather than a configuration mistake, and is a miserable first hour.
    */
    const ids = setupSteps(nothing).map((s) => s.id);
    expect(ids.indexOf("install")).toBeLessThan(ids.indexOf("domains"));
  });

  it("puts getting feedback before writing a prompt about it", () => {
    const ids = setupSteps(nothing).map((s) => s.id);
    expect(ids.indexOf("feedback")).toBeLessThan(ids.indexOf("prompt"));
  });

  it("counts feedback received through the hosted board", () => {
    // Posts do not require the widget: /b/:id works without an install, and
    // telling that founder they have had no feedback would be wrong.
    expect(byId({ ...nothing, hasPosts: true })).toMatchObject({
      install: false,
      feedback: true,
    });
  });

  it("marks each step from its own fact and no other", () => {
    expect(byId({ ...nothing, installed: true })).toMatchObject({
      install: true,
      domains: false,
      feedback: false,
    });
    expect(byId({ ...nothing, domainsLocked: true })).toMatchObject({
      install: false,
      domains: true,
    });
  });

  it("gives every step somewhere to go", () => {
    // A checklist row that is not actionable is just a reprimand.
    for (const step of setupSteps(nothing)) {
      expect(step.href.startsWith("/")).toBe(true);
      expect(step.title.length).toBeGreaterThan(0);
    }
  });
});

describe("showSetup", () => {
  it("shows while anything is left", () => {
    expect(showSetup(setupSteps(nothing), null)).toBe(true);
    expect(showSetup(setupSteps({ ...everything, hasShipped: false }), null)).toBe(true);
  });

  it("hides itself once everything is done", () => {
    // Finishing it is the dismissal. A checklist with nothing left on it is
    // clutter the founder then has to close by hand.
    expect(showSetup(setupSteps(everything), null)).toBe(false);
  });

  it("stays hidden once dismissed, even with steps left", () => {
    expect(showSetup(setupSteps(nothing), "2026-10-19T00:00:00Z")).toBe(false);
  });
});
