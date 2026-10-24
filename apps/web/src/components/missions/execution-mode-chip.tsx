"use client";

import type { ExecutionMode } from "@missions/protocol/common";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDownIcon,
  ClipboardIcon,
  EditIcon,
} from "@/components/ui/icons";
import { cn } from "@/lib/utils";

const MODES: Record<ExecutionMode, { description: string; label: string }> = {
  plan: {
    description:
      "Every agent stays read-only until you approve the plan the main agent presents.",
    label: "Plan",
  },
  work: {
    description: "Agents act directly.",
    label: "Work",
  },
};

const EXECUTION_MODES = ["work", "plan"] as const;

const isExecutionMode = (value: string): value is ExecutionMode =>
  (EXECUTION_MODES as readonly string[]).includes(value);

const ModeIcon = ({ mode }: { mode: ExecutionMode }) =>
  mode === "plan" ? (
    <ClipboardIcon size="sm" tone="secondary" />
  ) : (
    <EditIcon size="sm" tone="secondary" />
  );

/** "Work" or "Plan" composer chip: the mode the next message asks for. */
export const ExecutionModeChip = ({
  disabled = false,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange: (value: ExecutionMode) => void;
  value: ExecutionMode;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button
        aria-label={`Mode: ${MODES[value].label}`}
        data-testid="execution-mode"
        disabled={disabled}
        size="chip"
        variant="chip"
      >
        <ModeIcon mode={value} />
        <span
          className={cn(
            "font-medium",
            value === "plan" ? "text-info" : "text-text-secondary"
          )}
        >
          {MODES[value].label}
        </span>
        <ChevronDownIcon size="xs" tone="tertiary" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-80" side="top">
      <DropdownMenuLabel>Mode · how the main agent proceeds</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        onValueChange={(next) => {
          if (isExecutionMode(next)) {
            onChange(next);
          }
        }}
        value={value}
      >
        {EXECUTION_MODES.map((mode) => (
          <DropdownMenuRadioItem key={mode} size="rich" value={mode}>
            <ModeIcon mode={mode} />
            <span className="flex min-w-0 flex-1 flex-col gap-stack">
              <span className="font-medium text-text">{MODES[mode].label}</span>
              <span className="text-xs leading-sm text-text-tertiary">
                {MODES[mode].description}
              </span>
            </span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);
