import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const URL = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/**
 * True once the three Supabase env vars are present. Every page checks this so
 * the app renders a readable setup notice instead of crashing before the
 * envs are wired up.
 */
export function isConfigured(): boolean {
  return Boolean(URL() && ANON());
}

export function hasServiceRole(): boolean {
  return Boolean(URL() && SERVICE());
}

/**
 * Request-scoped client carrying the founder's session. RLS applies, so this
 * can only ever see the caller's own workspaces.
 */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(URL(), ANON(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) {
            store.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render, where cookies are readonly.
          // Session refresh happens in middleware instead.
        }
      },
    },
  });
}

/**
 * Service-role client. Used only by the public widget API and background jobs,
 * which authorise per board themselves — never import this into a route that
 * serves founder data without an explicit workspace check.
 */
export function supabaseAdmin() {
  return createClient(URL(), SERVICE(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
