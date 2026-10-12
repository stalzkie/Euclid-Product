import type { ReactNode } from "react";
import { Sidebar, type NavKey } from "./sidebar";
import { SidebarRail } from "./sidebar-rail";
import { RouteFade } from "./route-fade";
import type { FounderContext } from "@/server/context";

/**
 * The dashboard frame: a 248 px sidebar and a main column that caps at
 * 1080 px, as every dashboard screen in the designs does.
 *
 * The fade on route change is around the main column only, so the sidebar
 * holds still while the page under it changes.
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
      <SidebarRail>
        <Sidebar active={active} ctx={ctx} />
      </SidebarRail>
      <main className="box-border min-w-0 flex-[999_1_560px] px-6 pb-12 pt-7 md:px-10">
        <RouteFade>
          <div
            className={
              wide
                ? "mx-auto flex max-w-[1320px] flex-col gap-7"
                : "mx-auto flex max-w-[1080px] flex-col gap-7"
            }
          >
            {children}
          </div>
        </RouteFade>
      </main>
    </div>
  );
}
