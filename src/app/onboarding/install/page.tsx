import { redirect } from "next/navigation";
import { isConfigured, supabaseServer } from "@/lib/supabase/server";
import { appOrigin } from "@/lib/origin";
import { InstallStep } from "./install-step";
import { mergeDesign } from "@/lib/design-presets";
import type { StackItem } from "@/lib/types";

/** 04 · Onboarding — install. */
export default async function OnboardingInstallPage() {
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

  const [{ data: board }, { data: profile }] = await Promise.all([
    db
      .from("boards")
      .select("*")
      .eq("workspace_id", membership.workspace_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    db
      .from("project_profiles")
      .select("stack")
      .eq("workspace_id", membership.workspace_id)
      .maybeSingle(),
  ]);

  if (!board) redirect("/onboarding/app");

  // Has any post or vote come through yet? That is the honest install signal.
  const { count: posts } = await db
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("board_id", board.id);

  return (
    <InstallStep
      boardPublicId={board.public_id}
      boardName={board.name}
      origin={await appOrigin()}
      mode={mergeDesign(board.design).mode}
      identityMode={board.identity_mode}
      allowedDomains={board.allowed_domains}
      stack={(profile?.stack as StackItem[] | null) ?? []}
      installed={(posts ?? 0) > 0}
    />
  );
}
