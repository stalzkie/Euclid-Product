import { Logo } from "@/components/icons";
import { isConfigured } from "@/lib/supabase/server";
import { hasAnthropic } from "@/lib/ai/client";
import { hasEmbeddingProvider } from "@/lib/ai/embeddings";
import { redirect } from "next/navigation";

/**
 * Setup notice. Shown before the environment is wired up, so a fresh clone
 * explains itself instead of throwing.
 */
export default function SetupPage() {
  if (isConfigured()) redirect("/");

  const rows = [
    {
      key: "NEXT_PUBLIC_SUPABASE_URL",
      need: "required",
      ok: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      what: "Your Supabase project URL.",
    },
    {
      key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      need: "required",
      ok: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      what: "Public anon key. Used for the founder's session, under RLS.",
    },
    {
      key: "SUPABASE_SERVICE_ROLE_KEY",
      need: "required",
      ok: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      what: "Server-only. The widget API and background jobs use it.",
    },
    {
      key: "ANTHROPIC_API_KEY",
      need: "for AI features",
      ok: hasAnthropic(),
      what: "Build Prompt, Ask Euclid, theme names, changelog drafts.",
    },
    {
      key: "EMBEDDINGS_API_KEY",
      need: "optional",
      ok: hasEmbeddingProvider(),
      what: "Duplicate detection and clustering. Falls back to a local hash.",
    },
  ];

  return (
    <main className="aurora flex min-h-screen items-center justify-center px-6 py-16">
      <section className="flex w-full max-w-[680px] flex-col gap-6 rounded-modal border border-line bg-canvas p-8 shadow-float">
        <div className="flex flex-col gap-3">
          <Logo size={36} />
          <h1 className="text-[24px] font-semibold tracking-[-0.02em]">
            Euclid needs its environment
          </h1>
          <p className="text-[13.5px] leading-[1.55] text-ink-2">
            Create a <code className="font-mono text-[12.5px]">.env.local</code> with the
            values below, run the migrations in{" "}
            <code className="font-mono text-[12.5px]">supabase/migrations</code>, then
            reload. Everything that does not need a key works without one.
          </p>
        </div>

        <div className="overflow-hidden rounded-card border border-line">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-subtle text-left text-[12px] text-ink-2">
                <th scope="col" className="px-4 py-2 font-medium">Variable</th>
                <th scope="col" className="px-4 py-2 font-medium">Needed</th>
                <th scope="col" className="px-4 py-2 font-medium">Set</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-hairline align-top">
                  <td className="px-4 py-3">
                    <code className="font-mono text-[12.5px]">{r.key}</code>
                    <p className="mt-1 text-[12px] text-ink-3">{r.what}</p>
                  </td>
                  <td className="px-4 py-3 text-[12.5px] text-ink-2">{r.need}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        r.ok
                          ? "rounded-full bg-ok-wash px-[9px] py-[3px] text-[11.5px] font-medium text-ok"
                          : "rounded-full bg-muted px-[9px] py-[3px] text-[11.5px] font-medium text-ink-2"
                      }
                    >
                      {r.ok ? "yes" : "no"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <pre className="thin-scroll overflow-auto rounded-card border border-line bg-subtle p-4 font-mono text-[12.5px] leading-[1.7] text-ink-2">
{`# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# AI features
ANTHROPIC_API_KEY=...

# Embeddings (optional; falls back to a local hash)
EMBEDDINGS_API_KEY=...
EMBEDDINGS_MODEL=text-embedding-3-small

# Where the widget loads from
NEXT_PUBLIC_APP_URL=http://localhost:3000`}
        </pre>
      </section>
    </main>
  );
}
