"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { Banner, Button, Input, Meter, SectionTitle, cx } from "@/components/ui";
import { Segmented, Spinner } from "@/components/controls";
import { useToast } from "@/components/motion";
import { PLANS, PLAN_ORDER } from "@/lib/plans";
import { longDate } from "@/lib/format";
import type { PlanTier } from "@/lib/types";
import {
  changePlan,
  deleteEndUser,
  exportEndUser,
  renameWorkspace,
  verifyStudentEmail,
} from "./actions";

/** 14 · Plan and credits. */
export function BillingView({
  workspaceName,
  plan,
  billingPeriod,
  promptsUsed,
  chatCreditsUsed,
  extraPrompts,
  extraChatCredits,
  topups,
  boardCount,
  periodStart,
  memberCount,
  founderEmail,
  founderName,
  billing,
  studentState,
}: {
  workspaceName: string;
  plan: PlanTier;
  billingPeriod: "monthly" | "yearly";
  promptsUsed: number;
  chatCreditsUsed: number;
  /** Balance bought with a top-up. Survives the monthly reset. */
  extraPrompts: number;
  extraChatCredits: number;
  /** Packs this deployment can sell to this plan. Empty hides the section. */
  topups: { id: string; label: string; price: number; kind: "prompts" | "credits" }[];
  boardCount: number;
  periodStart: string;
  memberCount: number;
  founderEmail: string;
  founderName: string;
  billing: {
    /** Whether Polar is configured. False keeps the old direct-write path. */
    enabled: boolean;
    /** Whether this workspace has a Polar customer, and so a portal to open. */
    hasCustomer: boolean;
    status: string | null;
    periodEnd: string | null;
    /** Length of the Polar trial, or null when no trial is configured. */
    trialDays: number | null;
    /** Whether a student discount is configured on this deployment. */
    studentDiscount: boolean;
  };
  studentState: {
    verified: boolean;
    email: string | null;
    /** When a current verification lapses, ISO. Null when not verified. */
    expiresAt: string | null;
  };
}) {
  const router = useRouter();
  const [period, setPeriod] = useState<"monthly" | "yearly">(billingPeriod);
  const [name, setName] = useState(workspaceName);
  const [privacyEmail, setPrivacyEmail] = useState("");
  const [studentEmail, setStudentEmail] = useState("");
  // `sent` is local only: the link has gone but nothing has changed server-side
  // until it is opened, so there is nothing to re-read from the workspace yet.
  const [student, setStudent] = useState<{
    verified: boolean;
    email: string | null;
    expiresAt: string | null;
    sent: "auto" | "review" | null;
  }>({ ...studentState, sent: null });
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const current = PLANS[plan];
  const yearly = period === "yearly";

  const flash = (message: string) => {
    toast(message);
  };

  const renewal = new Date(periodStart);
  renewal.setMonth(renewal.getMonth() + 1);

  /*
    Steps per chat question, for turning a credit balance into the number a
    founder actually cares about.

    A credit is one step of the Ask Euclid agent. Real answers measured on
    2026-10-13 took four and seven steps, so six is the midpoint — and
    rounding towards the pessimistic end is deliberate: a founder who is told
    to expect 100 questions and gets 140 is pleased, and one told to expect
    230 and gets 140 has been misled. This said three before anything measured
    it, which overstated the allowance by roughly double.
  */
  const STEPS_PER_QUESTION = 6;

  const creditsLeft = Math.max(0, current.chatCredits - chatCreditsUsed) + extraChatCredits;

  const usage = [
    {
      label: "Build Prompts",
      used: promptsUsed,
      limit: current.buildPrompts,
      extra: extraPrompts,
      color: promptsUsed >= current.buildPrompts ? "#F59E0B" : "#1A8CFF",
      note: `Resets ${longDate(renewal.toISOString())}`,
    },
    {
      label: "AI chat credits",
      used: chatCreditsUsed,
      limit: current.chatCredits,
      extra: extraChatCredits,
      color: "#1A8CFF",
      note: current.chatCredits
        ? `${creditsLeft} left · about ${Math.round(creditsLeft / STEPS_PER_QUESTION)} questions`
        : "Ask Euclid is on the Pro plan",
    },
    {
      label: "Boards",
      used: boardCount,
      limit: current.boards ?? boardCount,
      extra: 0,
      color:
        current.boards !== null && boardCount >= current.boards ? "#F59E0B" : "#1A8CFF",
      note:
        current.boards === null
          ? "Unlimited on Pro"
          : boardCount >= current.boards
            ? "At limit · Pro has unlimited boards"
            : `${current.boards - boardCount} more available`,
    },
  ];

  const SETTINGS_NAV = [
    { group: "Account", items: [{ href: "#profile", label: "Profile" }] },
    {
      group: "Workspace",
      items: [
        { href: "#general", label: "General" },
        { href: "#members", label: "Members" },
        { href: "#plan", label: "Plan and credits", current: true },
      ],
    },
    {
      group: "Boards",
      items: [
        { href: "/install#identity", label: "User identity (JWT)" },
        { href: "/install#domains", label: "Domains" },
        { href: "/install#integrations", label: "Integrations" },
      ],
    },
    {
      group: "Developers",
      items: [
        { href: "/install#api", label: "Install and API" },
        { href: "#privacy", label: "Data and privacy" },
      ],
    },
  ];

  return (
    <div className="flex flex-wrap items-start gap-8">
      <nav
        aria-label="Settings"
        className="flex min-w-0 flex-[1_1_200px] flex-col gap-1 lg:max-w-[220px]"
      >
        {SETTINGS_NAV.map((section) => (
          <div key={section.group} className="flex flex-col gap-1">
            <span className="px-2 pb-1 pt-3 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-ink-3">
              {section.group}
            </span>
            {section.items.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                aria-current={"current" in item && item.current ? "page" : undefined}
                className={cx(
                  "flex h-8 items-center rounded-control px-2 text-[13px] no-underline",
                  "current" in item && item.current
                    ? "bg-nav-active font-medium text-ink"
                    : "text-ink-body hover:bg-muted",
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <main className="flex min-w-0 flex-[999_1_560px] flex-col gap-7">
        <header className="flex flex-col gap-1">
          <h1 className="text-[26px] font-semibold tracking-[-0.015em]">
            Plan and credits
          </h1>
          <p className="text-[14px] text-ink-2">
            Flat monthly price. No fees per tracked user, ever.
          </p>
        </header>

        {error && (
          <Banner tone="bad" icon="warn">
            {error}
          </Banner>
        )}

        {/* Current plan */}
        <section
          id="plan"
          aria-labelledby="current-title"
          className="flex flex-col gap-4 rounded-card border border-line p-[18px]"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2
                id="current-title"
                className="flex items-center gap-2 text-[17px] font-semibold"
              >
                {current.name} plan
                <span className="rounded-full bg-ok-wash px-[9px] py-[3px] text-[11.5px] font-medium text-ok">
                  Active
                </span>
              </h2>
              <span className="text-[13px] text-ink-2">
                {current.monthly === 0
                  ? "Free forever"
                  : `$${
                      billingPeriod === "yearly" ? current.yearly : current.monthly
                    } a month · renews ${longDate(renewal.toISOString())}`}
              </span>
            </div>
            {/*
              Disabled until there is a Polar customer to manage: a workspace
              that has never been through checkout has no portal, and the route
              would answer 404. The free tier never has one.
            */}
            <Button
              disabled={!billing.enabled || !billing.hasCustomer}
              onClick={() =>
                window.location.assign(new URL("/api/billing/portal", window.location.origin))
              }
            >
              Manage billing
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-5 border-t border-hairline pt-4 md:grid-cols-3">
            {usage.map((u) => (
              <div key={u.label} className="flex flex-col gap-2">
                <div className="flex justify-between text-[12.5px]">
                  <span className="text-ink-2">{u.label}</span>
                  <span className="tnum">
                    {u.used} of {u.limit}
                    {/* Shown separately rather than folded into the limit:
                        bought balance does not reset with the month, and a
                        single combined number would hide that. */}
                    {u.extra > 0 && <span className="text-ink-3"> +{u.extra} bought</span>}
                  </span>
                </div>
                <Meter value={u.used} max={u.limit || 1} color={u.color} />
                <span className="text-[11.5px] text-ink-3">{u.note}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Top-ups */}
        {topups.length > 0 && (
          <section aria-labelledby="topup-title" className="flex flex-col gap-3">
            <SectionTitle id="topup-title">Need more this month?</SectionTitle>
            <p className="text-[13px] text-ink-2">
              A one-off top-up adds to your allowance without changing your plan. What
              you buy never expires — it carries over every month until you use it.
            </p>
            <div className="flex flex-wrap gap-2">
              {topups.map((pack) => (
                <Button
                  key={pack.id}
                  variant="secondary"
                  onClick={() =>
                    // A real browser navigation, not a Link. The route answers
                    // with a redirect to Polar, and the client router cannot
                    // follow one off-origin — the same reason the upgrade and
                    // portal buttons below do this. Routed through Link it
                    // simply does nothing, which is exactly how it shipped
                    // once.
                    window.location.assign(
                      new URL(`/api/billing/topup?pack=${pack.id}`, window.location.origin),
                    )
                  }
                >
                  {pack.label} · ${pack.price}
                </Button>
              ))}
            </div>
          </section>
        )}

        {/* Plans */}
        <section aria-labelledby="plans-title" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionTitle id="plans-title">Plans</SectionTitle>
            <Segmented
              value={period}
              onChange={setPeriod}
              options={[
                { value: "monthly", label: "Monthly" },
                { value: "yearly", label: "Yearly · 2 months free" },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {PLAN_ORDER.map((tier) => {
              const spec = PLANS[tier];
              const isCurrent = tier === plan;
              const recommended = tier === "pro" && plan !== "pro";
              const price = yearly ? spec.yearly : spec.monthly;

              return (
                <article
                  key={tier}
                  className={cx(
                    "flex flex-col gap-4 rounded-card border p-[18px]",
                    recommended
                      ? "border-state-bright shadow-[0_0_0_3px_var(--color-state-ring)]"
                      : "border-line",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <h3 className="text-[15px] font-semibold">{spec.name}</h3>
                    {isCurrent && (
                      <span className="rounded-full bg-muted px-[9px] py-[3px] text-[11.5px] font-medium text-ink-2">
                        Current plan
                      </span>
                    )}
                    {recommended && (
                      <span className="rounded-full bg-state-wash px-[9px] py-[3px] text-[11.5px] font-medium text-state">
                        Most picked
                      </span>
                    )}
                  </div>

                  <div className="flex items-baseline gap-1">
                    <span className="tnum text-[30px] font-semibold tracking-[-0.02em]">
                      ${price}
                    </span>
                    <span className="text-[12.5px] text-ink-3">
                      {price === 0
                        ? "forever"
                        : yearly
                          ? "/ mo, billed yearly"
                          : "/ month"}
                    </span>
                  </div>

                  <ul className="flex flex-1 flex-col gap-2">
                    {spec.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-[13px] text-ink-body">
                        <Icon
                          name="check"
                          size={14}
                          strokeWidth={2.2}
                          className="mt-[3px] shrink-0 text-ok"
                        />
                        {f}
                      </li>
                    ))}
                  </ul>

                  <Button
                    variant={
                      isCurrent ? "secondary" : recommended ? "system" : "secondary"
                    }
                    disabled={isCurrent || pending}
                    onClick={() => {
                      // With Polar configured, buying is a trip to checkout and
                      // leaving is a trip to the portal. Neither is a server
                      // action: the plan only moves when the webhook says the
                      // money moved.
                      //
                      // A hard navigation, not `router.push`. Both routes answer
                      // with a redirect to polar.sh, and the client router
                      // cannot follow one off-origin — it has to be the browser
                      // that makes the request. The URL is absolute for the same
                      // reason it has to be a real navigation.
                      if (billing.enabled) {
                        const path =
                          tier === "free"
                            ? "/api/billing/portal"
                            : `/api/billing/checkout?tier=${tier}&period=${period}`;
                        window.location.assign(new URL(path, window.location.origin));
                        return;
                      }
                      start(async () => {
                        setError(null);
                        const res = await changePlan({ plan: tier, period });
                        if (res.ok) {
                          flash(`Moved to the ${res.plan} plan.`);
                          router.refresh();
                        } else {
                          setError(res.error);
                        }
                      });
                    }}
                  >
                    {pending ? <Spinner /> : null}
                    {isCurrent
                      ? "Current plan"
                      : PLAN_ORDER.indexOf(tier) > PLAN_ORDER.indexOf(plan)
                        ? // The trial is only promised when one is actually
                          // configured, and only to a founder who has never
                          // subscribed — Polar gives a trial once, so offering
                          // it again to a returning customer would be a lie the
                          // checkout page then has to correct.
                          billing.enabled && billing.trialDays && !billing.hasCustomer
                          ? `Start ${billing.trialDays}-day free trial`
                          : `Upgrade to ${spec.name}`
                        : billing.enabled && tier === "free"
                          ? "Cancel subscription"
                          : `Downgrade to ${spec.name}`}
                  </Button>
                </article>
              );
            })}
          </div>

          {!billing.enabled ? (
            <Banner tone="state" icon="info">
              No payment provider is connected on this deployment, so changing plans here
              switches the limits without charging anything.
            </Banner>
          ) : billing.status === "past_due" ? (
            <Banner tone="warn" icon="info">
              A payment failed. Your plan stays active while the card is retried — update
              it in the billing portal to avoid losing access.{" "}
              <a className="underline" href="/api/billing/portal">
                Open the portal
              </a>
            </Banner>
          ) : billing.hasCustomer ? (
            <Banner tone="state" icon="info">
              Payments are handled by Polar.{" "}
              {billing.periodEnd
                ? `The current period runs to ${new Date(billing.periodEnd).toLocaleDateString()}. `
                : ""}
              <a className="underline" href="/api/billing/portal">
                Invoices, card and cancellation
              </a>
            </Banner>
          ) : (
            <Banner tone="state" icon="info">
              Payments are handled by Polar. Upgrading opens a checkout; your plan changes
              once the payment clears.
            </Banner>
          )}
        </section>

        {/* Student discount */}
        {billing.enabled && billing.studentDiscount ? (
          <section
            id="student"
            aria-labelledby="student-title"
            className="flex flex-col gap-4 rounded-card border border-line p-[18px]"
          >
            <SectionTitle id="student-title">Student discount</SectionTitle>

            {student.verified ? (
              <Banner tone="ok" icon="check">
                Verified with {student.email}. The discount is applied at checkout — there
                is no code to enter. Confirm again by {longDate(student.expiresAt!)} to keep
                it.
              </Banner>
            ) : student.sent === "auto" ? (
              <Banner tone="state" icon="info">
                Check your inbox. Opening the link applies the discount; it expires in 24
                hours.
              </Banner>
            ) : student.sent === "review" ? (
              <Banner tone="state" icon="info">
                That domain is not one we recognise automatically, which does not mean it
                is not a university. We have sent it for review and will email you.
              </Banner>
            ) : (
              <>
                <p className="text-[13px] text-ink-2">
                  Studying? Verify an email address at your institution and the discount is
                  applied at checkout automatically — there is no code to enter or share.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="email"
                    className="max-w-[320px]"
                    placeholder="you@university.edu"
                    value={studentEmail}
                    onChange={(e) => setStudentEmail(e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    disabled={pending || !studentEmail.trim()}
                    onClick={() =>
                      start(async () => {
                        setError(null);
                        const res = await verifyStudentEmail(studentEmail);
                        if (res.ok) {
                          setStudent({ ...student, sent: res.kind });
                          flash(
                            res.kind === "auto"
                              ? "Verification link sent."
                              : "Sent for review.",
                          );
                        } else {
                          setError(res.error);
                        }
                      })
                    }
                  >
                    {pending ? <Spinner /> : null}
                    Send verification link
                  </Button>
                </div>
                <p className="text-[11.5px] text-ink-3">
                  We only use the address to confirm you are at an institution. Verification
                  lasts a year, then needs confirming again.
                </p>
              </>
            )}
          </section>
        ) : null}

        {/* Workspace */}
        <section
          id="general"
          aria-labelledby="general-title"
          className="flex flex-col gap-4 rounded-card border border-line p-[18px]"
        >
          <SectionTitle id="general-title">Workspace</SectionTitle>
          <label className="flex max-w-[360px] flex-col gap-[6px] text-[13px] font-medium">
            Name
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <Button
            className="self-start"
            disabled={pending || name === workspaceName || !name.trim()}
            onClick={() =>
              start(async () => {
                const res = await renameWorkspace(name);
                if (res.ok) {
                  flash("Workspace renamed.");
                  router.refresh();
                } else setError(res.error);
              })
            }
          >
            Save
          </Button>
        </section>

        {/* Members */}
        <section
          id="members"
          aria-labelledby="members-title"
          className="flex flex-col gap-3 rounded-card border border-line p-[18px]"
        >
          <SectionTitle id="members-title">Members</SectionTitle>
          <div className="flex items-center gap-3 border-b border-hairline pb-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ai-tint text-[10.5px] font-semibold text-ai-deep">
              {founderName
                .split(/\s+/)
                .map((p) => p[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[13.5px] font-medium">{founderName}</span>
              <span className="truncate text-[12px] text-ink-3">{founderEmail}</span>
            </span>
            <span className="rounded-chip bg-muted px-2 py-[2px] text-[11.5px] font-medium text-ink-2">
              Owner
            </span>
          </div>
          <p className="text-[12.5px] text-ink-3">
            {memberCount} member{memberCount === 1 ? "" : "s"}. Seats are not charged —
            invite whoever you build with.
          </p>
        </section>

        {/* Data and privacy */}
        <section
          id="privacy"
          aria-labelledby="privacy-title"
          className="flex flex-col gap-4 rounded-card border border-line p-[18px]"
        >
          <SectionTitle id="privacy-title">Data and privacy</SectionTitle>
          <p className="text-[13px] leading-[1.5] text-ink-2">
            Euclid stores your users&apos; emails and feedback on your behalf, so you are
            the controller and Euclid is the processor. Export or delete one person&apos;s
            data here when they ask.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex max-w-[300px] flex-1 flex-col gap-[6px] text-[13px] font-medium">
              End user email
              <Input
                type="email"
                value={privacyEmail}
                onChange={(e) => setPrivacyEmail(e.target.value)}
                placeholder="someone@example.com"
              />
            </label>
            <Button
              icon="download"
              disabled={pending || !privacyEmail.includes("@")}
              onClick={() =>
                start(async () => {
                  const res = await exportEndUser(privacyEmail);
                  if (res.ok) {
                    const blob = new Blob([res.json], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${privacyEmail}-euclid-export.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                    flash("Export downloaded.");
                  } else setError(res.error);
                })
              }
            >
              Export
            </Button>
            <Button
              variant="danger"
              disabled={pending || !privacyEmail.includes("@")}
              onClick={() =>
                start(async () => {
                  const res = await deleteEndUser(privacyEmail);
                  if (res.ok) {
                    flash(
                      "Deleted. Their posts stay on the board but are no longer attributed.",
                    );
                    setPrivacyEmail("");
                  } else setError(res.error);
                })
              }
            >
              Delete
            </Button>
          </div>
          <p className="text-[11.5px] leading-[1.45] text-ink-3">
            Deleting removes the person&apos;s identity and comment text. Their posts stay
            so the board&apos;s vote counts remain honest.
          </p>
        </section>
      </main>
    </div>
  );
}
