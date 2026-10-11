import { redirect } from "next/navigation";
import { destinationFor } from "@/server/auth";

/**
 * The landing step after a client-side sign-in. By the time the browser gets
 * here the session cookies exist, so the server can decide where the founder
 * belongs: the dashboard, or onboarding.
 */
export default async function AuthLandPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  redirect(await destinationFor(next));
}
