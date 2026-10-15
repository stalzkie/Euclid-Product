"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireFounder } from "@/server/context";
import { PLANS } from "@/lib/plans";
import { billingEnabled } from "@/lib/polar";
import { requestStudentVerification } from "@/server/student";
import { appOrigin } from "@/lib/origin";
import { drainAfterResponse } from "@/server/dispatch";
import { referralLink } from "@/lib/referrals";
import type { PlanTier } from "@/lib/types";

/**
 * Plan changes.
 *
 * With Polar configured this is **not** the way a plan moves: a paid tier is
 * bought at `/api/billing/checkout` and granted by the webhook, and a
 * cancellation happens in Polar's customer portal. This action refuses outright
 * in that case, so there is no second path that can put a workspace on Pro
 * without a subscription behind it.
 *
 * It stays functional when billing is unconfigured, which is how local
 * development and the test suite exercise the paid tiers without a card.
 */

const Change = z.object({
  plan: z.enum(["free", "indie", "pro"]),
  period: z.enum(["monthly", "yearly"]),
});

export async function changePlan(input: z.infer<typeof Change>) {
  const parsed = Change.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Pick a plan." };

  if (billingEnabled()) {
    return {
      ok: false as const,
      error: "Plans are managed through checkout. Use the upgrade button or the billing portal.",
    };
  }

  const ctx = await requireFounder();
  const db = await supabaseServer();
  const next = PLANS[parsed.data.plan as PlanTier];

  // Downgrading below the board allowance would leave boards orphaned, so it
  // is blocked until the founder deletes some.
  if (next.boards !== null && ctx.boards.length > next.boards) {
    return {
      ok: false as const,
      error: `The ${next.name} plan includes ${next.boards} board${
        next.boards === 1 ? "" : "s"
      }. Delete ${ctx.boards.length - next.boards} first.`,
    };
  }

  const { error } = await db
    .from("workspaces")
    .update({ plan: parsed.data.plan, billing_period: parsed.data.period })
    .eq("id", ctx.workspace.id);

  // The free tier always carries the badge.
  if (!error && next.badge) {
    await db
      .from("boards")
      .update({ show_badge: true })
      .eq("workspace_id", ctx.workspace.id);
  }

  revalidatePath("/billing");
  revalidatePath("/", "layout");
  return error
    ? { ok: false as const, error: error.message }
    : { ok: true as const, plan: next.name };
}

export async function renameWorkspace(name: string) {
  const ctx = await requireFounder();
  const db = await supabaseServer();
  const { error } = await db
    .from("workspaces")
    .update({ name: name.slice(0, 60) })
    .eq("id", ctx.workspace.id);
  revalidatePath("/", "layout");
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

/**
 * Data export for one end user, by email. The PRD's privacy requirements make
 * this an endpoint the founder can run on a request from their own user.
 */
export async function exportEndUser(email: string) {
  const ctx = await requireFounder();
  const db = await supabaseServer();
  const { data, error } = await db.rpc("export_end_user", {
    p_board: ctx.board.id,
    p_email: email.trim().toLowerCase(),
  });
  return error
    ? { ok: false as const, error: error.message }
    : { ok: true as const, json: JSON.stringify(data, null, 2) };
}

export async function deleteEndUser(email: string) {
  const ctx = await requireFounder();
  const db = await supabaseServer();
  const { error } = await db.rpc("delete_end_user", {
    p_board: ctx.board.id,
    p_email: email.trim().toLowerCase(),
  });
  revalidatePath("/feedback");
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

/**
 * Start student verification for the signed-in founder's workspace.
 *
 * The address is not trusted and not stored here — it is only somewhere to send
 * a link. Nothing about the plan changes until that link comes back.
 */
export async function verifyStudentEmail(email: string) {
  const ctx = await requireFounder();
  const origin = await appOrigin();
  const result = await requestStudentVerification(ctx.workspace.id, email, origin);
  if (!result.ok) return { ok: false as const, error: result.error };

  // The link is in the outbox; send it as soon as this response is out.
  // Without this the row waits for the daily cron while the link it carries
  // expires in 24 hours, so a verification sent in the afternoon could arrive
  // already dead — or, for the review variant, land after the student has
  // given up. Same reasoning as the magic-link route, which has always done
  // this; this path was simply missed.
  drainAfterResponse({ deliveries: false });

  revalidatePath("/billing");
  return { ok: true as const, kind: result.kind };
}

/* --------------------------------------------------------------------------
 * Referrals
 * ------------------------------------------------------------------------ */

export interface ReferralState {
  code: string;
  link: string;
  /** Workspaces that signed up through the code. */
  signups: number;
  /** Build Prompts earned, net of anything a refund took back. */
  earned: number;
}

/**
 * The workspace's referral code, minting one on first use.
 *
 * A separate action rather than part of the page load, because minting writes
 * and a page render should not: a founder who never opens the referral
 * section never gets a row, and the table stays a list of people who actually
 * asked.
 */
export async function referralState(): Promise<
  { ok: true; state: ReferralState } | { ok: false; error: string }
> {
  const ctx = await requireFounder();
  const db = await supabaseServer();

  const { data: code, error } = await db.rpc("ensure_referral_code", {
    p_workspace: ctx.workspace.id,
    // The slug is already lower-case, unique-ish and recognisably theirs,
    // which is a better starting point than a random string somebody has to
    // read out loud.
    p_base: ctx.workspace.slug,
  });

  if (error || typeof code !== "string") {
    return { ok: false as const, error: error?.message ?? "Could not create a code." };
  }

  const [{ count: signups }, { data: rows }] = await Promise.all([
    db
      .from("workspaces")
      .select("id", { count: "exact", head: true })
      .eq("referred_by", code),
    db
      .from("referral_commissions")
      .select("quantity,reversed_at")
      .eq("referrer_id", ctx.workspace.id),
  ]);

  // Reversed rows are kept in the ledger and excluded from the total, so the
  // number shown is what the founder actually has rather than what they were
  // once promised.
  const earned = (rows ?? [])
    .filter((row) => !row.reversed_at)
    .reduce((sum, row) => sum + (row.quantity as number), 0);

  return {
    ok: true as const,
    state: {
      code,
      link: referralLink(await appOrigin(), code),
      signups: signups ?? 0,
      earned,
    },
  };
}
