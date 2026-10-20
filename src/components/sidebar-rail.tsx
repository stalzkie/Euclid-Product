"use client";

import { m } from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { CollapseIcon } from "./icons";
import { cx } from "./ui";
import { dur, ease } from "@/lib/motion/tokens";

/**
 * The sidebar's collapsed-to-a-rail state.
 *
 * The order matters and is the whole point of the animation: collapsing fades
 * the labels out first and only then narrows the column, so text never gets
 * squeezed; expanding does it the other way round, widening before the labels
 * arrive, so they never appear in a space too small to hold them.
 */
const RailContext = createContext<{ collapsed: boolean; toggle: () => void }>({
  collapsed: false,
  toggle: () => {},
});

const STORAGE_KEY = "eu-sidebar-collapsed";

/** How long the labels take to go. The width waits for this. */
const LABEL_FADE = dur.press;

/*
  A tiny store rather than state in an effect. The server has no localStorage,
  so it reports "expanded"; the client reads the stored choice on its first
  snapshot after hydration. React reconciles the difference itself, which keeps
  the markup honest without a flash of the wrong width.
*/
const listeners = new Set<() => void>();
let cached: boolean | null = null;

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Storage can be blocked. An expanded sidebar is the safe default.
    return false;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): boolean {
  if (cached === null) cached = readStored();
  return cached;
}

function getServerSnapshot(): boolean {
  return false;
}

function setCollapsedGlobal(next: boolean): void {
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // Nothing to do; the choice just will not survive a reload.
  }
  for (const listener of listeners) listener();
}

export function SidebarRail({ children }: { children: ReactNode }) {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => setCollapsedGlobal(!getSnapshot()), []);

  return (
    <RailContext.Provider value={{ collapsed, toggle }}>
      {/*
        A layout animation rather than a width transition: Motion measures the
        two widths and moves between them with transforms, so the browser is
        not laying the whole page out again on every frame of the collapse.
      */}
      <m.div
        layout
        transition={{
          duration: dur.slow,
          ease: ease.standard,
          // Collapsing waits for the labels to clear; expanding goes first.
          delay: collapsed ? LABEL_FADE : 0,
        }}
        data-collapsed={collapsed || undefined}
        className={cx(
          "flex max-w-full flex-col",
          /*
            Pinned to the viewport from `lg` up, which is where the rail is a
            column beside the page rather than a block stacked above it.

            `self-start` is the load-bearing half. A flex item stretches to the
            height of its line by default, so the rail was as tall as whatever
            the main column happened to be — on a long page its footer sat at
            the bottom of the *document*, and signing out meant scrolling past
            everything to reach it. Without `self-start` the explicit height is
            overridden by the stretch and `sticky` has no slack to move in.

            Below `lg` the shell wraps and the rail is full width above the
            content, where pinning it would hold a screen-tall block over the
            page. So none of this applies there.
          */
          "lg:sticky lg:top-0 lg:h-dvh lg:self-start",
          collapsed ? "lg:max-w-[56px] lg:flex-[1_1_56px]" : "lg:max-w-[248px] lg:flex-[1_1_248px]",
        )}
      >
        {children}
      </m.div>
    </RailContext.Provider>
  );
}

/**
 * A label that is only there when the sidebar is wide.
 *
 * It keeps its space in the layout while fading, and is taken out of the
 * accessibility tree once gone — a rail of icons should not announce labels
 * nobody can see.
 */
export function RailLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { collapsed } = useContext(RailContext);

  return (
    <span
      aria-hidden={collapsed || undefined}
      className={cx(
        "min-w-0 truncate transition-opacity ease-eu-standard",
        // 100ms out, and on the way back it waits for the width to arrive.
        collapsed
          ? "pointer-events-none opacity-0 duration-[var(--eu-dur-press)]"
          : "opacity-100 duration-[var(--eu-dur-fast)] delay-[var(--eu-dur-slow)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Hides anything that has no meaning at 56px — a meter, a plan chip. */
export function RailOnlyWide({ children }: { children: ReactNode }) {
  const { collapsed } = useContext(RailContext);
  if (collapsed) return null;
  return children;
}

/**
 * The inverse: only at 56px.
 *
 * For the handful of things that cannot simply be dropped from the rail. A
 * meter is noise without its label, but a control that is the only way to do
 * something has to go somewhere — so it moves rather than disappears, and
 * this is where it moves to.
 */
export function RailOnlyNarrow({ children }: { children: ReactNode }) {
  const { collapsed } = useContext(RailContext);
  if (!collapsed) return null;
  return children;
}

export function RailToggle() {
  const { collapsed, toggle } = useContext(RailContext);

  return (
    <button
      type="button"
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      onClick={toggle}
      className="eu-press flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-2 hover:bg-muted"
    >
      <span
        className={cx(
          "flex transition-transform duration-[var(--eu-dur-base)] ease-eu-standard",
          collapsed && "rotate-180",
        )}
      >
        <CollapseIcon />
      </span>
    </button>
  );
}
