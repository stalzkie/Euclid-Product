"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, SectionTitle } from "@/components/ui";
import { Spinner } from "@/components/controls";
import { exportPostToIssue } from "../../install/integration-actions";

/**
 * Hand a post to the issue tracker the team already works in. One post, one
 * issue: once exported, this shows the link rather than offering to open a
 * second copy of the same request.
 */
export function ExportIssue({
  postId,
  connected,
  externalUrl,
  externalKind,
}: {
  postId: string;
  connected: ("github" | "linear")[];
  externalUrl: string | null;
  externalKind: "github" | "linear" | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (externalUrl) {
    return (
      <Card className="flex flex-col gap-2 p-[18px]">
        <SectionTitle>Tracked</SectionTitle>
        <a
          href={externalUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[12.5px] font-medium text-state no-underline hover:underline"
        >
          Open the {externalKind === "linear" ? "Linear" : "GitHub"} issue
        </a>
      </Card>
    );
  }

  if (!connected.length) return null;

  return (
    <Card className="flex flex-col gap-2 p-[18px]">
      <SectionTitle>Export to your tracker</SectionTitle>
      <p className="text-[12.5px] leading-[1.5] text-ink-3">
        Opens an issue with the title, the description and how many people
        asked for it.
      </p>
      <div className="flex flex-wrap gap-2">
        {connected.map((kind) => (
          <Button
            key={kind}
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const result = await exportPostToIssue(postId, kind);
                if (result.ok) router.refresh();
                else setError(result.error ?? "That did not work.");
              })
            }
          >
            {kind === "github" ? "GitHub issue" : "Linear issue"}
          </Button>
        ))}
      </div>
      {pending && (
        <span className="flex items-center gap-2 text-[11.5px] text-ink-3">
          <Spinner /> Opening the issue…
        </span>
      )}
      {error && <span className="text-[11.5px] text-bad">{error}</span>}
    </Card>
  );
}
