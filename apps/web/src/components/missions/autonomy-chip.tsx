"use client";

import type { Autonomy } from "@missions/protocol/common";
import { ChevronDownIcon, ShieldIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AUTONOMY, AUTONOMY_LEVELS } from "@/lib/autonomy";
import { cn } from "@/lib/utils";

const isAutonomy = (value: string): value is Autonomy =>
  (AUTONOMY_LEVELS as readonly string[]).includes(value);

const ScopeTable = ({ value }: { value: Autonomy }) => (
  <span className="flex flex-col gap-xs py-xs">
    <span className="flex items-center gap-lg">
      <span className="font-medium">What runs without asking</span>
      <span className="ml-auto flex items-center gap-2xs">
        <Kbd>⇧</Kbd>
        <Kbd>Tab</Kbd>
      </span>
    </span>
    {AUTONOMY_LEVELS.map((level) => (
      <span
        className={cn(
          "flex gap-md",
          level === value ? "text-text" : "text-text-secondary"
        )}
        key={level}
      >
        <span className="w-14 shrink-0">{AUTONOMY[level].label}</span>
        <span>{AUTONOMY[level].scope}</span>
      </span>
    ))}
  </span>
);

interface AutonomyChipProps {
  disabled?: boolean;
  onChange: (value: Autonomy) => void;
  value: Autonomy;
}

/** "Auto Medium" chip: hover explains each level, click picks one. */
export const AutonomyChip = ({
  disabled = false,
  onChange,
  value,
}: AutonomyChipProps) => (
  <DropdownMenu>
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuTrigger asChild>
          <Button disabled={disabled} size="sm" variant="ghost">
            <ShieldIcon aria-hidden="true" />
            <span className="text-text-tertiary">Auto</span>
            <span className={value === "high" ? "text-warning" : "text-text"}>
              {AUTONOMY[value].label}
            </span>
            <ChevronDownIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent side="top">
        <ScopeTable value={value} />
      </TooltipContent>
    </Tooltip>
    <DropdownMenuContent align="start" side="top">
      <DropdownMenuLabel>What runs without asking</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        onValueChange={(next) => {
          if (isAutonomy(next)) {
            onChange(next);
          }
        }}
        value={value}
      >
        {AUTONOMY_LEVELS.map((level) => (
          <DropdownMenuRadioItem key={level} value={level}>
            <span className="flex min-w-0 flex-1 items-center gap-lg">
              <span
                className={cn(
                  "w-14 type-label",
                  level === "high" ? "text-warning" : "text-text"
                )}
              >
                {AUTONOMY[level].label}
              </span>
              <span className="type-caption text-text-tertiary">
                {AUTONOMY[level].scope}
              </span>
            </span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);
