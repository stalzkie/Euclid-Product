"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import {
  AiCard,
  AiLabel,
  Banner,
  Button,
  ButtonLink,
  Card,
  Meter,
  SectionTitle,
  StatusChip,
  Textarea,
  cx,
} from "@/components/ui";
import { Spinner, Toggle, UnderlineTabs, VoteButton } from "@/components/controls";
import { ago, longDate, plural } from "@/lib/format";
import { POST_STATUSES, STATUS_LABEL, type IdentityMode } from "@/lib/types";
import { TARGETS, defaultTargetFor } from "@/lib/ai/targets";
import type { PostDetail } from "@/server/queries";
import { setStatus, setTheme, mergePost } from "../../feedback/actions";
import { reply, setFounderNotes, setNotifyOnShip, summarisePost } from "./actions";
import type { DemandSummary } from "@/lib/ai/summarise";
import { ExportIssue } from "./export-issue";

export function PostDetailView({
  post,
  boardName,
  boardColor,
  boardPublicId,
  identityMode,
  themes,
  founderName,
  promptsLeft,
  issueTrackers,
  codingTools,
}: {
  post: PostDetail;
  boardName: string;
  boardColor: string;
  boardPublicId: string;
  identityMode: IdentityMode;
  themes: { id: string; name: string }[];
  founderName: string;
  promptsLeft: number;
  issueTrackers: ("github" | "linear")[];
  codingTools: string[];
}) {
  const router = useRouter();
  const [statusOpen, setStatusOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [replyTab, setReplyTab] = useState<"public" | "internal">("public");
  const [replyBody, setReplyBody] = useState("");
  const [notes, setNotes] = useState(post.founder_notes ?? "");
  const [notesSaved, setNotesSaved] = useState(false);
  const [target, setTarget] = useState(defaultTargetFor(codingTools));
  const [notify, setNotify] = useState(true);
  const [summary, setSummary] = useState<DemandSummary | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  };

  const mergedVotes = post.merged.reduce((a, m) => a + m.vote_count, 0);
  const publicComments = post.comments.filter((c) => !c.internal);
  const internalNotes = post.comments.filter((c) => c.internal);
  const openSimilar = post.similar.filter((s) => s.state === "pending");

  const planSplit = splitByPlan(post);

  return (
    <div className="flex flex-wrap items-start gap-7">
      <main className="flex min-w-0 flex-[999_1_560px] flex-col gap-6">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[13px] text-ink-3">
            <Link href="/feedback" className="text-ink-2 no-underline hover:text-ink">
              Feedback
            </Link>
            <span aria-hidden="true">/</span>
            <span>{boardName}</span>
            <span aria-hidden="true">/</span>
            <span className="text-ink">#{post.number}</span>
          </span>
        </nav>

        {/* The post */}
        <article className="flex gap-[18px]">
          <VoteButton votes={post.vote_count} voted={false} />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <h1 className="text-[24px] font-semibold leading-[1.25] tracking-[-0.015em]">
              {post.title}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
              <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-ink-2">
                {initials(post.authorEmail)}
              </span>
              <span className="text-ink-body">{post.authorEmail ?? "anonymous"}</span>
              {post.payingShare > 0 && identityMode === "jwt" && (
                <span className="rounded-chip bg-state-wash px-2 py-[2px] text-[11.5px] font-medium text-state">
                  paying voter
                </span>
              )}
              <span aria-hidden="true">·</span>
              <span>{ago(post.created_at)}</span>
              <span aria-hidden="true">·</span>
              <span>via widget</span>
            </div>

            {post.injection_flagged && (
              <Banner tone="warn" icon="warn">
                This post contains text shaped like an instruction to a coding agent.
                It is quoted as data everywhere Euclid uses it — read any prompt
                through before you paste it.
              </Banner>
            )}

            {post.body && (
              <p className="whitespace-pre-wrap text-[14.5px] leading-[1.6] text-ink-body">
                {post.body}
              </p>
            )}

            {/* Inline controls */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setStatusOpen((v) => !v)}
                  className="flex h-8 items-center gap-[6px] rounded-control border border-line-strong px-[10px] text-[13px] font-medium hover:bg-subtle"
                >
                  <StatusChip status={post.status} />
                  <Icon name="chevronDown" size={12} strokeWidth={2} />
                </button>
                {statusOpen && (
                  <div className="absolute left-0 top-[36px] z-20 flex w-[180px] flex-col gap-[2px] rounded-control border border-line bg-canvas p-1 shadow-overlay">
                    {POST_STATUSES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            setStatusOpen(false);
                            const res = await setStatus({ postIds: [post.id], status: s });
                            flash(
                              res.ok
                                ? s === "shipped"
                                  ? "Marked Shipped · changelog draft created"
                                  : `Moved to ${STATUS_LABEL[s]}`
                                : (res.error ?? "Could not update"),
                            );
                            router.refresh();
                          })
                        }
                        className="flex h-8 items-center rounded-[6px] px-2 text-left text-[13px] hover:bg-muted"
                      >
                        {STATUS_LABEL[s]}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setThemeOpen((v) => !v)}
                  className="flex h-8 items-center gap-[6px] rounded-control border border-line-strong px-[10px] text-[13px] font-medium hover:bg-subtle"
                >
                  {post.themeName ?? "No theme"}
                  <span className="text-ink-3">· theme</span>
                  <Icon name="chevronDown" size={12} strokeWidth={2} />
                </button>
                {themeOpen && (
                  <div className="absolute left-0 top-[36px] z-20 flex w-[240px] flex-col gap-[2px] rounded-control border border-line bg-canvas p-1 shadow-overlay">
                    <button
                      type="button"
                      onClick={() =>
                        start(async () => {
                          setThemeOpen(false);
                          await setTheme([post.id], null);
                          flash("Theme cleared");
                          router.refresh();
                        })
                      }
                      className="flex h-8 items-center rounded-[6px] px-2 text-left text-[13px] text-ink-3 hover:bg-muted"
                    >
                      No theme
                    </button>
                    {themes.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() =>
                          start(async () => {
                            setThemeOpen(false);
                            await setTheme([post.id], t.id);
                            flash(`Moved to ${t.name}`);
                            router.refresh();
                          })
                        }
                        className="flex h-8 items-center rounded-[6px] px-2 text-left text-[13px] hover:bg-muted"
                      >
                        {t.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {openSimilar.length > 0 && (
                <Button onClick={() => setMergeOpen((v) => !v)}>Merge into…</Button>
              )}

              <Button
                icon={copied ? "check" : "link"}
                onClick={async () => {
                  const url = `${window.location.origin}/b/${boardPublicId}/p/${post.number}`;
                  await navigator.clipboard.writeText(url).catch(() => {});
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? "Link copied" : "Copy link"}
              </Button>
            </div>

            {mergeOpen && openSimilar.length > 0 && (
              <Card className="flex flex-col gap-2 p-3">
                <p className="text-[12.5px] text-ink-3">
                  Merge this post into one of these. Votes and comments move across.
                </p>
                {openSimilar.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        setMergeOpen(false);
                        const res = await mergePost(post.id, s.id);
                        flash(res.ok ? `Merged into #${s.number}` : "Could not merge");
                        if (res.ok) router.push(`/posts/${s.number}`);
                      })
                    }
                    className="flex items-center gap-3 rounded-control border border-line px-3 py-2 text-left hover:bg-subtle"
                  >
                    <span className="tnum w-11 rounded-chip bg-muted px-2 py-[2px] text-center text-[12px] font-semibold text-ink-2">
                      {Math.round(s.similarity * 100)}%
                    </span>
                    <span className="flex-1 truncate text-[13.5px]">
                      #{s.number} {s.title}
                    </span>
                    <span className="text-[12px] text-ink-3">{s.votes} votes</span>
                  </button>
                ))}
              </Card>
            )}
          </div>
        </article>

        {toast && (
          <Banner tone="ok" icon="check">
            {toast}
          </Banner>
        )}

        {/* AI read of the demand */}
        <AiCard>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <AiLabel>What {post.vote_count} voters are asking for</AiLabel>
              <span className="text-[11.5px] text-ink-3">
                From {plural(post.comment_count, "comment")} and {plural(post.merged.length, "merged post")}
              </span>
            </div>
            {summary ? (
              <ul className="flex list-disc flex-col gap-2 pl-[18px] text-[13.5px] leading-[1.5] text-ink-body">
                {summary.map((b) => (
                  <li key={b.claim}>
                    <strong className="font-semibold text-ink">{b.claim}</strong>{" "}
                    {b.detail}
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <p className="text-[13.5px] leading-[1.5] text-ink-body">
                  Euclid can read this post, its {plural(post.comment_count, "comment")} and the{" "}
                  {plural(post.merged.length, "merged post")}, and tell you what the
                  shared ask actually is.
                </p>
                <Button
                  variant="ai"
                  icon="sparkle"
                  disabled={pending}
                  className="self-start"
                  onClick={() =>
                    start(async () => {
                      const res = await summarisePost(post.id);
                      if (res.ok) setSummary(res.bullets);
                      else flash(res.error);
                    })
                  }
                >
                  {pending ? <Spinner /> : null}
                  Read the comments for me
                </Button>
              </>
            )}
          </div>
        </AiCard>

        {/* Similar posts */}
        {post.similar.length > 0 && (
          <section aria-labelledby="sim-title" className="flex flex-col gap-3">
            <SectionTitle id="sim-title">Similar posts</SectionTitle>
            <Card className="divide-y divide-hairline">
              {post.similar.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span
                    className={cx(
                      "tnum w-12 rounded-chip px-2 py-[3px] text-center text-[12px] font-semibold",
                      s.similarity >= 0.9 ? "bg-ai-wash text-ai-deep" : "bg-muted text-ink-2",
                    )}
                  >
                    {Math.round(s.similarity * 100)}%
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <Link
                      href={`/posts/${s.number}`}
                      className="truncate text-[13.5px] font-medium text-ink no-underline hover:underline"
                    >
                      #{s.number} {s.title}
                    </Link>
                    <span className="text-[12px] text-ink-3">
                      {s.votes} votes · {boardName}
                    </span>
                  </span>
                  {s.state === "merged" ? (
                    <span className="flex items-center gap-[6px] text-[12.5px] font-medium text-ok">
                      <Icon name="check" size={13} strokeWidth={2.4} />
                      Merged
                    </span>
                  ) : s.state === "dismissed" ? (
                    <span className="text-[12.5px] text-ink-3">Kept separate</span>
                  ) : (
                    <Button
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const res = await mergePost(s.id, post.id);
                          flash(
                            res.ok
                              ? `Merged #${s.number} · ${s.votes} votes combined`
                              : "Could not merge",
                          );
                          router.refresh();
                        })
                      }
                    >
                      Merge
                    </Button>
                  )}
                </div>
              ))}
            </Card>
          </section>
        )}

        {/* Comments */}
        <section aria-labelledby="com-title" className="flex flex-col gap-4">
          <SectionTitle id="com-title">
            Comments{" "}
            <span className="font-normal text-ink-3">{publicComments.length}</span>
          </SectionTitle>

          {publicComments.length === 0 && (
            <p className="text-[13px] text-ink-3">No comments on this post yet.</p>
          )}

          {publicComments.map((c) => (
            <div key={c.id} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10.5px] font-semibold text-ink-2">
                {initials(c.author_name ?? "anon")}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                  <strong className="font-semibold text-ink">
                    {c.author_name ?? "anonymous"}
                  </strong>
                  {c.author_user_id && (
                    <span className="rounded-chip bg-muted px-[6px] py-[1px] text-[11px] font-medium text-ink-2">
                      Founder
                    </span>
                  )}
                  <span>· {ago(c.created_at)}</span>
                </span>
                <p className="whitespace-pre-wrap text-[13.5px] leading-[1.55] text-ink-body">
                  {c.body}
                </p>
              </div>
            </div>
          ))}

          {internalNotes.length > 0 && (
            <div className="flex flex-col gap-3 rounded-control border border-[#FDE68A] bg-warn-note p-3">
              <p className="text-[12px] font-semibold uppercase tracking-[0.05em] text-warn">
                Internal notes · only your team sees these
              </p>
              {internalNotes.map((c) => (
                <p key={c.id} className="text-[13px] leading-[1.5] text-ink-body">
                  <strong className="font-semibold">{c.author_name ?? "You"}</strong>{" "}
                  <span className="text-ink-3">· {ago(c.created_at)}</span>
                  <br />
                  {c.body}
                </p>
              ))}
            </div>
          )}

          {/* Reply box */}
          <Card className="flex flex-col gap-3 p-4">
            <UnderlineTabs
              value={replyTab}
              onChange={setReplyTab}
              options={[
                { value: "public", label: "Reply publicly" },
                { value: "internal", label: "Internal note" },
              ]}
            />
            <Textarea
              rows={3}
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder={
                replyTab === "internal"
                  ? "Only your team sees this note"
                  : "Write a reply voters will see"
              }
              className={replyTab === "internal" ? "bg-warn-note" : undefined}
            />
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                disabled={pending || !replyBody.trim()}
                onClick={() =>
                  start(async () => {
                    const res = await reply({
                      postId: post.id,
                      body: replyBody,
                      internal: replyTab === "internal",
                    });
                    if (res.ok) {
                      setReplyBody("");
                      flash(replyTab === "internal" ? "Note saved" : "Reply posted");
                      router.refresh();
                    } else {
                      flash(res.error);
                    }
                  })
                }
              >
                {pending ? <Spinner /> : null}
                {replyTab === "internal" ? "Save note" : "Reply"}
              </Button>
              <span className="text-[12px] text-ink-3">
                {replyTab === "internal"
                  ? "Not shown on the public board"
                  : `Signed as ${founderName}`}
              </span>
            </div>
          </Card>
        </section>
      </main>

      {/* Right rail */}
      <aside aria-label="Post details" className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
        <ExportIssue
          postId={post.id}
          connected={issueTrackers}
          externalUrl={post.external_url}
          externalKind={post.external_kind}
        />

        {/* Build Prompt */}
        <Card className="flex flex-col gap-3 p-[18px]">
          <SectionTitle id="bp-title">Ship this with your agent</SectionTitle>
          <p className="text-[13px] leading-[1.5] text-ink-3">
            Turns the post{post.merged.length ? `, ${post.merged.length} merged posts` : ""},
            user quotes and your project profile into one prompt.
          </p>
          <div role="radiogroup" aria-label="Target tool" className="flex flex-wrap gap-2">
            {TARGETS.filter((t) => t.id !== "builder").map((t) => {
              const on = t.id === target;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setTarget(t.id)}
                  className={cx(
                    "h-8 rounded-control border px-[10px] text-[12.5px] font-medium",
                    on
                      ? "border-state-bright bg-state-wash text-state"
                      : "border-line-strong bg-canvas text-ink hover:bg-subtle",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <ButtonLink
            href={`/prompts/new?post=${post.number}&target=${target}`}
            variant="ai"
            icon="sparkle"
          >
            Generate for {TARGETS.find((t) => t.id === target)?.label}
          </ButtonLink>
          <span className="text-[12px] text-ink-3">
            Uses 1 Build Prompt · {promptsLeft} left this month
            {post.promptCount > 0 && ` · ${post.promptCount} already generated`}
          </span>
          {post.latestPromptId && (
            <Link
              href={`/prompts/${post.latestPromptId}`}
              className="text-[12.5px] font-medium text-state no-underline hover:underline"
            >
              Open the last prompt for this post
            </Link>
          )}
        </Card>

        {/* Founder notes feed the prompt */}
        <Card className="flex flex-col gap-2 p-[18px]">
          <SectionTitle>Founder notes</SectionTitle>
          <p className="text-[12.5px] text-ink-3">
            Constraints only you know. These go into the Build Prompt verbatim.
          </p>
          <Textarea
            rows={3}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setNotesSaved(false);
            }}
            placeholder="Keep it behind a feature flag. Free plan gets CSV only."
          />
          <Button
            disabled={pending || notesSaved}
            className="self-start"
            onClick={() =>
              start(async () => {
                await setFounderNotes(post.id, notes);
                setNotesSaved(true);
              })
            }
          >
            {notesSaved ? "Saved" : "Save notes"}
          </Button>
        </Card>

        {/* Details */}
        <Card className="flex flex-col gap-3 p-[18px]">
          <SectionTitle id="det-title">Details</SectionTitle>
          <dl className="grid grid-cols-[88px_1fr] gap-y-[10px] text-[13px]">
            <dt className="text-ink-3">Board</dt>
            <dd className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-[3px]" style={{ background: boardColor }} />
              {boardName}
            </dd>
            <dt className="text-ink-3">Status</dt>
            <dd>
              <StatusChip status={post.status} />
            </dd>
            <dt className="text-ink-3">Theme</dt>
            <dd>{post.themeName ?? "—"}</dd>
            <dt className="text-ink-3">Category</dt>
            <dd>{post.category ?? "—"}</dd>
            <dt className="text-ink-3">Created</dt>
            <dd>{longDate(post.created_at)}</dd>
            {post.shipped_at && (
              <>
                <dt className="text-ink-3">Shipped</dt>
                <dd>{longDate(post.shipped_at)}</dd>
              </>
            )}
            {post.merged.length > 0 && (
              <>
                <dt className="text-ink-3">Merged in</dt>
                <dd>
                  {post.merged.length} post{post.merged.length === 1 ? "" : "s"} ·{" "}
                  {mergedVotes} votes
                </dd>
              </>
            )}
          </dl>
        </Card>

        {/* Who voted */}
        <Card className="flex flex-col gap-3 p-[18px]">
          <SectionTitle id="who-title">Who voted</SectionTitle>
          {planSplit.length === 0 ? (
            <p className="text-[12.5px] leading-[1.5] text-ink-3">
              {identityMode === "jwt"
                ? "No votes on this post yet."
                : "Turn on signed JWT identity to see which plans your voters are on."}
            </p>
          ) : (
            <>
              <div className="flex h-[6px] overflow-hidden rounded-full">
                {planSplit.map((p) => (
                  <span
                    key={p.plan}
                    style={{ width: `${p.share}%`, background: p.color }}
                    title={`${p.plan} ${p.share}%`}
                  />
                ))}
              </div>
              <div className="flex flex-col gap-[6px]">
                {planSplit.map((p) => (
                  <span key={p.plan} className="flex items-center gap-2 text-[12.5px]">
                    <span
                      className="h-[8px] w-[8px] rounded-full"
                      style={{ background: p.color }}
                    />
                    <span className="flex-1 capitalize text-ink-body">{p.plan}</span>
                    <span className="tnum text-ink-3">
                      {p.votes} · {p.share}%
                    </span>
                  </span>
                ))}
              </div>
              <span className="text-[11.5px] leading-[1.45] text-ink-3">
                {identityMode === "jwt"
                  ? "From the signed JWT your app passes."
                  : "Plans come from the email domain. Switch to JWT identity for exact segments."}
              </span>
            </>
          )}
          <div className="flex flex-col gap-1 border-t border-hairline pt-3">
            <span className="text-[12px] text-ink-2">Paying share</span>
            <Meter value={post.payingShare} max={100} />
            <span className="tnum text-[12px] text-ink-3">{post.payingShare}% of voters pay</span>
          </div>
        </Card>

        {/* Notify on ship */}
        <Card className="p-[18px]">
          <div className="flex items-center gap-3">
            <span className="flex flex-1 flex-col">
              <span id="notify-title" className="text-[13.5px] font-medium">
                Email voters when shipped
              </span>
              <span className="text-[12px] text-ink-3">
                {post.voterEmails.length} {post.voterEmails.length === 1 ? "person" : "people"} ·
                from the changelog
              </span>
            </span>
            <Toggle
              checked={notify}
              label="Email voters when shipped"
              onChange={(next) => {
                setNotify(next);
                start(async () => {
                  await setNotifyOnShip(post.id, next);
                });
              }}
            />
          </div>
        </Card>
      </aside>
    </div>
  );
}

const PLAN_COLORS: Record<string, string> = {
  pro: "#0A72DC",
  team: "#7C3AED",
  free: "#D6D6D2",
  indie: "#16A34A",
};

/**
 * Vote split by plan. The query hands back the voter emails and the paying
 * share; the exact per-plan split only exists under JWT identity, so this
 * degrades to paying vs free elsewhere.
 */
function splitByPlan(post: PostDetail) {
  const total = post.vote_count;
  if (!total) return [];
  const paying = Math.round((post.payingShare / 100) * total);
  const free = total - paying;
  const rows = [
    { plan: "paying", votes: paying, color: PLAN_COLORS.pro },
    { plan: "free", votes: free, color: PLAN_COLORS.free },
  ].filter((r) => r.votes > 0);
  return rows.map((r) => ({ ...r, share: Math.round((r.votes / total) * 100) }));
}

function initials(value: string | null): string {
  if (!value) return "··";
  const name = value.split("@")[0];
  const parts = name.split(/[.\s_-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
