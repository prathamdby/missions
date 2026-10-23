"use client";

import type { ReactNode } from "react";

import { AddProjectProvider } from "@/components/projects/add-project-context";
import { ShellProvider } from "@/components/shell/shell-context";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GlobalLive } from "@/lib/live/global-live";
import { QueryProvider } from "@/lib/query-provider";

export const Providers = ({ children }: { children: ReactNode }) => (
  <QueryProvider>
    <TooltipProvider>
      <ShellProvider>
        <AddProjectProvider>
          <GlobalLive />
          {children}
          <Toaster />
        </AddProjectProvider>
      </ShellProvider>
    </TooltipProvider>
  </QueryProvider>
);
