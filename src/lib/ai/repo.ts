/**
 * Turning a repository file list into something worth putting in a prompt.
 *
 * A flat list of two thousand paths is not context, it is filler: it costs
 * tokens and tells the agent nothing it could not get by looking. What helps
 * is the shape of the tree, the files that identify the stack, and a short
 * list of the places this particular request probably touches.
 */

/** Files that say what a project is, worth naming even when nothing matches. */
const LANDMARKS = [
  "package.json",
  "tsconfig.json",
  "next.config.ts",
  "next.config.js",
  "requirements.txt",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "Gemfile",
  "composer.json",
  "README.md",
  "CLAUDE.md",
  "AGENTS.md",
  "schema.prisma",
];

/** Directories whose contents tell an agent nothing about the product. */
const NOISE = [
  "node_modules/",
  ".next/",
  "dist/",
  "build/",
  "vendor/",
  ".git/",
  "coverage/",
  "__pycache__/",
  ".venv/",
  "target/",
];

const BINARY = /\.(png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|mp4|zip|pdf)$/i;

/** Machine-written and enormous. Naming one tells an agent nothing. */
const LOCKFILES = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "poetry.lock",
  "Gemfile.lock",
  "composer.lock",
  "Cargo.lock",
];

export function isInterestingPath(path: string): boolean {
  if (NOISE.some((prefix) => path.startsWith(prefix) || path.includes(`/${prefix}`))) {
    return false;
  }
  const name = path.split("/").pop() ?? "";
  if (LOCKFILES.includes(name)) return false;
  return !BINARY.test(path);
}

/** Drops the noise, so a snapshot stores what might actually be referenced. */
export function filterTree(paths: string[]): string[] {
  return paths.filter(isInterestingPath);
}

/**
 * A directory map: where the code lives and roughly how much of it there is.
 * Depth is capped because the point is orientation, not an inventory.
 */
export function directoryMap(paths: string[], maxEntries = 24, depth = 2): string[] {
  const counts = new Map<string, number>();

  for (const path of paths) {
    const parts = path.split("/");
    // A file at the root is grouped under the root itself.
    const dir = parts.length === 1 ? "." : parts.slice(0, Math.min(depth, parts.length - 1)).join("/");
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxEntries)
    .map(([dir, count]) => `${dir === "." ? "(root)" : `${dir}/`} — ${count} ${count === 1 ? "file" : "files"}`);
}

export function landmarks(paths: string[]): string[] {
  const set = new Set(paths);
  return LANDMARKS.filter(
    (name) => set.has(name) || paths.some((path) => path.endsWith(`/${name}`)),
  ).map((name) => paths.find((path) => path === name || path.endsWith(`/${name}`)) ?? name);
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with", "when",
  "it", "is", "be", "can", "should", "would", "add", "make", "please", "we",
  "i", "my", "our", "you", "your", "this", "that", "so", "but", "if", "as",
  "from", "by", "at", "not", "all", "some", "more", "like", "want", "need",
]);

export function keywordsFrom(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 2 && !STOP.has(word)),
    ),
  ];
}

/**
 * Paths whose own name overlaps the request. A weak signal on its own, which
 * is why the output is labelled a starting point rather than an answer.
 */
export function likelyFiles(paths: string[], text: string, limit = 12): string[] {
  const words = keywordsFrom(text);
  if (!words.length) return [];

  const scored = paths
    .map((path) => {
      const haystack = path.toLowerCase();
      // Score on the file name first: src/lib/export.ts beats
      // src/exporters/unrelated/thing.ts for the word "export".
      const name = haystack.split("/").pop() ?? "";
      let score = 0;
      for (const word of words) {
        if (name.includes(word)) score += 3;
        else if (haystack.includes(word)) score += 1;
      }
      return { path, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length);

  return scored.slice(0, limit).map((entry) => entry.path);
}

export interface RepoSnapshot {
  repo: string;
  branch: string;
  paths: string[];
  fetchedAt: string;
}

/** The repo section of a Build Prompt. Empty string when there is nothing useful. */
export function repoSection(snapshot: RepoSnapshot | null, requestText: string): string {
  if (!snapshot || !snapshot.paths.length) return "";

  const likely = likelyFiles(snapshot.paths, requestText);
  const marks = landmarks(snapshot.paths);

  const lines = [
    `## Repository`,
    `${snapshot.repo} on ${snapshot.branch}, read-only snapshot taken ${snapshot.fetchedAt.slice(0, 10)}. ${snapshot.paths.length} files.`,
    "",
    "Layout:",
    ...directoryMap(snapshot.paths).map((line) => `- ${line}`),
  ];

  if (marks.length) {
    lines.push("", `Project files: ${marks.join(", ")}`);
  }

  if (likely.length) {
    lines.push(
      "",
      "Possibly relevant, matched on filename alone — confirm before trusting:",
      ...likely.map((path) => `- ${path}`),
    );
  }

  return lines.join("\n");
}
