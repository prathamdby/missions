"use client";

import type { ReactNode } from "react";

import { BrainIcon, ChevronRightIcon } from "@/components/mission/icons";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleHeader,
} from "@/components/ui/collapsible";
import { OverflowArea } from "@/components/ui/overflow-area";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

export const TurnGroup = ({
  children,
  failures,
  onOpenChange,
  open,
  running,
  start,
  end,
  now,
}: {
  children: ReactNode;
  failures: number;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  running: boolean;
  start: string | null;
  end: string | null;
  now: number;
}) => {
  const duration =
    start && (running || end)
      ? formatDuration(
          Math.max(
            0,
            (running ? now : Date.parse(end ?? start)) - Date.parse(start)
          )
        )
      : null;
  return (
    <Collapsible
      data-testid="turn-group"
      onOpenChange={onOpenChange}
      open={open}
    >
      <CollapsibleHeader>
        <BrainIcon className="text-text-tertiary" />
        <span className="text-sm leading-sm font-book text-text-tertiary">
          {running ? "Work" : "Worked"}
        </span>
        {failures > 0 ? (
          <span className="font-mono text-2xs leading-xs text-warning">
            {failures === 1 ? "Failed" : `${failures} failed`}
          </span>
        ) : null}
        {duration ? (
          <span className="font-mono text-2xs leading-xs text-text-tertiary">
            {duration}
          </span>
        ) : null}
        <ChevronRightIcon
          className={cn("size-3 text-text-tertiary", open && "rotate-90")}
        />
      </CollapsibleHeader>
      <CollapsibleContent className="mt-lg">
        <OverflowArea aria-label="Turn work" follow={running} size="turn">
          {children}
        </OverflowArea>
      </CollapsibleContent>
    </Collapsible>
  );
};
