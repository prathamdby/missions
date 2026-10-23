"use client";

import { useRouter } from "next/navigation";

import type { SidebarLayout } from "@/components/shell/shell-context";
import { Avatar } from "@/components/ui/avatar";
import { Dot } from "@/components/ui/dot";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SettingsIcon, UnfoldIcon } from "@/components/ui/icons";
import { useGithubAuth } from "@/lib/api/queries";
import { useConnection } from "@/lib/live/hooks";
import { cn } from "@/lib/utils";

const DAEMON_LABEL = {
  connecting: "Connecting to the daemon",
  offline: "Daemon offline",
  online: "Daemon connected",
} as const;

const DAEMON_TONE = {
  connecting: "tertiary",
  offline: "danger",
  online: "success",
} as const;

/** Footer account card. Settings live in its menu because Paper's sidebar has no Settings row. */
export const UserMenu = ({ layout }: { layout: SidebarLayout }) => {
  const router = useRouter();
  const auth = useGithubAuth();
  const { phase } = useConnection();
  const touch = layout === "touch";
  const login = auth.data?.state === "signed_in" ? auth.data.user : null;
  const name = login ?? "Local workspace";
  const detail = login ? "Personal workspace" : "This machine";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`${name}, account and settings`}
          className={cn(
            "flex w-full shrink-0 cursor-pointer items-center gap-control rounded-sm text-left transition-colors duration-fast outline-none hover:bg-surface-overlay focus-visible:shadow-focus data-[state=open]:bg-surface-overlay",
            touch ? "h-13 px-control" : "h-11 px-md"
          )}
          type="button"
        >
          <Avatar name={name} size={touch ? "touch" : "md"} />
          <span className="flex min-w-0 flex-1 flex-col gap-hairline">
            <span className="truncate text-sm leading-sm font-medium tracking-tight text-text">
              {name}
            </span>
            <span className="truncate text-xs leading-sm tracking-tight text-text-tertiary">
              {detail}
            </span>
          </span>
          <UnfoldIcon tone="secondary" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56" side="top">
        <DropdownMenuLabel>
          <span className="flex items-center gap-sm">
            <Dot tone={DAEMON_TONE[phase]} />
            {DAEMON_LABEL[phase]}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/settings")}>
          <SettingsIcon />
          Settings
          <DropdownMenuShortcut>⌘,</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
