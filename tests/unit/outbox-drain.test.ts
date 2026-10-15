import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every path that queues an email has to send it.
 *
 * `email_outbox` is a queue with two readers: `drainAfterResponse`, which runs
 * once the current response is out, and the daily cron. Queueing without the
 * first means the row waits up to a day — which is fine for a digest and fatal
 * for a link, because every link the app mails expires in an hour (magic link)
 * or a day (student verification). A verification queued in the afternoon can
 * arrive already dead.
 *
 * That is not hypothetical: student verification shipped without the drain and
 * nobody noticed, because the row is written, the UI says "sent", and the email
 * does turn up eventually. Nothing fails. This test is the thing that fails.
 *
 * It reads source rather than behaviour, which is unusual here and deliberate:
 * the bug is an omission, and an omission has no behaviour to assert on.
 */

const SRC = join(process.cwd(), "src");

/**
 * Files that queue but do not drain, each naming the caller that drains for
 * them. A module with no request of its own cannot schedule after-response
 * work, so the obligation moves up to whoever calls it — but it does not
 * disappear, and this map is where that is written down.
 */
const DRAINED_BY_CALLER: Record<string, string> = {
  "server/student.ts": "app/(dashboard)/billing/actions.ts",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const files = sourceFiles(SRC).map((full) => ({
  path: relative(SRC, full).split(sep).join("/"),
  text: readFileSync(full, "utf8"),
}));

/**
 * The insert has to be chained onto the table, not merely present in the same
 * file. `server/jobs.ts` is the drainer: it reads `email_outbox` and writes
 * back to it, and inserts into other tables, so a looser match accuses the one
 * file whose whole job is sending.
 */
const QUEUES_EMAIL = /from\(\s*["']email_outbox["']\s*\)\s*\.insert\(/;

const queues = files.filter((f) => QUEUES_EMAIL.test(f.text));
const drains = new Set(files.filter((f) => f.text.includes("drainAfterResponse(")).map((f) => f.path));

describe("email outbox", () => {
  // If this ever finds nothing, the detection has rotted rather than the
  // problem being solved — the app certainly still sends email.
  it("finds the paths that queue email", () => {
    expect(queues.length).toBeGreaterThan(0);
  });

  it.each(queues.map((f) => f.path))("%s drains what it queues", (path) => {
    const delegate = DRAINED_BY_CALLER[path];
    if (delegate) {
      expect(
        drains.has(delegate),
        `${path} delegates draining to ${delegate}, which does not call drainAfterResponse`,
      ).toBe(true);
      return;
    }
    expect(
      drains.has(path),
      `${path} inserts into email_outbox but never calls drainAfterResponse, so the ` +
        "row waits for the daily cron. Either drain it, or add an entry to " +
        "DRAINED_BY_CALLER naming the caller that does.",
    ).toBe(true);
  });

  it("does not keep stale delegations", () => {
    for (const [queuer, caller] of Object.entries(DRAINED_BY_CALLER)) {
      expect(
        queues.some((f) => f.path === queuer),
        `${queuer} is listed in DRAINED_BY_CALLER but no longer queues email`,
      ).toBe(true);
      expect(
        files.some((f) => f.path === caller),
        `${caller} is named as the drainer for ${queuer} but does not exist`,
      ).toBe(true);
    }
  });
});
