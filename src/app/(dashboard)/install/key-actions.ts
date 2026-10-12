"use server";

import { revalidatePath } from "next/cache";
import { founderBoard, requireFounder } from "@/server/context";
import { supabaseAdmin } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";
import { newApiKey } from "@/server/mcp";

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export async function listApiKeys(boardId: string): Promise<ApiKeySummary[]> {
  // Reads below run as the service role, which RLS does not constrain, so the
  // board has to be shown to be the caller's before anything is read.
  if (!(await founderBoard(boardId))) return [];

  const { data } = await supabaseAdmin()
    .from("api_keys")
    .select("id,name,token_prefix,created_at,last_used_at")
    .eq("board_id", boardId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    prefix: row.token_prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }));
}

/**
 * Issue a key. The token is returned exactly once — only its hash is
 * stored, so there is no later route by which anyone, us included, can
 * recover it.
 */
export async function createApiKey(
  name: string,
): Promise<{ ok: true; token: string; key: ApiKeySummary } | { ok: false; error: string }> {
  const ctx = await requireFounder();
  const label = name.trim().slice(0, 60) || "Coding agent";

  const { token, hash, prefix } = newApiKey();

  const { data, error } = await supabaseAdmin()
    .from("api_keys")
    .insert({ board_id: ctx.board.id, name: label, token_hash: hash, token_prefix: prefix })
    .select("id,name,token_prefix,created_at,last_used_at")
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? "Could not create the key." };

  revalidatePath("/install");
  return {
    ok: true,
    token,
    key: {
      id: data.id,
      name: data.name,
      prefix: data.token_prefix,
      createdAt: data.created_at,
      lastUsedAt: data.last_used_at,
    },
  };
}

export async function revokeApiKey(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!uuid().safeParse(id).success) return { ok: false, error: "Unknown key." };

  const ctx = await requireFounder();

  const { error } = await supabaseAdmin()
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    // Scoped to this board, so an id from elsewhere matches nothing.
    .eq("id", id)
    .eq("board_id", ctx.board.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/install");
  return { ok: true };
}
