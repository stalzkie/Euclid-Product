import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireFounder } from "@/server/context";
import { polar } from "@/server/billing";
import {
  billingEnabled,
  discountForCheckout,
  productIdFor,
  type BillingPeriod,
  type PaidTier,
} from "@/lib/polar";
import { studentVerificationActive } from "@/lib/student";
import { appOrigin } from "@/lib/origin";

/**
 * Start a Polar checkout for the signed-in founder's workspace.
 *
 * The tier and period come from the query string; the *workspace* never does.
 * It is read from the session, because a route that accepted a workspace id
 * from the caller would let anyone attach their own card to someone else's
 * workspace — or, worse, point their own payment at a workspace they do not
 * own and have the webhook upgrade it.
 */

const Params = z.object({
  tier: z.enum(["indie", "pro"]),
  period: z.enum(["monthly", "yearly"]),
});

export async function GET(request: NextRequest) {
  if (!billingEnabled()) {
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }

  const ctx = await requireFounder();
  const parsed = Params.safeParse({
    tier: request.nextUrl.searchParams.get("tier"),
    period: request.nextUrl.searchParams.get("period"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Pick a plan and a billing period." }, { status: 400 });
  }

  const tier = parsed.data.tier as PaidTier;
  const period = parsed.data.period as BillingPeriod;
  const product = productIdFor(tier, period);
  if (!product) {
    return NextResponse.json({ error: "That plan is not for sale here." }, { status: 503 });
  }

  const base = await appOrigin();
  // Entitlement to the student rate is read from the workspace row, never from
  // the request: the verification link is what grants it, and this is only
  // reading the result.
  const student = studentVerificationActive(ctx.workspace.student_verified_at, new Date());
  const discount = discountForCheckout(student);

  try {
    const checkout = await polar().checkouts.create({
      products: [product],
      // Ties the Polar customer to the workspace for good. On every later
      // checkout Polar recognises the same external id and reuses the customer,
      // so one workspace keeps one billing history.
      external_customer_id: ctx.workspace.id,
      customer_email: ctx.email,
      customer_name: ctx.name,
      // The webhook's most direct route back to the workspace. Belt and braces
      // with `external_customer_id`, because a subscription created any other
      // way still has to be placeable.
      metadata: { workspace_id: ctx.workspace.id },
      success_url: `${base}/billing?upgraded=1`,
      // The launch promotion, when one is running. Spread rather than passed
      // as null: Polar treats an explicit null as "no discount", which is the
      // same outcome, but omitting the key keeps the request honest about what
      // this deployment is actually asking for.
      ...(discount ? { discount_id: discount } : {}),
    });

    return NextResponse.redirect(checkout.url);
  } catch (err) {
    // Polar refuses a checkout for an organisation that has not finished its
    // payment setup, which is the common failure in a fresh account and reads
    // as a mystery 500 unless it is said out loud.
    const message = err instanceof Error ? err.message : "Polar refused the checkout.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
