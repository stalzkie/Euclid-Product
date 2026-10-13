import Link from "next/link";
import { Icon, InviteIcon, Logo, SearchIcon, type IconName } from "./icons";
import { Meter } from "./ui";
import { PLANS } from "@/lib/plans";
import type { FounderContext } from "@/server/context";
import { BoardSwitcher } from "./board-switcher";
import { SidebarNav, NotificationDot, RailHeading, type NavRow } from "./sidebar-nav";
import { RailLabel, RailOnlyWide, RailToggle } from "./sidebar-rail";

export type NavKey =
  | "home"
  | "feedback"
  | "themes"
  | "insights"
  | "prompts"
  | "changelog"
  | "designer"
  | "install"
  | "profile"
  | "settings"
  | "none";

interface NavItem {
  key: NavKey;
  label: string;
  href: string;
  icon: IconName;
  count?: number;
}

/** One highlight for the whole sidebar, so it slides between any two rows. */
const ACTIVE_HIGHLIGHT = "sidebar-active";

export function Sidebar({
  active,
  ctx,
}: {
  active: NavKey;
  ctx: FounderContext;
}) {
  const plan = PLANS[ctx.workspace.plan];
  const openPosts = ctx.boardCounts[ctx.board.id] ?? 0;

  const main: NavItem[] = [
    { key: "home", label: "Home", href: "/", icon: "home" },
    { key: "feedback", label: "Feedback", href: "/feedback", icon: "feedback", count: openPosts },
    { key: "themes", label: "Themes", href: "/themes", icon: "themes" },
    { key: "insights", label: "Insights", href: "/insights", icon: "insights" },
    { key: "prompts", label: "Build Prompts", href: "/prompts", icon: "prompts" },
    { key: "changelog", label: "Changelog", href: "/changelog", icon: "changelog" },
  ];

  const configure: NavItem[] = [
    { key: "designer", label: "Board designer", href: "/designer", icon: "designer" },
    { key: "install", label: "Install widget", href: "/install", icon: "install" },
    { key: "profile", label: "Project profile", href: "/profile", icon: "profile" },
  ];

  const toRows = (items: NavItem[]): NavRow[] =>
    items.map((item) => ({
      key: item.key,
      label: item.label,
      href: item.href,
      icon: item.icon,
      count: item.count,
      active: item.key === active,
    }));

  const boardRows: NavRow[] = ctx.boards.map((b) => ({
    key: b.id,
    label: b.name,
    href: `/feedback?board=${b.id}`,
    swatch: b.color,
    count: ctx.boardCounts[b.id] ?? 0,
    height: "sm",
  }));

  return (
    <nav
      aria-label="Main"
      className="flex h-full min-h-screen w-full flex-col gap-[2px] overflow-hidden border-r border-line bg-subtle px-3 pb-3 pt-[14px]"
    >
      <div className="flex items-center justify-between px-1 pb-[10px]">
        <Link href="/" className="flex items-center gap-2 text-ink no-underline">
          <Logo size={22} />
          <RailLabel className="text-[16px] font-semibold tracking-[-0.01em]">Euclid</RailLabel>
        </Link>
        <div className="flex gap-[2px]">
          <RailOnlyWide>
            <Link
              href="/feedback"
              aria-label="Search, Command K"
              className="eu-press flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-2 hover:bg-muted"
            >
              <SearchIcon />
            </Link>
          </RailOnlyWide>
          <RailToggle />
        </div>
      </div>

      <RailOnlyWide>
        <BoardSwitcher ctx={ctx} />
      </RailOnlyWide>

      <Link
        href="/ask"
        className="eu-press mb-[10px] mt-[6px] flex h-[34px] items-center gap-2 rounded-control border border-line bg-canvas px-[10px] text-[13.5px] font-medium text-ink no-underline shadow-[0_1px_2px_rgba(23,23,26,0.04)] hover:bg-subtle"
      >
        <Icon name="sparkle" size={15} strokeWidth={1.9} className="shrink-0 text-ai" />
        <RailLabel className="flex-1">Ask Euclid</RailLabel>
        <RailLabel>
          <span className="rounded-[5px] border border-line px-[5px] font-mono text-[11px] text-ink-3">
            ⌘J
          </span>
        </RailLabel>
      </Link>

      <SidebarNav group={ACTIVE_HIGHLIGHT} rows={toRows(main)} />

      <div className="flex items-center justify-between px-[10px] pb-[6px] pt-4 text-[12px] font-medium text-ink-3">
        <RailHeading>Boards</RailHeading>
        <RailOnlyWide>
          <Link
            href="/designer?new=1"
            aria-label="Add board"
            className="eu-press flex h-[22px] w-[22px] items-center justify-center rounded-chip text-ink-3 hover:bg-muted"
          >
            <Icon name="plus" size={14} strokeWidth={1.9} />
          </Link>
        </RailOnlyWide>
      </div>
      <SidebarNav group={ACTIVE_HIGHLIGHT} rows={boardRows} />

      <div className="px-[10px] pb-[6px] pt-4 text-[12px] font-medium text-ink-3">
        <RailHeading>Configure</RailHeading>
      </div>
      <SidebarNav group={ACTIVE_HIGHLIGHT} rows={toRows(configure)} />

      <div className="min-h-6 flex-1" />

      <SidebarNav
        group={ACTIVE_HIGHLIGHT}
        rows={[
          {
            key: "settings",
            label: "Settings",
            href: "/billing",
            icon: "settings",
            active: active === "settings",
          },
        ]}
      />

      <Link
        href="/billing"
        className="eu-colors flex h-8 items-center gap-[10px] rounded-control px-[10px] text-[13.5px] text-ink-body no-underline hover:bg-muted"
      >
        <span className="flex w-4 shrink-0 justify-center">
          <InviteIcon />
        </span>
        <RailLabel>Invite a teammate</RailLabel>
      </Link>

      {/* AI credits meter. Hidden on Pro, which has no practical ceiling. */}
      <RailOnlyWide>
        <div className="mt-[10px] flex flex-col gap-2 rounded-[10px] border border-line bg-canvas p-3">
          <div className="flex justify-between text-[12px]">
            <span className="text-ink-2">Build Prompts</span>
            <span className="tnum text-ink">
              {ctx.workspace.prompts_used} of {plan.buildPrompts}
            </span>
          </div>
          <Meter value={ctx.workspace.prompts_used} max={plan.buildPrompts} />
          {ctx.workspace.plan !== "pro" && (
            <Link
              href="/billing"
              className="eu-press flex h-[30px] items-center justify-center rounded-[7px] bg-state text-[12.5px] font-medium text-white no-underline hover:bg-[#095fb8]"
            >
              Upgrade to {ctx.workspace.plan === "free" ? "Indie" : "Pro"}
            </Link>
          )}
        </div>
      </RailOnlyWide>

      <div className="flex items-center gap-[9px] px-1 pt-[10px]">
        <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-ai-tint text-[11px] font-semibold text-ai-deep">
          {ctx.initials}
        </span>
        <RailLabel className="flex-1 text-[13.5px]">{ctx.name}</RailLabel>
        <RailOnlyWide>
          <Link
            href="/feedback"
            aria-label="Notifications"
            className="eu-press relative flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-2 hover:bg-muted"
          >
            <Icon name="bell" size={16} />
            <NotificationDot show />
          </Link>
          {/*
            Signing out. A plain form rather than a link or a click handler:
            `/auth/signout` is POST only — it has to be, since a GET that
            destroys a session can be triggered by any image tag on any page —
            and this keeps it working with no client JavaScript at all.

            The route has existed since the beginning and nothing ever linked
            to it, so until now a founder could not sign out of the product.
          */}
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              aria-label="Sign out"
              title="Sign out"
              className="eu-press flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-2 hover:bg-muted"
            >
              <Icon name="external" size={16} />
            </button>
          </form>
        </RailOnlyWide>
      </div>
    </nav>
  );
}
