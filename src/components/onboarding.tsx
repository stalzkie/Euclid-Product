"use client";

import Link from "next/link";
import { m } from "motion/react";
import type { ReactNode } from "react";
import { Logo } from "./icons";
import { cx } from "./ui";
import { spring } from "@/lib/motion/tokens";

/**
 * Onboarding chrome: the aurora wash, the mark top-left, and the three-step
 * progress dots. Target for the whole flow is under ten minutes.
 */
export function OnboardShell({
  step,
  title,
  subtitle,
  children,
  aside,
  back,
  next,
  skip,
}: {
  step: 1 | 2 | 3;
  title: string;
  subtitle: string;
  children: ReactNode;
  aside?: ReactNode;
  back?: { href: string; label?: string };
  next?: ReactNode;
  skip?: { href: string; label: string };
}) {
  return (
    <main className="aurora min-h-screen px-6 py-10 md:px-12">
      <div className="mb-8 flex items-center gap-2">
        <Logo size={26} />
        <span className="text-[16px] font-semibold tracking-[-0.01em]">Euclid</span>
      </div>

      <section
        aria-labelledby="ob-title"
        className="mx-auto flex max-w-[1120px] flex-wrap items-start gap-7"
      >
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-6 rounded-modal border border-line bg-canvas p-8 shadow-float">
          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-3">
              Step {step} of 3
            </span>
            <h1 id="ob-title" className="text-[26px] font-semibold tracking-[-0.02em]">
              {title}
            </h1>
            <p className="text-[13.5px] leading-[1.55] text-ink-2">{subtitle}</p>
          </div>

          {children}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-5">
            {back ? (
              <Link
                href={back.href}
                className="eu-press flex h-9 items-center rounded-control px-3 text-[13.5px] font-medium text-ink-2 no-underline hover:bg-muted"
              >
                {back.label ?? "Back"}
              </Link>
            ) : (
              <span />
            )}

            {/*
              One pill that moves and stretches between the dots, rather than
              three dots each animating their own width. A shared layoutId is
              what makes it read as the same object advancing.
            */}
            <div aria-label={`Step ${step} of 3`} className="flex items-center gap-[6px]">
              {[1, 2, 3].map((n) => (
                <span
                  key={n}
                  className={cx(
                    "relative h-[6px] rounded-full",
                    n === step ? "w-6" : "w-[6px] bg-line-strong",
                  )}
                >
                  {n === step && (
                    <m.span
                      layoutId="onboarding-step"
                      transition={spring.snappy}
                      className="absolute inset-0 rounded-full bg-ink"
                    />
                  )}
                </span>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {skip && (
                <Link
                  href={skip.href}
                  className="flex h-9 items-center rounded-control px-3 text-[13.5px] font-medium text-ink-2 no-underline hover:bg-muted"
                >
                  {skip.label}
                </Link>
              )}
              {next}
            </div>
          </div>
        </div>

        {aside && (
          <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">{aside}</div>
        )}
      </section>
    </main>
  );
}
