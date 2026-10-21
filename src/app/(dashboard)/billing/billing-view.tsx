"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { Banner, Button, Input, Meter, SectionTitle, cx } from "@/components/ui";
import { Segmented, Spinner } from "@/components/controls";
import { useToast } from "@/components/motion";
import { PLANS, PLAN_ORDER } from "@/lib/plans";
import { INDIE3, WAITLIST, type Promo } from "@/lib/polar";
import { longDate } from "@/lib/format";
import type { PlanTier } from "@/lib/types";
import {
  changePlan,
  deleteEndUser,
  exportEndUser,
  referralState,
  renameWorkspace,
  verifyStudentEmail,
  type ReferralState,
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
  bernn,
  promo,
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
    /** Set when the plan will not renew. Polar leaves `status` alone. */
    cancelAtPeriodEnd: boolean;
    /** Length of the Polar trial, or null when no trial is configured. */
    trialDays: number | null;
    /** Whether a student discount is configured on this deployment. */
    studentDiscount: boolean;
  };
  /** The partner promotion's code, when this workspace earned one. */
  bernn: { code: string | null } | null;
  /**
   * The promotion to offer, or null. Resolved on the server: configured,
   * arrived-through, and — for the waitlist month — owed to this address.
   */
  promo: Promo | null;
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

  // Loaded on demand, because asking for it mints a code. A founder who never
  // opens this section never gets a row.
  const [referral, setReferral] = useState<ReferralState | null>(null);
  const [referralPending, startReferral] = useTransition();

  const current = PLANS[plan];
  const yearly = period === "yearly";

  /*
    When to show the promotion on this page.

    Only to a workspace on Free: the discount allows one redemption per
    customer, so dangling it in front of someone who already subscribed
    promises something Polar would refuse at checkout.

    And only while the toggle is on Monthly, because that is the only thing
    the promotion covers. Switching to Yearly takes the offer off the Indie
    card rather than letting it look as though it carries over —
    `promoEligible` refuses it there on the server, and an offer the checkout
    then contradicts is worse than no offer.
  */
  const promoLive = promo !== null && plan === "free";
  const promoOn = (tier: PlanTier) => promoLive && tier === "indie" && !yearly;

  const flash = (message: string) => {
    toast(message);
  };

  /*
    Two different dates used to be one.

    `periodStart + 1 month` is when the *allowance* resets, which is what the
    usage meters below are counting towards. It is not when money moves, and
    labelling it "renews" said so: on a trial started on the 15th the header
    read "renews November 1" while the banner under it correctly said the
    period ran to October 22.

    `billing.periodEnd` is Polar's `current_period_end` — the date a charge
    actually falls, or a cancelled plan actually ends. Use it whenever there is
    a subscription; fall back to the allowance reset only when there is none,
    where it is the only date there is.
  */
  const allowanceReset = new Date(periodStart);
  allowanceReset.setMonth(allowanceReset.getMonth() + 1);
  const billingDate = billing.periodEnd ? new Date(billing.periodEnd) : allowanceReset;

  // A cancelled plan keeps its tier to the end of the period and then drops.
  const cancelled = billing.cancelAtPeriodEnd;

  // A trial does not renew, it converts — and Polar's trial checkout takes no
  // card, so the first charge is also the first time one is asked for. Saying
  // "renews" here was the same mistake in a smaller way: it describes a
  // payment continuing when none has ever been taken.
  const trialing = billing.status === "trialing";

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
      note: `Resets ${longDate(allowanceReset.toISOString())}`,
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
                {cancelled ? (
                  <span className="rounded-full bg-muted px-[9px] py-[3px] text-[11.5px] font-medium text-ink-2">
                    Cancelled
                  </span>
                ) : trialing ? (
                  <span className="rounded-full bg-state-wash px-[9px] py-[3px] text-[11.5px] font-medium text-state">
                    Trial
                  </span>
                ) : (
                  <span className="rounded-full bg-ok-wash px-[9px] py-[3px] text-[11.5px] font-medium text-ok">
                    Active
                  </span>
                )}
              </h2>
              <span className="text-[13px] text-ink-2">
                {current.monthly === 0
                  ? "Free forever"
                  : cancelled
                    ? `Ends ${longDate(billingDate.toISOString())} · you keep ${
                        current.name
                      } until then`
                    : trialing
                      ? `Trial ends ${longDate(billingDate.toISOString())} · $${
                          billingPeriod === "yearly" ? current.yearly : current.monthly
                        } a month after that`
                      : `$${
                          billingPeriod === "yearly" ? current.yearly : current.monthly
                        } a month · renews ${longDate(billingDate.toISOString())}`}
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

          {promoLive && promo === INDIE3 && (
            <Banner tone="ai" icon="sparkle">
              <strong className="font-semibold">Launch offer.</strong> Indie monthly is
              $9 a month for your first four — four months for the price of three — and
              you get a month of Bernn Pro free once your first payment clears. Applied
              at checkout, nothing to type.
            </Banner>
          )}

          {/*
            The waitlist month. Said as what it is rather than as a discount
            percentage, and the renewal is in the same sentence: the e-mail
            that sends people here promises "$0 now, $12 after", and a page
            that quietly dropped the second half would be the version nobody
            trusts.
          */}
          {promoLive && promo === WAITLIST && (
            <Banner tone="ai" icon="sparkle">
              <strong className="font-semibold">Your waitlist month.</strong> Your first
              month of Indie monthly is on us, applied at checkout with nothing to type.
              It renews at $12 a month after that, and you can cancel any time before it
              does.
            </Banner>
          )}

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

                  {promoOn(tier) && (
                    <p className="text-[12.5px] font-medium text-state">
                      {promo === WAITLIST
                        ? "$0 for your first month, then $12"
                        : "$9 / month for your first four months"}
                    </p>
                  )}

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
                        // The promotion rides on the URL as well as in the
                        // cookie the checkout route reads. Belt and braces, the
                        // same way the Polar customer is tied to the workspace
                        // by both `external_customer_id` and metadata: this way
                        // the request says what it is asking for rather than
                        // depending on an invisible cookie to mean it.
                        const path =
                          tier === "free"
                            ? "/api/billing/portal"
                            : `/api/billing/checkout?tier=${tier}&period=${period}` +
                              (promoOn(tier) ? `&promo=${promo}` : "");
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
                          ? // Already cancelled: the same portal has an
                            // Uncancel button, so offering "Cancel" again is
                            // both wrong and the thing that made a cancelled
                            // plan look untouched.
                            cancelled
                            ? "Resume subscription"
                            : "Cancel subscription"
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

        {/*
          The partner half of the 4-for-3 promotion.

          Shown only to workspaces that earned one, since it is not an offer
          anyone can take from here — the Euclid half is a discount applied at
          checkout, and by the time this renders it has already been paid for.
        */}
        {bernn && (
          <section
            aria-labelledby="bernn-title"
            className="flex flex-col gap-3 rounded-card border border-line bg-canvas p-5"
          >
            <SectionTitle id="bernn-title">Your free month of Bernn</SectionTitle>
            {bernn.code ? (
              <>
                <p className="text-[13px] leading-[1.5] text-ink-2">
                  Part of the 4-for-3 offer. Open Bernn, go to Settings — or tap
                  “Have a code?” on the paywall — and enter this. It works once.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="flex-1 truncate rounded-control border border-line bg-subtle px-3 py-2 font-mono text-[13px] text-ink">
                    {bernn.code}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(bernn.code ?? "");
                      toast("Code copied");
                    }}
                    className="flex h-9 items-center gap-[6px] rounded-control border border-line-strong px-3 text-[12.5px] font-medium text-ink hover:bg-subtle"
                  >
                    <Icon name="copy" size={13} strokeWidth={1.9} />
                    Copy
                  </button>
                </div>
                <p className="text-[12px] text-ink-3">
                  Already on Bernn Pro? Trying it does not spend it — keep it for whenever
                  your subscription lapses.
                </p>
              </>
            ) : (
              <p className="text-[13px] leading-[1.5] text-ink-2">
                Your code is on its way — we ran out at the moment you bought, which is
                our fault rather than yours. It will appear here and by email shortly,
                with nothing for you to do.
              </p>
            )}
          </section>
        )}

        {/* Referrals */}
        <section
          id="referrals"
          aria-labelledby="referrals-title"
          className="flex flex-col gap-4 rounded-card border border-line p-[18px]"
        >
          <SectionTitle id="referrals-title">Refer another founder</SectionTitle>

          {referral ? (
            <>
              <p className="text-[13.5px] text-ink-body">
                Anyone who signs up through your link and pays earns you{" "}
                <strong className="font-semibold">4 Build Prompts per dollar</strong> they
                spend — every month they stay, not just the first.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <code className="flex-1 min-w-[240px] truncate rounded-control border border-line bg-subtle px-3 py-2 text-[12.5px]">
                  {referral.link}
                </code>
                <Button
                  icon="copy"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(referral.link)
                      .then(() => flash("Link copied."))
                      .catch(() => setError("Could not copy the link."));
                  }}
                >
                  Copy
                </Button>
              </div>

              <div className="flex flex-wrap gap-6 text-[13px]">
                <span className="flex flex-col">
                  <strong className="text-[18px] font-semibold tnum">
                    {referral.signups}
                  </strong>
                  <span className="text-ink-3">
                    {referral.signups === 1 ? "signup" : "signups"}
                  </span>
                </span>
                <span className="flex flex-col">
                  <strong className="text-[18px] font-semibold tnum">
                    {referral.earned}
                  </strong>
                  <span className="text-ink-3">Build Prompts earned</span>
                </span>
              </div>

              <p className="text-[12px] text-ink-3">
                Earned prompts land in your balance and never expire. A refunded order
                takes its prompts back, floored at zero.
              </p>
            </>
          ) : (
            <>
              <p className="text-[13.5px] text-ink-body">
                Know someone building something? Get a link, and earn Build Prompts when
                they pay.
              </p>
              <span>
                <Button
                  disabled={referralPending}
                  onClick={() =>
                    startReferral(async () => {
                      const res = await referralState();
                      if (res.ok) setReferral(res.state);
                      else setError(res.error);
                    })
                  }
                >
                  {referralPending ? <Spinner /> : null}
                  Get my link
                </Button>
              </span>
            </>
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
