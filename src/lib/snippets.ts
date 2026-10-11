import type { EmbedMode } from "./types";

/**
 * Install snippets, one per host framework. Conventions change, so every
 * snippet lives here and nowhere else.
 */

export interface Framework {
  id: string;
  label: string;
  filename: string;
  language: string;
}

export const FRAMEWORKS: Framework[] = [
  { id: "html", label: "HTML", filename: "index.html", language: "html" },
  { id: "next", label: "Next.js", filename: "app/layout.tsx", language: "tsx" },
  { id: "react", label: "React", filename: "App.tsx", language: "tsx" },
  { id: "vue", label: "Vue", filename: "App.vue", language: "vue" },
  { id: "nocode", label: "Webflow / Framer", filename: "custom code", language: "html" },
];

export interface SnippetArgs {
  boardId: string;
  mode: EmbedMode;
  origin: string;
}

export function installSnippet(framework: string, args: SnippetArgs): string {
  const { boardId, mode, origin } = args;
  const src = `${origin}/widget.js`;

  switch (framework) {
    case "next":
      return [
        "// app/layout.tsx",
        'import Script from "next/script";',
        "",
        "<Script",
        `  src="${src}"`,
        `  data-board="${boardId}"`,
        `  data-mode="${mode}"`,
        '  strategy="lazyOnload"',
        "/>",
      ].join("\n");

    case "react":
      return [
        "// Load once, in your root component.",
        'import { useEffect } from "react";',
        "",
        "useEffect(() => {",
        '  const s = document.createElement("script");',
        `  s.src = "${src}";`,
        `  s.dataset.board = "${boardId}";`,
        `  s.dataset.mode = "${mode}";`,
        "  s.async = true;",
        "  document.body.appendChild(s);",
        "  return () => s.remove();",
        "}, []);",
      ].join("\n");

    case "vue":
      return [
        "<!-- App.vue -->",
        "<script setup>",
        'import { onMounted } from "vue";',
        "",
        "onMounted(() => {",
        '  const s = document.createElement("script");',
        `  s.src = "${src}";`,
        `  s.dataset.board = "${boardId}";`,
        `  s.dataset.mode = "${mode}";`,
        "  s.async = true;",
        "  document.body.appendChild(s);",
        "});",
        "</script>",
      ].join("\n");

    case "nocode":
      return [
        "<!-- Webflow: Site settings → Custom code → Footer -->",
        "<!-- Framer: Site settings → Custom code → End of body -->",
        `<script src="${src}"`,
        `  data-board="${boardId}" data-mode="${mode}" async>`,
        "</" + "script>",
      ].join("\n");

    default:
      return [
        "<script",
        `  src="${src}"`,
        `  data-board="${boardId}"`,
        `  data-mode="${mode}"`,
        "  async>",
        "</" + "script>",
      ].join("\n");
  }
}

/**
 * The vibe-coder shortcut: a prompt the founder pastes into their coding agent
 * so the agent installs the widget for them, using the stack they already told
 * Euclid about.
 */
export function agentInstallPrompt(args: {
  boardId: string;
  mode: EmbedMode;
  origin: string;
  stack: { kind: string; name: string }[];
  identityMode: string;
}): string {
  const framework =
    args.stack.find((s) => s.kind.toLowerCase() === "framework")?.name ?? "this project";
  const auth = args.stack.find((s) => s.kind.toLowerCase() === "auth")?.name;

  const lines = [
    `Add the Euclid feedback widget to this`,
    `${framework} project.`,
    "",
    `- Load ${args.origin}/widget.js`,
    framework.toLowerCase().includes("next")
      ? "  with next/script, strategy lazyOnload"
      : "  asynchronously, after first paint",
    `- data-board="${args.boardId}"`,
    `- data-mode="${args.mode}"`,
  ];

  if (args.identityMode === "jwt") {
    lines.push(
      "- Only on signed-in pages. Pass the",
      `  ${auth ?? "signed-in"} user as a signed JWT from a`,
      "  server action (secret in env",
      "  EUCLID_SECRET).",
    );
  } else {
    lines.push("- Any page is fine; identity is anonymous or email.");
  }

  lines.push("", "Show me the diff before you write.");
  return lines.join("\n");
}

/**
 * Copy-paste identity snippets for the common auth setups, so wiring signed
 * JWT identity is a paste rather than a project.
 */
export const IDENTITY_SNIPPETS: { id: string; label: string; code: string }[] = [
  {
    id: "supabase",
    label: "Supabase",
    code: [
      "// app/api/euclid-token/route.ts",
      'import { SignJWT } from "jose";',
      'import { createClient } from "@/lib/supabase/server";',
      "",
      "export async function GET() {",
      "  const supabase = await createClient();",
      "  const { data } = await supabase.auth.getUser();",
      '  if (!data.user) return new Response("", { status: 401 });',
      "",
      "  const token = await new SignJWT({",
      "    sub: data.user.id,",
      "    email: data.user.email,",
      '    plan: data.user.app_metadata.plan ?? "free",',
      "  })",
      '    .setProtectedHeader({ alg: "HS256" })',
      '    .setExpirationTime("1h")',
      "    .sign(new TextEncoder().encode(process.env.EUCLID_SECRET!));",
      "",
      "  return Response.json({ token });",
      "}",
    ].join("\n"),
  },
  {
    id: "clerk",
    label: "Clerk",
    code: [
      "// app/api/euclid-token/route.ts",
      'import { currentUser } from "@clerk/nextjs/server";',
      'import { SignJWT } from "jose";',
      "",
      "export async function GET() {",
      "  const user = await currentUser();",
      '  if (!user) return new Response("", { status: 401 });',
      "",
      "  const token = await new SignJWT({",
      "    sub: user.id,",
      "    email: user.primaryEmailAddress?.emailAddress,",
      '    plan: (user.publicMetadata.plan as string) ?? "free",',
      "  })",
      '    .setProtectedHeader({ alg: "HS256" })',
      '    .setExpirationTime("1h")',
      "    .sign(new TextEncoder().encode(process.env.EUCLID_SECRET!));",
      "",
      "  return Response.json({ token });",
      "}",
    ].join("\n"),
  },
  {
    id: "authjs",
    label: "Auth.js",
    code: [
      "// app/api/euclid-token/route.ts",
      'import { auth } from "@/auth";',
      'import { SignJWT } from "jose";',
      "",
      "export async function GET() {",
      "  const session = await auth();",
      '  if (!session?.user) return new Response("", { status: 401 });',
      "",
      "  const token = await new SignJWT({",
      "    sub: session.user.id!,",
      "    email: session.user.email ?? undefined,",
      '    plan: (session.user as { plan?: string }).plan ?? "free",',
      "  })",
      '    .setProtectedHeader({ alg: "HS256" })',
      '    .setExpirationTime("1h")',
      "    .sign(new TextEncoder().encode(process.env.EUCLID_SECRET!));",
      "",
      "  return Response.json({ token });",
      "}",
    ].join("\n"),
  },
];

/** How the host page hands the token to the widget. */
export function identityHandoff(boardId: string, origin: string): string {
  return [
    "<!-- Fetch a signed token, then hand it to the widget. -->",
    "<script>",
    "  window.EuclidIdentity = async () => {",
    '    const res = await fetch("/api/euclid-token");',
    "    if (!res.ok) return null;",
    "    const { token } = await res.json();",
    "    return token;",
    "  };",
    "</" + "script>",
    `<script src="${origin}/widget.js" data-board="${boardId}" async></` + "script>",
  ].join("\n");
}
