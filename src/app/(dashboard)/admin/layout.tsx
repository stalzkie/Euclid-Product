import type { ReactNode } from "react";
import Link from "next/link";
import { requireAdmin } from "@/server/admin";
import {
  estate,
  failedSlices,
  missingSlices,
  truncatedSlices,
  ROW_CAP,
} from "@/server/admin-data";
import { AdminNav } from "./nav";

/**
 * The operator console frame. **No sidebar** — see `nav.tsx`.
 *
 * The gate is here as well as on every page. A layout is not a security
 * boundary in Next (a page can render without it in some routing cases), so
 * `requireAdmin` stays on each page too; this call is what keeps the frame
 * itself, and the operator's address in it, from rendering for anyone else.
 */
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const ctx = await requireAdmin();
  const data = await estate();

  const short = truncatedSlices(data);
  const failed = failedSlices(data);
  const absent = missingSlices(data);

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      {/* Near-black bar: this is not the founder app, and it should not be
          possible to forget that while reading other people's data. */}
      <header className="bg-ink text-white">
        <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5">
          <span className="text-[13px] font-semibold tracking-[-0.01em]">Euclid · Operations</span>
          <span className="hidden text-[12px] text-white/50 sm:inline">
            every workspace · read-only but for resolving errors
          </span>
          <span className="ml-auto flex items-center gap-3">
            <span className="font-mono text-[11.5px] text-white/60">{ctx.email}</span>
            <Link
              href="/"
              className="rounded-control border border-white/20 px-2 py-[3px] text-[12px] text-white/80 transition-colors hover:border-white/40 hover:text-white"
            >
              Back to app
            </Link>
          </span>
        </div>
      </header>

      <div className="border-b border-line">
        <div className="mx-auto w-full max-w-[1600px] px-5">
          <AdminNav />
        </div>
      </div>

      {(failed.length > 0 || short.length > 0 || absent.length > 0) && (
        <div className="mx-auto w-full max-w-[1600px] px-5 pt-4">
          {failed.length > 0 && (
            <p className="rounded-card border border-bad-line bg-bad-wash px-3.5 py-2.5 text-[12.5px] text-bad">
              <span className="font-medium">Could not read:</span>{" "}
              {failed.map((f) => `${f.name} (${f.error})`).join("; ")}. Numbers below are missing
              that table rather than reporting zero for it.
            </p>
          )}
          {absent.length > 0 && (
            <p className="mt-2 rounded-card border border-state-ring bg-state-wash px-3.5 py-2.5 text-[12.5px] text-state">
              <span className="font-medium">Not migrated:</span> {absent.join(", ")}. The code is
              deployed ahead of the database — apply the matching migration in{" "}
              <code className="font-mono">supabase/migrations/</code> through the Supabase SQL
              editor. Panels that need it say so; everything else is unaffected.
            </p>
          )}
          {short.length > 0 && (
            <p className="mt-2 rounded-card border border-[#FDE68A] bg-warn-wash px-3.5 py-2.5 text-[12.5px] text-warn">
              <span className="font-medium">Sampled:</span> {short.join(", ")} hit the{" "}
              {ROW_CAP.toLocaleString("en-US")}-row read cap, so every count derived from them is a
              floor and the oldest rows are missing. Time to move those aggregates into the
              database.
            </p>
          )}
        </div>
      )}

      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-7 px-5 pb-16 pt-5">
        {children}
      </main>
    </div>
  );
}
