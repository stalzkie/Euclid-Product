import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireFounder } from "@/server/context";
import { polar } from "@/server/billing";
import { billingEnabled, topupById, topupProductId } from "@/lib/polar";
import { PLANS } from "@/lib/plans";
import { appOrigin } from "@/lib/origin";
import { RATE_LIMITED, withinLimit } from "@/server/limits";

/**
 * Buy a top-up pack: a one-time order that extends an allowance without
 * touching the plan.
 *
 * Same shape as `/api/billing/checkout` and the same rule about trust: the
 * pack comes from the query string, the *workspace* never does. It is read
 * from the session, because a route that took a workspace id from the caller
 * would let anyone buy credit onto someone else's workspace — or, worse, point
 * their own payment at a workspace they do not own.
 *
 * Nothing here grants anything. The grant happens when Polar reports the order
 * paid, through the webhook, exactly as the plan does. A route that credited
 * the workspace on redirect would credit an abandoned checkout.
 */

const Params = z.object({ pack: z.string().min(1).max(40) });

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
  const parsed = Params.safeParse({ pack: request.nextUrl.searchParams.get("pack") });
  if (!parsed.success) {
    return NextResponse.json({ error: "Pick a top-up pack." }, { status: 400 });
  }

  const pack = topupById(parsed.data.pack);
  if (!pack) {
    return NextResponse.json({ error: "No such top-up." }, { status: 404 });
  }

  const plan = ctx.workspace.plan;
  if (plan === "free") {
    return NextResponse.json(
      { error: "Top-ups are for paid plans. Upgrade first." },
      { status: 403 },
    );
  }

  // Checked on the server as well as hidden in the UI. Chat credits on a tier
  // whose `chatAssistant` is false would be unspendable, and selling someone
  // something they cannot use is worse than refusing the sale.
  if (!pack.tiers.includes(plan)) {
    return NextResponse.json(
      {
        error:
          pack.kind === "credits"
            ? `Ask Euclid is a ${PLANS.pro.name} feature, so chat credits are too. Upgrade to buy them.`
            : "That top-up is not available on your plan.",
      },
      { status: 403 },
    );
  }

  const product = topupProductId(pack);
  if (!product) {
    return NextResponse.json({ error: "That top-up is not for sale here." }, { status: 503 });
  }

  const base = await appOrigin();

  try {
    const checkout = await polar().checkouts.create({
      products: [product],
      // The same customer the subscription uses, so a founder has one billing
      // history rather than one per purchase.
      external_customer_id: ctx.workspace.id,
      customer_email: ctx.email,
      customer_name: ctx.name,
      // How the webhook finds the workspace for an order that may be the
      // first thing this customer has ever bought.
      metadata: { workspace_id: ctx.workspace.id, topup: pack.id },
      success_url: `${base}/billing?topped_up=${pack.id}`,
    });

    return NextResponse.redirect(checkout.url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Polar refused the checkout.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
