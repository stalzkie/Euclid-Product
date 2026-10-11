"use client";

import { useState, useTransition } from "react";
import { Banner, Button, Card, Input, SectionTitle } from "@/components/ui";
import { CopyIconButton, Spinner } from "@/components/controls";
import {
  removeCustomDomain,
  setCustomDomain,
  verifyCustomDomain,
  type DomainState,
} from "./domain-actions";

/**
 * Claiming a domain is not owning one. The board is served from it only
 * after a TXT record proves the founder controls its DNS, so the panel
 * walks through claim → publish records → verify.
 */
export function DomainPanel({
  initial,
  allowed,
  planName,
}: {
  initial: DomainState;
  allowed: boolean;
  planName: string;
}) {
  const [state, setState] = useState(initial);
  const [draft, setDraft] = useState(initial.domain ?? "");
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const run = (
    action: () => Promise<
      { ok: true; message: string; state: DomainState } | { ok: false; error: string }
    >,
  ) =>
    start(async () => {
      const result = await action();
      if (result.ok) {
        setState(result.state);
        setDraft(result.state.domain ?? "");
        setNote({ tone: "ok", text: result.message });
      } else {
        setNote({ tone: "bad", text: result.error });
      }
    });

  return (
    <Card className="flex flex-col gap-3 p-[18px]">
      <SectionTitle>Custom domain</SectionTitle>
      <p className="text-[12.5px] leading-[1.5] text-ink-2">
        Serve the hosted board from your own subdomain, e.g. feedback.yourapp.com.
      </p>

      {!allowed ? (
        <Banner tone="state" icon="info">
          Custom domains are on the Pro plan — you are on {planName}.
        </Banner>
      ) : (
        <>
          {note && (
            <Banner tone={note.tone === "ok" ? "ok" : "bad"} icon={note.tone === "ok" ? "check" : "warn"}>
              {note.text}
            </Banner>
          )}

          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="feedback.yourapp.com"
              className="flex-1"
            />
            <Button disabled={pending || !draft.trim()} onClick={() => run(() => setCustomDomain(draft))}>
              Save
            </Button>
          </div>

          {state.domain && (
            <>
              <div className="flex items-center gap-2">
                <span
                  className={
                    state.verified
                      ? "rounded-chip bg-ok-wash px-2 py-[2px] text-[11.5px] font-medium text-ok"
                      : "rounded-chip bg-warn-wash px-2 py-[2px] text-[11.5px] font-medium text-warn"
                  }
                >
                  {state.verified ? "Verified and serving" : "Not verified yet"}
                </span>
                <span className="text-[12px] text-ink-3">{state.domain}</span>
              </div>

              {!state.verified && state.record && (
                <div className="flex flex-col gap-2 rounded-control border border-line p-3">
                  <p className="text-[12px] text-ink-2">
                    Add both records at your DNS provider. The TXT record proves the
                    domain is yours; without it we will not answer for it.
                  </p>
                  <DnsRow type="CNAME" name={state.domain} value={state.target} />
                  <DnsRow
                    type="TXT"
                    name={`${state.record.name}.${state.domain}`}
                    value={state.record.value}
                  />
                </div>
              )}

              <div className="flex gap-2">
                <Button disabled={pending} onClick={() => run(() => verifyCustomDomain())}>
                  {state.verified ? "Check again" : "Verify"}
                </Button>
                <Button variant="ghost" disabled={pending} onClick={() => run(() => removeCustomDomain())}>
                  Remove
                </Button>
              </div>

              {pending && (
                <span className="flex items-center gap-2 text-[11.5px] text-ink-3">
                  <Spinner /> Looking up DNS…
                </span>
              )}
            </>
          )}
        </>
      )}
    </Card>
  );
}

function DnsRow({ type, name, value }: { type: string; name: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="w-14 shrink-0 font-medium text-ink-2">{type}</span>
      <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-[11.5px]">
        {name}
      </code>
      <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-[11.5px]">
        {value}
      </code>
      <CopyIconButton text={value} />
    </div>
  );
}
