import type { NextRequest } from "next/server";

/**
 * Authorises a job endpoint.
 *
 * These routes drain the email outbox and spend AI credits, so they fail
 * closed: an unset or empty CRON_SECRET refuses the request rather than
 * waving it through. Treating a missing secret as "no auth needed" is how an
 * endpoint ends up publicly callable in production, and the failure is
 * invisible until someone finds it.
 */
export type CronCheck = { ok: true } | { ok: false; status: number; error: string };

export function authorizeCron(request: NextRequest): CronCheck {
  const secret = process.env.CRON_SECRET;

  if (!secret || secret.trim().length < 16) {
    return {
      ok: false,
      status: 503,
      error:
        "CRON_SECRET is not set, so the job endpoints are disabled. Set it to " +
        "a long random string in the environment and in your scheduler.",
    };
  }

  const given = request.headers.get("authorization");
  if (given !== `Bearer ${secret}`) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true };
}
