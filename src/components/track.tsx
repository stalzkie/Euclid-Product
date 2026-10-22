"use client";

import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics/client";
import type { EventName, Props } from "@/lib/analytics/events";

/**
 * Record that a screen was opened.
 *
 * Rendered by the server component for each screen, which is why this is a
 * component and not a call in a layout: the layout cannot tell `/posts/3` from
 * `/themes`, and the page already knows what it is.
 *
 * Fires in an effect, once per mount. Three things follow from that, all of
 * them the reason it is written this way:
 *
 *   - **A prefetch does not count.** Next fetches the RSC payload for a
 *     hovered link, which renders the server component without ever mounting
 *     it in the browser. Capturing on the server would have counted a screen
 *     the founder never looked at.
 *   - **A re-render does not count.** The ref guards against the second run
 *     of an effect, which React does deliberately in development.
 *   - **A revalidation does not count.** A server action that calls
 *     `revalidatePath` re-renders the page without remounting it.
 */
export function TrackScreen({ name, props }: { name: EventName; props?: Props }) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    track(name, props);
    // `props` is a fresh object on every render, so it is deliberately not a
    // dependency: the ref is what makes this once-per-mount, not the array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  return null;
}
