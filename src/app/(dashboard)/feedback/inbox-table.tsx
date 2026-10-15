"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";
import { AnimatePresence, m } from "motion/react";
import { Icon, SearchIcon } from "@/components/icons";
import {
  Button,
  Card,
  Input,
  Meter,
  Sparkline,
  StatusChip,
  Textarea,
  cx,
} from "@/components/ui";
import { Spinner } from "@/components/controls";
import {
  AnimatedNumber,
  Collapse,
  FadeRise,
  useToast,
} from "@/components/motion";
import { dur, ease, spring } from "@/lib/motion/tokens";
import { ago, plural } from "@/lib/format";
import { POST_STATUSES, STATUS_LABEL, type PostStatus } from "@/lib/types";
import type { PostRow } from "@/server/queries";
import { addPost, deletePosts, exportPostsCsv, setStatus, setTheme } from "./actions";

type Tab = "all" | PostStatus;
type Sort = "votes" | "demand" | "recent" | "rising";

const SORTS: { value: Sort; label: string; detail?: string }[] = [
  { value: "votes", label: "Most votes" },
  {
    value: "demand",
    label: "Most demand",
    detail: "Weights paying voters higher",
  },
  { value: "rising", label: "Fastest rising" },
  { value: "recent", label: "Newest" },
];

export function InboxTable({
  posts,
  counts,
  themes,
  boardName,
  boardCount,
  duplicateCount,
  heldCount,
  search,
  categories,
}: {
  posts: PostRow[];
  counts: Record<Tab, number>;
  themes: { id: string; name: string }[];
  boardName: string;
  boardCount: number;
  duplicateCount: number;
  heldCount: number;
  search: string;
  categories: string[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("all");
  const [sort, setSort] = useState<Sort>("votes");
  const [sortOpen, setSortOpen] = useState(false);
  const [query, setQuery] = useState(search);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState(false);
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const tabThumb = useId();
  const [pending, start] = useTransition();

  const rows = useMemo(() => {
    const filtered = posts.filter((p) => {
      if (tab !== "all" && p.status !== tab) return false;
      if (query && !p.title.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
    const sorted = [...filtered];
    if (sort === "votes") sorted.sort((a, b) => b.vote_count - a.vote_count);
    if (sort === "demand") {
      sorted.sort((a, b) => b.weighted_score - a.weighted_score);
    }
    if (sort === "rising") sorted.sort((a, b) => b.recentVotes - a.recentVotes);
    if (sort === "recent") {
      sorted.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    }
    return sorted;
  }, [posts, tab, query, sort]);

  const allChecked = rows.length > 0 && rows.every((r) => checked.has(r.id));
  const selection = [...checked];

  const toggleAll = () => {
    setChecked(allChecked ? new Set() : new Set(rows.map((r) => r.id)));
  };

  const toggleOne = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast(done, { tone: "ok" });
        setChecked(new Set());
      } else {
        toast(res.error ?? "Something went wrong", { tone: "bad" });
      }
      router.refresh();
    });

  const download = () =>
    start(async () => {
      const csv = await exportPostsCsv();
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${boardName.toLowerCase().replace(/\s+/g, "-")}-posts.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });

  const tabs: { value: Tab; label: string; count: number }[] = [
    { value: "all", label: "All", count: counts.all },
    ...POST_STATUSES.map((s) => ({
      value: s as Tab,
      label: STATUS_LABEL[s],
      count: counts[s],
    })),
  ];

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] font-semibold tracking-[-0.015em]">Feedback</h1>
          <p className="text-[14px] text-ink-2">
            Every post on {boardName}, ranked by votes.
            {boardCount > 1 && ` Switch boards in the sidebar.`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button icon="download" onClick={download} disabled={pending}>
            Export
          </Button>
          <Button variant="primary" icon="plus" onClick={() => setAdding((v) => !v)}>
            Add post
          </Button>
        </div>
      </header>

      {/*
        Held posts come before duplicates, and cannot be dismissed. A duplicate
        is a tidiness problem the founder can ignore for a week; a held post is
        feedback nobody can see, from someone who was told it was under review.
        Hiding the only route to it would be the bug this banner exists to fix.
      */}
      {heldCount > 0 && (
        <div
          role="note"
          className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[#F3C9C9] bg-[#FEF0F0] px-[14px] py-[10px]"
        >
          <Icon name="shield" size={16} className="shrink-0 text-bad" />
          <span className="min-w-[240px] flex-1 text-[13.5px]">
            <strong className="font-semibold">
              {heldCount} post{heldCount === 1 ? "" : "s"} held for approval.
            </strong>{" "}
            <span className="text-ink-body">
              {heldCount === 1 ? "It is" : "They are"} invisible on the board until
              you review {heldCount === 1 ? "it" : "them"}.
            </span>
          </span>
          <Link
            href="/feedback?view=held"
            className="flex h-[30px] items-center rounded-[7px] bg-bad px-3 text-[12.5px] font-medium text-white no-underline hover:brightness-95"
          >
            Review {heldCount === 1 ? "it" : "them"}
          </Link>
        </div>
      )}

      {duplicateCount > 0 && !dismissed && (
        <div
          role="note"
          className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[#CFE4FF] bg-state-wash px-[14px] py-[10px]"
        >
          <MergeGlyph />
          <span className="min-w-[240px] flex-1 text-[13.5px]">
            <strong className="font-semibold">
              Euclid found {duplicateCount} likely duplicate
              {duplicateCount === 1 ? "" : "s"}.
            </strong>{" "}
            <span className="text-ink-body">Merging keeps every vote and comment.</span>
          </span>
          <Link
            href="/feedback?view=merges"
            className="flex h-[30px] items-center rounded-[7px] bg-state px-3 text-[12.5px] font-medium text-white no-underline hover:bg-[#095fb8]"
          >
            Review merges
          </Link>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setDismissed(true)}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-2 hover:bg-white/60"
          >
            <CloseGlyph />
          </button>
        </div>
      )}

      <Collapse open={adding}>
        <AddPostForm categories={categories} onDone={() => setAdding(false)} />
      </Collapse>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Status" className="flex flex-wrap gap-[2px] rounded-[9px] bg-muted p-[3px]">
          {tabs.map((t) => {
            const on = t.value === tab;
            return (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t.value)}
                className={cx(
                  "eu-colors relative flex h-7 items-center gap-[6px] px-[10px] text-[12.5px] font-medium",
                  on ? "text-ink" : "text-ink-2",
                )}
              >
                {on && (
                  <m.span
                    layoutId={tabThumb}
                    transition={spring.snappy}
                    className="absolute inset-0 rounded-[7px] bg-canvas shadow-seg"
                  />
                )}
                <span className="relative">{t.label}</span>
                <AnimatedNumber
                  value={t.count}
                  className="relative text-[11.5px] text-ink-3"
                />
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2">
          <label className="flex h-[34px] w-[240px] items-center gap-2 rounded-control border border-line-strong px-[10px] text-ink-3">
            <SearchIcon size={15} />
            <span className="sr-only">Search posts</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search posts"
              className="min-w-0 flex-1 border-0 text-[13.5px] text-ink outline-none"
            />
          </label>

          <div className="relative">
            <button
              type="button"
              onClick={() => setSortOpen((v) => !v)}
              aria-expanded={sortOpen}
              className="eu-press flex h-[34px] items-center gap-[6px] rounded-control border border-line-strong bg-canvas px-3 text-[13px] font-medium text-ink hover:bg-subtle"
            >
              {SORTS.find((s) => s.value === sort)?.label}
              <Icon name="chevronDown" size={13} strokeWidth={2} />
            </button>
            {/* A dropdown: scales up from its trigger edge and leaves on
                opacity alone, because a menu on its way out is already done. */}
            <AnimatePresence>
              {sortOpen && (
              <m.div
                initial={{ opacity: 0, scale: 0.98, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: dur.fast, ease: ease.in } }}
                transition={{ duration: dur.base, ease: ease.out }}
                style={{ transformOrigin: "top right" }}
                className="absolute right-0 top-[38px] z-20 flex w-[210px] flex-col gap-[2px] rounded-control border border-line bg-canvas p-1 shadow-overlay"
              >
                {SORTS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => {
                      setSort(s.value);
                      setSortOpen(false);
                    }}
                    className={cx(
                      "eu-colors flex flex-col items-start rounded-[6px] px-2 py-[6px] text-left text-[13px] hover:bg-muted",
                      s.value === sort ? "font-medium text-ink" : "text-ink-body",
                    )}
                  >
                    {s.label}
                    {s.detail && (
                      <span className="text-[11px] font-normal text-ink-3">
                        {s.detail}
                      </span>
                    )}
                  </button>
                ))}
              </m.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Bulk actions appear only once something is selected. */}
      <Collapse open={selection.length > 0}>
        <FadeRise className="flex flex-wrap items-center gap-2 rounded-control border border-line bg-subtle px-3 py-2">
          <span className="text-[13px] font-medium">
            <AnimatedNumber value={selection.length} live /> selected
          </span>
          <span className="h-5 w-px bg-line" />
          {POST_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              disabled={pending}
              onClick={() =>
                act(() => setStatus({ postIds: selection, status: s }), `Moved to ${STATUS_LABEL[s]}`)
              }
              className="eu-press h-7 rounded-[6px] border border-line bg-canvas px-[10px] text-[12.5px] font-medium hover:bg-muted disabled:opacity-50"
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
          {themes.length > 0 && (
            <select
              defaultValue=""
              disabled={pending}
              onChange={(e) =>
                e.target.value &&
                act(() => setTheme(selection, e.target.value), "Theme set")
              }
              className="h-7 rounded-[6px] border border-line bg-canvas px-2 text-[12.5px] font-medium"
            >
              <option value="">Set theme…</option>
              {themes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => act(() => deletePosts(selection), "Deleted")}
            className="eu-press ml-auto h-7 rounded-[6px] border border-bad-line bg-bad-wash px-[10px] text-[12.5px] font-medium text-bad hover:bg-[#fde8e8] disabled:opacity-50"
          >
            Delete
          </button>
          {pending && <Spinner />}
        </FadeRise>
      </Collapse>


      <div className="overflow-x-auto rounded-card border border-line">
        {/*
          Changing the filter, the sort or the search dips the body to 40% and
          brings it back. Rows do not stagger and do not animate into new
          positions: there can be thousands of them, and a list the founder is
          scanning has to feel instant rather than choreographed.
        */}
        <m.table
          key={`${tab}:${sort}:${query}`}
          initial={{ opacity: 0.4 }}
          animate={{ opacity: 1 }}
          transition={{ duration: dur.fast, ease: ease.out }}
          className="w-full min-w-[880px] border-collapse text-[13.5px]"
        >
          <thead>
            <tr className="bg-subtle text-left text-[12.5px] text-ink-2">
              <th scope="col" className="w-9 py-[10px] pl-4 font-medium">
                <button
                  type="button"
                  aria-label={allChecked ? "Clear selection" : "Select all"}
                  onClick={toggleAll}
                  className={cx(
                    "flex h-4 w-4 items-center justify-center rounded-[4px] border-[1.5px] text-white",
                    allChecked ? "border-state-bright bg-state-bright" : "border-line-strong bg-canvas",
                  )}
                >
                  {allChecked && <Icon name="check" size={11} strokeWidth={3} />}
                </button>
              </th>
              <th scope="col" className="w-[72px] px-2 py-[10px] font-medium">Votes</th>
              <th scope="col" className="px-2 py-[10px] font-medium">Post</th>
              <th scope="col" className="px-2 py-[10px] font-medium">Theme</th>
              <th scope="col" className="px-2 py-[10px] font-medium">Status</th>
              <th scope="col" className="px-2 py-[10px] font-medium">Paying</th>
              <th scope="col" className="px-2 py-[10px] font-medium">7 weeks</th>
              <th scope="col" className="px-2 py-[10px] font-medium">Updated</th>
              <th scope="col" className="w-10 py-[10px] pr-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-[13px] text-ink-3">
                  {query
                    ? `Nothing matches "${query}".`
                    : "No posts in this view yet."}
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const on = checked.has(r.id);
              return (
                <tr
                  key={r.id}
                  className={cx(
                    "eu-colors border-t border-hairline",
                    on ? "bg-state-row" : "bg-canvas hover:bg-subtle",
                  )}
                >
                  <td className="py-3 pl-4">
                    <button
                      type="button"
                      aria-label={`Select ${r.title}`}
                      onClick={() => toggleOne(r.id)}
                      className={cx(
                        "flex h-4 w-4 items-center justify-center rounded-[4px] border-[1.5px] text-white",
                        on ? "border-state-bright bg-state-bright" : "border-line-strong bg-canvas",
                      )}
                    >
                      {on && <Icon name="check" size={11} strokeWidth={3} />}
                    </button>
                  </td>
                  <td className="px-2 py-3">
                    <span
                      className="tnum inline-flex h-[26px] items-center gap-1 rounded-[7px] border border-line-strong px-2 font-semibold"
                      title={
                        Math.round(r.weighted_score) !== r.vote_count
                          ? `${r.vote_count} people · ${r.weighted_score} weighted by plan`
                          : undefined
                      }
                    >
                      <Icon name="caretUp" size={11} strokeWidth={2.6} />
                      <AnimatedNumber value={r.vote_count} />
                    </span>
                    {sort === "demand" &&
                      Math.round(r.weighted_score) !== r.vote_count && (
                        <span className="tnum mt-[3px] block text-[11px] text-state">
                          {r.weighted_score} demand
                        </span>
                      )}
                  </td>
                  <td className="max-w-[340px] px-2 py-3">
                    <Link
                      href={`/posts/${r.number}`}
                      className="flex flex-col gap-[2px] text-ink no-underline"
                    >
                      <span className="truncate font-medium">{r.title}</span>
                      <span className="text-[12px] text-ink-3">
                        #{r.number} · {r.authorEmail ?? "anonymous"} · {plural(r.comment_count, "comment")}
                        {r.injection_flagged && (
                          <span className="ml-2 text-warn">⚠ needs review</span>
                        )}
                      </span>
                    </Link>
                  </td>
                  <td className="px-2 py-3">
                    {r.themeName ? (
                      <span className="whitespace-nowrap rounded-chip bg-muted px-2 py-[3px] text-[12px] text-ink-body">
                        {r.themeName}
                      </span>
                    ) : (
                      <span className="text-[12px] text-ink-3">—</span>
                    )}
                  </td>
                  <td className="px-2 py-3">
                    <StatusChip status={r.status} />
                  </td>
                  <td className="px-2 py-3">
                    <span className="flex items-center gap-2">
                      <span className="block w-11">
                        <Meter value={r.payingShare} max={100} />
                      </span>
                      <span className="tnum text-[12.5px] text-ink-2">{r.payingShare}%</span>
                    </span>
                  </td>
                  <td className="px-2 py-3">
                    <Sparkline points={r.trend} width={64} height={20} color="#1A8CFF" />
                  </td>
                  <td className="whitespace-nowrap px-2 py-3 text-ink-3">
                    {ago(r.updated_at)}
                  </td>
                  <td className="py-3 pr-3">
                    <Link
                      href={`/prompts/new?post=${r.number}`}
                      aria-label={`Build Prompt for ${r.title}`}
                      className="eu-colors flex h-7 w-7 items-center justify-center rounded-[7px] text-ai hover:bg-ai-wash"
                    >
                      <Icon name="sparkle" size={15} strokeWidth={1.9} />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </m.table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-ink-2">
        <span>
          Showing {rows.length} of {counts.all} post{counts.all === 1 ? "" : "s"}
        </span>
        <span>Ranked by {SORTS.find((s) => s.value === sort)?.label.toLowerCase()}</span>
      </div>
    </>
  );
}

function AddPostForm({
  categories,
  onDone,
}: {
  categories: string[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState(categories[0] ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const res = await addPost({ title, body, category, status: "under_review" });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setTitle("");
      setBody("");
      onDone();
      router.refresh();
    });

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="text-[14px] font-semibold">Add a post by hand</p>
      <p className="-mt-2 text-[12.5px] text-ink-3">
        For requests that arrived in a DM or an email. It joins the board with no votes.
      </p>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What did they ask for?"
      />
      <Textarea
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Their own words, if you have them — these end up in the Build Prompt."
      />
      <div className="flex flex-wrap items-center gap-2">
        {categories.length > 0 && (
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 rounded-control border border-line-strong bg-canvas px-2 text-[13.5px]"
          >
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        )}
        <Button variant="primary" onClick={submit} disabled={pending || title.length < 3}>
          {pending ? <Spinner /> : null}
          Add post
        </Button>
        <Button onClick={onDone}>Cancel</Button>
        {error && <span className="text-[12.5px] text-bad">{error}</span>}
      </div>
    </Card>
  );
}

function MergeGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#0A72DC"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M6 7v10M6 7c0 3 3 5 10 5" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
