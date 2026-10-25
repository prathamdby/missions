"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { ChevronDownIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/** Keep a natural-height mirror so expansion does not erase overflow state. */
export const AnswerRow = ({
  question,
  answer,
}: {
  question: string;
  answer: string;
}) => {
  const measure = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    const node = measure.current;
    if (!node) {
      return;
    }
    const update = () =>
      setOverflow(
        [...node.children].some(
          (child) =>
            child.scrollHeight >
            Number(getComputedStyle(child).lineHeight.replace("px", "")) + 1
        )
      );
    const observer = new ResizeObserver(update);
    observer.observe(node);
    update();
    return () => observer.disconnect();
  }, []);
  const Component = overflow ? "button" : "div";
  return (
    <div className="relative border-t border-border-subtle py-md text-sm leading-md tracking-tight">
      <div
        aria-hidden
        className="invisible absolute top-md right-section left-0 flex flex-col gap-2xs"
        ref={measure}
      >
        <span className="font-medium break-words">{question}</span>
        <span className="font-book break-words">{answer}</span>
      </div>
      <Component
        aria-expanded={overflow ? expanded : undefined}
        className={cn(
          "flex w-full gap-lg text-left outline-none",
          overflow && "cursor-pointer rounded-xs focus-visible:shadow-focus"
        )}
        onClick={overflow ? () => setExpanded(!expanded) : undefined}
        type={overflow ? "button" : undefined}
      >
        <div className="relative min-w-0 flex-1">
          <div className="flex flex-col gap-2xs">
            <span
              className={cn(
                "font-medium break-words text-text",
                overflow && !expanded && "line-clamp-1"
              )}
            >
              {question}
            </span>
            <span
              className={cn(
                "font-book break-words text-text-secondary",
                overflow && !expanded && "line-clamp-1"
              )}
            >
              {answer}
            </span>
          </div>
        </div>
        <span className="flex h-4.5 w-4 shrink-0 items-center">
          {overflow ? (
            <ChevronDownIcon
              className={cn(
                "size-4 text-text-tertiary",
                expanded && "rotate-180"
              )}
            />
          ) : null}
        </span>
      </Component>
    </div>
  );
};
