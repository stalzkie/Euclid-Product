"use client";

import { useEffect, useState } from "react";
import { Logo } from "@/components/icons";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Finishes an implicit-flow sign-in. The access token arrives in the URL
 * fragment, which the server never sees, so the session is established here
 * and then the page navigates with a full load so the server picks up the
 * fresh cookies.
 */
export function HashCallback({ next }: { next: string | null }) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The whole exchange runs inside this, reading the fragment included.
    // Signing in is one process with one failure path, so its errors all
    // reach state the same way — from a callback, never synchronously out of
    // the effect body.
    void (async () => {
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      const params = new URLSearchParams(hash);

      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      const hashError = params.get("error_description") ?? params.get("error");

      if (hashError) {
        setError(hashError);
        return;
      }
      if (!accessToken || !refreshToken) {
        setError("That sign-in link is missing its token. Request a new one.");
        return;
      }

      const supabase = supabaseBrowser();
      const { error: setError_ } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (setError_) {
        setError(setError_.message);
        return;
      }
      // Strip the token out of the address bar, then do a full navigation so
      // the server sees the new cookies.
      window.history.replaceState(null, "", window.location.pathname);
      window.location.replace(`/auth/land${next ? `?next=${encodeURIComponent(next)}` : ""}`);
    })();
  }, [next]);

  return (
    <main className="aurora flex min-h-screen items-center justify-center px-6">
      <div className="flex w-full max-w-[380px] flex-col items-center gap-4 rounded-modal border border-line bg-canvas p-8 text-center shadow-float">
        <Logo size={32} />
        {error ? (
          <>
            <p className="text-[15px] font-semibold">Could not sign you in</p>
            <p className="text-[13px] leading-[1.55] text-ink-2">{error}</p>
            <a
              href="/signup"
              className="flex h-9 items-center rounded-control bg-ink px-4 text-[13.5px] font-medium text-white no-underline"
            >
              Try again
            </a>
          </>
        ) : (
          <>
            <p className="text-[15px] font-semibold">Signing you in…</p>
            <p className="text-[13px] text-ink-2">One moment.</p>
          </>
        )}
      </div>
    </main>
  );
}
