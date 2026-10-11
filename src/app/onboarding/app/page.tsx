import { redirect } from "next/navigation";
import { isConfigured, supabaseServer } from "@/lib/supabase/server";
import { AppStepForm } from "./app-form";

/** 02 · Onboarding — your app. */
export default async function OnboardingAppPage() {
  if (!isConfigured()) redirect("/setup");

  const db = await supabaseServer();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) redirect("/signup");

  // Coming back to this step pre-fills what is already saved.
  const { data: membership } = await db
    .from("workspace_members")
    .select("workspaces(app_name, app_url, coding_tools)")
    .eq("user_id", auth.user.id)
    .limit(1)
    .maybeSingle();

  const ws = Array.isArray(membership?.workspaces)
    ? membership?.workspaces[0]
    : (membership?.workspaces as
        | { app_name: string | null; app_url: string | null; coding_tools: string[] }
        | null
        | undefined);

  return (
    <AppStepForm
      initialName={ws?.app_name ?? ""}
      initialUrl={(ws?.app_url ?? "").replace(/^https?:\/\//, "")}
      initialTools={ws?.coding_tools ?? ["Claude Code", "Cursor"]}
    />
  );
}
