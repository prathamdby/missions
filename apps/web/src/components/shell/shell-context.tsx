"use client";

import { usePathname } from "next/navigation";
import { createContext, use, useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";

interface ShellState {
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
}

const ShellContext = createContext<ShellState>({
  navOpen: false,
  setNavOpen: () => null,
});

export const ShellProvider = ({ children }: { children: ReactNode }) => {
  const pathname = usePathname();
  // Remembering where the drawer was opened closes it on navigation without an effect.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const navOpen = openAt !== null && openAt === pathname;

  const setNavOpen = useCallback(
    (open: boolean) => setOpenAt(open ? pathname : null),
    [pathname]
  );

  const value = useMemo(() => ({ navOpen, setNavOpen }), [navOpen, setNavOpen]);
  return <ShellContext value={value}>{children}</ShellContext>;
};

export const useShell = () => use(ShellContext);
