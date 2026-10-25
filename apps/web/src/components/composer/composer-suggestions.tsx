"use client";

import { useEffect, useRef } from "react";

import { FileTextIcon, SkillIcon, TerminalIcon } from "@/components/ui/icons";
import { Listbox, ListOption } from "@/components/ui/list-row";
import { PopoverContent } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface ComposerSuggestion {
  value: string;
  label?: string;
  description?: string;
  kind?: "command" | "skill";
}

const SuggestionIcon = ({ kind }: { kind: ComposerSuggestion["kind"] }) => {
  if (kind === "skill") {
    return <SkillIcon tone="tertiary" />;
  }
  return kind === "command" ? (
    <TerminalIcon tone="tertiary" />
  ) : (
    <FileTextIcon tone="secondary" />
  );
};

export const ComposerSuggestions = ({
  activeIndex,
  id,
  items,
  loading,
  onChoose,
  unavailable,
}: {
  activeIndex: number;
  id: string;
  items: readonly ComposerSuggestion[];
  loading: boolean;
  onChoose: (item: ComposerSuggestion) => void;
  unavailable: boolean;
}) => {
  const selected = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (activeIndex >= 0) {
      selected.current?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);
  let empty = "No matches";
  if (loading) {
    empty = "Loading…";
  } else if (unavailable) {
    empty = "Search unavailable";
  }
  return (
    <PopoverContent
      onCloseAutoFocus={(event) => event.preventDefault()}
      onOpenAutoFocus={(event) => event.preventDefault()}
      side="top"
      size="composer"
    >
      <ScrollArea axis="y">
        <Listbox aria-label="Composer suggestions" id={id}>
          {items.map((item, index) => (
            <ListOption
              id={`${id}-${index}`}
              key={item.label ?? item.value}
              onClick={() => onChoose(item)}
              onMouseDown={(event) => event.preventDefault()}
              ref={index === activeIndex ? selected : undefined}
              selected={index === activeIndex}
              size="suggestion"
              title={item.description}
              virtualFocus
            >
              <SuggestionIcon kind={item.kind} />
              <span className="flex min-w-0 flex-1 flex-col text-left">
                <span className="truncate font-mono text-xs leading-sm">
                  {item.label ?? item.value}
                </span>
                {item.description ? (
                  <span className="sr-only">{item.description}</span>
                ) : null}
              </span>
            </ListOption>
          ))}
          {items.length === 0 ? (
            <p className="px-md py-md text-xs leading-sm text-text-tertiary">
              {empty}
            </p>
          ) : null}
        </Listbox>
      </ScrollArea>
    </PopoverContent>
  );
};
