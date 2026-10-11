"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuid } from "@/lib/validation";
import { supabaseServer } from "@/lib/supabase/server";
import { requireFounder } from "@/server/context";
import { PLANS, boardAllowance } from "@/lib/plans";
import { slugify } from "@/lib/format";
import { DEFAULT_DESIGN } from "@/lib/design-presets";

/**
 * Publishing a design writes the JSON config on the board. The widget fetches
 * that config on load, so edits apply without the founder redeploying.
 */

const Design = z.object({
  preset: z.string().max(40),
  accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  theme: z.enum(["Light", "Dark", "Auto"]),
  radius: z.enum(["Sharp", "Soft", "Round"]),
  mode: z.enum(["inline", "floating"]),
  heading: z.string().max(80),
  subheading: z.string().max(200),
  submitCta: z.string().max(40),
  showStatuses: z.boolean(),
  showComments: z.boolean(),
  showChangelog: z.boolean(),
  showRoadmap: z.boolean(),
  showVoteCounts: z.boolean(),
});

export async function publishDesign(
  boardId: string,
  design: z.infer<typeof Design>,
  showBadge: boolean,
) {
  const parsed = Design.safeParse(design);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }

  const ctx = await requireFounder();
  const plan = PLANS[ctx.workspace.plan];

  // The Free tier keeps the badge — that is the growth loop, so it is enforced
  // here and not only in the UI.
  const badge = plan.badge ? true : showBadge;

  const db = await supabaseServer();
  const { error } = await db
    .from("boards")
    .update({ design: parsed.data, show_badge: badge })
    .eq("id", boardId)
    .eq("workspace_id", ctx.workspace.id);

  revalidatePath("/designer");
  revalidatePath("/install");
  return error
    ? { ok: false as const, error: error.message }
    : { ok: true as const, badgeForced: plan.badge && !showBadge };
}

const BoardSettings = z.object({
  boardId: uuid(),
  name: z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  identityMode: z.enum(["anonymous", "email", "jwt"]),
  allowedDomains: z.array(z.string().max(253)).max(32),
  anonVoteLimit: z.number().int().min(1).max(100),
  requireApproval: z.boolean(),
  categories: z.array(z.string().max(40)).max(12),
});

export async function saveBoardSettings(input: z.infer<typeof BoardSettings>) {
  const parsed = BoardSettings.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const ctx = await requireFounder();
  const plan = PLANS[ctx.workspace.plan];

  if (parsed.data.identityMode === "jwt" && !plan.jwtIdentity) {
    return {
      ok: false as const,
      error: `Signed JWT identity is on the Indie plan and above. You are on ${plan.name}.`,
    };
  }

  const db = await supabaseServer();
  const { error } = await db
    .from("boards")
    .update({
      name: parsed.data.name,
      slug: slugify(parsed.data.name),
      color: parsed.data.color,
      identity_mode: parsed.data.identityMode,
      allowed_domains: parsed.data.allowedDomains
        .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
        .filter(Boolean),
      anon_vote_limit: parsed.data.anonVoteLimit,
      require_approval: parsed.data.requireApproval,
      categories: parsed.data.categories.filter(Boolean),
    })
    .eq("id", parsed.data.boardId)
    .eq("workspace_id", ctx.workspace.id);

  revalidatePath("/designer");
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

export async function createBoard(name: string) {
  const ctx = await requireFounder();
  const plan = PLANS[ctx.workspace.plan];

  if (!boardAllowance(ctx.workspace.plan, ctx.boards.length)) {
    return {
      ok: false as const,
      error: `The ${plan.name} plan includes ${plan.boards} board${
        plan.boards === 1 ? "" : "s"
      }. Upgrade for more.`,
    };
  }

  const db = await supabaseServer();
  const { data, error } = await db
    .from("boards")
    .insert({
      workspace_id: ctx.workspace.id,
      name: name.slice(0, 60) || "New board",
      slug: slugify(name),
      design: DEFAULT_DESIGN,
      show_badge: plan.badge,
    })
    .select("id,public_id")
    .single();

  revalidatePath("/designer");
  return error
    ? { ok: false as const, error: error.message }
    : { ok: true as const, boardId: data.id, publicId: data.public_id };
}

export async function deleteBoard(boardId: string) {
  const ctx = await requireFounder();
  if (ctx.boards.length <= 1) {
    return { ok: false as const, error: "A workspace needs at least one board." };
  }
  const db = await supabaseServer();
  const { error } = await db
    .from("boards")
    .delete()
    .eq("id", boardId)
    .eq("workspace_id", ctx.workspace.id);
  revalidatePath("/designer");
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}
