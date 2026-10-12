"use client";

import { AnimatePresence } from "motion/react";
import { useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { Button, Card, Chip, SectionTitle, cx } from "@/components/ui";
import { Spinner, Toggle } from "@/components/controls";
import {
  AnimatedNumber,
  Collapse,
  CollapseOut,
  CountUp,
  DiffHighlight,
  FadeRise,
  IconSwap,
  MotionProvider,
  Shimmer,
  Stagger,
  Toaster,
  useToast,
} from "@/components/motion";

const PROMPT_LINES = [
  "## Goal",
  "Let a team export their board as CSV.",
  "## Acceptance criteria",
  "- A founder on any plan can export the open posts.",
  "- The file downloads without a round trip to the server.",
];

const SAMPLE_ROWS = ["Dark mode", "CSV export", "Slack digest"];

export function MotionLab() {
  const [reduce, setReduce] = useState(false);
  const [replay, setReplay] = useState(0);

  return (
    <div style={{ display: "contents" }} data-reduce-motion={reduce ? "1" : undefined}>
      <MotionProvider reduceMotion={reduce}>
        <Toaster>
          <main className="mx-auto flex max-w-[940px] flex-col gap-7 px-6 py-10">
            <header className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-col gap-1">
                <h1 className="text-[26px] font-semibold tracking-[-0.015em]">Motion</h1>
                <p className="text-[14px] text-ink-2">
                  The eight primitives, on the real tokens. Everything here is caused by
                  something, and nothing loops but the three that may.
                </p>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-[13px] font-medium">
                  Reduce motion
                  <Toggle checked={reduce} onChange={setReduce} label="Reduce motion" />
                </label>
                <Button icon="refresh" variant="primary" onClick={() => setReplay((n) => n + 1)}>
                  Replay
                </Button>
              </div>
            </header>

            {/* Remounting is what replays every mount animation at once. */}
            <div key={replay} className="flex flex-col gap-5">
              <Demo
                name="FadeRise"
                spec="opacity 0 to 1, y 4px to 0 · enter 200ms ease-out · exit opacity only, 140ms ease-in"
              >
                <FadeRise mountAnimation distance="sm">
                  <Card className="px-4 py-3 text-[13.5px]">
                    The default entrance. Everything that appears uses it.
                  </Card>
                </FadeRise>
                <FadeRise mountAnimation distance="md" delay={0.05}>
                  <Card className="px-4 py-3 text-[13.5px]">
                    8px, for the cards the spec gives more presence.
                  </Card>
                </FadeRise>
              </Demo>

              <Demo
                name="Collapse"
                spec="height 0 to auto · 250ms ease-standard · content fades 50ms behind the height"
              >
                <CollapseDemo />
              </Demo>

              <Demo
                name="Stagger"
                spec="30ms per item · first 8 only · first mount only, never on filtering"
              >
                <Stagger as="ul" itemAs="li" className="flex flex-col gap-2">
                  {[
                    "Export the board as CSV",
                    "Slack notifications on new posts",
                    "Dark mode for the public board",
                    "Let voters change their mind",
                    "Merge duplicates in bulk",
                  ].map((title) => (
                    <li key={title}>
                      <Card className="flex items-center justify-between px-4 py-[10px] text-[13.5px]">
                        {title}
                        <Chip tone="neutral">open</Chip>
                      </Card>
                    </li>
                  ))}
                </Stagger>
              </Demo>

              <Demo
                name="AnimatedNumber"
                spec="changed digits roll · spring.snappy · tabular, fixed width"
              >
                <AnimatedNumberDemo />
              </Demo>

              <Demo
                name="CountUp"
                spec="0 to value on first view only · 600ms ease-out · once per session per metric"
              >
                <div className="flex flex-wrap gap-6">
                  {[
                    { label: "Votes", value: 1284, metric: "lab-votes" },
                    { label: "Voters", value: 312, metric: "lab-voters" },
                  ].map((kpi) => (
                    <div key={kpi.metric} className="flex flex-col gap-1">
                      <span className="text-[12.5px] text-ink-2">{kpi.label}</span>
                      <CountUp
                        value={kpi.value}
                        metric={`${kpi.metric}:${replay}`}
                        format={(n) => n.toLocaleString("en-US")}
                        className="text-[30px] font-semibold tracking-[-0.02em]"
                      />
                    </div>
                  ))}
                </div>
                <p className="text-[12px] text-ink-3">
                  The metric key includes the replay counter here. In the app it does not,
                  which is what makes it once per session.
                </p>
              </Demo>

              <Demo
                name="DiffHighlight"
                spec="pink tint fading out over 900ms ease-out · an opacity overlay, not an animated background"
              >
                <DiffHighlightDemo />
              </Demo>

              <Demo
                name="IconSwap"
                spec="outgoing scale 1 to 0.8 and fade, incoming 0.8 to 1 · 150ms"
              >
                <IconSwapDemo />
              </Demo>

              <Demo
                name="Shimmer"
                spec="1px pink hairline sweeping left to right · 1.4s linear · an allowed loop, only while a request is pending"
              >
                <div className="flex flex-col gap-3">
                  <Card className="overflow-hidden">
                    <Shimmer label="Generating the build prompt" />
                    <div className="flex items-center gap-2 px-4 py-3 text-[13px] text-ink-2">
                      <Spinner />
                      Generating…
                    </div>
                  </Card>
                  <p className="text-[12px] text-ink-3">
                    Under reduced motion the sweep goes, and the static hairline, the
                    spinner and the label carry the message instead.
                  </p>
                </div>
              </Demo>

              <Demo
                name="Toasts"
                spec="enter y 8px and fade 200ms · exit fade and x 8px 140ms · stack reflows · hover pauses the timer"
              >
                <ToastDemo />
              </Demo>

              <Demo
                name="Skeletons and spinners"
                spec="opacity 1 to 0.6 over 1.2s · 14px spinner, 0.8s linear · both survive reduced motion"
              >
                <div className="flex flex-wrap items-center gap-6">
                  <div className="flex flex-col gap-2">
                    <span className="eu-skeleton block h-4 w-[180px] rounded-chip" />
                    <span className="eu-skeleton block h-4 w-[120px] rounded-chip" />
                  </div>
                  <span className="flex items-center gap-2 text-[13px] text-ink-2">
                    <Spinner />
                    Working
                  </span>
                </div>
              </Demo>
            </div>
          </main>
        </Toaster>
      </MotionProvider>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Demo({ name, spec, children }: { name: string; spec: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-hairline pt-5">
      <div className="flex flex-col gap-[2px]">
        <SectionTitle>{name}</SectionTitle>
        <p className="font-mono text-[11.5px] text-ink-3">{spec}</p>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function CollapseDemo() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(SAMPLE_ROWS);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Button onClick={() => setOpen((v) => !v)} icon="chevronDown">
          {open ? "Hide the assumptions" : "Show the assumptions"}
        </Button>
        <Collapse open={open}>
          <Card className="mt-1 px-4 py-3 text-[13.5px] text-ink-body">
            Euclid assumed the export is CSV only, and that the free plan gets it too.
            Confirm or correct it before you copy the prompt.
          </Card>
        </Collapse>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[12.5px] text-ink-3">
          CollapseOut, for a row leaving: a merged duplicate, a confirmed assumption.
        </p>
        <ul className="flex flex-col">
          <AnimatePresence initial={false}>
            {rows.map((row) => (
              <CollapseOut key={row} as="li">
                <Card className="mb-2 flex items-center justify-between px-4 py-[10px] text-[13.5px]">
                  {row}
                  <button
                    type="button"
                    onClick={() => setRows((r) => r.filter((x) => x !== row))}
                    className="text-[12px] font-medium text-ink-3 transition-colors duration-[var(--eu-dur-fast)] hover:text-ink"
                  >
                    Merge
                  </button>
                </Card>
              </CollapseOut>
            ))}
          </AnimatePresence>
        </ul>
        {rows.length === 0 && (
          <Button variant="ghost" onClick={() => setRows(SAMPLE_ROWS)}>
            Put them back
          </Button>
        )}
      </div>
    </div>
  );
}

function AnimatedNumberDemo() {
  const [votes, setVotes] = useState(99);

  return (
    <div className="flex flex-wrap items-center gap-4">
      <span className="text-[30px] font-semibold tracking-[-0.02em]">
        <AnimatedNumber value={votes} minWidth={4} live />
      </span>
      <div className="flex gap-2">
        <Button onClick={() => setVotes((v) => v + 1)}>+1</Button>
        <Button onClick={() => setVotes((v) => Math.max(0, v - 1))}>Minus 1</Button>
        <Button onClick={() => setVotes((v) => v + 137)}>+137</Button>
        <Button onClick={() => setVotes(9)}>Set 9</Button>
      </div>
      <p className="w-full text-[12px] text-ink-3">
        Four cells are reserved, so the layout does not settle as the number grows. 99 to
        100 keeps the units place and pushes a new cell onto the front.
      </p>
    </div>
  );
}

function DiffHighlightDemo() {
  const [version, setVersion] = useState(0);
  const extra = version % 2 === 1;

  return (
    <div className="flex flex-col gap-3">
      <Button variant="ai" icon="sparkle" onClick={() => setVersion((v) => v + 1)}>
        Refine the prompt
      </Button>
      <div className="overflow-hidden rounded-card border border-line">
        <div className="border-b border-line bg-subtle px-4 py-[9px] font-mono text-[12.5px] text-ink-2">
          build-prompt.md
        </div>
        <pre className="flex flex-col gap-[2px] px-4 py-4 font-mono text-[13px] leading-[1.6] text-ink-deep">
          {PROMPT_LINES.map((line) => (
            <span key={line}>{line}</span>
          ))}
          {extra && (
            <DiffHighlight token={version}>
              - The export sits behind a feature flag.
            </DiffHighlight>
          )}
          <DiffHighlight token={version}>
            - Tests cover an empty board and a board of 10,000 posts.
          </DiffHighlight>
        </pre>
      </div>
    </div>
  );
}

function IconSwapDemo() {
  const [copied, setCopied] = useState(false);
  const [published, setPublished] = useState(false);

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => setCopied((v) => !v)}
        className={cx(
          "inline-flex h-9 items-center gap-[7px] rounded-control bg-ink px-[14px]",
          "text-[13.5px] font-medium text-white",
          "transition-colors duration-[var(--eu-dur-fast)] ease-eu-standard hover:bg-[#28282d]",
        )}
      >
        <IconSwap swapKey={copied ? "check" : "copy"}>
          <Icon name={copied ? "check" : "copy"} size={14} strokeWidth={2} />
        </IconSwap>
        {copied ? "Copied" : "Copy prompt"}
      </button>

      <button
        type="button"
        onClick={() => setPublished((v) => !v)}
        className={cx(
          "inline-flex h-9 items-center gap-[7px] rounded-control border px-[14px]",
          "text-[13.5px] font-medium",
          "transition-colors duration-[var(--eu-dur-base)] ease-eu-standard",
          published ? "border-ok-line bg-ok-wash text-ok" : "border-line-strong bg-canvas text-ink",
        )}
      >
        <IconSwap swapKey={published ? "done" : "pending"}>
          {published ? <Icon name="check" size={14} strokeWidth={2.4} /> : <Spinner />}
        </IconSwap>
        {published ? "Published" : "Publishing…"}
      </button>
    </div>
  );
}

function ToastDemo() {
  const toast = useToast();

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => toast("Merged into #41. 12 votes moved across.")}>Neutral</Button>
      <Button onClick={() => toast("Changelog published.", { tone: "ok" })}>Success</Button>
      <Button onClick={() => toast("Could not save. Try again.", { tone: "bad" })}>Error</Button>
    </div>
  );
}
