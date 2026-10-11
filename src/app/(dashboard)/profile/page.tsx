import { Shell } from "@/components/shell";
import { requireFounder } from "@/server/context";
import { ProfileEditor } from "./profile-editor";
import type { StackItem } from "@/lib/types";

/** Project profile — the context that makes every Build Prompt specific. */
export default async function ProfilePage() {
  const ctx = await requireFounder();

  return (
    <Shell active="profile" ctx={ctx} wide>
      <ProfileEditor
        stack={(ctx.profile?.stack as StackItem[] | null) ?? []}
        conventions={ctx.profile?.conventions ?? ""}
        rulesFile={ctx.profile?.rules_file ?? null}
        rulesFileName={ctx.profile?.rules_file_name ?? "CLAUDE.md"}
        codingTools={ctx.workspace.coding_tools}
      />
    </Shell>
  );
}
