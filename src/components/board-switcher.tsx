"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { cx } from "./ui";
import { PLANS } from "@/lib/plans";
import type { FounderContext } from "@/server/context";

/** Workspace and board switcher at the top of the sidebar. */
export function BoardSwitcher({ ctx }: { ctx: FounderContext }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const plan = PLANS[ctx.workspace.plan];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = async (boardId: string) => {
    setOpen(false);
    await fetch("/api/board/select", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ boardId }),
    });
    router.refresh();
  };

  const boardCount = ctx.boards.length;

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        aria-label="Switch workspace"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-full items-center gap-[9px] rounded-control px-2 text-left text-ink hover:bg-muted"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-chip bg-brand text-[12px] font-semibold text-white">
          {ctx.workspace.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-[1.2]">
          <span className="truncate text-[13.5px] font-medium">{ctx.workspace.name}</span>
          <span className="text-[11.5px] text-ink-3">
            {plan.name} plan · {boardCount} board{boardCount === 1 ? "" : "s"}
          </span>
        </span>
        <Icon name="chevronUpDown" size={14} strokeWidth={1.8} className="text-ink-3" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[44px] z-30 flex flex-col gap-[2px] rounded-card border border-line bg-canvas p-2 shadow-overlay">
          <p className="px-2 py-1 text-[11.5px] font-medium uppercase tracking-[0.05em] text-ink-3">
            Boards
          </p>
          {ctx.boards.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => pick(b.id)}
              className={cx(
                "flex h-8 items-center gap-[10px] rounded-control px-2 text-left text-[13.5px] hover:bg-muted",
                b.id === ctx.board.id ? "font-medium text-ink" : "text-ink-body",
              )}
            >
              <span className="h-2 w-2 rounded-[3px]" style={{ background: b.color }} />
              <span className="flex-1 truncate">{b.name}</span>
              {b.id === ctx.board.id && (
                <Icon name="check" size={13} strokeWidth={2.2} className="text-state" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
