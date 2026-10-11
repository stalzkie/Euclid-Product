"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import {
  Banner,
  Button,
  Card,
  Input,
  PageHeader,
  SectionTitle,
  Textarea,
  cx,
} from "@/components/ui";
import { Spinner } from "@/components/controls";
import { detectStack, saveProfileStep } from "@/app/onboarding/actions";
import type { StackItem } from "@/lib/types";

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
 * The project profile, editable after onboarding. The preview on the right is
 * the literal block that goes into every Build Prompt.
 */
export function ProfileEditor({
  stack: initialStack,
  conventions: initialConventions,
  rulesFile,
  rulesFileName,
  codingTools,
}: {
  stack: StackItem[];
  conventions: string;
  rulesFile: string | null;
  rulesFileName: string;
  codingTools: string[];
}) {
  const router = useRouter();
  const [stack, setStack] = useState(initialStack);
  const [conventions, setConventions] = useState(initialConventions);
  const [rules, setRules] = useState(rulesFile);
  const [rulesName, setRulesName] = useState(rulesFileName);
  const [pasted, setPasted] = useState("");
  const [pasting, setPasting] = useState(false);
  const [newKind, setNewKind] = useState("Framework");
  const [newName, setNewName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const rulesBytes = rules ? new TextEncoder().encode(rules).length : 0;

  const save = () =>
    start(async () => {
      setError(null);
      const res = await saveProfileStep({
        stack,
        conventions,
        rulesFile: rules,
        rulesFileName: rulesName,
      });
      if (res.ok) {
        setDirty(false);
        setToast("Saved. Every new Build Prompt carries this.");
        setTimeout(() => setToast(null), 4000);
        router.refresh();
      } else {
        setError(res.error);
      }
    });

  const detect = () =>
    start(async () => {
      setError(null);
      const res = await detectStack(pasted);
      if (res.ok) {
        const merged = [...res.stack];
        for (const item of stack) {
          if (!merged.some((m) => m.kind === item.kind)) merged.push(item);
        }
        setStack(merged);
        setPasting(false);
        setPasted("");
        setDirty(true);
      } else {
        setError(res.error);
      }
    });

  const addItem = () => {
    if (!newName.trim()) return;
    setStack((prev) => [
      ...prev.filter((s) => s.kind !== newKind),
      { kind: newKind, name: newName.trim() },
    ]);
    setNewName("");
    setDirty(true);
  };

  return (
    <>
      <PageHeader
        title="Project profile"
        subtitle="What your agent needs to know before it touches your code. Euclid adds this to every Build Prompt."
        actions={
          <Button variant="primary" onClick={save} disabled={pending || !dirty}>
            {pending ? <Spinner /> : null}
            {dirty ? "Save profile" : "Saved"}
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
      {stack.length === 0 && (
        <Banner tone="warn" icon="warn">
          Without a profile, prompts stay generic and list your stack as an assumption.
          Paste a package.json below and it fills itself in.
        </Banner>
      )}

      <div className="flex flex-wrap items-start gap-7">
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-5">
          {/* package.json helper */}
          <Card className="flex flex-col gap-3 p-[18px]">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-chip border border-line bg-subtle font-mono text-[13px] text-ink-2">
                {"{ }"}
              </span>
              <span className="flex min-w-[180px] flex-1 flex-col">
                <SectionTitle>Detect from package.json</SectionTitle>
                <span className="text-[12px] text-ink-3">
                  Paste it and Euclid fills in the stack. Nothing leaves your workspace.
                </span>
              </span>
              <Button onClick={() => setPasting((v) => !v)}>
                {pasting ? "Cancel" : "Paste"}
              </Button>
            </div>
            {pasting && (
              <>
                <Textarea
                  rows={6}
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  placeholder={'{ "dependencies": { "next": "15.5.4" } }'}
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
              </>
            )}
          </Card>

          {/* Stack */}
          <Card className="flex flex-col gap-3 p-[18px]">
            <SectionTitle>Stack</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {stack.map((s) => (
                <span
                  key={`${s.kind}-${s.name}`}
                  className="flex items-center gap-2 rounded-chip border border-line bg-canvas py-[5px] pl-2 pr-[6px] text-[12.5px]"
                >
                  <span className="text-ink-3">{s.kind}</span>
                  <span className="font-medium">{s.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${s.name}`}
                    onClick={() => {
                      setStack((prev) =>
                        prev.filter((x) => !(x.kind === s.kind && x.name === s.name)),
                      );
                      setDirty(true);
                    }}
                    className="flex h-4 w-4 items-center justify-center rounded-full text-ink-3 hover:bg-muted hover:text-bad"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-2 border-t border-hairline pt-3">
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
                  onKeyDown={(e) => e.key === "Enter" && addItem()}
                  placeholder="Next.js 15 (App Router)"
                />
              </label>
              <Button disabled={!newName.trim()} onClick={addItem}>
                Add
              </Button>
            </div>
          </Card>

          {/* Conventions */}
          <Card className="flex flex-col gap-3 p-[18px]">
            <SectionTitle>Conventions</SectionTitle>
            <p className="text-[12.5px] text-ink-3">
              One per line. These become bullets in the prompt&apos;s project context.
            </p>
            <Textarea
              rows={4}
              value={conventions}
              onChange={(e) => {
                setConventions(e.target.value);
                setDirty(true);
              }}
              placeholder={
                "Server actions over API routes\nZod for every input\nFeature flags live in lib/flags.ts"
              }
            />
          </Card>

          {/* Rules file */}
          <Card className="flex flex-col gap-3 p-[18px]">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={cx(
                  "flex h-8 w-8 items-center justify-center rounded-chip",
                  rules ? "bg-ok-wash text-ok" : "bg-muted text-ink-3",
                )}
              >
                <Icon name={rules ? "check" : "code"} size={15} strokeWidth={1.9} />
              </span>
              <span className="flex min-w-[180px] flex-1 flex-col">
                <SectionTitle>Rules file</SectionTitle>
                <span className="text-[12px] text-ink-3">
                  {rules
                    ? `${rulesName} · ${(rulesBytes / 1024).toFixed(1)} KB · attached to every prompt`
                    : "Paste CLAUDE.md, AGENTS.md or your Cursor rules."}
                </span>
              </span>
              <Input
                value={rulesName}
                onChange={(e) => {
                  setRulesName(e.target.value);
                  setDirty(true);
                }}
                className="max-w-[180px]"
              />
            </div>
            <Textarea
              rows={10}
              value={rules ?? ""}
              onChange={(e) => {
                setRules(e.target.value || null);
                setDirty(true);
              }}
              placeholder={"# Your app\n\n## Commands\n- pnpm dev · pnpm test\n\n## Conventions\n- …"}
              className="font-mono text-[12.5px]"
            />
          </Card>
        </div>

        {/* Preview */}
        <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          <div className="overflow-hidden rounded-card border border-line">
            <div className="flex items-center gap-[7px] border-b border-line bg-subtle px-4 py-[10px] text-[12px] font-medium text-ai-deep">
              <Icon name="sparkle" size={14} strokeWidth={1.9} />
              Goes into every Build Prompt
            </div>
            <div
              role="region"
              aria-label="Project context preview"
              className="flex flex-col gap-[3px] px-4 py-4 font-mono text-[12px] leading-[1.7] text-ink-2"
            >
              <span className="font-semibold text-ink">## Project context</span>
              {stack.length === 0 ? (
                <span className="text-ink-3">(nothing yet)</span>
              ) : (
                stack.map((s) => (
                  <span key={`${s.kind}-${s.name}`}>
                    - <span className="text-ink">{s.name}</span>
                  </span>
                ))
              )}
              {conventions
                .split("\n")
                .map((l) => l.replace(/^[-*]\s*/, "").trim())
                .filter(Boolean)
                .map((l, i) => (
                  <span key={i}>- {l}</span>
                ))}
              {rules && (
                <span className="mt-2 text-ink-3">
                  &lt;!-- {rulesName} attached in the context tab --&gt;
                </span>
              )}
            </div>
          </div>

          <Card className="flex flex-col gap-2 p-[18px]">
            <SectionTitle>Your tools</SectionTitle>
            <p className="text-[12.5px] text-ink-3">
              Prompts are formatted for these. Change them in{" "}
              <Link href="/billing#general" className="font-medium text-state no-underline">
                workspace settings
              </Link>
              .
            </p>
            <div className="flex flex-wrap gap-2">
              {codingTools.length === 0 ? (
                <span className="text-[12.5px] text-ink-3">None picked yet.</span>
              ) : (
                codingTools.map((t) => (
                  <span
                    key={t}
                    className="rounded-chip border border-ai-line bg-ai-wash px-2 py-[4px] text-[12px] font-medium text-ai-deep"
                  >
                    {t}
                  </span>
                ))
              )}
            </div>
          </Card>

          <Banner tone="state" icon="info">
            Read-only GitHub context, so prompts can reference your real files, is a later
            bet. Until then prompts describe what to change and let the agent find where.
          </Banner>
        </aside>
      </div>
    </>
  );
}
