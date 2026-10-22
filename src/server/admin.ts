import { notFound } from "next/navigation";
import { hasServiceRole } from "@/lib/supabase/server";
import { requireFounder } from "@/server/context";

/**
 * The operator console gate. Not a founder feature — everything behind it
 * reads across every workspace, so it is gated on an explicit allow-list
 * rather than on a role in the database.
 *
 * `ADMIN_EMAILS` and not a column, for two reasons. A column is a thing
 * somebody can be granted by a bug — a bad RLS policy, a careless update —
 * whereas an environment variable can only change by deploying. And the
 * answer to "who can see everything" should be visible in the deployment
 * config, not discoverable by querying.
 *
 * Unset means nobody, including in development. An admin surface that opens
 * itself when unconfigured is the wrong default for the one screen that can
 * read every workspace's data.
 *
 * The panels live in `admin-data.ts` (one read of every table) and
 * `admin-model.ts` (pure derivations over it).
 */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowed = adminEmails();
  return allowed.length > 0 && allowed.includes(email.trim().toLowerCase());
}

/**
 * Require an operator, or pretend the page does not exist.
 *
 * `notFound()` rather than a 403: a signed-in founder who stumbles on /admin
 * learns nothing from a 404, where "forbidden" confirms there is something
 * there worth getting at.
 */
export async function requireAdmin() {
  const ctx = await requireFounder();
  if (!isAdminEmail(ctx.email)) notFound();
  if (!hasServiceRole()) notFound();
  return ctx;
}

/**
 * Re-exported, because the funnel's one testable property belongs to the gate
 * module by history rather than by design: `tests/unit/admin.test.ts` asserts
 * that a step can never exceed the step above it, and the implementation now
 * sits with the rest of the pure derivations.
 */
export { funnelCounts } from "@/server/admin-model";
