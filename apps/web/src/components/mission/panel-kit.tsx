"use client";

import type { ReactNode } from "react";
import { useState } from "react";

import { ChevronDownIcon } from "@/components/mission/icons";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/** Paper's 5x5 dot loader: `text` for the active todo, `accent` for working agents. */
export const DotLoader = ({
  label = "In progress",
  tone = "text",
}: {
  label?: string;
  tone?: "accent" | "text";
}) => <Spinner label={label} pattern={tone === "accent" ? "spiral" : "wave"} />;

/** Fixed 20px box that centers row icons the way Paper's 19px icon cells do. */
export const IconCell = ({ children }: { children: ReactNode }) => (
  <span className="flex size-5 shrink-0 items-center justify-center">
    {children}
  </span>
);

/** Panel section: bold title, mono count, and a chevron that folds the body. */
export const PanelSection = ({
  children,
  count,
  gap = "sm",
  grow = false,
  title,
}: {
  children: ReactNode;
  count?: number | string | null;
  gap?: "lg" | "sm" | "xs";
  grow?: boolean;
  title: string;
}) => {
  const [open, setOpen] = useState(true);
  return (
    <section
      aria-label={title}
      className={cn(
        "flex flex-col",
        gap === "lg" && "gap-lg",
        gap === "sm" && "gap-sm",
        gap === "xs" && "gap-xs",
        grow && "mt-auto"
      )}
    >
      <h2 className="flex h-5 shrink-0">
        <button
          aria-expanded={open}
          className="flex cursor-pointer items-center gap-sm rounded-xs text-sm leading-sm font-semibold tracking-tight text-text"
          onClick={() => setOpen(!open)}
          type="button"
        >
          {title}
          {count === null || count === undefined ? null : (
            <span className="font-mono text-2xs leading-xs font-regular text-text-tertiary">
              {count}
            </span>
          )}
          <ChevronDownIcon
            className={cn(
              "size-3 text-text-tertiary transition-transform duration-fast",
              open ? "" : "-rotate-90"
            )}
          />
        </button>
      </h2>
      {open ? children : null}
    </section>
  );
};

/** Mono metadata in the Paper panels: counts, durations, refs. */
export const Meta = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <span
    className={cn(
      "font-mono text-2xs leading-xs text-text-tertiary",
      className
    )}
  >
    {children}
  </span>
);
