"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireFounder } from "@/server/context";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { appOrigin } from "@/lib/origin";
import { PLANS } from "@/lib/plans";
import { uuid } from "@/lib/validation";
import {
  createGithubIssue,
  createLinearIssue,
  sendTestMessage,
} from "@/server/integrations";
import {
  parseRepo,
  validateWebhookUrl,
  type IntegrationKind,
  type PostEventData,
} from "@/lib/integrations";

/**
 * Connecting and using integrations.
 *
 * Credentials are written with the service role and never read back into the
 * browser. The dashboard is told that an integration exists and when it last
 * worked, which is everything it needs to render.
 */

const ChatInput = z.object({
  kind: z.enum(["slack", "discord"]),
  webhookUrl: z.string().min(1),
  events: z.array(z.enum(["post.created", "post.status_changed"])).min(1),
});

const GithubInput = z.object({
  repo: z.string().min(1),
  token: z.string().min(1),
  label: z.string().optional(),
});

const LinearInput = z.object({
  token: z.string().min(1),
  teamId: z.string().min(1),
});

type Result = { ok: true; message: string } | { ok: false; error: string };

async function guard() {
  const ctx = await requireFounder();
  if (!PLANS[ctx.workspace.plan].integrations) {
    return { ctx, blocked: `Integrations are on the paid plans — you are on ${PLANS[ctx.workspace.plan].name}.` };
  }
  return { ctx, blocked: null };
}

export async function connectChat(input: z.infer<typeof ChatInput>): Promise<Result> {
  const { kind, webhookUrl, events } = ChatInput.parse(input);
  const { ctx, blocked } = await guard();
  if (blocked) return { ok: false, error: blocked };

  // The allow-list is the thing standing between this field and an
  // server-side request to anywhere, so it runs on the server too — not
  // only in the browser where it is a convenience.
  const checked = validateWebhookUrl(kind, webhookUrl);
  if (!checked.ok) return { ok: false, error: checked.error };

  const origin = await appOrigin();
  const test = await sendTestMessage(
    kind,
    checked.url,
    ctx.board.name,
    `${origin}/b/${ctx.board.public_id}`,
  );
  if (!test.ok) {
    return { ok: false, error: `That webhook did not accept a test message: ${test.error}` };
  }

  const { error } = await supabaseAdmin()
    .from("integrations")
    .upsert(
      {
        board_id: ctx.board.id,
        kind,
        config: { webhook_url: checked.url },
        events,
        active: true,
        last_error: null,
        last_delivered_at: new Date().toISOString(),
      },
      { onConflict: "board_id,kind" },
    );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/install");
  return { ok: true, message: "Connected. A test message is in the channel." };
}

export async function connectGithub(input: z.infer<typeof GithubInput>): Promise<Result> {
  const { repo, token, label } = GithubInput.parse(input);
  const { ctx, blocked } = await guard();
  if (blocked) return { ok: false, error: blocked };

  const parsed = parseRepo(repo);
  if (!parsed) return { ok: false, error: "Give the repository as owner/repo." };

  // Check the token can actually see the repo now, rather than finding out
  // the first time someone tries to export a post.
  const probe = await fetch(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(8_000),
    },
  ).catch(() => null);

  if (!probe) return { ok: false, error: "Could not reach GitHub." };
  if (probe.status === 404) {
    return { ok: false, error: "GitHub cannot see that repository with this token." };
  }
  if (!probe.ok) return { ok: false, error: `GitHub refused the token (${probe.status}).` };

  const { error } = await supabaseAdmin()
    .from("integrations")
    .upsert(
      {
        board_id: ctx.board.id,
        kind: "github",
        config: { repo: `${parsed.owner}/${parsed.repo}`, token, ...(label ? { label } : {}) },
        events: [],
        active: true,
        last_error: null,
      },
      { onConflict: "board_id,kind" },
    );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/install");
  return { ok: true, message: `Connected to ${parsed.owner}/${parsed.repo}.` };
}

export async function connectLinear(input: z.infer<typeof LinearInput>): Promise<Result> {
  const { token, teamId } = LinearInput.parse(input);
  const { ctx, blocked } = await guard();
  if (blocked) return { ok: false, error: blocked };

  const { error } = await supabaseAdmin()
    .from("integrations")
    .upsert(
      {
        board_id: ctx.board.id,
        kind: "linear",
        config: { token, team_id: teamId },
        events: [],
        active: true,
        last_error: null,
      },
      { onConflict: "board_id,kind" },
    );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/install");
  return { ok: true, message: "Linear connected." };
}

export async function disconnectIntegration(kind: IntegrationKind): Promise<Result> {
  const ctx = await requireFounder();

  const { error } = await supabaseAdmin()
    .from("integrations")
    .delete()
    .eq("board_id", ctx.board.id)
    .eq("kind", kind);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/install");
  return { ok: true, message: "Disconnected." };
}

/** Export one post to the connected issue tracker. */
export async function exportPostToIssue(
  postId: string,
  kind: "github" | "linear",
): Promise<Result & { url?: string }> {
  if (!uuid().safeParse(postId).success) return { ok: false, error: "Unknown post." };

  const { ctx, blocked } = await guard();
  if (blocked) return { ok: false, error: blocked };

  const db = await supabaseServer();
  const { data: post } = await db
    .from("posts")
    .select("id,number,title,body,category,status,vote_count,external_url")
    .eq("id", postId)
    .eq("board_id", ctx.board.id)
    .maybeSingle();

  if (!post) return { ok: false, error: "That post is not on this board." };
  if (post.external_url) {
    return { ok: false, error: "That post already has an issue.", url: post.external_url };
  }

  const admin = supabaseAdmin();
  const { data: integration } = await admin
    .from("integrations")
    .select("config")
    .eq("board_id", ctx.board.id)
    .eq("kind", kind)
    .eq("active", true)
    .maybeSingle();

  if (!integration) return { ok: false, error: `${kind} is not connected.` };

  const origin = await appOrigin();
  const data: PostEventData = {
    number: post.number,
    title: post.title,
    body: post.body,
    category: post.category,
    status: post.status,
    votes: post.vote_count,
    url: `${origin}/b/${ctx.board.public_id}`,
    boardName: ctx.board.name,
  };

  const config = integration.config as Record<string, string>;
  const result =
    kind === "github" ? await createGithubIssue(config, data) : await createLinearIssue(config, data);

  if (!result.ok || !result.url) {
    return { ok: false, error: result.error ?? "The issue was not created." };
  }

  await admin
    .from("posts")
    .update({ external_url: result.url, external_kind: kind })
    .eq("id", post.id);

  await admin.from("activity").insert({
    workspace_id: ctx.workspace.id,
    board_id: ctx.board.id,
    post_id: post.id,
    kind: "export",
    text: `Exported #${post.number} to ${kind === "github" ? "GitHub" : "Linear"}`,
    meta: result.url,
  });

  revalidatePath("/feedback");
  revalidatePath(`/posts/${post.number}`);
  return { ok: true, message: "Issue opened.", url: result.url };
}
