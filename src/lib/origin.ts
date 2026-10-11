import { headers } from "next/headers";

/**
 * Where this deployment lives. Snippets and the widget loader need an absolute
 * origin, and the founder copies them into another app, so it has to be right.
 */
export async function appOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");

  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host");
  if (!host) return "http://localhost:3000";

  const proto =
    list.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
