"use client";

import type { Autonomy } from "@missions/protocol/common";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CheckIcon, ChevronDownIcon, ShieldIcon } from "@/components/ui/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AUTONOMY, AUTONOMY_LEVELS } from "@/lib/autonomy";
import { cn } from "@/lib/utils";

/** Long-form copy for the Y8B menu: what each level allows, with example actions. */
const DETAIL: Record<Autonomy, { description: string; examples: string }> = {
  high: {
    description: "Adds high-risk actions. Safety checks still apply.",
    examples: "git push · migrations · docker compose",
  },
  low: {
    description: "Edits files and runs low-risk commands.",
    examples: "Edit · rg · show logs",
  },
  medium: {
    description: "Adds reversible changes to the worktree.",
    examples: "npm install · git commit · build",
  },
  off: {
    description: "Reads only. Asks before every edit or command.",
    examples: "Read · ls · git status",
  },
};

const isAutonomy = (value: string): value is Autonomy =>
  (AUTONOMY_LEVELS as readonly string[]).includes(value);

/** XXY: hover table of levels with the current one checked. */
const ScopeTable = ({ value }: { value: Autonomy }) => (
  <>
    <span className="pb-xs font-medium text-text">
      What runs without asking
    </span>
    {AUTONOMY_LEVELS.map((level) => {
      const current = level === value;
      return (
        <span className="flex h-5 shrink-0 items-center gap-sm" key={level}>
          <span className="flex w-3 shrink-0 items-center">
            {current ? <CheckIcon size="xs" tone="text" /> : null}
          </span>
          <span
            className={cn(
              "w-12.5 shrink-0 font-medium",
              current ? "text-text" : "text-text-tertiary"
            )}
          >
            {AUTONOMY[level].label}
          </span>
          <span
            className={current ? "text-text-secondary" : "text-text-tertiary"}
          >
            {AUTONOMY[level].scope}
          </span>
        </span>
      );
    })}
  </>
);

const levelTone = (level: Autonomy, selected: boolean) => {
  if (level === "high") {
    return "warning";
  }
  return selected ? "text" : "secondary";
};

/** Y8B: one rich row per level. */
const LevelItem = ({
  level,
  selected,
}: {
  level: Autonomy;
  selected: boolean;
}) => {
  const tone = levelTone(level, selected);
  return (
    <DropdownMenuRadioItem size="rich" value={level}>
      <ShieldIcon className="mt-hairline" tone={tone} />
      <span className="flex min-w-0 flex-1 flex-col gap-stack">
        <span
          className={cn(
            "font-medium",
            tone === "warning" && "text-warning",
            tone === "text" && "text-text",
            tone === "secondary" && "text-text-secondary"
          )}
        >
          {AUTONOMY[level].label}
        </span>
        <span className="text-xs leading-sm text-text-tertiary">
          {DETAIL[level].description}
        </span>
        <span className="font-mono text-2xs leading-xs text-text-tertiary">
          {DETAIL[level].examples}
        </span>
      </span>
    </DropdownMenuRadioItem>
  );
};

interface AutonomyChipProps {
  disabled?: boolean;
  onChange: (value: Autonomy) => void;
  value: Autonomy;
}

/** "Auto Medium" chip: hover explains each level, click picks one. Touch screens show only the level. */
export const AutonomyChip = ({
  disabled = false,
  onChange,
  value,
}: AutonomyChipProps) => (
  <DropdownMenu>
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={`Autonomy: ${AUTONOMY[value].label}`}
            disabled={disabled}
            size="chip"
            variant="chip"
          >
            <ShieldIcon
              size="sm"
              tone={value === "high" ? "warning" : "secondary"}
            />
            <span className="hidden text-text-tertiary md:inline">Auto</span>
            <span
              className={cn(
                "font-medium",
                value === "high" ? "text-warning" : "text-text-secondary"
              )}
            >
              {AUTONOMY[value].label}
            </span>
            <ChevronDownIcon size="xs" tone="tertiary" />
          </Button>
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent align="start" side="top" variant="panel">
        <ScopeTable value={value} />
      </TooltipContent>
    </Tooltip>
    <DropdownMenuContent align="start" className="w-85" side="top">
      <DropdownMenuLabel>Autonomy · what runs without asking</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        onValueChange={(next) => {
          if (isAutonomy(next)) {
            onChange(next);
          }
        }}
        value={value}
      >
        {AUTONOMY_LEVELS.map((level) => (
          <LevelItem key={level} level={level} selected={level === value} />
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <p className="px-md py-sm text-xs leading-sm text-text-tertiary">
        Set the default in Settings.
      </p>
    </DropdownMenuContent>
  </DropdownMenu>
);
