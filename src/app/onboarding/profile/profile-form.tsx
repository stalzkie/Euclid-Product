"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { OnboardShell } from "@/components/onboarding";
import { Banner, Button, Input, Textarea, cx } from "@/components/ui";
import { Spinner } from "@/components/controls";
import { AnimatePresence, m } from "motion/react";
import { CollapseOut } from "@/components/motion";
import { dur, spring } from "@/lib/motion/tokens";
import type { StackItem } from "@/lib/types";
import { detectStack, saveProfileStep } from "../actions";

const KINDS = [
  "Framework",
  "Language",
  "Database",
  "Auth",
  "UI",
  "Hosting",
  "Testing",
  "Other",
];

/**
 * 03 · Project profile. This is the one-time setup that decides whether a
 * Build Prompt is specific or generic, so the screen shows exactly what the
 * prompt will carry.
 */
export function ProfileStepForm({
  initialStack,
  initialConventions,
  initialRules,
  initialRulesName,
}: {
  initialStack: StackItem[];
  initialConventions: string;
  initialRules: string | null;
  initialRulesName: string;
}) {
  const router = useRouter();
  const [stack, setStack] = useState<StackItem[]>(initialStack);
  const [conventions, setConventions] = useState(initialConventions);
  const [rules, setRules] = useState<string | null>(initialRules);
  const [rulesName, setRulesName] = useState(initialRulesName);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newKind, setNewKind] = useState("Framework");
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const rulesBytes = rules ? new TextEncoder().encode(rules).length : 0;

  const detect = () =>
    start(async () => {
      setError(null);
      const res = await detectStack(pasted);
      if (res.ok) {
        // Keep anything the founder added by hand that detection missed.
        const merged = [...res.stack];
        for (const item of stack) {
          if (!merged.some((m) => m.kind === item.kind)) merged.push(item);
        }
        setStack(merged);
        setPasting(false);
        setPasted("");
        setMessage(`Detected ${res.stack.length} entries from package.json.`);
        setTimeout(() => setMessage(null), 4000);
      } else {
        setError(res.error);
      }
    });

  const submit = (then: string) =>
    start(async () => {
      setError(null);
      const res = await saveProfileStep({
        stack,
        conventions,
        rulesFile: rules,
        rulesFileName: rulesName,
      });
      if (res.ok) router.push(then);
      else setError(res.error);
    });

  return (
    <OnboardShell
      step={2}
      title="Teach Euclid your stack"
      subtitle="Euclid adds this to every Build Prompt, so your agent never guesses your framework."
      back={{ href: "/onboarding/app" }}
      skip={{ href: "/onboarding/install", label: "Skip for now" }}
      next={
        <Button
          variant="primary"
          disabled={pending}
          onClick={() => submit("/onboarding/install")}
        >
          {pending ? <Spinner /> : null}
          Continue
        </Button>
      }
      aside={
        <div className="flex flex-col gap-0 overflow-hidden rounded-[14px] border border-line bg-canvas shadow-float">
          <div className="flex items-center gap-[7px] border-b border-line bg-subtle px-4 py-[10px] text-[12px] font-medium text-ai-deep">
            <Icon name="sparkle" size={14} strokeWidth={1.9} />
            Live preview · added to every Build Prompt
          </div>
          <div
            role="region"
            aria-label="Project context preview"
            className="flex flex-col gap-[3px] px-4 py-4 font-mono text-[12px] leading-[1.7] text-ink-2"
          >
            <span className="font-semibold text-ink">## Project context</span>
            {stack.length === 0 ? (
              <span className="text-ink-3">(nothing yet — add your stack)</span>
            ) : (
              <AnimatePresence initial={false}>
                {stack.map((s) => (
                  <CollapseOut key={`${s.kind}-${s.name}`}>
                    - {s.kind}: <span className="text-ink">{s.name}</span>
                  </CollapseOut>
                ))}
              </AnimatePresence>
            )}
            {conventions.trim() && (
              <>
                <span className="mt-2 font-semibold text-ink">## Conventions</span>
                {conventions
                  .split("\n")
                  .map((l) => l.replace(/^[-*]\s*/, "").trim())
                  .filter(Boolean)
                  .map((l, i) => (
                    <span key={i}>- {l}</span>
                  ))}
              </>
            )}
            {rules && (
              <span className="mt-2 text-ink-3">
                &lt;!-- {rulesName} attached below --&gt;
              </span>
            )}
          </div>
        </div>
      }
    >
      {/* package.json helper */}
      <div className="flex flex-wrap items-center gap-3 rounded-control border border-line bg-subtle px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-chip border border-line bg-canvas font-mono text-[13px] text-ink-2">
          {"{ }"}
        </span>
        <span className="flex min-w-[180px] flex-1 flex-col">
          <span className="text-[13px] font-medium">
            {stack.length
              ? `${stack.length} entr${stack.length === 1 ? "y" : "ies"} in your profile`
              : "Paste your package.json"}
          </span>
          <span className="text-[12px] text-ink-3">
            Euclid reads it and fills this in. Paste again any time to refresh.
          </span>
        </span>
        <Button onClick={() => setPasting((v) => !v)}>
          {pasting ? "Cancel" : stack.length ? "Paste again" : "Paste package.json"}
        </Button>
      </div>

      {pasting && (
        <div className="flex flex-col gap-2">
          <Textarea
            rows={6}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={'{\n  "dependencies": {\n    "next": "15.5.4",\n    ...\n  }\n}'}
            className="font-mono text-[12.5px]"
          />
          <Button
            variant="primary"
            className="self-start"
            disabled={pending || pasted.trim().length < 10}
            onClick={detect}
          >
            {pending ? <Spinner /> : null}
            Detect my stack
          </Button>
        </div>
      )}

      {message && (
        <Banner tone="ok" icon="check">
          {message}
        </Banner>
      )}

      {/* Stack */}
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">Stack</span>
        <div className="flex flex-wrap gap-2">
          {/*
            A removed token shrinks away and the ones after it slide up to
            close the gap, rather than the row snapping to a new arrangement.
          */}
          <AnimatePresence initial={false} mode="popLayout">
          {stack.map((s) => (
            <m.span
              key={`${s.kind}-${s.name}`}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: dur.fast } }}
              transition={spring.smooth}
              className="flex items-center gap-2 rounded-chip border border-line bg-canvas py-[5px] pl-2 pr-[6px] text-[12.5px]"
            >
              <span className="text-ink-3">{s.kind}</span>
              <span className="font-medium">{s.name}</span>
              <button
                type="button"
                aria-label={`Remove ${s.name}`}
                onClick={() =>
                  setStack((prev) => prev.filter((x) => !(x.kind === s.kind && x.name === s.name)))
                }
                className="eu-colors flex h-4 w-4 items-center justify-center rounded-full text-ink-3 hover:bg-muted hover:text-bad"
              >
                ×
              </button>
            </m.span>
          ))}
          </AnimatePresence>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded-chip border border-dashed border-line-strong px-[10px] py-[5px] text-[12.5px] font-medium text-ink-2 hover:bg-subtle"
          >
            + Add
          </button>
        </div>

        {adding && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-[6px] text-[12.5px] font-medium">
              Kind
              <select
                value={newKind}
                onChange={(e) => setNewKind(e.target.value)}
                className="h-9 rounded-control border border-line-strong bg-canvas px-2 text-[13.5px]"
              >
                {KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[200px] flex-1 flex-col gap-[6px] text-[12.5px] font-medium">
              Name
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newName.trim()) {
                    setStack((prev) => [
                      ...prev.filter((s) => s.kind !== newKind),
                      { kind: newKind, name: newName.trim() },
                    ]);
                    setNewName("");
                    setAdding(false);
                  }
                }}
                placeholder="Next.js 15 (App Router)"
              />
            </label>
            <Button
              disabled={!newName.trim()}
              onClick={() => {
                setStack((prev) => [
                  ...prev.filter((s) => s.kind !== newKind),
                  { kind: newKind, name: newName.trim() },
                ]);
                setNewName("");
                setAdding(false);
              }}
            >
              Add
            </Button>
          </div>
        )}
      </div>

      {/* Conventions */}
      <label className="flex flex-col gap-[6px] text-[13px] font-medium">
        Conventions your agent should follow
        <Textarea
          rows={3}
          value={conventions}
          onChange={(e) => setConventions(e.target.value)}
          placeholder="Server actions over API routes. Zod for every input. Feature flags live in lib/flags.ts."
        />
      </label>

      {/* Rules file */}
      <div className="flex flex-wrap items-center gap-3 rounded-control border border-line px-4 py-3">
        <span
          className={cx(
            "flex h-8 w-8 items-center justify-center rounded-chip",
            rules ? "bg-ok-wash text-ok" : "bg-muted text-ink-3",
          )}
        >
          <Icon name={rules ? "check" : "code"} size={15} strokeWidth={1.9} />
        </span>
        <span className="flex min-w-[180px] flex-1 flex-col">
          <span className="text-[13px] font-medium">{rulesName}</span>
          <span className="text-[12px] text-ink-3">
            {rules
              ? `Rules file · ${(rulesBytes / 1024).toFixed(1)} KB · attached to every prompt`
              : "Optional. Paste CLAUDE.md, AGENTS.md or your rules file."}
          </span>
        </span>
        <Button onClick={() => setRulesOpen((v) => !v)}>
          {rulesOpen ? "Done" : rules ? "Replace" : "Paste"}
        </Button>
      </div>

      {rulesOpen && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-[6px] text-[12.5px] font-medium">
            File name
            <Input
              value={rulesName}
              onChange={(e) => setRulesName(e.target.value)}
              placeholder="CLAUDE.md"
              className="max-w-[240px]"
            />
          </label>
          <Textarea
            rows={8}
            value={rules ?? ""}
            onChange={(e) => setRules(e.target.value || null)}
            placeholder={"# Your app\n\n## Commands\n- pnpm dev · pnpm test\n\n## Conventions\n- …"}
            className="font-mono text-[12.5px]"
          />
        </div>
      )}

      {error && (
        <Banner tone="bad" icon="warn">
          {error}
        </Banner>
      )}
    </OnboardShell>
  );
}
