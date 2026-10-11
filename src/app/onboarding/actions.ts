"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { slugify } from "@/lib/format";
import { DEFAULT_DESIGN } from "@/lib/design-presets";
import type { StackItem } from "@/lib/types";

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

  // A fresh workspace, its first board, and an empty project profile.
  const slug = await uniqueSlug(db, slugify(parsed.data.appName));

  const { data: workspace, error: wsError } = await db
    .from("workspaces")
    .insert({
      name: parsed.data.appName,
      slug,
      plan: "free",
      app_name: parsed.data.appName,
      app_url: domain ? `https://${domain}` : null,
      coding_tools: parsed.data.tools,
    })
    .select("id")
    .single();

  if (wsError || !workspace) {
    return { ok: false as const, error: wsError?.message ?? "Could not create workspace." };
  }

  const { error: memberError } = await db.from("workspace_members").insert({
    workspace_id: workspace.id,
    user_id: auth.user.id,
    role: "owner",
    name:
      (auth.user.user_metadata?.full_name as string | undefined) ??
      auth.user.email?.split("@")[0] ??
      null,
  });
  if (memberError) return { ok: false as const, error: memberError.message };

  await db.from("project_profiles").insert({ workspace_id: workspace.id, stack: [] });

  const { error: boardError } = await db.from("boards").insert({
    workspace_id: workspace.id,
    name: "Feature requests",
    slug: "feature-requests",
    color: "#1A8CFF",
    identity_mode: "email",
    allowed_domains: domain ? [domain] : [],
    show_badge: true,
    design: {
      ...DEFAULT_DESIGN,
      heading: `What should we build next in ${parsed.data.appName}?`,
    },
  });
  if (boardError) return { ok: false as const, error: boardError.message };

  revalidatePath("/", "layout");
  return { ok: true as const, workspaceId: workspace.id };
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

async function uniqueSlug(
  db: Awaited<ReturnType<typeof supabaseServer>>,
  base: string,
): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const { data } = await db
      .from("workspaces")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}
