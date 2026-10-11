import Link from "next/link";
import {
  CollapseIcon,
  Icon,
  InviteIcon,
  Logo,
  SearchIcon,
  SettingsIcon,
  type IconName,
} from "./icons";
import { Meter, cx } from "./ui";
import { PLANS } from "@/lib/plans";
import type { FounderContext } from "@/server/context";
import { BoardSwitcher } from "./board-switcher";

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

  const row = (item: NavItem) => {
    const on = item.key === active;
    return (
      <Link
        key={item.key}
        href={item.href}
        aria-current={on ? "page" : undefined}
        className={cx(
          "flex h-8 items-center gap-[10px] rounded-control px-[10px] text-[13.5px] no-underline",
          on
            ? "bg-nav-active font-medium text-ink"
            : "font-normal text-ink-body hover:bg-muted",
        )}
      >
        <Icon name={item.icon} size={16} className="shrink-0" />
        <span className="flex-1">{item.label}</span>
        {item.count ? (
          <span className="tnum text-[11.5px] text-ink-3">{item.count}</span>
        ) : null}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Main"
      className="flex h-full min-h-screen w-full flex-col gap-[2px] border-r border-line bg-subtle px-3 pb-3 pt-[14px]"
    >
      <div className="flex items-center justify-between px-1 pb-[10px]">
        <Link href="/" className="flex items-center gap-2 text-ink no-underline">
          <Logo size={22} />
          <span className="text-[16px] font-semibold tracking-[-0.01em]">Euclid</span>
        </Link>
        <div className="flex gap-[2px]">
          <Link
            href="/feedback"
            aria-label="Search, Command K"
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-2 hover:bg-muted"
          >
            <SearchIcon />
          </Link>
          <button
            type="button"
            aria-label="Collapse sidebar"
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-2 hover:bg-muted"
          >
            <CollapseIcon />
          </button>
        </div>
      </div>

      <BoardSwitcher ctx={ctx} />

      <Link
        href="/ask"
        className="mb-[10px] mt-[6px] flex h-[34px] items-center gap-2 rounded-control border border-line bg-canvas px-[10px] text-[13.5px] font-medium text-ink no-underline shadow-[0_1px_2px_rgba(23,23,26,0.04)] hover:bg-subtle"
      >
        <Icon name="sparkle" size={15} strokeWidth={1.9} className="text-ai" />
        <span className="flex-1">Ask Euclid</span>
        <span className="rounded-[5px] border border-line px-[5px] font-mono text-[11px] text-ink-3">
          ⌘J
        </span>
      </Link>

      {main.map(row)}

      <div className="flex items-center justify-between px-[10px] pb-[6px] pt-4 text-[12px] font-medium text-ink-3">
        <span>Boards</span>
        <Link
          href="/designer?new=1"
          aria-label="Add board"
          className="flex h-[22px] w-[22px] items-center justify-center rounded-chip text-ink-3 hover:bg-muted"
        >
          <Icon name="plus" size={14} strokeWidth={1.9} />
        </Link>
      </div>
      {ctx.boards.map((b) => (
        <Link
          key={b.id}
          href={`/feedback?board=${b.id}`}
          className={cx(
            "flex h-[30px] items-center gap-[10px] rounded-control px-[10px] text-[13.5px] no-underline hover:bg-muted",
            b.id === ctx.board.id ? "text-ink" : "text-ink-body",
          )}
        >
          <span className="flex w-4 justify-center">
            <span
              className="h-2 w-2 rounded-[3px]"
              style={{ background: b.color }}
            />
          </span>
          <span className="flex-1 truncate">{b.name}</span>
          <span className="tnum text-[11.5px] text-ink-3">{ctx.boardCounts[b.id] ?? 0}</span>
        </Link>
      ))}

      <div className="px-[10px] pb-[6px] pt-4 text-[12px] font-medium text-ink-3">
        Configure
      </div>
      {configure.map(row)}

      <div className="min-h-6 flex-1" />

      <Link
        href="/billing"
        className="flex h-8 items-center gap-[10px] rounded-control px-[10px] text-[13.5px] text-ink-body no-underline hover:bg-muted"
      >
        <InviteIcon />
        Invite a teammate
      </Link>
      <Link
        href="/billing"
        className={cx(
          "flex h-8 items-center gap-[10px] rounded-control px-[10px] text-[13.5px] no-underline",
          active === "settings"
            ? "bg-nav-active font-medium text-ink"
            : "text-ink-body hover:bg-muted",
        )}
      >
        <SettingsIcon />
        Settings
      </Link>

      {/* AI credits meter. Hidden on Pro, which has no practical ceiling. */}
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
            className="flex h-[30px] items-center justify-center rounded-[7px] bg-state text-[12.5px] font-medium text-white no-underline hover:bg-[#095fb8]"
          >
            Upgrade to {ctx.workspace.plan === "free" ? "Indie" : "Pro"}
          </Link>
        )}
      </div>

      <div className="flex items-center gap-[9px] px-1 pt-[10px]">
        <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-ai-tint text-[11px] font-semibold text-ai-deep">
          {ctx.initials}
        </span>
        <span className="flex-1 truncate text-[13.5px]">{ctx.name}</span>
        <Link
          href="/feedback"
          aria-label="Notifications"
          className="relative flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-2 hover:bg-muted"
        >
          <Icon name="bell" size={16} />
          <span className="absolute right-[6px] top-[5px] h-[6px] w-[6px] rounded-full bg-ai-bright" />
        </Link>
      </div>
    </nav>
  );
}
