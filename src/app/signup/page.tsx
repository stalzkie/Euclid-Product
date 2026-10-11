import { redirect } from "next/navigation";
import { isConfigured, supabaseServer } from "@/lib/supabase/server";
import { SignupForm } from "./signup-form";

/** 01 · Sign up. */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; mode?: string }>;
}) {
  const params = await searchParams;

  if (!isConfigured()) redirect("/setup");

  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect(params.next ?? "/");

  return <SignupForm mode={params.mode === "signin" ? "signin" : "signup"} />;
}
