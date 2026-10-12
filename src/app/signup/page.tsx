import { redirect } from "next/navigation";
import { isConfigured, supabaseServer } from "@/lib/supabase/server";
import { SignupForm } from "./signup-form";

/** 01 · Sign up. */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; mode?: string; error?: string }>;
}) {
  const params = await searchParams;

  if (!isConfigured()) redirect("/setup");

  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect(params.next ?? "/");

  return (
    <SignupForm
      mode={params.mode === "signin" ? "signin" : "signup"}
      // A sign-in that failed somewhere else — the OAuth provider, or the code
      // exchange — arrives here with its reason in the query. Dropping it is
      // how a failed Google sign-in came to look like a page that simply
      // reloaded itself.
      initialError={params.error ?? null}
    />
  );
}
