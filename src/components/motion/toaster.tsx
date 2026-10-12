"use client";

import { AnimatePresence, m } from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { dur, ease, exitOf, rise, spring } from "@/lib/motion/tokens";
import { cx } from "../ui";

export type ToastTone = "neutral" | "ok" | "bad";

export interface ToastOptions {
  tone?: ToastTone;
  /** Milliseconds on screen. Errors get longer by default. */
  duration?: number;
}

interface Toast extends Required<ToastOptions> {
  id: number;
  message: string;
}

type Push = (message: string, options?: ToastOptions) => void;

const ToastContext = createContext<Push>(() => {
  // No provider in the tree: a toast is confirmation, never the only record of
  // what happened, so dropping it is safe.
});

/** Raise a toast. Returns a no-op outside a `Toaster`. */
export function useToast(): Push {
  return useContext(ToastContext);
}

const TONES: Record<ToastTone, string> = {
  neutral: "border-ink-edge bg-ink text-white",
  ok: "border-ok-line bg-ok-wash text-ok",
  bad: "border-bad-line bg-bad-wash text-bad",
};

let nextId = 0;

/**
 * The toast stack: bottom right, newest at the bottom.
 *
 * Toasts rise 8px as they fade in and slide 8px right as they leave, which is
 * the direction they came from. When one goes, the rest settle into the gap
 * with a layout animation rather than jumping.
 *
 * Hovering the stack pauses every dismiss timer — a toast carrying an undo or
 * a post number should not vanish while it is being read. Each timer keeps its
 * own remaining time, so pausing twice does not reset the clock.
 */
export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [paused, setPaused] = useState(false);

  const push = useCallback<Push>((message, options = {}) => {
    const tone = options.tone ?? "neutral";
    setToasts((current) => [
      ...current,
      {
        id: (nextId += 1),
        message,
        tone,
        duration: options.duration ?? (tone === "bad" ? 6000 : 4000),
      },
    ]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2"
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <Row key={toast.id} toast={toast} paused={paused} onDone={dismiss} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

function Row({
  toast,
  paused,
  onDone,
}: {
  toast: Toast;
  paused: boolean;
  onDone: (id: number) => void;
}) {
  const remaining = useRef(toast.duration);

  useEffect(() => {
    if (paused) return;

    const started = Date.now();
    const timer = setTimeout(() => onDone(toast.id), remaining.current);

    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [paused, toast.id, onDone]);

  return (
    <m.div
      layout
      role="status"
      initial={{ opacity: 0, y: rise.md }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: rise.md, transition: exitOf(dur.base) }}
      transition={{ duration: dur.base, ease: ease.out, layout: spring.snappy }}
      className={cx(
        "pointer-events-auto flex max-w-[360px] items-center gap-2 rounded-control",
        "border px-3 py-[9px] text-[13px] font-medium shadow-overlay",
        TONES[toast.tone],
      )}
    >
      <span className="flex-1">{toast.message}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => onDone(toast.id)}
        className="shrink-0 opacity-60 transition-opacity duration-[var(--eu-dur-fast)] hover:opacity-100"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6 6l12 12M18 6L6 18"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </m.div>
  );
}
