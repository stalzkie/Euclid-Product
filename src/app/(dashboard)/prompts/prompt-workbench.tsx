"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AnimatePresence } from "motion/react";
import { Icon } from "@/components/icons";
import {
  Banner,
  Button,
  Card,
  SectionTitle,
  Textarea,
  cx,
} from "@/components/ui";
import {
  CopyButton,
  DownloadButton,
  Spinner,
  ToggleRow,
  UnderlineTabs,
} from "@/components/controls";
import { TARGETS, targetSpec } from "@/lib/ai/targets";
import {
  DEFAULT_INCLUDES,
  type Assumption,
  type BuildPrompt,
  type PromptIncludes,
  type PromptTarget,
} from "@/lib/types";
import {
  AnimatedNumber,
  Collapse,
  DiffHighlight,
  FadeRise,
  IconSwap,
  Shimmer,
} from "@/components/motion";
import { changedLines } from "@/lib/motion/lines";
import { ago, plural } from "@/lib/format";
import { confirmAssumption, generateBuildPrompt, markCopied } from "./actions";

export interface Subject {
  kind: "post" | "theme";
  number?: number;
  themeId?: string;
  title: string;
  votes: number;
  payingShare: number;
  commentCount: number;
  mergedCount: number;
  quoteCount: number;
  founderNotes: string | null;
  themeName: string | null;
}

export interface ProfileSummary {
  stackLine: string;
  rulesName: string;
  rulesBytes: number;
  hasProfile: boolean;
}

const REFINEMENTS = [
  "Make it smaller",
  "Write tests first",
  "Split into 2 PRs",
  "Use Supabase row-level security",
];

/**
 * 09 · Build Prompt. Inputs on the left, the prompt on the right, a refinement
 * chat along the bottom. Nothing is ever executed — the founder reads the full
 * prompt before they copy it.
 */
export function PromptWorkbench({
  subject,
  profile,
  initialPrompt,
  history,
  promptsLeft,
  promptLimit,
  defaultTarget,
  aiReady,
}: {
  subject: Subject;
  profile: ProfileSummary;
  initialPrompt: BuildPrompt | null;
  history: Pick<BuildPrompt, "id" | "version" | "target" | "created_at" | "copied">[];
  promptsLeft: number;
  promptLimit: number;
  defaultTarget: PromptTarget;
  aiReady: boolean;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState<BuildPrompt | null>(initialPrompt);
  const [target, setTarget] = useState<PromptTarget>(
    initialPrompt?.target ?? defaultTarget,
  );
  const [includes, setIncludes] = useState<PromptIncludes>(
    (initialPrompt?.includes as PromptIncludes) ?? DEFAULT_INCLUDES,
  );
  const [notes, setNotes] = useState(
    initialPrompt?.founder_notes ?? subject.founderNotes ?? "",
  );
  const [tab, setTab] = useState<"prompt" | "ctx">("prompt");
  const [refinement, setRefinement] = useState("");
  const [left, setLeft] = useState(promptsLeft);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pending, start] = useTransition();

  /*
    The previous version of the document, kept only so the next one can tint
    the lines that are new. Set when a generation comes back rather than on
    every render, because a re-render has not changed anything.
  */
  const [previousBody, setPreviousBody] = useState<string | null>(null);

  const spec = targetSpec(target);
  const assumptions = (prompt?.assumptions ?? []) as Assumption[];
  const open = assumptions.filter((a) => !a.confirmed);

  const body = prompt
    ? tab === "prompt"
      ? prompt.body
      : (prompt.context_block ?? "")
    : "";

  const fileName = tab === "prompt" ? spec.file : spec.ctxFile;
  const lines = body ? body.split("\n").length : 0;
  const tokens = prompt ? prompt.token_estimate : 0;

  const includeRows = useMemo(
    () => [
      {
        key: "quotes" as const,
        label: "User quotes",
        detail: subject.quoteCount
          ? `${plural(subject.quoteCount, "quote")} from ${plural(subject.commentCount, "comment")}`
          : "No comments to quote yet",
      },
      {
        key: "demand" as const,
        label: "Demand data",
        detail: `${subject.votes} votes · ${subject.payingShare}% paying${
          subject.mergedCount ? ` · ${subject.mergedCount} merged` : ""
        }`,
      },
      {
        key: "profile" as const,
        label: "Project profile",
        detail: profile.hasProfile ? profile.stackLine : "Not filled in yet",
      },
      {
        key: "rules" as const,
        label: profile.rulesName,
        detail: profile.rulesBytes
          ? `Rules file · ${(profile.rulesBytes / 1024).toFixed(1)} KB`
          : "No rules file pasted",
      },
      { key: "notes" as const, label: "Founder notes", detail: "Written by you" },
    ],
    [subject, profile],
  );

  const run = (instruction?: string) =>
    start(async () => {
      setError(null);
      const res = await generateBuildPrompt({
        postNumber: subject.kind === "post" ? subject.number : undefined,
        themeId: subject.kind === "theme" ? subject.themeId : undefined,
        target,
        includes,
        founderNotes: notes || null,
        refinement: instruction ?? null,
        previousId: instruction ? (prompt?.id ?? null) : null,
        assumptions,
      });

      if (res.ok) {
        setPreviousBody(prompt?.body ?? null);
        setPrompt(res.prompt);
        setLeft(res.promptsLeft);
        setRefinement("");
        setTab("prompt");
        router.refresh();
      } else {
        setError(res.error);
      }
    });

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {subject.kind === "post" && (
            <Link
              href={`/posts/${subject.number}`}
              aria-label="Back to post"
              className="mt-1 flex h-8 w-8 items-center justify-center rounded-control border border-line-strong text-ink-2 no-underline hover:bg-subtle"
            >
              <Icon name="chevronRight" size={14} className="rotate-180" />
            </Link>
          )}
          <div className="flex flex-col gap-1">
            <h1 className="flex items-center gap-2 text-[26px] font-semibold tracking-[-0.015em]">
              Build Prompt
              {prompt && (
                <span className="rounded-full bg-muted px-[9px] py-[3px] text-[12px] font-medium text-ink-2">
                  v{prompt.version}
                  {prompt.copied ? " · copied" : " · draft"}
                </span>
              )}
            </h1>
            <span className="text-[14px] text-ink-2">
              {subject.title}
              {subject.kind === "post" ? ` · #${subject.number}` : " · theme"}
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          {history.length > 0 && (
            <Button icon="clock" onClick={() => setHistoryOpen((v) => !v)}>
              History
            </Button>
          )}
          {prompt && (
            <>
              <DownloadButton text={body} filename={fileName} />
              <CopyButton
                text={body}
                label="Copy prompt"
                variant="primary"
                onCopied={() => {
                  void markCopied(prompt.id);
                }}
              />
            </>
          )}
        </div>
      </header>

      {historyOpen && history.length > 0 && (
        <Card className="flex flex-col divide-y divide-hairline">
          {history.map((h) => (
            <Link
              key={h.id}
              href={`/prompts/${h.id}`}
              className="flex items-center gap-3 px-4 py-[10px] text-ink no-underline hover:bg-subtle"
            >
              <span className="w-10 text-[13px] font-semibold">v{h.version}</span>
              <span className="flex-1 text-[13px]">{targetSpec(h.target).label}</span>
              {h.copied && (
                <span className="rounded-chip bg-ok-wash px-2 py-[2px] text-[11.5px] font-medium text-ok">
                  copied
                </span>
              )}
              <span className="text-[12px] text-ink-3">{ago(h.created_at)}</span>
            </Link>
          ))}
        </Card>
      )}

      {!aiReady && (
        <Banner tone="warn" icon="warn">
          No Anthropic key is configured, so generation is switched off. Set{" "}
          <code className="font-mono text-[12.5px]">ANTHROPIC_API_KEY</code> to turn
          Build Prompt, Ask Euclid and the AI drafts on.
        </Banner>
      )}

      {error && (
        <Banner tone="bad" icon="warn">
          {error}
        </Banner>
      )}

      <div className="flex flex-wrap items-start gap-6">
        {/* Inputs */}
        <aside
          aria-label="Prompt inputs"
          className="flex min-w-0 flex-[1_1_320px] flex-col gap-5"
        >
          <section aria-labelledby="tool-title" className="flex flex-col gap-2">
            <SectionTitle id="tool-title">Target tool</SectionTitle>
            <div role="radiogroup" aria-labelledby="tool-title" className="flex flex-col gap-2">
              {TARGETS.map((t) => {
                const on = t.id === target;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setTarget(t.id)}
                    className={cx(
                      "flex flex-col gap-[2px] rounded-[10px] border bg-canvas px-3 py-[10px] text-left",
                      on
                        ? "border-state-bright shadow-[0_0_0_3px_var(--color-state-ring)]"
                        : "border-line hover:bg-subtle",
                    )}
                  >
                    <span className="text-[13.5px] font-medium">{t.label}</span>
                    <span className="text-[12px] text-ink-3">{t.format}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="inc-title" className="flex flex-col gap-3">
            <SectionTitle id="inc-title">Include in prompt</SectionTitle>
            {includeRows.map((row) => (
              <ToggleRow
                key={row.key}
                label={row.label}
                detail={row.detail}
                checked={includes[row.key]}
                onChange={(next) => setIncludes({ ...includes, [row.key]: next })}
              />
            ))}
          </section>

          <label className="flex flex-col gap-[6px] text-[13px] font-medium">
            Founder notes
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Keep it behind a feature flag. Free plan gets CSV only."
            />
          </label>

          {prompt && assumptions.length > 0 && (
            // Confirming the last one collapses the panel: there is nothing
            // left to check, and an empty amber box still reads as a warning.
            <Collapse open={open.length > 0}>
              <section
                aria-labelledby="asm-title"
                className="flex flex-col gap-3 rounded-[14px] border border-[#FDE68A] bg-warn-note p-4"
              >
              <h2
                id="asm-title"
                className="flex items-center gap-[7px] text-[13px] font-semibold text-warn"
              >
                <Icon name="warn" size={15} strokeWidth={1.9} />
                {open.length} assumption{open.length === 1 ? "" : "s"} to check
              </h2>
              {assumptions.map((a) => (
                <div key={a.id} className="flex items-start gap-3">
                  <span className="flex-1 text-[13px] leading-[1.45] text-ink-body">
                    {a.text}
                  </span>
                  {a.confirmed ? (
                    <span className="eu-crossfade flex shrink-0 items-center gap-1 text-[12px] font-medium text-ok">
                      <IconSwap swapKey="confirmed" size={12}>
                        <Icon name="check" size={12} strokeWidth={2.4} />
                      </IconSwap>
                      Confirmed
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const res = await confirmAssumption(prompt.id, a.id);
                          if (res.ok) {
                            setPreviousBody(prompt.body);
                            setPrompt({
                              ...prompt,
                              assumptions: res.assumptions,
                              body: res.body,
                            });
                          }
                        })
                      }
                      className="eu-press h-7 shrink-0 rounded-[6px] border border-line bg-canvas px-[10px] text-[12px] font-medium hover:bg-muted disabled:opacity-50"
                    >
                      Confirm
                    </button>
                  )}
                </div>
              ))}
                <p className="text-[11.5px] leading-[1.45] text-warn">
                  Confirming an assumption removes it from the prompt. Correcting one is
                  a refinement — type the correction below.
                </p>
              </section>
            </Collapse>
          )}

          {!prompt && (
            <Button
              variant="ai"
              icon="sparkle"
              disabled={pending || !aiReady || left === 0}
              onClick={() => run()}
            >
              {pending ? <Spinner /> : null}
              {pending ? "Generating…" : `Generate for ${spec.label}`}
            </Button>
          )}

          <p className="text-[12px] text-ink-3">
            {left} of {promptLimit} Build Prompts left this month.
          </p>
        </aside>

        {/* The prompt */}
        <main className="flex min-w-0 flex-[999_1_520px] flex-col gap-3">
          {prompt ? (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <UnderlineTabs
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: "prompt", label: "Prompt" },
                    { value: "ctx", label: spec.ctx },
                  ]}
                />
                <span className="flex items-center gap-3 pb-[9px] text-[12px] text-ink-3">
                  <span className="flex items-center gap-1">
                    <AnimatedNumber value={lines} /> lines - about{" "}
                    <AnimatedNumber value={tokens} /> tokens
                  </span>
                  <span className="flex items-center gap-[5px] text-ai-deep">
                    <Icon name="shield" size={13} strokeWidth={1.8} />
                    User text quoted as data
                  </span>
                </span>
              </div>

              <div className="overflow-hidden rounded-card border border-line">
                {/* The hairline exists only while a request is in flight. */}
                <AnimatePresence>
                  {pending && (
                    <FadeRise key="shimmer" mountAnimation>
                      <Shimmer label={"Generating the " + spec.label + " prompt"} />
                    </FadeRise>
                  )}
                </AnimatePresence>
                <div className="flex items-center justify-between border-b border-line bg-subtle px-4 py-[9px]">
                  {/*
                    Switching the target tool changes the file name and nothing
                    else, so the file name is the only thing that crossfades.
                    The document underneath stays exactly where it is.
                  */}
                  <FadeRise
                    key={fileName}
                    as="span"
                    className="font-mono text-[12.5px] text-ink-2"
                  >
                    {fileName}
                  </FadeRise>
                  <FadeRise
                    key={pending ? "generating" : spec.label}
                    as="span"
                    className="text-[12px] text-ink-3"
                  >
                    {pending ? "Generating..." : "Formatted for " + spec.label}
                  </FadeRise>
                </div>
                <PromptBody
                  body={body}
                  previousBody={tab === "prompt" ? previousBody : null}
                  version={prompt.id + tab}
                  pending={pending}
                />
              </div>

              {/* Refinement */}
              <Card className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap gap-2">
                  {REFINEMENTS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      disabled={pending || !aiReady || left === 0}
                      onClick={() => run(r)}
                      className="h-8 rounded-control border border-line bg-canvas px-[10px] text-[12.5px] font-medium text-ink-body hover:bg-subtle disabled:opacity-50"
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex h-9 min-w-[240px] flex-1 items-center gap-2 rounded-control border border-line-strong px-3">
                    <span className="sr-only">Refine the prompt</span>
                    <input
                      type="text"
                      value={refinement}
                      onChange={(e) => setRefinement(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && refinement.trim()) run(refinement.trim());
                      }}
                      placeholder={`Refine: "Keep CSV for every plan"`}
                      className="min-w-0 flex-1 border-0 text-[13.5px] outline-none"
                    />
                  </label>
                  <span className="text-[12px] text-ink-3">1 credit</span>
                  <Button
                    variant="ai"
                    aria-label="Regenerate with this change"
                    disabled={pending || !refinement.trim() || !aiReady || left === 0}
                    onClick={() => run(refinement.trim())}
                  >
                    {pending ? <Spinner /> : <Icon name="send" size={15} strokeWidth={1.9} />}
                    Regenerate
                  </Button>
                </div>
                <p className="text-[11.5px] leading-[1.45] text-ink-3">
                  Nothing here runs on its own. Read the prompt through, then paste it into{" "}
                  {spec.label}.
                </p>
              </Card>
            </>
          ) : (
            <Card className="flex flex-col items-start gap-4 p-8">
              <span className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-ai-wash text-ai">
                <Icon name="sparkle" size={20} strokeWidth={1.8} />
              </span>
              <div className="flex flex-col gap-2">
                <p className="text-[17px] font-semibold">
                  Turn this request into a prompt
                </p>
                <p className="max-w-[520px] text-[13.5px] leading-[1.55] text-ink-2">
                  Euclid reads {subject.title}
                  {subject.commentCount > 0 && ` and its ${plural(subject.commentCount, "comment")}`}
                  {subject.mergedCount > 0 && `, the ${plural(subject.mergedCount, "post")} merged into it`}
                  , the {subject.votes} votes behind it and your project profile, and
                  writes a brief your coding agent can act on: goal, acceptance
                  criteria, edge cases, test plan, and the assumptions it had to make.
                </p>
              </div>
              <Button
                variant="ai"
                icon="sparkle"
                disabled={pending || !aiReady || left === 0}
                onClick={() => run()}
              >
                {pending ? <Spinner /> : null}
                {pending ? "Generating…" : `Generate for ${spec.label}`}
              </Button>
              {left === 0 && (
                <p className="text-[12.5px] text-warn">
                  You have used this month&apos;s Build Prompts.{" "}
                  <Link href="/billing" className="font-medium text-state">
                    Upgrade for more
                  </Link>
                  .
                </p>
              )}
            </Card>
          )}
        </main>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The prompt document.
 *
 * Three things happen to it, and nothing else:
 *
 * While a request is in flight it dims to 60%, which says "this is about to
 * be replaced" without taking it away — the founder can still read the version
 * they have. When a new version arrives it crossfades, because the whole
 * document changed and sliding it would be theatre. And the lines that are
 * genuinely new get a brief pink tint, so a refinement can be read as a diff
 * rather than re-read from the top.
 *
 * The lines are rendered one span per line specifically so a line can be
 * tinted. The text is still a single pre block, so copy and select behave.
 */
function PromptBody({
  body,
  previousBody,
  version,
  pending,
}: {
  body: string;
  previousBody: string | null;
  /** Changes when the document is replaced, which is what triggers the fade. */
  version: string;
  pending: boolean;
}) {
  const lines = useMemo(() => body.split("\n"), [body]);
  const changed = useMemo(() => changedLines(previousBody, body), [previousBody, body]);

  return (
    <FadeRise key={version}>
      <pre
        className={cx(
          "thin-scroll max-h-[620px] overflow-auto whitespace-pre-wrap break-words",
          "px-4 py-4 font-mono text-[13px] leading-[1.6] text-ink-deep",
          "transition-opacity duration-[var(--eu-dur-base)] ease-eu-standard",
          pending && "opacity-60",
        )}
        aria-busy={pending || undefined}
      >
        {lines.map((line, index) =>
          changed.has(index) ? (
            <DiffHighlight key={index} token={version} as="span">
              {line}
              {"\n"}
            </DiffHighlight>
          ) : (
            <span key={index}>
              {line}
              {"\n"}
            </span>
          ),
        )}
      </pre>
    </FadeRise>
  );
}
