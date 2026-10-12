import { NextResponse } from "next/server";
import { requireFounder } from "@/server/context";
import { polar } from "@/server/billing";
import { billingEnabled } from "@/lib/polar";

/**
 * Send the founder to Polar's customer portal.
 *
 * Changing a card, downloading an invoice and cancelling all live there rather
 * than in Euclid. Polar is the merchant of record, so it is the only party that
 * holds the payment details — rebuilding any of that here would mean handling
 * card data we have deliberately never touched.
 *
 * The customer is resolved from the session's workspace, not from a parameter,
 * for the same reason the checkout route does it: a portal session is full
 * access to someone's billing.
 */
export async function GET() {
  if (!billingEnabled()) {
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }

  const ctx = await requireFounder();
  const customerId = ctx.workspace.polar_customer_id;
  if (!customerId) {
    return NextResponse.json(
      { error: "This workspace has never been through checkout." },
      { status: 404 },
    );
  }

  try {
    const session = await polar().customerSessions.create({ customer_id: customerId });
    return NextResponse.redirect(session.customer_portal_url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Polar refused the portal session.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
