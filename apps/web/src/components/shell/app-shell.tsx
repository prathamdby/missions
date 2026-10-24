"use client";

import type { ReactNode } from "react";

import { GlobalShortcuts } from "@/components/shell/global-shortcuts";
import { SearchDialog } from "@/components/shell/search-dialog";
import { useShell } from "@/components/shell/shell-context";
import { Sidebar } from "@/components/shell/sidebar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

/** Sidebar, then one rounded pane that pages fill. Below `md` the sidebar is a drawer (JD1). */
export const AppShell = ({ children }: { children: ReactNode }) => {
  const { navOpen, setNavOpen } = useShell();
  return (
    <div className="relative flex h-dvh overflow-hidden bg-bg">
      <aside
        aria-label="Missions navigation"
        className="hidden w-sidebar shrink-0 md:flex"
      >
        <Sidebar />
      </aside>
      <Sheet onOpenChange={setNavOpen} open={navOpen}>
        <SheetContent aria-describedby={undefined} side="left">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar layout="touch" />
        </SheetContent>
      </Sheet>
      <main className="flex min-w-0 flex-1 md:my-md md:mr-md" id="main">
        <div className="relative flex min-w-0 flex-1 overflow-hidden bg-surface md:rounded-lg md:shadow-sm">
          {children}
        </div>
      </main>
      <SearchDialog />
      <GlobalShortcuts />
    </div>
  );
};
