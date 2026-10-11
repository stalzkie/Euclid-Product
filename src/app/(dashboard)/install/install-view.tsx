"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { InstallPanel } from "@/components/install-panel";
import {
  Banner,
  Button,
  Card,
  Input,
  PageHeader,
  SectionTitle,
  cx,
} from "@/components/ui";
import { CopyIconButton, Segmented, Spinner, ToggleRow } from "@/components/controls";
import { IDENTITY_SNIPPETS, identityHandoff } from "@/lib/snippets";
import type { EmbedMode, IdentityMode, StackItem } from "@/lib/types";
import { saveBoardSettings } from "../designer/actions";

export interface BoardSettingsShape {
  id: string;
  publicId: string;
  name: string;
  slug: string;
  color: string;
  identityMode: IdentityMode;
  allowedDomains: string[];
  anonVoteLimit: number;
  requireApproval: boolean;
  categories: string[];
  mode: EmbedMode;
}

const IDENTITY_COPY: Record<IdentityMode, { title: string; detail: string }> = {
  anonymous: {
    title: "Anonymous",
    detail: "Cookie-based, with a vote cap per visitor. Zero friction, easy to game.",
  },
  email: {
    title: "Email magic link",
    detail: "Votes and replies tie to a real address, so you can email voters on ship.",
  },
  jwt: {
    title: "Signed JWT from your app",
    detail:
      "Your backend passes user id, email and plan. Unlocks segment analytics and plan-weighted votes.",
  },
};

export function InstallView({
  board,
  origin,
  stack,
  installed,
  jwtAllowed,
  customDomainAllowed,
  planName,
}: {
  board: BoardSettingsShape;
  origin: string;
  stack: StackItem[];
  installed: boolean;
  jwtAllowed: boolean;
  customDomainAllowed: boolean;
  planName: string;
}) {
  const router = useRouter();
  const [identity, setIdentity] = useState<IdentityMode>(board.identityMode);
  const [domains, setDomains] = useState(board.allowedDomains.join("\n"));
  const [voteLimit, setVoteLimit] = useState(board.anonVoteLimit);
  const [approval, setApproval] = useState(board.requireApproval);
  const [categories, setCategories] = useState(board.categories.join(", "));
  const [snippet, setSnippet] = useState(IDENTITY_SNIPPETS[0].id);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      setError(null);
      const res = await saveBoardSettings({
        boardId: board.id,
        name: board.name,
        color: board.color,
        identityMode: identity,
        allowedDomains: domains.split(/[\n,]/).map((d) => d.trim()).filter(Boolean),
        anonVoteLimit: voteLimit,
        requireApproval: approval,
        categories: categories.split(",").map((c) => c.trim()).filter(Boolean),
      });
      if (res.ok) {
        setToast("Saved. The widget picks this up on its next load.");
        setTimeout(() => setToast(null), 4000);
        router.refresh();
      } else {
        setError(res.error);
      }
    });

  const activeSnippet =
    IDENTITY_SNIPPETS.find((s) => s.id === snippet) ?? IDENTITY_SNIPPETS[0];

  return (
    <>
      <PageHeader
        title="Install widget"
        subtitle={`One script tag puts ${board.name} in your app. Design changes go live without a redeploy.`}
        actions={
          <Button variant="primary" onClick={save} disabled={pending}>
            {pending ? <Spinner /> : null}
            Save settings
          </Button>
        }
      />

      {toast && (
        <Banner tone="ok" icon="check">
          {toast}
        </Banner>
      )}
      {error && (
        <Banner tone="bad" icon="warn">
          {error}
        </Banner>
      )}

      <section id="api" className="flex flex-col gap-4">
        <SectionTitle>The script tag</SectionTitle>
        <InstallPanel
          boardPublicId={board.publicId}
          boardName={board.name}
          origin={origin}
          initialMode={board.mode}
          identityMode={identity}
          stack={stack}
          allowedDomains={board.allowedDomains}
          installed={installed}
        />
      </section>

      {/* Identity */}
      <section id="identity" className="flex flex-col gap-4">
        <SectionTitle>Who can post and vote</SectionTitle>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {(["anonymous", "email", "jwt"] as IdentityMode[]).map((mode) => {
            const on = mode === identity;
            const locked = mode === "jwt" && !jwtAllowed;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={locked}
                onClick={() => setIdentity(mode)}
                className={cx(
                  "flex flex-col gap-2 rounded-card border bg-canvas p-4 text-left",
                  on
                    ? "border-state-bright shadow-[0_0_0_3px_var(--color-state-ring)]"
                    : "border-line hover:bg-subtle",
                  locked && "opacity-60",
                )}
              >
                <span className="flex items-center gap-2 text-[14px] font-semibold">
                  {IDENTITY_COPY[mode].title}
                  {locked && <Icon name="lock" size={13} className="text-ink-3" />}
                </span>
                <span className="text-[12.5px] leading-[1.5] text-ink-2">
                  {IDENTITY_COPY[mode].detail}
                </span>
                {locked && (
                  <span className="text-[11.5px] text-warn">
                    Indie plan and above · you are on {planName}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {identity === "anonymous" && (
          <label className="flex max-w-[280px] flex-col gap-[6px] text-[13px] font-medium">
            Vote cap per visitor
            <Input
              type="number"
              min={1}
              max={100}
              value={voteLimit}
              onChange={(e) => setVoteLimit(Number(e.target.value) || 1)}
            />
            <span className="text-[12px] font-normal text-ink-3">
              Anonymous boards are easy to game. This caps how many posts one cookie can
              vote for.
            </span>
          </label>
        )}

        {identity === "jwt" && (
          <Card className="flex flex-col gap-3 p-[18px]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionTitle>Pass a signed user from your app</SectionTitle>
              <Segmented
                size="sm"
                value={snippet}
                onChange={setSnippet}
                options={IDENTITY_SNIPPETS.map((s) => ({ value: s.id, label: s.label }))}
              />
            </div>
            <p className="text-[12.5px] leading-[1.5] text-ink-2">
              Sign a short-lived token with a shared secret and hand it to the widget.
              Euclid verifies it, so a visitor cannot claim to be on a paid plan.
            </p>
            <div className="overflow-hidden rounded-control border border-line">
              <div className="flex items-center justify-between border-b border-line bg-subtle px-3 py-2">
                <span className="font-mono text-[12px] text-ink-2">
                  app/api/euclid-token/route.ts
                </span>
                <CopyIconButton text={activeSnippet.code} />
              </div>
              <pre className="thin-scroll max-h-[320px] overflow-auto px-3 py-3 font-mono text-[12px] leading-[1.65] text-ink-deep">
                {activeSnippet.code}
              </pre>
            </div>
            <div className="overflow-hidden rounded-control border border-line">
              <div className="flex items-center justify-between border-b border-line bg-subtle px-3 py-2">
                <span className="font-mono text-[12px] text-ink-2">
                  then, on the page
                </span>
                <CopyIconButton text={identityHandoff(board.publicId, origin)} />
              </div>
              <pre className="thin-scroll overflow-auto px-3 py-3 font-mono text-[12px] leading-[1.65] text-ink-deep">
                {identityHandoff(board.publicId, origin)}
              </pre>
            </div>
            <Banner tone="warn" icon="warn">
              Put the shared secret in <code className="font-mono">EUCLID_SECRET</code> on
              both sides. Never ship it to the browser.
            </Banner>
          </Card>
        )}
      </section>

      {/* Domains and moderation */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card id="domains" className="flex flex-col gap-3 p-[18px]">
          <SectionTitle>Allowed domains</SectionTitle>
          <p className="text-[12.5px] leading-[1.5] text-ink-2">
            One per line. The widget refuses to load anywhere else, which is what keeps
            someone else from embedding your board.
          </p>
          <textarea
            rows={4}
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
            placeholder={"yourapp.com\nstaging.yourapp.com"}
            className="w-full rounded-control border border-line-strong px-3 py-2 font-mono text-[12.5px] outline-none"
          />
          <p className="text-[11.5px] text-ink-3">
            Leave empty to allow any domain. Fine while you are testing, not at launch.
          </p>
        </Card>

        <Card className="flex flex-col gap-4 p-[18px]">
          <SectionTitle>Moderation</SectionTitle>
          <ToggleRow
            label="Approval queue"
            detail="New posts stay hidden until you approve them"
            checked={approval}
            onChange={setApproval}
          />
          <div className="flex flex-col gap-2 border-t border-hairline pt-3 text-[12.5px] leading-[1.5] text-ink-2">
            <span className="flex items-center gap-2">
              <Icon name="check" size={13} strokeWidth={2.2} className="text-ok" />
              Rate limits on posts, votes and comments
            </span>
            <span className="flex items-center gap-2">
              <Icon name="check" size={13} strokeWidth={2.2} className="text-ok" />
              Honeypot field on the submit form
            </span>
            <span className="flex items-center gap-2">
              <Icon name="check" size={13} strokeWidth={2.2} className="text-ok" />
              Spam scoring on every submission
            </span>
            <span className="flex items-center gap-2">
              <Icon name="check" size={13} strokeWidth={2.2} className="text-ok" />
              Prompt-injection flagging before anything reaches your agent
            </span>
          </div>
          <label className="flex flex-col gap-[6px] text-[13px] font-medium">
            Categories
            <Input
              value={categories}
              onChange={(e) => setCategories(e.target.value)}
              placeholder="Feature, Bug, Integration, Other"
            />
            <span className="text-[12px] font-normal text-ink-3">
              Comma separated. Shown as a picker on the submit form.
            </span>
          </label>
        </Card>
      </div>

      {/* Integrations and custom domain */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card id="integrations" className="flex flex-col gap-3 p-[18px]">
          <SectionTitle>Integrations</SectionTitle>
          <p className="text-[12.5px] leading-[1.5] text-ink-2">
            Post new feedback to Slack or Discord, and export a post to GitHub or Linear.
          </p>
          <div className="flex flex-col gap-2">
            {["Slack", "Discord", "GitHub issues", "Linear"].map((name) => (
              <div
                key={name}
                className="flex items-center gap-3 rounded-control border border-line px-3 py-[10px]"
              >
                <span className="flex-1 text-[13px]">{name}</span>
                <span className="rounded-chip bg-muted px-2 py-[2px] text-[11.5px] font-medium text-ink-2">
                  Coming soon
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="flex flex-col gap-3 p-[18px]">
          <SectionTitle>Custom domain</SectionTitle>
          <p className="text-[12.5px] leading-[1.5] text-ink-2">
            Serve the hosted board from your own subdomain, e.g.
            feedback.yourapp.com.
          </p>
          {customDomainAllowed ? (
            <>
              <Input placeholder="feedback.yourapp.com" />
              <p className="text-[11.5px] text-ink-3">
                Point a CNAME at this deployment, then save. Verification is not wired up
                yet.
              </p>
            </>
          ) : (
            <Banner tone="state" icon="info">
              Custom domains are on the Pro plan — you are on {planName}.
            </Banner>
          )}
        </Card>
      </div>
    </>
  );
}
