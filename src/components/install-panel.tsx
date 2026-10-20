"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { Banner, SectionTitle, cx } from "./ui";
import { CopyIconButton, Segmented } from "./controls";
import { InstallPing } from "./install-ping";
import { FRAMEWORKS, agentInstallPrompt, installSnippet } from "@/lib/snippets";
import { diagnose, type InstallSignal } from "@/lib/install-doctor";
import { plural } from "@/lib/format";
import type { EmbedMode, IdentityMode, StackItem } from "@/lib/types";

/**
 * 04 · Install. The script tag, the vibe-coder shortcut, and a live check for
 * the first ping from the founder's domain.
 */
/**
 * "3 requests", "999+ requests".
 *
 * `plural` already carries the number, so this exists for the ceiling alone:
 * past a thousand the exact count stops being information and starts being a
 * number the reader has to parse to learn "lots".
 */
function requestCount(n: number): string {
  return n > 999 ? "999+ requests" : plural(n, "request");
}

export function InstallPanel({
  boardPublicId,
  boardName,
  origin,
  initialMode,
  identityMode,
  stack,
  allowedDomains,
  installed,
  compact,
  onAllowDomain,
}: {
  boardPublicId: string;
  boardName: string;
  origin: string;
  initialMode: EmbedMode;
  identityMode: IdentityMode;
  stack: StackItem[];
  allowedDomains: string[];
  /** True once the widget has been served to a real page. */
  installed: boolean;
  compact?: boolean;
  /**
   * Add a hostname to the allow-list and save. Supplied by the screen that
   * owns the domains field, so the doctor's fix writes through the same
   * action as typing it by hand rather than a second path to the same column.
   */
  onAllowDomain?: (host: string) => void;
}) {
  const [framework, setFramework] = useState("next");
  const [mode, setMode] = useState<EmbedMode>(initialMode);
  const [seen, setSeen] = useState(installed);
  const [signals, setSignals] = useState<InstallSignal[]>([]);

  const code = installSnippet(framework, { boardId: boardPublicId, mode, origin });
  const agentPrompt = agentInstallPrompt({
    boardId: boardPublicId,
    mode,
    origin,
    stack,
    identityMode,
  });
  const hostedUrl = `${origin}/b/${boardPublicId}`;
  // Matches the loopback hosts originAllowed() accepts, so the note below
  // disappears exactly when the founder has made it unnecessary.
  const allowsLoopback = allowedDomains.some((d) => {
    const clean = d.trim().toLowerCase().replace(/^\*\./, "");
    return clean === "localhost" || clean === "127.0.0.1" || clean.endsWith(".localhost");
  });
  const spec = FRAMEWORKS.find((f) => f.id === framework) ?? FRAMEWORKS[0];

  /*
    Poll for the first widget request from the founder's app — and, while it
    has not arrived, for the reason.

    `/api/board/doctor` rather than `/api/board/installed`, which answered the
    same boolean and nothing else. Both the install flag and the diagnosis
    come from one request because they are one question: a founder looking at
    a grey dot is asking "why", and two endpoints would let the dot and its
    explanation disagree for five seconds at a time.

    Runs immediately as well as on the interval. The previous version waited
    the full five seconds before its first call, so a founder arriving at a
    board that had been refusing requests all morning was shown "waiting" and
    no reason, until a tick they had no way to anticipate.
  */
  useEffect(() => {
    if (seen) return;
    let live = true;

    const check = async () => {
      try {
        const res = await fetch(`/api/board/doctor?board=${boardPublicId}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          installed?: boolean;
          signals?: InstallSignal[];
        };
        if (!live) return;
        setSignals(json.signals ?? []);
        if (json.installed) setSeen(true);
      } catch {
        // Offline or blocked; the next tick tries again.
      }
    };

    void check();
    const timer = setInterval(check, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [seen, boardPublicId]);

  const diagnosis = diagnose(seen, signals);

  return (
    <div className={cx("flex flex-wrap items-start gap-6", compact && "gap-5")}>
      <div className="flex min-w-0 flex-[999_1_460px] flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Framework" className="flex flex-wrap gap-4">
            {FRAMEWORKS.map((f) => {
              const on = f.id === framework;
              return (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setFramework(f.id)}
                  className={cx(
                    "-mb-px border-b-2 pb-[8px] text-[13px] font-medium",
                    on ? "border-ink text-ink" : "border-transparent text-ink-3",
                  )}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          <Segmented
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: "inline", label: "Inline" },
              { value: "floating", label: "Floating" },
            ]}
          />
        </div>

        <div className="overflow-hidden rounded-card border border-line">
          <div className="flex items-center justify-between border-b border-line bg-subtle px-4 py-2">
            <span className="font-mono text-[12.5px] text-ink-2">{spec.filename}</span>
            <CopyIconButton text={code} />
          </div>
          <pre className="thin-scroll overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-[1.7] text-ink-deep">
            {code}
          </pre>
        </div>

        <p className="text-[12px] leading-[1.5] text-ink-3">
          {mode === "inline"
            ? `Inline mode renders the board inside an element with id "euclid-board". Add that element where you want it.`
            : "Floating mode adds a button that opens the board in a side panel, on every page the script loads."}{" "}
          The widget mounts in a Shadow DOM, loads asynchronously, and never blocks your
          page.
        </p>

        {/* Install check */}
        <div
          role="status"
          className={cx(
            "eu-crossfade flex flex-wrap items-center gap-3 rounded-control border px-4 py-3",
            seen ? "border-ok-line bg-ok-wash" : "border-line bg-subtle",
          )}
        >
          <InstallPing seen={seen} />
          <span className="flex min-w-[220px] flex-1 flex-col">
            <span
              className={cx(
                "eu-crossfade text-[13px] font-medium",
                seen ? "text-ok" : "text-ink",
              )}
            >
              {seen
                ? "Your board is live. The widget has loaded from your app."
                : diagnosis.kind === "blocked"
                  ? "Your widget is running — and Euclid is turning it away."
                  : diagnosis.kind === "local"
                    ? "Working on your machine. Not live yet."
                    : `Waiting for the first ping${
                        allowedDomains[0] ? ` from ${allowedDomains[0]}` : ""
                      }`}
            </span>
            <span className="text-[12px] text-ink-3">
              {seen
                ? "Submit a test post from your own board to see the loop end to end."
                : diagnosis.kind === "silent"
                  ? "Deploy, then open any page. This checks every 5 seconds."
                  : "This checks every 5 seconds."}
            </span>
          </span>
        </div>

        {/*
          The install doctor.

          Only ever rendered when there is something to say that the line
          above could not: a board being refused, or one that only Euclid's
          own author has ever loaded. Silence stays silent — a panel that
          appears to report "nothing is wrong, we think" is noise on every
          healthy install, and this screen already has a dot for that.
        */}
        {diagnosis.kind === "blocked" && (
          <Banner
            tone="bad"
            icon="warn"
            action={
              onAllowDomain ? (
                <button
                  type="button"
                  onClick={() => onAllowDomain(diagnosis.origins[0])}
                  className="eu-press shrink-0 rounded-control border border-bad-line px-[10px] py-[5px] text-[12.5px] font-medium text-bad hover:bg-bad-wash"
                >
                  Allow {diagnosis.origins[0]}
                </button>
              ) : undefined
            }
          >
            <strong className="font-semibold">
              {diagnosis.origins.slice(0, 2).join(" and ")}
              {diagnosis.origins.length > 2
                ? ` and ${diagnosis.origins.length - 2} more`
                : ""}
            </strong>{" "}
            {diagnosis.origins.length === 1 ? "is" : "are"} loading the widget and being
            refused — {requestCount(diagnosis.count)} so far. The snippet is in the right
            place;{" "}
            {diagnosis.origins.length === 1 ? "that domain is" : "those domains are"} not on
            the allowed list for {boardName}.
          </Banner>
        )}

        {diagnosis.kind === "local" && (
          <Banner tone="state" icon="info">
            The widget is loading on{" "}
            <strong className="font-semibold">{diagnosis.origins.join(", ")}</strong>, so
            the snippet works. Local requests deliberately do not count as an install —
            deploy and open any page, and this turns green.
          </Banner>
        )}

        {/* Hosted fallback */}
        <div className="flex flex-wrap items-center gap-3 rounded-control border border-line px-4 py-3">
          <span className="min-w-[160px] flex-1 text-[13px] text-ink-2">
            No deploy yet? Share the hosted board:
          </span>
          <code className="truncate rounded-chip bg-muted px-2 py-[4px] font-mono text-[12.5px]">
            /b/{boardPublicId}
          </code>
          <Link
            href={hostedUrl}
            target="_blank"
            className="flex h-8 items-center gap-[6px] rounded-control border border-line-strong px-3 text-[12.5px] font-medium text-ink no-underline hover:bg-subtle"
          >
            Open
            <Icon name="arrowUpRight" size={12} strokeWidth={2} />
          </Link>
        </div>

        {allowedDomains.length === 0 && (
          <Banner tone="warn" icon="warn">
            No domains are allow-listed for {boardName}, so the widget will load anywhere.
            Add your app&apos;s domain in the board settings before you launch.
          </Banner>
        )}

        {/*
          The one surprising thing about the allow-list, said before it bites.

          Loopback is accepted while a board has never been served live, so a
          founder can test before deploying — and refused afterwards, because
          an `Origin: http://localhost` header is otherwise a way for anything
          that is not a browser to skip the list entirely. That transition is
          invisible: local requests simply start returning 403 one day.

          Shown only in the window where it is true and not yet explained, and
          not at all once `localhost` is listed, which is the fix it suggests.
        */}
        {allowedDomains.length > 0 && !seen && !allowsLoopback && (
          <Banner tone="state" icon="info">
            While you set this up, the widget also loads from localhost. That stops once
            {" "}{boardName} has been seen on a real site — add <code>localhost</code> under
            Allowed domains if you want to keep developing against this board after it
            goes live.
          </Banner>
        )}
      </div>

      {/* The vibe-coder shortcut */}
      <aside
        aria-labelledby="agent-install-title"
        className="flex min-w-0 flex-[1_1_320px] flex-col gap-3 rounded-card border border-ai-line bg-[linear-gradient(180deg,#FDF0F6_0%,#FFFFFF_45%)] p-[18px]"
      >
        <span className="flex items-center gap-[7px] text-[12.5px] font-semibold text-ai-deep">
          <Icon name="sparkle" size={15} strokeWidth={1.9} />
          Vibe-coder shortcut
        </span>
        <SectionTitle id="agent-install-title">
          Let your coding agent install it
        </SectionTitle>
        <p className="text-[13px] leading-[1.5] text-ink-2">
          Paste this into Claude Code, Codex or Cursor. It already knows your stack from
          the project profile.
        </p>
        <div className="overflow-hidden rounded-control border border-line bg-canvas">
          <div className="flex items-center justify-between border-b border-line bg-subtle px-3 py-2">
            <span className="font-mono text-[12px] text-ink-2">install-euclid.md</span>
            <CopyIconButton text={agentPrompt} />
          </div>
          <pre className="thin-scroll max-h-[320px] overflow-auto px-3 py-3 font-mono text-[12px] leading-[1.65] text-ink-deep">
            {agentPrompt}
          </pre>
        </div>
        <p className="text-[11.5px] leading-[1.45] text-ink-3">
          It asks for a diff before writing, so you see the change before it lands.
        </p>
      </aside>
    </div>
  );
}
