import type { PromptTarget } from "../types";

/**
 * One template per target tool. Tool conventions change often, so everything
 * tool-specific lives here and nowhere else — re-check these against the
 * current docs before a launch.
 */
export interface TargetSpec {
  id: PromptTarget;
  label: string;
  /** How the prompt is packaged, shown under the tool name in the picker. */
  format: string;
  /** Label of the second tab: the context block this tool reads. */
  ctx: string;
  /** Filename offered for the .md download. */
  file: string;
  /** Filename of the context block itself. */
  ctxFile: string;
  /** The opening instruction, appended under the task heading. */
  intro: string;
  /** Whether this tool can see the repo, which gates file-path mentions. */
  repoAware: boolean;
}

export const TARGETS: TargetSpec[] = [
  {
    id: "claude",
    label: "Claude Code",
    format: "Plan-first prompt",
    ctx: "CLAUDE.md context",
    file: "build-prompt.claude.md",
    ctxFile: "CLAUDE.md",
    intro:
      "Start in plan mode: read the relevant code, propose a plan,\n" +
      "and wait for my approval before editing files.",
    repoAware: true,
  },
  {
    id: "codex",
    label: "Codex",
    format: "Task prompt",
    ctx: "AGENTS.md context",
    file: "build-prompt.codex.md",
    ctxFile: "AGENTS.md",
    intro:
      "Work through the steps in order. Run the existing test\n" +
      "suite before you finish and report the result.",
    repoAware: true,
  },
  {
    id: "cursor",
    label: "Cursor",
    format: "Prompt + rules",
    ctx: "Rules snippet",
    file: "build-prompt.cursor.md",
    ctxFile: ".cursor/rules/project.mdc",
    intro:
      "Follow the project rules. Ask before adding any new\ndependency.",
    repoAware: true,
  },
  {
    id: "builder",
    label: "Lovable · Bolt · v0",
    format: "Chat prompt",
    ctx: "Context",
    file: "build-prompt.chat.md",
    ctxFile: "context.md",
    intro:
      "Add this feature to the existing app. Keep the current\ndesign and layout.",
    // These tools work without repo access, so the prompt must stay
    // path-free and describe intent instead.
    repoAware: false,
  },
  {
    id: "generic",
    label: "Generic",
    format: "Plain Markdown",
    ctx: "Context",
    file: "build-prompt.md",
    ctxFile: "context.md",
    intro: "Implement the feature described below.",
    repoAware: false,
  },
];

export function targetSpec(id: PromptTarget): TargetSpec {
  return TARGETS.find((t) => t.id === id) ?? TARGETS[TARGETS.length - 1];
}

/** Maps the founder's picked coding tools to a sensible default target. */
export function defaultTargetFor(tools: string[]): PromptTarget {
  const lower = tools.map((t) => t.toLowerCase());
  if (lower.some((t) => t.includes("claude"))) return "claude";
  if (lower.some((t) => t.includes("cursor"))) return "cursor";
  if (lower.some((t) => t.includes("codex"))) return "codex";
  if (lower.some((t) => /lovable|bolt|v0|windsurf/.test(t))) return "builder";
  return "generic";
}
