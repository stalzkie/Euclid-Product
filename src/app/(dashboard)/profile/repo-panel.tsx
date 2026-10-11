"use client";

import { useState, useTransition } from "react";
import { Banner, Button, Card, SectionTitle } from "@/components/ui";
import { Spinner } from "@/components/controls";
import { ago } from "@/lib/format";
import { refreshRepo, type RepoStatus } from "./repo-actions";

/**
 * Repository context for Build Prompt.
 *
 * Only the file listing is read, never file contents — enough for a prompt
 * to name real paths instead of saying "the relevant file", without any of
 * the founder's code passing through Euclid or reaching a model.
 */
export function RepoPanel({ initial }: { initial: RepoStatus }) {
  const [status, setStatus] = useState(initial);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  return (
    <Card className="flex flex-col gap-3 p-[18px]">
      <SectionTitle>Repository context</SectionTitle>
      <p className="text-[12.5px] leading-[1.5] text-ink-2">
        Build Prompts can name real files when Euclid knows your file list.
        Only the list of paths is read — never the contents of any file.
      </p>

      {!status.connected ? (
        <Banner tone="state" icon="info">
          Connect GitHub on the Install page, then refresh here.
        </Banner>
      ) : (
        <>
          {note && (
            <Banner tone={note.tone === "ok" ? "ok" : "bad"} icon={note.tone === "ok" ? "check" : "warn"}>
              {note.text}
            </Banner>
          )}

          <div className="rounded-control border border-line px-3 py-[10px] text-[12.5px]">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{status.repo ?? "Not read yet"}</span>
              {status.branch && <span className="text-ink-3">{status.branch}</span>}
            </div>
            <p className="mt-1 text-[11.5px] text-ink-3">
              {status.fetchedAt
                ? `${status.fileCount} files · read ${ago(status.fetchedAt)}`
                : "No file list stored yet."}
              {status.truncated && " · partial, the repository is very large"}
            </p>
          </div>

          {status.lastError && (
            <p className="text-[11.5px] text-bad">Last attempt failed: {status.lastError}</p>
          )}

          <div className="flex items-center gap-2">
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await refreshRepo();
                  if (result.ok) {
                    setStatus(result.status);
                    setNote({ tone: "ok", text: result.message });
                  } else {
                    setNote({ tone: "bad", text: result.error });
                  }
                })
              }
            >
              {status.fetchedAt ? "Refresh file list" : "Read file list"}
            </Button>
            {pending && (
              <span className="flex items-center gap-2 text-[11.5px] text-ink-3">
                <Spinner /> Reading from GitHub…
              </span>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
