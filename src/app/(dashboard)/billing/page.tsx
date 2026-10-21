import { cookies } from "next/headers";
import { Shell } from "@/components/shell";
import { requireFounder } from "@/server/context";
import { supabaseServer } from "@/lib/supabase/server";
import {
  PROMO_COOKIE,
  availableTopups,
  billingEnabled,
  normalisePromo,
  promoDiscountId,
  promoRequiresWaitlist,
  studentDiscountId,
  trialDays,
} from "@/lib/polar";
import { studentVerificationActive, studentVerificationExpiry } from "@/lib/student";
import { onWaitlist } from "@/server/waitlist";
import { BillingView } from "./billing-view";

/** 14 · Plan and credits, plus the workspace settings nav around it. */
export default async function BillingPage() {
  const ctx = await requireFounder();
  const db = await supabaseServer();

  // Evaluated once here rather than in the view, so the server decides whether
  // the discount is live and the client only renders the answer.
  const studentVerified = studentVerificationActive(
    ctx.workspace.student_verified_at,
    new Date(),
  );

  /*
    Which promotion, if any, to show on this page.

    Every half has to be true: a promotion has to be named by the cookie the
    middleware wrote when this founder arrived through its link, it has to be
    configured on this deployment, and — for the waitlist month — the signed-in
    address has to actually be on the waitlist. It is deliberately not offered
    to everyone who opens this page: the discounts are capped, and showing one
    to a founder who was going to pay list price anyway spends the cap on them.

    This is only a question of what to *render*. The checkout route reads the
    cookie again and re-derives all of it, including the waitlist lookup, so
    nothing here can grant anything.

    The waitlist check is the one piece that costs a query, and it is the
    reason this is resolved here rather than in the view: a client component
    cannot ask the database whether the person reading it is owed a free
    month.
  */
  const cookiePromo = normalisePromo((await cookies()).get(PROMO_COOKIE)?.value);
  const promo =
    cookiePromo &&
    Boolean(promoDiscountId(cookiePromo)) &&
    (!promoRequiresWaitlist(cookiePromo) || (await onWaitlist(ctx.email)))
      ? cookiePromo
      : null;

  const { data: members } = await db
    .from("workspace_members")
    .select("user_id,role,name,created_at")
    .eq("workspace_id", ctx.workspace.id);

  /*
    The Bernn code from the 4-for-3 promotion, if this workspace earned one.

    Read through the session, which RLS allows via `partner_grants_member_read`
    — unlike `partner_codes`, which has no policy at all because unclaimed
    codes are inventory rather than anybody's property.

    A row with a null `code` means the pool was empty when they qualified and
    they are owed one; the view says so rather than showing nothing, because
    the alternative is a founder who paid for a promotion and sees no sign of
    half of it.
  */
  const { data: partner } = await db
    .from("partner_grants")
    .select("code")
    .eq("workspace_id", ctx.workspace.id)
    .eq("partner", "bernn")
    .maybeSingle();

  return (
    <Shell active="settings" ctx={ctx} wide>
      <BillingView
        workspaceName={ctx.workspace.name}
        plan={ctx.workspace.plan}
        billingPeriod={ctx.workspace.billing_period}
        promptsUsed={ctx.workspace.prompts_used}
        chatCreditsUsed={ctx.workspace.chat_credits_used}
        extraPrompts={ctx.workspace.extra_prompts ?? 0}
        extraChatCredits={ctx.workspace.extra_chat_credits ?? 0}
        // Free has nothing to top up — the answer there is to upgrade, not to
        // buy an allowance onto a plan that has none.
        topups={
          ctx.workspace.plan === "free" ? [] : availableTopups(ctx.workspace.plan)
        }
        boardCount={ctx.boards.length}
        periodStart={ctx.workspace.usage_period_start}
        memberCount={members?.length ?? 1}
        founderEmail={ctx.email}
        founderName={ctx.name}
        billing={{
          enabled: billingEnabled(),
          hasCustomer: Boolean(ctx.workspace.polar_customer_id),
          status: ctx.workspace.subscription_status,
          periodEnd: ctx.workspace.current_period_end,
          cancelAtPeriodEnd: ctx.workspace.cancel_at_period_end ?? false,
          trialDays: trialDays(),
          studentDiscount: Boolean(studentDiscountId()),
        }}
        bernn={partner ? { code: partner.code as string | null } : null}
        promo={promo}
        studentState={{
          verified: studentVerified,
          email: ctx.workspace.student_email,
          expiresAt:
            studentVerified && ctx.workspace.student_verified_at
              ? studentVerificationExpiry(ctx.workspace.student_verified_at).toISOString()
              : null,
        }}
      />
    </Shell>
  );
}
