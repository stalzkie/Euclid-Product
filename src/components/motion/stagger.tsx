"use client";

import { Children, isValidElement, useState, type ReactNode } from "react";
import { stagger as staggerToken } from "@/lib/motion/tokens";
import { FadeRise, type FadeRiseTag } from "./fade-rise";
import { hasHydrated } from "./hydrated";

/**
 * Brings a list in with a short cascade — 30ms per item, and only the first
 * eight, so the whole thing is over in 240ms no matter how long the list is.
 * Item nine onwards arrives with item eight.
 *
 * First mount only. Filtering, sorting and re-rendering must not re-stagger:
 * a list the reader is already looking at should not perform again, and a
 * filtered list has to feel instant.
 */
export function Stagger({
  children,
  as = "div",
  itemAs = "div",
  className,
}: {
  children: ReactNode;
  as?: "div" | "ul" | "ol" | "tbody";
  itemAs?: FadeRiseTag;
  className?: string;
}) {
  // The initialiser runs once, on mount, which is exactly "first mount only".
  // A later render — a filter, a sort, new data — sees the same answer.
  const [shouldStagger] = useState(() => hasHydrated());

  const Tag = as;
  const items = Children.toArray(children).filter(isValidElement);

  if (!shouldStagger) {
    return <Tag className={className}>{children}</Tag>;
  }

  return (
    <Tag className={className}>
      {items.map((child, index) => (
        <FadeRise
          key={child.key ?? index}
          as={itemAs}
          mountAnimation
          delay={Math.min(index, staggerToken.max - 1) * staggerToken.step}
        >
          {child}
        </FadeRise>
      ))}
    </Tag>
  );
}
