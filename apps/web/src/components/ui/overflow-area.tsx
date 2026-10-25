"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ComponentProps, ReactNode } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/** Measures the untruncated content, including changes caused by wrapping. */
export const useOverflow = (lines?: number) => {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const outer = viewport.current;
    const inner = content.current;
    if (!(outer && inner)) {
      return;
    }
    const measure = () =>
      setOverflow(
        inner.scrollHeight >
          (lines
            ? lines *
              Number(
                getComputedStyle(inner)
                  .getPropertyValue("--leading-chat")
                  .replace("px", "")
              )
            : outer.clientHeight) +
            1 || inner.scrollWidth > outer.clientWidth + 1
      );
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    measure();
    return () => observer.disconnect();
  }, [lines]);
  return { content, overflow, viewport };
};

/** Alpha masks blend with any surface; only hidden edges receive a fade. */
export const OverflowArea = ({
  children,
  className,
  follow = false,
  size = "fill",
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  children: ReactNode;
  follow?: boolean;
  size?: "fill" | "panel" | "turn";
}) => {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [edges, setEdges] = useState({ bottom: false, top: false });
  const measure = useCallback((element: HTMLDivElement) => {
    setEdges({
      bottom:
        element.scrollHeight - element.scrollTop - element.clientHeight > 1,
      top: element.scrollTop > 1,
    });
  }, []);
  useLayoutEffect(() => {
    const outer = viewport.current;
    const inner = content.current;
    if (!(outer && inner)) {
      return;
    }
    const update = () => {
      if (follow && pinned.current) {
        outer.scrollTop = outer.scrollHeight;
      }
      measure(outer);
    };
    const observer = new ResizeObserver(update);
    observer.observe(outer);
    observer.observe(inner);
    update();
    return () => observer.disconnect();
  }, [follow, measure]);
  return (
    <ScrollArea
      className={cn(
        "min-h-0",
        size === "turn" && "max-h-80",
        size === "panel" && "-mx-md px-md",
        edges.top &&
          edges.bottom &&
          "mask-[linear-gradient(to_bottom,transparent,var(--color-text)_var(--spacing-xl),var(--color-text)_calc(100%-var(--spacing-xl)),transparent)]",
        edges.top &&
          !edges.bottom &&
          "mask-[linear-gradient(to_bottom,transparent,var(--color-text)_var(--spacing-xl))]",
        !edges.top &&
          edges.bottom &&
          "mask-[linear-gradient(to_bottom,var(--color-text)_calc(100%-var(--spacing-xl)),transparent)]",
        className
      )}
      data-fade-bottom={edges.bottom || undefined}
      data-fade-top={edges.top || undefined}
      onScroll={(event) => {
        const element = event.currentTarget;
        pinned.current =
          element.scrollHeight - element.scrollTop - element.clientHeight < 32;
        measure(element);
      }}
      overscroll="contain"
      ref={viewport}
      {...props}
    >
      <div ref={content}>{children}</div>
    </ScrollArea>
  );
};

export const ClampedContent = ({
  children,
  expanded,
  contentRef,
  viewportRef,
  faded,
}: {
  children: ReactNode;
  expanded: boolean;
  contentRef: ComponentProps<"div">["ref"];
  viewportRef: ComponentProps<"div">["ref"];
  faded: boolean;
}) => (
  <div
    className={cn(
      "min-w-0 overflow-hidden",
      !expanded && "max-h-22",
      !expanded &&
        faded &&
        "mask-[linear-gradient(to_bottom,var(--color-text)_calc(100%-var(--spacing-xl)),transparent)]"
    )}
    ref={viewportRef}
  >
    <div ref={contentRef}>{children}</div>
  </div>
);

/** A fitting message has a plain header, not a disabled disclosure. */
export const ClampHeader = ({
  children,
  expandable,
  expanded,
  onToggle,
}: {
  children: ReactNode;
  expandable: boolean;
  expanded: boolean;
  onToggle: () => void;
}) => {
  const Component = expandable ? "button" : "div";
  return (
    <Component
      aria-expanded={expandable ? expanded : undefined}
      className={cn(
        "flex h-2xl min-w-0 items-center gap-md self-start rounded-xs text-left",
        expandable && "cursor-pointer focus-visible:shadow-focus"
      )}
      onClick={expandable ? onToggle : undefined}
      type={expandable ? "button" : undefined}
    >
      {children}
    </Component>
  );
};
