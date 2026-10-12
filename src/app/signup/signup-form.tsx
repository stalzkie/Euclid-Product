"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Icon, Logo } from "@/components/icons";
import { Banner, Button, Input, cx } from "@/components/ui";
import { Spinner } from "@/components/controls";
import { FadeRise, Stagger } from "@/components/motion";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * 01 · Sign up. The aurora wash and the floating proof cards appear only here
 * and in onboarding; the product itself stays white and stone-grey.
 */
export function SignupForm({
  mode,
  initialError = null,
}: {
  mode: "signup" | "signin";
  /** A failure from a previous attempt, passed through the query. */
  initialError?: string | null;
}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState<"email" | "google" | "github" | null>(null);

  const signInWithEmail = async () => {
    setBusy("email");
    setError(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        shouldCreateUser: true,
      },
    });
    setBusy(null);
    if (error) setError(error.message);
    else setSent(true);
  };

  const signInWithOAuth = async (provider: "google" | "github") => {
    setBusy(provider);
    setError(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setBusy(null);
      setError(error.message);
    }
  };

  return (
    <main className="aurora relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-16">
      {/* Proof cards: the core loop, floating on the wash. */}
      <ProofCards />

      {/*
        The one screen where the entrance is the point: this is the first thing
        a visitor sees, so it animates on mount rather than waiting for
        hydration the way in-app content does. 8px rather than 4px — the card
        is carrying the whole page.
      */}
      <FadeRise
        as="section"
        mountAnimation
        distance="md"
        aria-labelledby="signup-title"
        className="relative z-10 flex w-full max-w-[420px] flex-col gap-4 rounded-modal border border-line bg-canvas p-8 shadow-float"
      >
        <div className="flex flex-col gap-3">
          <Logo size={36} />
          <h1 id="signup-title" className="text-[24px] font-semibold tracking-[-0.02em]">
            {mode === "signin" ? "Sign in to Euclid" : "Create your Euclid account"}
          </h1>
          <p className="text-[13.5px] leading-[1.55] text-ink-2">
            From user feedback to a prompt your coding agent can ship. Free for one
            board.
          </p>
        </div>

        {sent ? (
          // Swapping the whole block for a confirmation is a change of state,
          // not a list arriving, so it fades in on its own.
          <FadeRise mountAnimation>
            <Banner tone="ok" icon="mail">
              Check {email} for a sign-in link. It expires in an hour.
            </Banner>
          </FadeRise>
        ) : (
          <Stagger className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => signInWithOAuth("google")}
              disabled={busy !== null}
              className="flex h-10 items-center justify-center gap-[10px] rounded-control border border-line-strong bg-canvas text-[13.5px] font-medium hover:bg-subtle disabled:opacity-50"
            >
              {busy === "google" ? <Spinner /> : <GoogleMark />}
              Continue with Google
            </button>
            <button
              type="button"
              onClick={() => signInWithOAuth("github")}
              disabled={busy !== null}
              className="flex h-10 items-center justify-center gap-[10px] rounded-control border border-line-strong bg-canvas text-[13.5px] font-medium hover:bg-subtle disabled:opacity-50"
            >
              {busy === "github" ? <Spinner /> : <GithubMark />}
              Continue with GitHub
            </button>

            <div className="flex items-center gap-3 py-1 text-[12px] text-ink-3">
              <span className="h-px flex-1 bg-line" />
              or
              <span className="h-px flex-1 bg-line" />
            </div>

            <label className="flex flex-col gap-[6px] text-[13px] font-medium">
              Work email
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && email.includes("@")) void signInWithEmail();
                }}
                placeholder="you@yourapp.com"
                autoComplete="email"
              />
            </label>
            <Button
              variant="primary"
              className="h-10"
              disabled={busy !== null || !email.includes("@")}
              onClick={signInWithEmail}
            >
              {busy === "email" ? <Spinner /> : null}
              Continue with email
            </Button>
          </Stagger>
        )}

        {error && (
          <FadeRise mountAnimation aria-live="polite">
            <Banner tone="bad" icon="warn">
              {error}
            </Banner>
          </FadeRise>
        )}

        <p className="text-[12.5px] text-ink-2">
          {mode === "signin" ? (
            <>
              New here?{" "}
              <Link href="/signup" className="font-medium text-ink no-underline hover:underline">
                Create an account
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link
                href="/signup?mode=signin"
                className="font-medium text-ink no-underline hover:underline"
              >
                Sign in
              </Link>
            </>
          )}
        </p>
        <p className="text-[11.5px] leading-[1.45] text-ink-3">
          By continuing you agree to the Terms and Privacy Policy.
        </p>
      </FadeRise>
    </main>
  );
}

/** The four moments of the core loop, scattered around the card. */
function ProofCards() {
  const card = "rounded-[14px] border border-line bg-canvas shadow-float flex";

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {/*
        Two nested elements per card on purpose: the outer one runs the
        one-time entrance and the inner one runs the endless drift, because
        both animate `transform` and a single element can only have one.
      */}
      <Floating className="left-[8%] top-[18%]" order={0} phase="0s">
        <div className={cx(card, "items-center gap-3 px-4 py-3")}>
          <span className="flex h-11 w-10 flex-col items-center justify-center rounded-[10px] border border-state-bright bg-state-wash text-[12.5px] font-semibold text-state">
            <Icon name="caretUp" size={11} strokeWidth={2.4} />
            184
          </span>
          <span className="flex flex-col">
            <span className="text-[13px] font-medium">Export to CSV</span>
            <span className="text-[11.5px] text-ink-3">62% paying users</span>
          </span>
        </div>
      </Floating>

      <Floating className="left-[6%] top-[52%]" order={1} phase="-1.5s">
        <div
          className={cx(
            card,
            "items-center gap-[7px] border-ai-line bg-ai-wash px-4 py-[10px] text-[12.5px] font-semibold text-ai-deep",
          )}
        >
          <Icon name="sparkle" size={14} strokeWidth={1.9} />
          Build Prompt ready for Claude Code
        </div>
      </Floating>

      <Floating className="right-[7%] top-[20%]" order={2} phase="-3s">
        <div
          className={cx(
            card,
            "w-[280px] flex-col gap-1 px-4 py-3 font-mono text-[11.5px] leading-[1.6] text-ink-2",
          )}
        >
          <span className="font-semibold text-ink">## Acceptance criteria</span>
          <span>- [ ] Export from Settings › Data</span>
          <span>- [ ] Free plan: CSV only</span>
          <span>- [ ] Behind flag export_v1</span>
        </div>
      </Floating>

      <Floating className="bottom-[16%] right-[9%]" order={3} phase="-4.5s">
        <div className={cx(card, "items-center gap-3 px-4 py-3")}>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ok-bright text-white">
            <Icon name="check" size={14} strokeWidth={2.6} />
          </span>
          <span className="flex flex-col">
            <span className="text-[13px] font-medium">Shipped · 184 voters emailed</span>
            <span className="text-[11.5px] text-ink-3">just now</span>
          </span>
        </div>
      </Floating>
    </div>
  );
}

/**
 * One proof card: it arrives once, 60ms behind the one before it, and then
 * drifts a few pixels up and down forever on its own phase so the four of
 * them never bob in unison.
 *
 * Hidden below 900px, where there is no room for it and the card in the middle
 * is the only thing worth reading.
 */
function Floating({
  children,
  className,
  order,
  phase,
}: {
  children: ReactNode;
  className?: string;
  /** Position in the 60ms entrance cascade. */
  order: number;
  /** Negative offset into the drift, so each card starts mid-cycle. */
  phase: string;
}) {
  return (
    <div
      className={cx("eu-enter-rise absolute hidden lg:block", className)}
      style={{ animationDelay: `${order * 60}ms` }}
    >
      <div className="eu-float" style={{ animationDelay: phase }}>
        {children}
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.3 17.6 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.6 24.6c0-1.6-.2-3.2-.5-4.6H24v9.1h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7.1-10.2 7.1-17.6z"
      />
      <path
        fill="#FBBC05"
        d="M10.4 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C1 16.4 0 20.1 0 24s1 7.6 2.6 10.8z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.2 0 11.5-2 15.5-5.8l-7.6-5.9c-2.1 1.4-4.8 2.2-7.9 2.2-6.4 0-11.7-3.8-13.6-9.8l-7.8 6.1C6.5 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}

function GithubMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="#17171A" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.07-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.15 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A7.99 7.99 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
