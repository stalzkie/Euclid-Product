"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireFounder } from "@/server/context";

/**
 * Close the setup checklist.
 *
 * Writes through the founder's own session rather than the service role:
 * `workspaces_write` is `is_member(id)`, so RLS is the authorisation and this
 * needs none of its own. There is nothing here worth a definer — the worst a
 * caller can do with it is hide their own checklist.
 */
export async function dismissSetup() {
  const ctx = await requireFounder();
  const db = await supabaseServer();

  const { error } = await db
    .from("workspaces")
    .update({ setup_dismissed_at: new Date().toISOString() })
    .eq("id", ctx.workspace.id);

  revalidatePath("/");
  return error ? { ok: false as const } : { ok: true as const };
}
