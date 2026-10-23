"use client";

import { useState } from "react";

import {
  BrainIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "@/components/mission/icons";
import { IndentRule } from "@/components/mission/tool-group";
import { Spinner } from "@/components/ui/spinner";

/**
 * Paper I9X "Thought" row: a quiet disclosure over the reasoning text. While
 * the reasoning streams it opens by default and the text grows inside it.
 */
export const Thinking = ({
  streaming = false,
  text,
}: {
  streaming?: boolean;
  text: string;
}) => {
  const [open, setOpen] = useState(streaming);
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <div className="flex flex-col gap-2xs">
      <button
        aria-expanded={open}
        className="flex h-2xl w-fit cursor-pointer items-center gap-md rounded-xs text-text-tertiary transition-colors duration-fast hover:text-text-secondary focus-visible:shadow-focus"
        onClick={() => setOpen(!open)}
        type="button"
      >
        {streaming ? (
          <Spinner label="Thinking" size="sm" />
        ) : (
          <BrainIcon aria-hidden="true" className="size-3.5 shrink-0" />
        )}
        <span className="text-sm leading-sm font-book tracking-tight">
          {streaming ? "Thinking…" : "Thought"}
        </span>
        <Chevron aria-hidden="true" className="size-3 shrink-0" />
      </button>
      {open && text ? (
        <div className="flex">
          <IndentRule />
          <p className="min-w-0 flex-1 py-xs pl-control text-xs leading-sm font-book tracking-tight whitespace-pre-wrap text-text-secondary">
            {text}
          </p>
        </div>
      ) : null}
    </div>
  );
};
