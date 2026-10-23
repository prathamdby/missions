"use client";

import type { ReactNode } from "react";

import { useShell } from "@/components/shell/shell-context";
import { SidebarLeftIcon } from "@/components/ui/icons";

/** Top bar of the center column (52px). On touch screens it carries the drawer toggle (YL0). */
export const PageHeader = ({ children }: { children: ReactNode }) => {
  const { setNavOpen } = useShell();
  return (
    <header className="flex h-13 shrink-0 items-center gap-xs border-b border-border-subtle px-md md:gap-control md:border-b-0 md:pr-xl md:pl-gutter">
      <button
        aria-label="Open navigation"
        className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-sm text-text-secondary transition-colors duration-fast outline-none hover:bg-surface-overlay hover:text-text focus-visible:shadow-focus md:hidden"
        onClick={() => setNavOpen(true)}
        type="button"
      >
        <SidebarLeftIcon />
      </button>
      {children}
    </header>
  );
};

export const PageTitle = ({ children }: { children: ReactNode }) => (
  <h1 className="line-clamp-1 min-w-0 pl-xs text-base leading-md font-semibold tracking-tight text-text md:pl-0 md:text-text-secondary">
    {children}
  </h1>
);
