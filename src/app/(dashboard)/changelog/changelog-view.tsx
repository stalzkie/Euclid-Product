"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Input,
  SectionTitle,
  Textarea,
  cx,
} from "@/components/ui";
import { Segmented, Spinner, ToggleRow } from "@/components/controls";
import { ago, shortDate } from "@/lib/format";
import type { ChangelogEntry } from "@/lib/types";
import {
  createEntry,
  draftEntry,
  linkPost,
  publishEntry,
  saveEntry,
  unlinkPost,
} from "./actions";

/** 13 · Changelog — write it, preview the email, publish. */
export function ChangelogView({
  entries,
  selected,
  linked,
  candidates,
  publicUrl,
  founderName,
  appName,
  aiReady,
}: {
  entries: ChangelogEntry[];
  selected: ChangelogEntry | null;
  linked: { id: string; number: number; title: string; voters: number }[];
  candidates: { number: number; title: string; votes: number }[];
  publicUrl: string;
  founderName: string;
  appName: string;
  aiReady: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<"edit" | "email">("edit");
  const [title, setTitle] = useState(selected?.title ?? "");
  const [body, setBody] = useState(selected?.body ?? "");
  const [notifyVoters, setNotifyVoters] = useState(selected?.notify_voters ?? true);
  const [showBadge, setShowBadge] = useState(selected?.show_badge ?? true);
  const [markShipped, setMarkShipped] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [pending, start] = useTransition();

  const voters = linked.reduce((a, p) => a + p.voters, 0);

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 5000);
  };

  const save = () =>
    start(async () => {
      if (!selected) return;
      setError(null);
      const res = await saveEntry({
        id: selected.id,
        title,
        body,
        notifyVoters,
        showBadge,
      });
      if (res.ok) {
        setDirty(false);
        flash("Draft saved");
        router.refresh();
      } else {
        setError(res.error);
      }
    });

  const publish = () =>
    start(async () => {
      if (!selected) return;
      setError(null);
      // Save the current text first so publishing never ships stale copy.
      await saveEntry({ id: selected.id, title, body, notifyVoters, showBadge });
      const res = await publishEntry(selected.id);
      if (res.ok) {
        setDirty(false);
        flash(
          `Published.${
            res.notified
              ? ` ${res.notified} voter${res.notified === 1 ? "" : "s"} are being emailed`
              : " No voter addresses to email"
          }${res.postNumber ? ` and #${res.postNumber} is now Shipped.` : "."}`,
        );
        router.refresh();
      } else {
        setError(res.error);
      }
    });

  const draft = () =>
    start(async () => {
      if (!selected) return;
      setError(null);
      const res = await draftEntry(selected.id);
      if (res.ok) {
        setBody(res.body);
        setDirty(true);
      } else {
        setError(res.error);
      }
    });

  return (
    <div className="flex flex-wrap items-start gap-7">
      {/* Entry list */}
      <aside aria-label="Entries" className="flex min-w-0 flex-[1_1_280px] flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="text-[26px] font-semibold tracking-[-0.015em]">Changelog</h1>
          <Button
            icon="plus"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await createEntry();
                if (res.ok) router.push(`/changelog?entry=${res.id}`);
              })
            }
          >
            New
          </Button>
        </div>

        <Link
          href={publicUrl}
          target="_blank"
          className="flex items-center gap-[6px] text-[12.5px] text-ink-2 no-underline hover:text-ink"
        >
          Public changelog
          <Icon name="arrowUpRight" size={12} strokeWidth={2} />
        </Link>

        <div className="flex flex-col">
          {entries.length === 0 && (
            <p className="py-3 text-[13px] text-ink-3">
              Nothing yet. Marking a post Shipped starts a draft for you.
            </p>
          )}
          {entries.map((e) => (
            <Link
              key={e.id}
              href={`/changelog?entry=${e.id}`}
              className={cx(
                "flex flex-col gap-1 border-b border-hairline px-3 py-[11px] no-underline",
                e.id === selected?.id ? "bg-muted" : "hover:bg-subtle",
              )}
            >
              <span className="truncate text-[13.5px] font-medium text-ink">
                {e.title}
              </span>
              <span className="flex items-center gap-2 text-[12px] text-ink-3">
                <span
                  className={cx(
                    "rounded-chip px-[6px] py-[1px] text-[11px] font-medium",
                    e.published ? "bg-ok-wash text-ok" : "bg-muted text-ink-2",
                  )}
                >
                  {e.published ? "Published" : "Draft"}
                </span>
                {e.published && e.published_at
                  ? `${shortDate(e.published_at)} · ${e.voters_notified} notified`
                  : `Edited ${ago(e.updated_at)}`}
              </span>
            </Link>
          ))}
        </div>
      </aside>

      {/* Editor */}
      <main className="flex min-w-0 flex-[999_1_520px] flex-col gap-4">
        {!selected ? (
          <Card>
            <EmptyState
              icon="changelog"
              title="No changelog entries"
              body="Mark a post Shipped and Euclid starts a draft linked to it, with the voter list ready to email. Or write one from scratch."
              action={
                <Button
                  variant="primary"
                  icon="plus"
                  onClick={() =>
                    start(async () => {
                      const res = await createEntry();
                      if (res.ok) router.push(`/changelog?entry=${res.id}`);
                    })
                  }
                >
                  New entry
                </Button>
              }
            />
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented
                value={view}
                onChange={setView}
                options={[
                  { value: "edit", label: "Edit" },
                  { value: "email", label: "Email preview" },
                ]}
              />
              <div className="flex gap-2">
                <Button onClick={save} disabled={pending || !dirty}>
                  {pending ? <Spinner /> : null}
                  Save draft
                </Button>
                <Button
                  variant="primary"
                  onClick={publish}
                  disabled={pending || selected.published}
                >
                  {selected.published ? "Published" : "Publish"}
                </Button>
              </div>
            </div>

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
            {selected.published && (
              <Banner tone="ok" icon="check">
                Published {selected.published_at ? shortDate(selected.published_at) : ""} ·{" "}
                {selected.voters_notified} voter
                {selected.voters_notified === 1 ? "" : "s"} emailed
              </Banner>
            )}

            {view === "edit" ? (
              <Card className="flex flex-col gap-4 p-[18px]">
                <label className="flex flex-col gap-[6px] text-[13px] font-medium">
                  Title
                  <Input
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setDirty(true);
                    }}
                    placeholder="What shipped?"
                  />
                </label>

                {/* Linked posts */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium">Ships</span>
                  {linked.length === 0 && (
                    <span className="text-[12.5px] text-ink-3">
                      Nothing linked yet — link a post so its voters get the email.
                    </span>
                  )}
                  {linked.map((p) => (
                    <span
                      key={p.id}
                      className="flex items-center gap-2 rounded-chip border border-line bg-subtle px-2 py-[4px] text-[12.5px]"
                    >
                      <strong className="font-medium">
                        #{p.number} {p.title}
                      </strong>
                      <span className="text-ink-3">· {p.voters} voters</span>
                      <button
                        type="button"
                        aria-label={`Unlink #${p.number}`}
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            await unlinkPost(selected.id, p.id);
                            router.refresh();
                          })
                        }
                        className="text-ink-3 hover:text-bad"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => setLinking((v) => !v)}
                    className="rounded-chip border border-dashed border-line-strong px-2 py-[4px] text-[12.5px] font-medium text-ink-2 hover:bg-subtle"
                  >
                    + Link post
                  </button>
                </div>

                {linking && candidates.length > 0 && (
                  <div className="flex max-h-[200px] flex-col gap-1 overflow-y-auto rounded-control border border-line p-2">
                    {candidates.map((c) => (
                      <button
                        key={c.number}
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            setLinking(false);
                            const res = await linkPost(selected.id, c.number);
                            if (!res.ok) setError(res.error);
                            router.refresh();
                          })
                        }
                        className="flex items-center gap-3 rounded-[6px] px-2 py-[7px] text-left hover:bg-subtle"
                      >
                        <span className="tnum w-10 text-[12px] text-ink-3">
                          #{c.number}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px]">
                          {c.title}
                        </span>
                        <span className="tnum text-[12px] text-ink-3">{c.votes}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Body */}
                <div className="overflow-hidden rounded-control border border-line">
                  <div className="flex flex-wrap items-center gap-2 border-b border-line bg-subtle px-3 py-2">
                    <span className="text-[12px] text-ink-3">Markdown</span>
                    <span className="flex-1" />
                    <Button
                      variant="ai"
                      icon="sparkle"
                      disabled={pending || !aiReady || linked.length === 0}
                      onClick={draft}
                      className="h-8"
                    >
                      {pending ? <Spinner /> : null}
                      {body.trim() ? "Redraft" : "Draft from linked posts"}
                    </Button>
                  </div>
                  <Textarea
                    rows={12}
                    value={body}
                    onChange={(e) => {
                      setBody(e.target.value);
                      setDirty(true);
                    }}
                    placeholder={
                      linked.length
                        ? `Write what changed, or let Euclid draft it from the ${voters} votes on the linked post${
                            linked.length === 1 ? "" : "s"
                          }.`
                        : "Write what changed."
                    }
                    className="rounded-none border-0"
                  />
                </div>
              </Card>
            ) : (
              /* Email preview */
              <Card className="overflow-hidden">
                <div className="flex flex-col gap-1 border-b border-line bg-subtle px-4 py-3 text-[12.5px] text-ink-2">
                  <span>
                    <strong className="font-semibold text-ink">From</strong> {founderName} at{" "}
                    {appName}
                  </span>
                  <span>
                    <strong className="font-semibold text-ink">Subject</strong> You asked,
                    we shipped: {title}
                  </span>
                  <span>
                    <strong className="font-semibold text-ink">To</strong> {voters} voter
                    {voters === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="flex flex-col gap-4 px-6 py-6 text-[14px] leading-[1.6] text-ink-body">
                  <p>Hi there,</p>
                  {linked[0] && (
                    <p>
                      You voted for{" "}
                      <strong className="font-semibold text-ink">{linked[0].title}</strong>.
                      It is live today.
                    </p>
                  )}
                  <p className="whitespace-pre-wrap">
                    {body || "(Nothing written yet.)"}
                  </p>
                  <span className="inline-flex h-9 w-fit items-center rounded-control bg-ink px-4 text-[13.5px] font-medium text-white">
                    Try it in {appName}
                  </span>
                  <p className="text-[12px] text-ink-3">
                    You are getting this because you voted on {appName}&apos;s feedback
                    board. Reply to unsubscribe.
                  </p>
                </div>
              </Card>
            )}

            {/* Publish options */}
            <section
              aria-labelledby="notify-h"
              className="flex flex-col gap-4 rounded-card border border-line p-[18px]"
            >
              <SectionTitle id="notify-h">When you publish</SectionTitle>
              <ToggleRow
                label={`Email the ${voters} voter${voters === 1 ? "" : "s"}`}
                detail={`From ${founderName} at ${appName} · they can unsubscribe`}
                checked={notifyVoters}
                onChange={(next) => {
                  setNotifyVoters(next);
                  setDirty(true);
                }}
                disabled={voters === 0}
              />
              <ToggleRow
                label={
                  linked[0]
                    ? `Mark #${linked[0].number} as Shipped`
                    : "Mark linked posts as Shipped"
                }
                detail="Moves them to Shipped on the public roadmap"
                checked={markShipped}
                onChange={setMarkShipped}
                disabled
              />
              <ToggleRow
                label="Show a badge in the widget"
                detail="A dot on the Changelog tab for 7 days"
                checked={showBadge}
                onChange={(next) => {
                  setShowBadge(next);
                  setDirty(true);
                }}
              />
              <p className="text-[11.5px] leading-[1.45] text-ink-3">
                Emails are queued when you publish and sent by a background worker, so a
                mail outage never loses them.
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
