"use client";

import type { ReactNode } from "react";
import { useReduceMotion } from "./reduce-motion";
import { cx } from "../ui";

/**
 * Tints a line that just changed and lets the tint fade away, so the founder
 * can see what a toggle or a refinement actually did to the prompt.
 *
 * The tint is an opacity-animated overlay rather than an animated
 * background-colour: same look, but it composites instead of repainting the
 * text under it every frame.
 *
 * `token` is what re-triggers it. Change it — a version number, a timestamp,
 * the line's own text — and the highlight plays again.
 */
export function DiffHighlight({
  token,
  children,
  as = "span",
  className,
  /** A border flash instead of a fill, for cards rather than lines. */
  variant = "fill",
}: {
  token: string | number;
  children: ReactNode;
  as?: "span" | "div" | "li";
  className?: string;
  variant?: "fill" | "border";
}) {
  const reduce = useReduceMotion();
  const Tag = as;

  if (reduce) {
    return <Tag className={className}>{children}</Tag>;
  }

  return (
    <Tag
      // Remounting is what restarts the CSS animation.
      key={token}
      className={cx(variant === "border" ? "eu-flash-border" : "eu-diff", className)}
    >
      {children}
    </Tag>
  );
}
