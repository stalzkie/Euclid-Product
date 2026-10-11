import { redirect } from "next/navigation";
import { isConfigured, supabaseServer } from "@/lib/supabase/server";
import { ProfileStepForm } from "./profile-form";
import type { StackItem } from "@/lib/types";

/** 03 · Onboarding — project profile. */
export default async function OnboardingProfilePage() {
  if (!isConfigured()) redirect("/setup");

  const db = await supabaseServer();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) redirect("/signup");

  const { data: membership } = await db
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", auth.user.id)
    .limit(1)
    .maybeSingle();
  if (!membership) redirect("/onboarding/app");

  const { data: profile } = await db
    .from("project_profiles")
    .select("stack, conventions, rules_file, rules_file_name")
    .eq("workspace_id", membership.workspace_id)
    .maybeSingle();

  return (
    <ProfileStepForm
      initialStack={(profile?.stack as StackItem[] | null) ?? []}
      initialConventions={profile?.conventions ?? ""}
      initialRules={profile?.rules_file ?? null}
      initialRulesName={profile?.rules_file_name ?? "CLAUDE.md"}
    />
  );
}
