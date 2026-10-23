"use client";

import type { ReactNode } from "react";

import { useShell } from "@/components/shell/shell-context";
import { Sidebar } from "@/components/shell/sidebar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

/** Sidebar, then one rounded pane that pages fill. Below `md` the sidebar is a drawer. */
export const AppShell = ({ children }: { children: ReactNode }) => {
  const { navOpen, setNavOpen } = useShell();
  return (
    <div className="flex h-dvh overflow-hidden bg-bg">
      <aside
        aria-label="Missions navigation"
        className="hidden w-sidebar shrink-0 md:flex"
      >
        <Sidebar />
      </aside>
      <Sheet onOpenChange={setNavOpen} open={navOpen}>
        <SheetContent aria-describedby={undefined} side="left">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar />
        </SheetContent>
      </Sheet>
      <main
        className="flex min-w-0 flex-1 md:py-md md:pr-md"
        id="main"
        tabIndex={-1}
      >
        <div className="flex min-w-0 flex-1 overflow-hidden bg-surface md:rounded-lg md:shadow-sm">
          {children}
        </div>
      </main>
    </div>
  );
};
