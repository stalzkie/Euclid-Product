"use server";

import { revalidatePath } from "next/cache";
import { requireFounder } from "@/server/context";
import { supabaseAdmin } from "@/lib/supabase/server";
import { PLANS } from "@/lib/plans";
import { normaliseDomain, verificationRecord } from "@/lib/domains";
import { checkDomainToken, newVerificationToken } from "@/server/domains";

export interface DomainState {
  domain: string | null;
  verified: boolean;
  record: { name: string; value: string } | null;
  /** Where the founder points the CNAME. */
  target: string;
}

type Result =
  | { ok: true; message: string; state: DomainState }
  | { ok: false; error: string };

function stateFrom(
  domain: string | null,
  token: string | null,
  verifiedAt: string | null,
  target: string,
): DomainState {
  return {
    domain,
    verified: Boolean(verifiedAt),
    record: token ? verificationRecord(token) : null,
    target,
  };
}

function cnameTarget(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) return "your-deployment-host";
  try {
    return new URL(configured).hostname;
  } catch {
    return "your-deployment-host";
  }
}

/** Claim a domain. Claiming is not owning: nothing is served until verified. */
export async function setCustomDomain(raw: string): Promise<Result> {
  const ctx = await requireFounder();
  const plan = PLANS[ctx.workspace.plan];
  if (!plan.customDomain) {
    return { ok: false, error: `Custom domains are on the Pro plan — you are on ${plan.name}.` };
  }

  const checked = normaliseDomain(raw);
  if (!checked.ok) return { ok: false, error: checked.error };

  const token = newVerificationToken();
  const { error } = await supabaseAdmin()
    .from("boards")
    .update({
      custom_domain: checked.host,
      custom_domain_token: token,
      // A changed domain is an unverified domain.
      custom_domain_verified_at: null,
    })
    .eq("id", ctx.board.id);

  if (error) {
    // The unique index is the authority on who holds a hostname.
    if (error.code === "23505") {
      return { ok: false, error: "Another board already uses that domain." };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/install");
  return {
    ok: true,
    message: "Saved. Add the two records below, then verify.",
    state: stateFrom(checked.host, token, null, cnameTarget()),
  };
}

export async function verifyCustomDomain(): Promise<Result> {
  const ctx = await requireFounder();

  const db = supabaseAdmin();
  const { data: board } = await db
    .from("boards")
    .select("custom_domain,custom_domain_token,custom_domain_verified_at")
    .eq("id", ctx.board.id)
    .maybeSingle();

  if (!board?.custom_domain || !board.custom_domain_token) {
    return { ok: false, error: "Save a domain first." };
  }

  const outcome = await checkDomainToken(board.custom_domain, board.custom_domain_token);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  const now = new Date().toISOString();
  await db.from("boards").update({ custom_domain_verified_at: now }).eq("id", ctx.board.id);

  revalidatePath("/install");
  return {
    ok: true,
    message: `${board.custom_domain} is verified and now serving this board.`,
    state: stateFrom(board.custom_domain, board.custom_domain_token, now, cnameTarget()),
  };
}

export async function removeCustomDomain(): Promise<Result> {
  const ctx = await requireFounder();

  await supabaseAdmin()
    .from("boards")
    .update({
      custom_domain: null,
      custom_domain_token: null,
      custom_domain_verified_at: null,
    })
    .eq("id", ctx.board.id);

  revalidatePath("/install");
  return {
    ok: true,
    message: "Removed.",
    state: stateFrom(null, null, null, cnameTarget()),
  };
}
