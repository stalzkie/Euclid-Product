"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { m } from "motion/react";
import { Icon } from "@/components/icons";
import { Banner, Button, Input, SectionTitle, Textarea, cx } from "@/components/ui";
import { Segmented, Spinner, ToggleRow } from "@/components/controls";
import { BoardWidget, type WidgetPost } from "@/components/board-widget";
import { ACCENTS, DEFAULT_DESIGN, PRESETS } from "@/lib/design-presets";
import type { BoardDesign } from "@/lib/types";
import { Collapse, FadeRise, IconSwap } from "@/components/motion";
import { dur, ease, spring } from "@/lib/motion/tokens";
import { publishDesign } from "./actions";
import { MatchSite } from "./match-site";

type Section = "look" | "content" | "behavior";

/**
 * 12 · Board designer. Controls on the left, a live preview on the right that
 * renders the same component the widget ships — so what the founder sees here
 * is what their users get.
 */
export function DesignerView({
  boardId,
  boardName,
  boardColor,
  design: initial,
  showBadge: initialBadge,
  badgeRemovable,
  planName,
  appUrl,
  posts,
}: {
  boardId: string;
  boardName: string;
  boardColor: string;
  design: BoardDesign;
  showBadge: boolean;
  badgeRemovable: boolean;
  planName: string;
  appUrl: string | null;
  posts: WidgetPost[];
}) {
  const router = useRouter();
  const [design, setDesign] = useState<BoardDesign>(initial);
  const [badge, setBadge] = useState(initialBadge);
  const [section, setSection] = useState<Section>("look");
  const deviceThumb = useId();
  const [device, setDevice] = useState<"Desktop" | "Mobile">("Desktop");
  const [dirty, setDirty] = useState(false);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const set = (patch: Partial<BoardDesign>) => {
    setDesign((prev) => ({ ...prev, ...patch }));
    setDirty(true);
    setPublished(false);
  };

  const setBadgeFlag = (next: boolean) => {
    setBadge(next);
    setDirty(true);
    setPublished(false);
  };

  const publish = () =>
    start(async () => {
      setError(null);
      const res = await publishDesign(boardId, design, badge);
      if (res.ok) {
        setDirty(false);
        setPublished(true);
        if (res.badgeForced) setBadge(true);
        router.refresh();
      } else {
        setError(res.error);
      }
    });

  const discard = () => {
    setDesign(initial);
    setBadge(initialBadge);
    setDirty(false);
    setPublished(false);
  };

  const reset = () => {
    setDesign({ ...DEFAULT_DESIGN, mode: design.mode });
    setDirty(true);
    setPublished(false);
  };

  const previewWidth =
    device === "Mobile" ? "360px" : design.mode === "inline" ? "640px" : "420px";

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[26px] font-semibold tracking-[-0.015em]">Board designer</h1>
          <span className="flex h-8 items-center gap-2 rounded-control border border-line-strong px-[10px] text-[13px] font-medium">
            <span className="h-2 w-2 rounded-[3px]" style={{ background: boardColor }} />
            {boardName}
          </span>
          {dirty && (
            <FadeRise
              as="span"
              className="flex items-center gap-[6px] rounded-full bg-warn-wash px-[10px] py-[4px] text-[12px] font-medium text-warn"
            >
              <span className="h-[6px] w-[6px] rounded-full bg-warn-bright" />
              Unsaved changes
            </FadeRise>
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={discard} disabled={!dirty || pending}>
            Discard
          </Button>
          <Button variant="primary" onClick={publish} disabled={pending || (!dirty && published)}>
            {(pending || published) && (
              <IconSwap swapKey={pending ? "working" : "done"}>
                {pending ? <Spinner /> : <Icon name="check" size={14} strokeWidth={2.4} />}
              </IconSwap>
            )}
            {published ? "Published" : "Publish changes"}
          </Button>
        </div>
      </header>

      {error && (
        <Banner tone="bad" icon="warn">
          {error}
        </Banner>
      )}
      <Collapse open={published}>
        <Banner tone="ok" icon="check">
          Published. Every embedded board picks this up on its next load — no redeploy
          needed.
        </Banner>
      </Collapse>

      <div className="flex flex-wrap items-start gap-7">
        {/* Controls */}
        <aside
          aria-label="Design controls"
          className="flex min-w-0 flex-[1_1_340px] flex-col gap-5"
        >
          <Segmented
            value={section}
            onChange={setSection}
            options={[
              { value: "look", label: "Look" },
              { value: "content", label: "Content" },
              { value: "behavior", label: "Behavior" },
            ]}
          />

          {section === "look" && (
            <>
              <MatchSite appUrl={appUrl} onApply={set} />

              <section aria-labelledby="preset-title" className="flex flex-col gap-2">
                <SectionTitle id="preset-title">Preset</SectionTitle>
                <div
                  role="radiogroup"
                  aria-labelledby="preset-title"
                  className="grid grid-cols-2 gap-2"
                >
                  {PRESETS.map((p) => {
                    const on = p.id === design.preset;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() =>
                          set({
                            preset: p.id,
                            accent: p.accent,
                            theme: p.theme,
                            radius: p.radius,
                          })
                        }
                        className={cx(
                          "flex flex-col gap-2 rounded-[10px] border bg-canvas p-3 text-left",
                          on
                            ? "border-state-bright shadow-[0_0_0_3px_var(--color-state-ring)]"
                            : "border-line hover:bg-subtle",
                        )}
                      >
                        <span
                          className="flex h-10 items-center gap-2 rounded-chip border px-2"
                          style={{ background: p.swatchBg, borderColor: p.swatchLine }}
                        >
                          <span
                            className="h-5 w-5 rounded-[5px]"
                            style={{ background: p.accent }}
                          />
                          <span
                            className="h-[6px] flex-1 rounded-full"
                            style={{ background: p.swatchLine }}
                          />
                        </span>
                        <span className="text-[13px] font-medium">{p.label}</span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section aria-labelledby="accent-title" className="flex flex-col gap-2">
                <SectionTitle id="accent-title">Accent color</SectionTitle>
                <div
                  role="radiogroup"
                  aria-labelledby="accent-title"
                  className="flex flex-wrap items-center gap-2"
                >
                  {ACCENTS.map((a) => {
                    const on = a.hex.toLowerCase() === design.accent.toLowerCase();
                    return (
                      <button
                        key={a.hex}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={a.name}
                        onClick={() => set({ accent: a.hex })}
                        className={cx(
                          "flex h-8 w-8 items-center justify-center rounded-control border-2",
                          on ? "border-state-bright" : "border-transparent",
                        )}
                      >
                        <span
                          className="h-[22px] w-[22px] rounded-chip"
                          style={{ background: a.hex }}
                        />
                      </button>
                    );
                  })}
                  <label className="flex items-center gap-2">
                    <span className="sr-only">Custom accent colour</span>
                    <input
                      type="color"
                      value={design.accent}
                      onChange={(e) => set({ accent: e.target.value.toUpperCase() })}
                      className="h-8 w-8 cursor-pointer rounded-control border border-line bg-canvas p-[2px]"
                    />
                  </label>
                  <code className="font-mono text-[12px] text-ink-2">{design.accent}</code>
                </div>
              </section>

              <section className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] font-medium">Theme</span>
                  <Segmented
                    size="sm"
                    value={design.theme}
                    onChange={(theme) => set({ theme })}
                    options={[
                      { value: "Light", label: "Light" },
                      { value: "Dark", label: "Dark" },
                      { value: "Auto", label: "Auto" },
                    ]}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] font-medium">Corners</span>
                  <Segmented
                    size="sm"
                    value={design.radius}
                    onChange={(radius) => set({ radius })}
                    options={[
                      { value: "Sharp", label: "Sharp" },
                      { value: "Soft", label: "Soft" },
                      { value: "Round", label: "Round" },
                    ]}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] font-medium">Embed mode</span>
                  <Segmented
                    size="sm"
                    value={design.mode}
                    onChange={(mode) => set({ mode })}
                    options={[
                      { value: "inline", label: "Inline" },
                      { value: "floating", label: "Floating" },
                    ]}
                  />
                </div>
                <Button variant="ghost" icon="refresh" onClick={reset} className="self-start">
                  Reset to Minimal
                </Button>
              </section>
            </>
          )}

          {section === "content" && (
            <section className="flex flex-col gap-4">
              <label className="flex flex-col gap-[6px] text-[13px] font-medium">
                Board title
                <Input
                  value={design.heading}
                  onChange={(e) => set({ heading: e.target.value })}
                  placeholder="What should we build next?"
                />
              </label>
              <label className="flex flex-col gap-[6px] text-[13px] font-medium">
                Subtitle
                <Textarea
                  rows={2}
                  value={design.subheading}
                  onChange={(e) => set({ subheading: e.target.value })}
                  placeholder="Suggest an idea or vote on one. We read every post."
                />
              </label>
              <label className="flex flex-col gap-[6px] text-[13px] font-medium">
                Submit button
                <Input
                  value={design.submitCta}
                  onChange={(e) => set({ submitCta: e.target.value })}
                  placeholder="Post idea"
                />
              </label>
            </section>
          )}

          {section === "behavior" && (
            <section className="flex flex-col gap-4">
              <ToggleRow
                label="Show statuses"
                detail="Under review, Planned, In progress, Shipped"
                checked={design.showStatuses}
                onChange={(showStatuses) => set({ showStatuses })}
              />
              <ToggleRow
                label="Show comment counts"
                detail="Signals that other people are discussing it"
                checked={design.showComments}
                onChange={(showComments) => set({ showComments })}
              />
              <ToggleRow
                label="Show vote counts"
                detail="Hide to stop the loudest post dominating"
                checked={design.showVoteCounts}
                onChange={(showVoteCounts) => set({ showVoteCounts })}
              />
              <ToggleRow
                label="Roadmap tab"
                detail="Planned, In progress and Shipped, in columns"
                checked={design.showRoadmap}
                onChange={(showRoadmap) => set({ showRoadmap })}
              />
              <ToggleRow
                label="Changelog tab"
                detail="What you shipped, newest first"
                checked={design.showChangelog}
                onChange={(showChangelog) => set({ showChangelog })}
              />
              <div className="flex items-center gap-3 border-t border-hairline pt-4">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[13.5px] font-medium">
                    Show &ldquo;Powered by Euclid&rdquo;
                  </span>
                  <span className="text-[12px] text-ink-3">
                    {badgeRemovable
                      ? "Remove it on any paid plan"
                      : `Included on the ${planName} plan`}
                  </span>
                </span>
                <ToggleRow
                  label="Show Powered by Euclid"
                  checked={badge}
                  onChange={setBadgeFlag}
                  disabled={!badgeRemovable}
                />
              </div>
              <p className="text-[12px] leading-[1.5] text-ink-3">
                Identity, allowed domains and the moderation queue live in{" "}
                <Link href="/install" className="font-medium text-state no-underline">
                  Install widget
                </Link>
                .
              </p>
            </section>
          )}
        </aside>

        {/* Live preview */}
        <main
          aria-label="Live preview"
          className="flex min-w-0 flex-[999_1_480px] flex-col gap-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              role="radiogroup"
              aria-label="Preview device"
              className="flex gap-[2px] rounded-[9px] bg-muted p-[3px]"
            >
              {(["Desktop", "Mobile"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={d === device}
                  onClick={() => setDevice(d)}
                  className={cx(
                    "eu-colors relative h-7 px-3 text-[12.5px] font-medium",
                    d === device ? "text-ink" : "text-ink-2",
                  )}
                >
                  {d === device && (
                    <m.span
                      layoutId={deviceThumb}
                      transition={spring.snappy}
                      className="absolute inset-0 rounded-[7px] bg-canvas shadow-seg"
                    />
                  )}
                  <span className="relative">{d}</span>
                </button>
              ))}
            </div>
            <span className="text-[12px] text-ink-3">
              Live preview · updates as you change controls
            </span>
          </div>

          <div
            className={cx(
              "relative flex min-h-[560px] justify-center rounded-card border border-line p-7",
              design.theme === "Dark" ? "bg-[#0C0C0E]" : "bg-subtle",
            )}
          >
            {/*
              The frame changes width when the device does. A layout animation
              rather than a width transition, so the reflow inside it is one
              composited move instead of 320ms of layout work; and keyed on the
              inline/floating choice so the two layouts crossfade rather than
              one snapping into the other.
            */}
            <m.div
              layout
              key={design.mode}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{
                layout: { duration: dur.slow, ease: ease.standard },
                duration: dur.moderate,
                ease: ease.out,
              }}
              style={{ width: previewWidth, maxWidth: "100%" }}
            >
            <BoardWidget
              design={design}
              boardName={boardName}
              posts={posts}
              showBadge={badge}
              preview
              identityLabel="leo@fastmail.com"
              changelog={[
                {
                  id: "sample",
                  title: "Pin entries to the top",
                  body: "You can now pin entries so they stay above the feed.",
                  publishedAt: new Date().toISOString(),
                },
              ]}
            />
            </m.div>

            {design.mode === "floating" && (
              <span
                className="absolute bottom-6 right-6 flex h-10 items-center gap-2 rounded-full px-4 text-[13px] font-medium shadow-float"
                style={{ background: design.accent, color: "#fff" }}
              >
                <Icon name="comment" size={15} strokeWidth={1.9} />
                Feedback
              </span>
            )}
          </div>

          <p className="text-[12px] leading-[1.5] text-ink-3">
            The widget mounts in a Shadow DOM, so your app&apos;s CSS cannot reach it and
            its CSS cannot reach your app. It loads asynchronously and degrades silently
            if Euclid is unreachable.
          </p>
        </main>
      </div>
    </>
  );
}
