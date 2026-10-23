"use client";

import { usePathname } from "next/navigation";
import { createContext, use, useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type SidebarLayout = "desktop" | "touch";

interface ShellState {
  navOpen: boolean;
  /** Project the next new-mission form should select, set from search. */
  preferredProject: { id: string; at: number } | null;
  searchOpen: boolean;
  setNavOpen: (open: boolean) => void;
  preferProject: (projectId: string) => void;
  setSearchOpen: (open: boolean) => void;
}

const ShellContext = createContext<ShellState>({
  navOpen: false,
  preferProject: () => null,
  preferredProject: null,
  searchOpen: false,
  setNavOpen: () => null,
  setSearchOpen: () => null,
});

export const ShellProvider = ({ children }: { children: ReactNode }) => {
  const pathname = usePathname();
  // Remembering where the drawer was opened closes it on navigation without an effect.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const navOpen = openAt !== null && openAt === pathname;
  const [searchOpen, setSearchOpen] = useState(false);
  const [preferredProject, setPreferredProject] =
    useState<ShellState["preferredProject"]>(null);

  const setNavOpen = useCallback(
    (open: boolean) => setOpenAt(open ? pathname : null),
    [pathname]
  );

  const preferProject = useCallback(
    (id: string) => setPreferredProject({ at: Date.now(), id }),
    []
  );

  const value = useMemo(
    () => ({
      navOpen,
      preferProject,
      preferredProject,
      searchOpen,
      setNavOpen,
      setSearchOpen,
    }),
    [navOpen, preferProject, preferredProject, searchOpen, setNavOpen]
  );
  return <ShellContext value={value}>{children}</ShellContext>;
};

export const useShell = () => use(ShellContext);
