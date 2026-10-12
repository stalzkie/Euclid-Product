"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "../ui";

/**
 * The one "something is being generated" loop: a pink hairline with a brighter
 * highlight travelling along it.
 *
 * Only ever rendered while a request is actually in flight — it is a progress
 * indicator, not a decoration. It stops when it scrolls out of view or the tab
 * goes to the background, because a loop nobody is looking at is pure battery.
 *
 * Under reduced motion the CSS leaves the static hairline in place and the
 * caller shows a spinner and a "Generating…" label instead.
 */
export function Shimmer({
  className,
  height = 1,
  label,
}: {
  className?: string;
  /** 1px, as specced. Taller only where it sits on a card edge. */
  height?: number;
  /** Describes what is being generated, for screen readers. */
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const [tabActive, setTabActive] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { threshold: 0 },
    );
    observer.observe(el);

    const onVisibility = () => setTabActive(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={cx("eu-shimmer w-full", className)}
      style={{ height }}
      data-paused={!visible || !tabActive}
      role={label ? "status" : undefined}
      aria-label={label}
    />
  );
}
