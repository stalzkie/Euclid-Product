"use client";

import { useState, useTransition } from "react";
import { Banner, Button, Card, Input, SectionTitle } from "@/components/ui";
import { CopyIconButton, Spinner } from "@/components/controls";
import { ago } from "@/lib/format";
import { createApiKey, revokeApiKey, type ApiKeySummary } from "./key-actions";

/**
 * Keys for the MCP server, so a coding agent can read the board directly.
 *
 * The token appears once, at creation. Only its hash is stored, so there is
 * no screen anywhere that can show it again — which the panel says plainly
 * rather than letting someone discover it by closing the dialog.
 */
export function McpPanel({
  initial,
  origin,
}: {
  initial: ApiKeySummary[];
  origin: string;
}) {
  const [keys, setKeys] = useState(initial);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const config = JSON.stringify(
    {
      mcpServers: {
        euclid: {
          type: "http",
          url: `${origin}/api/mcp`,
          headers: { Authorization: `Bearer ${fresh ?? "YOUR_KEY"}` },
        },
      },
    },
    null,
    2,
  );

  return (
    <Card className="flex flex-col gap-3 p-[18px]">
      <SectionTitle>Coding agent access (MCP)</SectionTitle>
      <p className="text-[12.5px] leading-[1.5] text-ink-2">
        Give Claude Code, Cursor or any MCP client a key and it can read your
        top requests, pull a Build Prompt, and mark a request shipped when the
        work lands.
      </p>

      {error && (
        <Banner tone="bad" icon="warn">
          {error}
        </Banner>
      )}

      {fresh && (
        <Banner tone="ok" icon="check">
          Copy this key now — it is stored only as a hash, so this is the one
          time it can be shown.
        </Banner>
      )}

      {fresh && (
        <div className="flex items-center gap-2 rounded-control border border-ok-line bg-ok-wash p-2">
          <code className="min-w-0 flex-1 truncate font-mono text-[12px]">{fresh}</code>
          <CopyIconButton text={fresh} />
        </div>
      )}

      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="What is this key for? e.g. Claude Code"
          className="flex-1"
        />
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const created = await createApiKey(name);
              if (created.ok) {
                setFresh(created.token);
                setKeys((current) => [created.key, ...current]);
                setName("");
              } else {
                setError(created.error);
              }
            })
          }
        >
          Create key
        </Button>
      </div>

      {keys.length > 0 && (
        <div className="flex flex-col gap-2">
          {keys.map((key) => (
            <div
              key={key.id}
              className="flex items-center gap-3 rounded-control border border-line px-3 py-[10px]"
            >
              <span className="flex-1 text-[13px]">{key.name}</span>
              <code className="font-mono text-[11.5px] text-ink-3">{key.prefix}…</code>
              <span className="text-[11.5px] text-ink-3">
                {key.lastUsedAt ? `used ${ago(key.lastUsedAt)}` : "never used"}
              </span>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const done = await revokeApiKey(key.id);
                    if (done.ok) setKeys((current) => current.filter((k) => k.id !== key.id));
                    else setError(done.error ?? "Could not revoke that key.");
                  })
                }
              >
                Revoke
              </Button>
            </div>
          ))}
        </div>
      )}

      <div>
        <p className="mb-1 text-[12px] font-medium text-ink-2">
          Add to your MCP client config
        </p>
        <div className="flex items-start gap-2">
          <pre className="min-w-0 flex-1 overflow-x-auto rounded-control bg-muted p-3 font-mono text-[11.5px] leading-[1.5]">
            {config}
          </pre>
          <CopyIconButton text={config} />
        </div>
      </div>

      {pending && (
        <span className="flex items-center gap-2 text-[11.5px] text-ink-3">
          <Spinner /> Working…
        </span>
      )}
    </Card>
  );
}
