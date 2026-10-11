"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireFounder } from "@/server/context";
import { PLANS } from "@/lib/plans";
import type { PlanTier } from "@/lib/types";

/**
 * Plan changes. There is no payment provider wired up yet, so this writes the
 * tier directly and says so in the UI — the limits it unlocks are real, the
 * charge is not.
 */

const Change = z.object({
  plan: z.enum(["free", "indie", "pro"]),
  period: z.enum(["monthly", "yearly"]),
});

export async function changePlan(input: z.infer<typeof Change>) {
  const parsed = Change.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Pick a plan." };

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
