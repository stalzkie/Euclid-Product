"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { slugify } from "@/lib/format";
import type { StackItem } from "@/lib/types";
import { REFERRAL_COOKIE, normaliseCode } from "@/lib/referrals";

/**
 * Founder setup, the three steps between signing up and a live board.
 * Target: under ten minutes from signup to an embedded board.
 */

const AppStep = z.object({
  appName: z.string().min(1).max(60),
  appUrl: z.string().max(253),
  tools: z.array(z.string().max(40)).max(12),
});

export async function saveAppStep(input: z.infer<typeof AppStep>) {
  const parsed = AppStep.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }

  const db = await supabaseServer();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return { ok: false as const, error: "Sign in first." };

  const domain = parsed.data.appUrl
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");

  // The founder may already have a workspace if they came back to this step.
  const { data: existing } = await db
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", auth.user.id)
    .limit(1)
    .maybeSingle();

  if (existing) {
    const { error } = await db
      .from("workspaces")
      .update({
        name: parsed.data.appName,
        app_name: parsed.data.appName,
        app_url: domain ? `https://${domain}` : null,
        coding_tools: parsed.data.tools,
      })
      .eq("id", existing.workspace_id);
    if (error) return { ok: false as const, error: error.message };

    if (domain) {
      // Keep the allow-list in step with the app URL.
      const { data: boards } = await db
        .from("boards")
        .select("id, allowed_domains")
        .eq("workspace_id", existing.workspace_id);
      for (const board of boards ?? []) {
        if (!board.allowed_domains.includes(domain)) {
          await db
            .from("boards")
            .update({ allowed_domains: [...board.allowed_domains, domain] })
            .eq("id", board.id);
        }
      }
    }

    revalidatePath("/", "layout");
    return { ok: true as const, workspaceId: existing.workspace_id };
  }

  /*
    A fresh workspace, its first board, its membership and an empty profile, in
    one call.

    It has to be one call. Creating a workspace from the client's own session
    cannot work under RLS: reading the new id back needs a membership that does
    not exist yet, de-duplicating the slug needs to see rows the policies
    rightly hide, and four separate writes can fail half-way and leave a
    workspace nobody is a member of — which no policy can see and no founder
    can delete. See 0013_workspace_bootstrap.sql.
  */
  const { data: workspaceId, error: createError } = await db.rpc("create_workspace", {
    p_name: parsed.data.appName,
    p_slug: slugify(parsed.data.appName),
    p_domain: domain || null,
    p_tools: parsed.data.tools,
    p_member_name:
      (auth.user.user_metadata?.full_name as string | undefined) ??
      auth.user.email?.split("@")[0] ??
      null,
    p_board_heading: `What should we build next in ${parsed.data.appName}?`,
    /*
      The referral, if one has been following this browser since before the
      founder signed up. Read here rather than earlier because this is the
      moment the workspace exists to attach it to, and passed into the same
      call that creates it so a workspace is never briefly unattributed.

      An unknown code is ignored inside `create_workspace` rather than
      refused: somebody mistyping a friend's code should still get a
      workspace.
    */
    p_referred_by: normaliseCode((await cookies()).get(REFERRAL_COOKIE)?.value),
  });

  if (createError || !workspaceId) {
    return {
      ok: false as const,
      error: createError?.message ?? "Could not create workspace.",
    };
  }

  revalidatePath("/", "layout");
  return { ok: true as const, workspaceId: workspaceId as string };
}

const ProfileStep = z.object({
  stack: z.array(z.object({ kind: z.string().max(40), name: z.string().max(120) })).max(20),
  conventions: z.string().max(4000),
  rulesFile: z.string().max(40000).nullable(),
  rulesFileName: z.string().max(60).nullable(),
});

export async function saveProfileStep(input: z.infer<typeof ProfileStep>) {
  const parsed = ProfileStep.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }

  const db = await supabaseServer();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return { ok: false as const, error: "Sign in first." };

  const { data: membership } = await db
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", auth.user.id)
    .limit(1)
    .maybeSingle();
  if (!membership) return { ok: false as const, error: "Finish step 1 first." };

  const { error } = await db.from("project_profiles").upsert(
    {
      workspace_id: membership.workspace_id,
      stack: parsed.data.stack,
      conventions: parsed.data.conventions || null,
      rules_file: parsed.data.rulesFile,
      rules_file_name: parsed.data.rulesFileName ?? "CLAUDE.md",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  );

  revalidatePath("/", "layout");
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

export async function finishOnboarding() {
  const db = await supabaseServer();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return { ok: false as const, error: "Sign in first." };

  const { data: membership } = await db
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", auth.user.id)
    .limit(1)
    .maybeSingle();
  if (!membership) return { ok: false as const, error: "Nothing to finish." };

  await db
    .from("workspaces")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", membership.workspace_id);

  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * Reads a pasted package.json and turns it into stack rows. This is the
 * "detect from package.json" helper — it recognises what it knows and says
 * nothing about what it does not, rather than guessing.
 */
export async function detectStack(pasted: string): Promise<
  { ok: true; stack: StackItem[] } | { ok: false; error: string }
> {
  let json: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    json = JSON.parse(pasted);
  } catch {
    return { ok: false, error: "That is not valid JSON. Paste the whole package.json." };
  }

  const deps = { ...(json.dependencies ?? {}), ...(json.devDependencies ?? {}) };
  const has = (name: string) => Object.prototype.hasOwnProperty.call(deps, name);
  const version = (name: string) =>
    (deps[name] ?? "").replace(/^[^\d]*/, "").split(".")[0] || "";

  const stack: StackItem[] = [];
  const add = (kind: string, name: string) => {
    if (!stack.some((s) => s.kind === kind)) stack.push({ kind, name });
  };

  if (has("next")) add("Framework", `Next.js${version("next") ? ` ${version("next")}` : ""} (App Router)`);
  else if (has("@remix-run/react")) add("Framework", "Remix");
  else if (has("astro")) add("Framework", "Astro");
  else if (has("nuxt")) add("Framework", "Nuxt");
  else if (has("@sveltejs/kit")) add("Framework", "SvelteKit");
  else if (has("vite")) add("Framework", "Vite + React");
  else if (has("react")) add("Framework", "React");

  if (has("typescript")) add("Language", "TypeScript");

  if (has("@supabase/supabase-js")) add("Database", "Supabase Postgres");
  else if (has("drizzle-orm")) add("Database", "Postgres via Drizzle");
  else if (has("@prisma/client")) add("Database", "Postgres via Prisma");
  else if (has("mongoose")) add("Database", "MongoDB");

  if (has("@clerk/nextjs") || has("@clerk/clerk-react")) add("Auth", "Clerk");
  else if (has("next-auth") || has("@auth/core")) add("Auth", "Auth.js");
  else if (has("@supabase/ssr")) add("Auth", "Supabase Auth");

  if (has("tailwindcss")) {
    add("UI", has("@radix-ui/react-dialog") ? "Tailwind + shadcn/ui" : "Tailwind CSS");
  } else if (has("@chakra-ui/react")) add("UI", "Chakra UI");
  else if (has("@mui/material")) add("UI", "MUI");

  if (has("vercel") || has("@vercel/analytics")) add("Hosting", "Vercel");
  else if (has("wrangler")) add("Hosting", "Cloudflare Workers");

  if (has("vitest")) add("Testing", "Vitest");
  else if (has("jest")) add("Testing", "Jest");
  else if (has("@playwright/test")) add("Testing", "Playwright");

  if (!stack.length) {
    return {
      ok: false,
      error: "Nothing recognisable in there. Add your stack by hand below.",
    };
  }
  return { ok: true, stack };
}

/*
  There was a uniqueSlug() here. It selected from `workspaces` with the
  founder's session to find a free slug, which RLS answers with nothing for
  someone who is not yet a member of anything — so it always reported the base
  slug as free, and two founders naming their app the same thing collided on
  the unique index. create_workspace() resolves the slug with privileges that
  can actually see the collisions.
*/
