"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner, Button, Card, Input, SectionTitle, cx } from "@/components/ui";
import { Spinner, ToggleRow } from "@/components/controls";
import { INTEGRATION_LABELS, type IntegrationKind } from "@/lib/integrations";
import {
  connectChat,
  connectGithub,
  connectLinear,
  disconnectIntegration,
} from "./integration-actions";

/** What the server is willing to tell the browser about a connection. */
export interface IntegrationSummary {
  kind: IntegrationKind;
  /** Redacted — never the webhook URL or token itself. */
  detail: string;
  events: string[];
  active: boolean;
  lastError: string | null;
  lastDeliveredAt: string | null;
}

const HINTS: Record<IntegrationKind, string> = {
  slack: "Slack → your workspace → Incoming Webhooks → Add to a channel.",
  discord: "Discord → Server settings → Integrations → Webhooks → New webhook.",
  github: "A fine-grained token with Issues: write on that one repository.",
  linear: "Linear → Settings → API → Personal API key, plus the team id.",
};

export function IntegrationsPanel({
  connected,
  allowed,
  planName,
}: {
  connected: IntegrationSummary[];
  allowed: boolean;
  planName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<IntegrationKind | null>(null);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const byKind = new Map(connected.map((item) => [item.kind, item]));

  const run = (action: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const result = await action();
      setNote(
        result.ok
          ? { tone: "ok", text: result.message ?? "Saved." }
          : { tone: "bad", text: result.error ?? "That did not work." },
      );
      if (result.ok) {
        setOpen(null);
        router.refresh();
      }
    });

  return (
    <Card id="integrations" className="flex flex-col gap-3 p-[18px]">
      <SectionTitle>Integrations</SectionTitle>
      <p className="text-[12.5px] leading-[1.5] text-ink-2">
        Post new feedback to Slack or Discord, and export a post to GitHub or Linear.
      </p>

      {!allowed && (
        <Banner tone="state" icon="info">
          Integrations are on the paid plans — you are on {planName}.
        </Banner>
      )}

      {note && (
        <Banner tone={note.tone === "ok" ? "ok" : "bad"} icon={note.tone === "ok" ? "check" : "warn"}>
          {note.text}
        </Banner>
      )}

      <div className="flex flex-col gap-2">
        {(["slack", "discord", "github", "linear"] as IntegrationKind[]).map((kind) => {
          const item = byKind.get(kind);
          return (
            <div key={kind} className="rounded-control border border-line">
              <div className="flex items-center gap-3 px-3 py-[10px]">
                <span className="flex-1 text-[13px]">{INTEGRATION_LABELS[kind]}</span>

                {item ? (
                  <span
                    className={cx(
                      "rounded-chip px-2 py-[2px] text-[11.5px] font-medium",
                      item.active && !item.lastError
                        ? "bg-ok-wash text-ok"
                        : "bg-bad-wash text-bad",
                    )}
                    title={item.detail}
                  >
                    {item.active && !item.lastError ? item.detail : "Needs attention"}
                  </span>
                ) : null}

                <Button
                  variant="ghost"
                  disabled={!allowed || pending}
                  onClick={() => setOpen(open === kind ? null : kind)}
                >
                  {item ? "Edit" : "Connect"}
                </Button>

                {item && (
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() => run(() => disconnectIntegration(kind))}
                  >
                    Disconnect
                  </Button>
                )}
              </div>

              {item?.lastError && (
                <p className="border-t border-line px-3 py-2 text-[11.5px] text-bad">
                  Last attempt failed: {item.lastError}
                </p>
              )}

              {open === kind && (
                <div className="border-t border-line p-3">
                  <Form kind={kind} pending={pending} run={run} />
                  <p className="mt-2 text-[11.5px] text-ink-3">{HINTS[kind]}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {pending && (
        <p className="flex items-center gap-2 text-[11.5px] text-ink-3">
          <Spinner /> Checking the connection…
        </p>
      )}
    </Card>
  );
}

function Form({
  kind,
  pending,
  run,
}: {
  kind: IntegrationKind;
  pending: boolean;
  run: (action: () => Promise<{ ok: boolean; error?: string; message?: string }>) => void;
}) {
  const [webhook, setWebhook] = useState("");
  const [onCreate, setOnCreate] = useState(true);
  const [onStatus, setOnStatus] = useState(true);
  const [repo, setRepo] = useState("");
  const [token, setToken] = useState("");
  const [teamId, setTeamId] = useState("");

  if (kind === "slack" || kind === "discord") {
    const events = [
      ...(onCreate ? (["post.created"] as const) : []),
      ...(onStatus ? (["post.status_changed"] as const) : []),
    ];

    return (
      <div className="flex flex-col gap-2">
        <Input
          value={webhook}
          onChange={(e) => setWebhook(e.target.value)}
          placeholder={
            kind === "slack"
              ? "https://hooks.slack.com/services/…"
              : "https://discord.com/api/webhooks/…"
          }
        />
        <ToggleRow
          label="New feedback"
          checked={onCreate}
          onChange={setOnCreate}
          detail="Post to the channel when someone submits."
        />
        <ToggleRow
          label="Status changes"
          checked={onStatus}
          onChange={setOnStatus}
          detail="Planned, In progress, Shipped, Declined."
        />
        <Button
          disabled={pending || !webhook.trim() || events.length === 0}
          onClick={() =>
            run(() => connectChat({ kind, webhookUrl: webhook, events: [...events] }))
          }
        >
          Connect and send a test message
        </Button>
      </div>
    );
  }

  if (kind === "github") {
    return (
      <div className="flex flex-col gap-2">
        <Input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" />
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="github_pat_…"
        />
        <Button
          disabled={pending || !repo.trim() || !token.trim()}
          onClick={() => run(() => connectGithub({ repo, token }))}
        >
          Connect
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="lin_api_…"
      />
      <Input
        value={teamId}
        onChange={(e) => setTeamId(e.target.value)}
        placeholder="Team id"
      />
      <Button
        disabled={pending || !token.trim() || !teamId.trim()}
        onClick={() => run(() => connectLinear({ token, teamId }))}
      >
        Connect
      </Button>
    </div>
  );
}
