import { describe, expect, it } from "vitest";
import {
  directoryMap,
  filterTree,
  isInterestingPath,
  keywordsFrom,
  landmarks,
  likelyFiles,
  repoSection,
  type RepoSnapshot,
} from "@/lib/ai/repo";

const tree = [
  "package.json",
  "README.md",
  "src/app/page.tsx",
  "src/app/layout.tsx",
  "src/app/export/page.tsx",
  "src/lib/export-csv.ts",
  "src/lib/format.ts",
  "src/components/button.tsx",
  "src/components/table.tsx",
  "node_modules/react/index.js",
  "public/logo.png",
  "package-lock.json",
];

describe("isInterestingPath", () => {
  it.each([
    ["node_modules/react/index.js", "dependency"],
    ["nested/node_modules/x/y.js", "nested dependency"],
    [".next/static/chunk.js", "build output"],
    ["public/logo.png", "image"],
    ["fonts/Geist.woff2", "font"],
    ["package-lock.json", "lock file"],
  ])("drops %s (%s)", (path) => {
    expect(isInterestingPath(path)).toBe(false);
  });

  it.each(["src/lib/export-csv.ts", "package.json", "README.md", "app/main.py"])(
    "keeps %s",
    (path) => {
      expect(isInterestingPath(path)).toBe(true);
    },
  );
});

describe("filterTree", () => {
  it("removes the noise and keeps the source", () => {
    const kept = filterTree(tree);
    expect(kept).toContain("src/lib/export-csv.ts");
    expect(kept).not.toContain("node_modules/react/index.js");
    expect(kept).not.toContain("public/logo.png");
  });
});

describe("directoryMap", () => {
  it("groups by directory with a count, busiest first", () => {
    const map = directoryMap(filterTree(tree));
    expect(map.join("\n")).toContain("src/app/");
    expect(map.some((line) => /\d+ files/.test(line))).toBe(true);
  });

  it("files at the root are grouped, not dropped", () => {
    expect(directoryMap(["package.json", "README.md"]).join("\n")).toContain("(root)");
  });

  it("says file, not files, for one", () => {
    expect(directoryMap(["src/only.ts"]).join("")).toContain("1 file");
  });

  it("caps how many directories it lists", () => {
    const many = Array.from({ length: 80 }, (_, i) => `dir${i}/file.ts`);
    expect(directoryMap(many, 10).length).toBe(10);
  });

  it("returns nothing for an empty tree rather than throwing", () => {
    expect(directoryMap([])).toEqual([]);
  });
});

describe("landmarks", () => {
  it("finds the files that identify the stack", () => {
    expect(landmarks(tree)).toContain("package.json");
    expect(landmarks(tree)).toContain("README.md");
  });

  it("finds them in a subdirectory too", () => {
    expect(landmarks(["apps/web/package.json"])).toContain("apps/web/package.json");
  });

  it("returns nothing when the repo has none of them", () => {
    expect(landmarks(["src/a.ts", "src/b.ts"])).toEqual([]);
  });
});

describe("keywordsFrom", () => {
  it("drops filler words", () => {
    const words = keywordsFrom("Please add the ability to export my entries");
    expect(words).toContain("export");
    expect(words).toContain("entries");
    expect(words).not.toContain("the");
    expect(words).not.toContain("please");
  });

  it("does not repeat a word", () => {
    const words = keywordsFrom("export export export");
    expect(words.filter((w) => w === "export")).toHaveLength(1);
  });
});

describe("likelyFiles", () => {
  it("prefers a match in the filename over one in the directory", () => {
    const hits = likelyFiles(
      ["src/exporters/unrelated/widget.ts", "src/lib/export-csv.ts"],
      "export to CSV",
    );
    expect(hits[0]).toBe("src/lib/export-csv.ts");
  });

  it("returns nothing rather than guessing when nothing matches", () => {
    expect(likelyFiles(tree, "zzzz qqqq")).toEqual([]);
  });

  it("returns nothing when the request is only filler", () => {
    expect(likelyFiles(tree, "the a an of to")).toEqual([]);
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 50 }, (_, i) => `src/export${i}.ts`);
    expect(likelyFiles(many, "export", 5)).toHaveLength(5);
  });
});

describe("repoSection", () => {
  const snapshot: RepoSnapshot = {
    repo: "owner/app",
    branch: "main",
    paths: filterTree(tree),
    fetchedAt: "2026-10-11T12:00:00.000Z",
  };

  it("names the repo, the branch and when it was read", () => {
    const section = repoSection(snapshot, "export to CSV");
    expect(section).toContain("owner/app on main");
    expect(section).toContain("2026-10-11");
  });

  it("marks filename matches as unconfirmed rather than as fact", () => {
    const section = repoSection(snapshot, "export to CSV");
    expect(section).toContain("src/lib/export-csv.ts");
    // The agent must not read a weak signal as a decision already made.
    expect(section.toLowerCase()).toContain("confirm before trusting");
  });

  it("is empty when there is no snapshot, so the prompt omits the section", () => {
    expect(repoSection(null, "anything")).toBe("");
  });

  it("is empty for a snapshot with no files", () => {
    expect(repoSection({ ...snapshot, paths: [] }, "anything")).toBe("");
  });

  it("omits the relevant-files list when nothing matched", () => {
    const section = repoSection(snapshot, "zzzz");
    expect(section).toContain("Layout:");
    expect(section).not.toContain("Possibly relevant");
  });
});
