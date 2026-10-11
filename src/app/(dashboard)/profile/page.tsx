import { Shell } from "@/components/shell";
import { requireFounder } from "@/server/context";
import { ProfileEditor } from "./profile-editor";
import type { StackItem } from "@/lib/types";
import { RepoPanel } from "./repo-panel";
import { readRepoStatus } from "./repo-actions";

/** Project profile — the context that makes every Build Prompt specific. */
export default async function ProfilePage() {
  const ctx = await requireFounder();
  const repo = await readRepoStatus(ctx.board.id);

  return (
    <Shell active="profile" ctx={ctx} wide>
      <ProfileEditor
        stack={(ctx.profile?.stack as StackItem[] | null) ?? []}
        conventions={ctx.profile?.conventions ?? ""}
        rulesFile={ctx.profile?.rules_file ?? null}
        rulesFileName={ctx.profile?.rules_file_name ?? "CLAUDE.md"}
        codingTools={ctx.workspace.coding_tools}
      />
      <RepoPanel initial={repo} />
    </Shell>
  );
}
