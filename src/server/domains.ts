import { resolveTxt } from "node:dns/promises";
import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { tokenMatches, VERIFY_PREFIX } from "@/lib/domains";

/**
 * Proving a board owns a domain.
 *
 * The check is a TXT record at _euclid.<domain>, because only whoever
 * controls the domain's DNS can publish one. A CNAME alone would not do:
 * anyone can point a name at us, and we would then answer for a hostname
 * that is not theirs.
 */

export function newVerificationToken(): string {
  return randomBytes(16).toString("hex");
}

export type VerifyOutcome =
  | { ok: true }
  | { ok: false; error: string; found?: string[] };

export async function checkDomainToken(host: string, token: string): Promise<VerifyOutcome> {
  const name = `${VERIFY_PREFIX}.${host}`;

  try {
    const records = await resolveTxt(name);
    if (tokenMatches(records, token)) return { ok: true };

    return {
      ok: false,
      error: `${name} exists but does not carry this board's token yet. DNS changes can take a few minutes to spread.`,
      found: records.map((chunks) => chunks.join("")),
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return { ok: false, error: `No TXT record found at ${name}.` };
    }
    return { ok: false, error: `Could not look up ${name}: ${code ?? "unknown error"}.` };
  }
}

/**
 * Which board, if any, has proved it owns this hostname. Returns null for
 * everything else, so an unclaimed host gets a 404 rather than somebody's
 * board.
 */
export async function boardForDomain(host: string): Promise<string | null> {
  const bare = host.split(":")[0].toLowerCase();
  if (!bare) return null;

  const { data } = await supabaseAdmin().rpc("board_for_domain", { p_host: bare });
  const rows = (data ?? []) as { public_id: string }[];
  return rows[0]?.public_id ?? null;
}
