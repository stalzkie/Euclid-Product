import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireFounder } from "@/server/context";
import { polar } from "@/server/billing";
import {
  INDIE3,
  billingEnabled,
  discountForCheckout,
  productIdFor,
  promoEligible,
  type BillingPeriod,
  type PaidTier,
} from "@/lib/polar";
import { studentVerificationActive } from "@/lib/student";
import { appOrigin } from "@/lib/origin";
import { RATE_LIMITED, withinLimit } from "@/server/limits";

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
  /*
    The promotion, when the founder arrived through its link.

    A flag rather than a code typed at Polar's checkout page, matching the
    student and launch discounts: this deployment applies discounts by id, so
    nothing is typed in and nothing can be shared further than the link. The
    cap on what it can cost is `max_redemptions` on the Polar discount, not
    this parameter — anyone can put ?promo=indie3 in the URL, and that is the
    same thing as having the link.
  */
  promo: z.literal(INDIE3).nullish(),
});

export async function GET(request: NextRequest) {
  if (!billingEnabled()) {
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }

  const ctx = await requireFounder();

  // Each of these is a Polar API call on our organisation token. The ceiling
  // is shared across the billing routes because they share that resource.
  if (!(await withinLimit(ctx.workspace.id, "billing", ctx.userId))) {
    return NextResponse.json({ error: RATE_LIMITED }, { status: 429 });
  }
  const parsed = Params.safeParse({
    tier: request.nextUrl.searchParams.get("tier"),
    period: request.nextUrl.searchParams.get("period"),
    promo: request.nextUrl.searchParams.get("promo"),
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

  // Eligibility is re-checked here and not trusted from the query string: the
  // link only says what the founder asked for, and `promoEligible` decides
  // whether this plan and period may actually have it.
  const promo = parsed.data.promo === INDIE3 && promoEligible(tier, period);
  const discount = discountForCheckout(student, promo);

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
      /*
        `promo` rides along so the webhook can tell a promotional order from an
        ordinary one without reading the discount back off it. Metadata is
        already the mechanism the referral attribution leans on, and
        0020_referrals.sql records that it survives checkout -> order ->
        subscription on this organisation's own live payloads.

        Only set when the promotion actually applied, so the Bernn grant
        cannot be triggered by asking for it.
      */
      metadata: promo
        ? { workspace_id: ctx.workspace.id, promo: INDIE3 }
        : { workspace_id: ctx.workspace.id },
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
