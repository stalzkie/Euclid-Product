"use client";

import { useEffect, useRef, useState } from "react";
import { rollDigits } from "@/lib/motion/digits";

/**
 * Motion for the embedded widget.
 *
 * The widget must not import Motion: it renders inside a Shadow DOM on
 * someone else's page, and the bundle has a 40 KB ceiling. So everything here
 * is CSS keyframes and the Web Animations API, and the keyframes ship inside
 * the shadow root rather than in a stylesheet — nothing it does can reach the
 * host page, and nothing the host page does can reach it.
 *
 * The tokens are written out rather than read from custom properties for the
 * same reason: `globals.css` is not loaded in the embed, so there is no
 * `--eu-dur-fast` to resolve. They are the same values.
 */

/** 150ms, 250ms, 100ms and the three easings, as in `globals.css`. */
const WIDGET_CSS = `
.eu-w-press { transition: filter 150ms cubic-bezier(.2,0,0,1), transform 100ms cubic-bezier(.2,0,0,1), background-color 150ms cubic-bezier(.2,0,0,1), border-color 150ms cubic-bezier(.2,0,0,1), color 150ms cubic-bezier(.2,0,0,1); }
.eu-w-press:not(:disabled):hover { filter: brightness(.97); }
.eu-w-press:not(:disabled):active { transform: scale(.96); }

.eu-w-hop { display: block; animation: eu-w-hop 220ms cubic-bezier(.16,1,.3,1); }
@keyframes eu-w-hop {
  0% { transform: translateY(0); }
  45% { transform: translateY(-3px); }
  100% { transform: translateY(0); }
}

.eu-w-count { display: inline-flex; font-variant-numeric: tabular-nums; }
.eu-w-cell { position: relative; display: inline-block; width: 1ch; height: 1.15em; overflow: hidden; vertical-align: bottom; }
.eu-w-strip { position: absolute; inset: 0; display: flex; flex-direction: column; }
.eu-w-strip > span { display: block; height: 1.15em; line-height: 1.15em; text-align: right; }
.eu-w-strip[data-dir="up"] { animation: eu-w-roll-up 220ms cubic-bezier(.16,1,.3,1) forwards; }
.eu-w-strip[data-dir="down"] { animation: eu-w-roll-down 220ms cubic-bezier(.16,1,.3,1) forwards; }
.eu-w-strip[data-dir="none"] { transform: translateY(0); }
@keyframes eu-w-roll-up { from { transform: translateY(0); } to { transform: translateY(-1.15em); } }
@keyframes eu-w-roll-down { from { transform: translateY(-1.15em); } to { transform: translateY(0); } }

.eu-w-rise { animation: eu-w-rise 200ms cubic-bezier(.16,1,.3,1); }
@keyframes eu-w-rise {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}

.eu-w-fade { animation: eu-w-fade 150ms cubic-bezier(.16,1,.3,1); }
@keyframes eu-w-fade { from { opacity: 0; } to { opacity: 1; } }

.eu-w-spin { animation: eu-w-spin 800ms linear infinite; }
@keyframes eu-w-spin { to { transform: rotate(360deg); } }

/* The host's reduced-motion setting reaches inside the shadow root, which is
   exactly what we want: it is the visitor's preference, not the page's. */
@media (prefers-reduced-motion: reduce) {
  .eu-w-press { transition: filter 120ms linear, background-color 120ms linear, border-color 120ms linear, color 120ms linear; }
  .eu-w-press:not(:disabled):active { transform: none; }
  .eu-w-hop { animation: none; }
  .eu-w-strip { animation: none !important; transform: translateY(-1.15em); }
  .eu-w-strip[data-dir="down"] { transform: translateY(0); }
  .eu-w-rise { animation: eu-w-fade 120ms linear; }
  .eu-w-fade { animation: eu-w-fade 120ms linear; }
}
`;

/**
 * The widget's keyframes, mounted inside its own subtree.
 *
 * Rendered as a style element rather than injected into `document.head` so it
 * lands in the shadow root with the rest of the widget and is removed with it.
 */
export function WidgetMotion() {
  return <style dangerouslySetInnerHTML={{ __html: WIDGET_CSS }} />;
}

/** Whether the visitor has asked for less movement. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * The vote count, rolling the digits that changed.
 *
 * Same behaviour as `AnimatedNumber` in the dashboard and the same arithmetic
 * behind it, but driven by two CSS keyframes instead of a spring, because the
 * widget cannot carry an animation library.
 */
export function WidgetCount({ value }: { value: number }) {
  const text = String(value);

  const [seen, setSeen] = useState(() => ({
    previous: value,
    current: value,
    widest: text.length,
    // Bumped on every change, so the CSS animation replays rather than
    // being considered already finished.
    tick: 0,
  }));

  let state = seen;
  if (seen.current !== value) {
    state = {
      previous: seen.current,
      current: value,
      widest: Math.max(seen.widest, text.length),
      tick: seen.tick + 1,
    };
    setSeen(state);
  }

  const roll = rollDigits(state.previous, state.current, { minWidth: state.widest });

  return (
    <span className="eu-w-count">
      {roll.slots.map((slot) => {
        const direction = slot.changed ? roll.direction : "none";
        // Up means the new digit arrives from below, so it sits second in the
        // strip; down reverses the pair.
        const order =
          direction === "down"
            ? [slot.char, slot.previous ?? ""]
            : [slot.previous ?? "", slot.char];

        return (
          <span key={slot.key} className="eu-w-cell">
            <span
              key={`${state.tick}-${direction}`}
              className="eu-w-strip"
              data-dir={direction}
            >
              <span>{direction === "none" ? slot.char : order[0]}</span>
              <span>{direction === "none" ? slot.char : order[1]}</span>
            </span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * Opens and closes a box in the flow by animating its measured height.
 *
 * The Web Animations API rather than a CSS transition because `auto` is not an
 * animatable value: the height has to be measured first, and then handed over
 * as a number. Used for the "already suggested?" nudge, which must never make
 * the form jump while someone is typing into it.
 */
export function useHeightReveal(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);

  useEffect(() => {
    const el = ref.current;
    if (!el || wasOpen.current === open) return;
    wasOpen.current = open;

    if (!open || prefersReducedMotion()) return;

    const height = el.scrollHeight;
    el.animate(
      [
        { height: "0px", opacity: 0 },
        { height: `${height}px`, opacity: 1 },
      ],
      { duration: 200, easing: "cubic-bezier(.16,1,.3,1)" },
    );
  }, [open]);

  return ref;
}

/** A 14px spinner, matching the dashboard's. */
export function WidgetSpinner({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" className="eu-w-spin" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9.25"
        fill="none"
        stroke={color}
        strokeOpacity={0.25}
        strokeWidth={2.6}
      />
      <path
        d="M12 2.75a9.25 9.25 0 0 1 9.25 9.25"
        fill="none"
        stroke={color}
        strokeWidth={2.6}
        strokeLinecap="round"
      />
    </svg>
  );
}
