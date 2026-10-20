import { cookies } from "next/headers";
import { Shell } from "@/components/shell";
import { requireFounder } from "@/server/context";
import { supabaseServer } from "@/lib/supabase/server";
import {
  INDIE3,
  PROMO_COOKIE,
  availableTopups,
  billingEnabled,
  promoDiscountId,
  studentDiscountId,
  trialDays,
} from "@/lib/polar";
import { studentVerificationActive, studentVerificationExpiry } from "@/lib/student";
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
    Whether to show the launch promotion here.

    Both halves have to be true: the promotion has to be configured on this
    deployment, and this founder has to have arrived through its link — the
    cookie the middleware wrote. It is deliberately not offered to everyone
    who opens this page. The discount is capped at 50 redemptions and exists
    to convert people the launch reached, so showing it to a founder who was
    going to pay list price anyway spends the cap on them.

    The cookie is only a question of what to *render*. The checkout route
    reads it again on its own and re-derives eligibility there, so this
    cannot grant anything.
  */
  const promoOffer =
    Boolean(promoDiscountId()) &&
    (await cookies()).get(PROMO_COOKIE)?.value === INDIE3;

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
        promoOffer={promoOffer}
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
