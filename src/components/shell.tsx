import type { ReactNode } from "react";
import { Sidebar, type NavKey } from "./sidebar";
import type { FounderContext } from "@/server/context";

/**
 * The dashboard frame: a 248 px sidebar and a main column that caps at
 * 1080 px, as every dashboard screen in the designs does.
 */
export function Shell({
  active,
  ctx,
  children,
  wide,
}: {
  active: NavKey;
  ctx: FounderContext;
  children: ReactNode;
  /** Board designer and Build Prompt use the full width for their split panes. */
  wide?: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-wrap bg-canvas text-ink">
      <div className="flex max-w-full flex-[1_1_248px] flex-col lg:max-w-[248px]">
        <Sidebar active={active} ctx={ctx} />
      </div>
      <main className="box-border min-w-0 flex-[999_1_560px] px-6 pb-12 pt-7 md:px-10">
        <div
          className={
            wide
              ? "mx-auto flex max-w-[1320px] flex-col gap-7"
              : "mx-auto flex max-w-[1080px] flex-col gap-7"
          }
        >
          {children}
        </div>
      </main>
    </div>
  );
}
