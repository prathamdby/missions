"use client";

import { PanelLeftIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useShell } from "@/components/shell/shell-context";
import { IconButton } from "@/components/ui/button";

/** Top bar of the center column. On mobile it carries the navigation toggle. */
export const PageHeader = ({ children }: { children: ReactNode }) => {
  const { setNavOpen } = useShell();
  return (
    <header className="flex h-12 shrink-0 items-center gap-md border-b border-border-subtle px-lg md:px-xl">
      <IconButton
        className="-ml-xs md:hidden"
        icon={<PanelLeftIcon />}
        label="Open navigation"
        onClick={() => setNavOpen(true)}
      />
      {children}
    </header>
  );
};

export const PageTitle = ({ children }: { children: ReactNode }) => (
  <h1 className="min-w-0 truncate type-label font-semibold text-text">
    {children}
  </h1>
);
