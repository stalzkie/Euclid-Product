import { Shell } from "@/components/shell";
import { requireFounder } from "@/server/context";
import { supabaseServer } from "@/lib/supabase/server";
import { billingEnabled, studentDiscountId, trialDays } from "@/lib/polar";
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

  const { data: members } = await db
    .from("workspace_members")
    .select("user_id,role,name,created_at")
    .eq("workspace_id", ctx.workspace.id);

  return (
    <Shell active="settings" ctx={ctx} wide>
      <BillingView
        workspaceName={ctx.workspace.name}
        plan={ctx.workspace.plan}
        billingPeriod={ctx.workspace.billing_period}
        promptsUsed={ctx.workspace.prompts_used}
        chatCreditsUsed={ctx.workspace.chat_credits_used}
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
          trialDays: trialDays(),
          studentDiscount: Boolean(studentDiscountId()),
        }}
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
