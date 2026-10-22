import { Shell } from "@/components/shell";
import { requireFounder } from "@/server/context";
import { ProfileEditor } from "./profile-editor";
import type { StackItem } from "@/lib/types";
import { RepoPanel } from "./repo-panel";
import { MotionPanel } from "./motion-panel";
import { cookies } from "next/headers";
import { REDUCE_MOTION_COOKIE, isReduceMotionValue } from "@/lib/motion/preference";
import { readRepoStatus } from "./repo-actions";
import { TrackScreen } from "@/components/track";

/** Project profile — the context that makes every Build Prompt specific. */
export default async function ProfilePage() {
  const ctx = await requireFounder();
  const repo = await readRepoStatus(ctx.board.id);
  const reduceMotion = isReduceMotionValue(
    (await cookies()).get(REDUCE_MOTION_COOKIE)?.value,
  );

  return (
    <Shell active="profile" ctx={ctx} wide>
      <TrackScreen name="screen.profile" />
      <ProfileEditor
        stack={(ctx.profile?.stack as StackItem[] | null) ?? []}
        conventions={ctx.profile?.conventions ?? ""}
        rulesFile={ctx.profile?.rules_file ?? null}
        rulesFileName={ctx.profile?.rules_file_name ?? "CLAUDE.md"}
        codingTools={ctx.workspace.coding_tools}
      />
      <RepoPanel initial={repo} />
      <MotionPanel initial={reduceMotion} />
    </Shell>
  );
}
