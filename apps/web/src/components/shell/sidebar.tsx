"use client";

import type { MissionSummary } from "@missions/protocol/missions";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useShell } from "@/components/shell/shell-context";
import type { SidebarLayout } from "@/components/shell/shell-context";
import { UserMenu } from "@/components/shell/user-menu";
import {
  ClockIcon,
  PlusIcon,
  PullRequestIcon,
  SearchIcon,
} from "@/components/ui/icons";
import { ListLabel, ListRow } from "@/components/ui/list-row";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LogoMark } from "@/components/ui/wordmark";
import { useMissions } from "@/lib/api/queries";
import { isMissionActive, MISSION_STATUS, shortAge } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const AGE_REFRESH_MS = 30_000;

const MissionRowStatus = ({
  mission,
  now,
}: {
  mission: MissionSummary;
  now: number;
}) => {
  if (isMissionActive(mission.status)) {
    return <Spinner label={MISSION_STATUS[mission.status].label} />;
  }
  if (mission.status === "awaiting_approval") {
    return (
      <span className="shrink-0 text-2xs leading-xs font-medium text-warning">
        Needs you
      </span>
    );
  }
  if (mission.status === "failed" || mission.status === "stop_failed") {
    return (
      <span className="shrink-0 text-2xs leading-xs font-medium text-danger">
        {MISSION_STATUS[mission.status].label}
      </span>
    );
  }
  return (
    <span className="shrink-0 font-mono text-2xs leading-xs text-text-tertiary">
      <span className="sr-only">{MISSION_STATUS[mission.status].label}, </span>
      {shortAge(mission.updatedAt, now)}
    </span>
  );
};

const sortMissions = (missions: readonly MissionSummary[]) =>
  missions
    .filter((mission) => mission.status !== "archived")
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));

const MissionList = ({ layout }: { layout: SidebarLayout }) => {
  const pathname = usePathname();
  const missions = useMissions();
  const now = useNow(AGE_REFRESH_MS);
  const touch = layout === "touch";

  if (missions.data === undefined) {
    if (missions.isError) {
      return (
        <p className="px-md py-xs text-xs leading-sm text-text-tertiary">
          Missions appear here once the daemon is reachable.
        </p>
      );
    }
    return (
      <div aria-hidden="true" className="flex flex-col gap-md px-md py-xs">
        <Skeleton className="w-3/4" />
        <Skeleton className="w-1/2" />
        <Skeleton className="w-2/3" />
      </div>
    );
  }

  const list = sortMissions(missions.data);
  if (list.length === 0) {
    return (
      <p className="px-md py-xs text-xs leading-sm text-text-tertiary">
        No missions yet
      </p>
    );
  }

  return (
    <ul className={cn("flex flex-col", touch ? "gap-2xs" : "gap-hairline")}>
      {list.map((mission) => {
        const href = `/missions/${mission.id}`;
        return (
          <li key={mission.id}>
            <ListRow asChild size={touch ? "touch" : "sidebar"}>
              <Link
                aria-current={pathname === href ? "page" : undefined}
                href={href}
              >
                <span className="line-clamp-1 min-w-0 flex-1">
                  {mission.title}
                </span>
                <MissionRowStatus mission={mission} now={now} />
              </Link>
            </ListRow>
          </li>
        );
      })}
    </ul>
  );
};

const AUTOMATIONS_UNAVAILABLE = "Automations aren't available in this app";

/** LFJ (desktop) and JD1 (drawer): navigation, the flat mission list, and the account. */
export const Sidebar = ({ layout = "desktop" }: { layout?: SidebarLayout }) => {
  const pathname = usePathname();
  const { setSearchOpen } = useShell();
  const touch = layout === "touch";
  const navSize = touch ? "touch-nav" : "sidebar-nav";

  return (
    <nav
      aria-label="Missions"
      className={cn(
        "flex h-full min-h-0 w-full flex-col",
        touch ? "gap-xl" : "px-lg pt-card pb-lg"
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-md",
          touch ? "h-11 px-control" : "h-7 px-md"
        )}
      >
        <LogoMark />
        <span className="flex-1 text-base leading-md font-semibold tracking-tight text-text">
          Missions
        </span>
        <button
          aria-keyshortcuts="Meta+K Control+K"
          aria-label="Search"
          className={cn(
            "flex shrink-0 cursor-pointer items-center justify-center rounded-sm text-text-secondary transition-colors duration-fast outline-none hover:bg-surface-overlay hover:text-text focus-visible:shadow-focus",
            touch ? "-mr-control size-9" : "-mr-xs size-6"
          )}
          onClick={() => setSearchOpen(true)}
          type="button"
        >
          <SearchIcon />
        </button>
      </div>

      <div
        className={cn(
          "flex shrink-0 flex-col",
          touch ? "gap-2xs" : "mt-xl gap-hairline"
        )}
      >
        <ListRow asChild size={navSize}>
          <Link
            aria-current={pathname === "/" ? "page" : undefined}
            aria-keyshortcuts="Meta+N Control+N"
            href="/"
          >
            <PlusIcon />
            <span className="flex-1">New mission</span>
            {touch ? null : (
              <span
                aria-hidden="true"
                className="font-mono text-2xs leading-xs font-book text-text-tertiary"
              >
                ⌘N
              </span>
            )}
          </Link>
        </ListRow>
        <ListRow asChild size={navSize}>
          <Link
            aria-current={pathname === "/pull-requests" ? "page" : undefined}
            href="/pull-requests"
          >
            <PullRequestIcon />
            <span className="flex-1">Pull requests</span>
          </Link>
        </ListRow>
        <Tooltip>
          <TooltipTrigger asChild>
            <ListRow aria-disabled="true" size={navSize}>
              <ClockIcon />
              <span className="flex-1">Automations</span>
              <span className="sr-only">. {AUTOMATIONS_UNAVAILABLE}</span>
            </ListRow>
          </TooltipTrigger>
          <TooltipContent side="right">
            {AUTOMATIONS_UNAVAILABLE}
          </TooltipContent>
        </Tooltip>
      </div>

      <section
        aria-labelledby={`missions-heading-${layout}`}
        className={cn(
          "-mx-xs flex min-h-0 flex-1 flex-col overflow-y-auto px-xs",
          touch ? "gap-2xs" : "mt-2xl gap-hairline"
        )}
      >
        <ListLabel
          id={`missions-heading-${layout}`}
          size={touch ? "touch" : "sidebar"}
        >
          Missions
        </ListLabel>
        <MissionList layout={layout} />
      </section>

      <UserMenu layout={layout} />
    </nav>
  );
};
