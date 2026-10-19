"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { requireAdmin } from "@/server/admin";

/**
 * Mark a fault dealt with.
 *
 * It reopens on its own if the same fingerprint occurs again — `record_error`
 * clears `resolved_at` on conflict — which is what makes resolving something
 * optimistically safe. A regression cannot hide behind a tick.
 */
export async function resolveError(fingerprint: string) {
  await requireAdmin();

  const { error } = await supabaseAdmin()
    .from("error_events")
    .update({ resolved_at: new Date().toISOString() })
    .eq("fingerprint", fingerprint);

  revalidatePath("/admin");
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}
