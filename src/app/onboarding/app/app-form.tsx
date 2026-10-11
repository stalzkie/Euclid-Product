"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { OnboardShell } from "@/components/onboarding";
import { Banner, Button, Input, cx } from "@/components/ui";
import { Spinner } from "@/components/controls";
import { saveAppStep } from "../actions";

/** The tools Euclid formats Build Prompts for. */
const TOOLS = [
  "Claude Code",
  "Cursor",
  "Codex",
  "Lovable",
  "Bolt",
  "v0",
  "Windsurf",
  "Hand-coded",
];

export function AppStepForm({
  initialName,
  initialUrl,
  initialTools,
}: {
  initialName: string;
  initialUrl: string;
  initialTools: string[];
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [url, setUrl] = useState(initialUrl);
  const [tools, setTools] = useState<string[]>(initialTools);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = (tool: string) =>
    setTools((prev) =>
      prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool],
    );

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await saveAppStep({ appName: name.trim(), appUrl: url, tools });
      if (res.ok) router.push("/onboarding/profile");
      else setError(res.error);
    });

  return (
    <OnboardShell
      step={1}
      title="Tell us about your app"
      subtitle="Your first board is named after it. You can add more boards later."
      next={
        <Button
          variant="primary"
          disabled={pending || name.trim().length < 1}
          onClick={submit}
        >
          {pending ? <Spinner /> : null}
          Continue
        </Button>
      }
      aside={
        <>
          {/* A preview of the board being built. */}
          <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-canvas p-4 shadow-float">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-chip bg-ink text-[12px] font-semibold text-white">
                {(name || "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="text-[13.5px] font-semibold">
                {name ? `${name} feedback` : "Your board"}
              </span>
            </div>
            <div className="flex items-center gap-3 rounded-control border border-line px-3 py-[10px]">
              <span className="tnum flex h-10 w-9 flex-col items-center justify-center rounded-chip border border-line-strong text-[12.5px] font-semibold">
                <Icon name="caretUp" size={11} strokeWidth={2.4} />0
              </span>
              <span className="text-[13px] text-ink-3">Your first idea lands here</span>
            </div>
            <div className="h-[6px] w-3/4 rounded-full bg-muted" />
            <div className="h-[6px] w-1/2 rounded-full bg-muted" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {tools.slice(0, 2).map((t) => (
              <span
                key={t}
                className="rounded-chip border border-ai-line bg-ai-wash px-2 py-[4px] text-[12px] font-medium text-ai-deep"
              >
                {t}
              </span>
            ))}
            <span className="text-[12px] text-ink-3">
              {tools.length
                ? `Prompts ready for ${tools.length} tool${tools.length === 1 ? "" : "s"}`
                : "Pick a tool to format prompts for"}
            </span>
          </div>
        </>
      }
    >
      <label className="flex flex-col gap-[6px] text-[13px] font-medium">
        App name
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Driftnote"
          autoFocus
        />
      </label>

      <label className="flex flex-col gap-[6px] text-[13px] font-medium">
        App URL
        <span className="flex h-9 items-center overflow-hidden rounded-control border border-line-strong">
          <span className="flex h-full items-center border-r border-line bg-subtle px-3 text-[13px] text-ink-3">
            https://
          </span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="yourapp.com"
            className="min-w-0 flex-1 border-0 px-3 text-[14px] outline-none"
          />
        </span>
        <span className="text-[12px] font-normal text-ink-3">
          Only this domain can load your widget. Add staging domains later.
        </span>
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] font-medium">What do you build with?</legend>
        <span className="text-[12px] text-ink-3">
          Euclid formats Build Prompts for these tools. Pick all that apply.
        </span>
        <div className="mt-1 flex flex-wrap gap-2">
          {TOOLS.map((tool) => {
            const on = tools.includes(tool);
            return (
              <button
                key={tool}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(tool)}
                className={cx(
                  "flex h-9 items-center gap-[6px] rounded-control border px-[14px] text-[13.5px] font-medium transition-colors",
                  on
                    ? "border-state-bright bg-state-wash text-state"
                    : "border-line-strong bg-canvas text-ink hover:bg-subtle",
                )}
              >
                {on && <Icon name="check" size={13} strokeWidth={2.4} />}
                {tool}
              </button>
            );
          })}
        </div>
      </fieldset>

      {error && (
        <Banner tone="bad" icon="warn">
          {error}
        </Banner>
      )}
    </OnboardShell>
  );
}
