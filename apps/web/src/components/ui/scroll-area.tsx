import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const scrollVariants = cva("", {
  defaultVariants: { axis: "y", overscroll: "auto" },
  variants: {
    axis: {
      both: "overflow-auto",
      x: "overflow-x-auto",
      y: "overflow-y-auto",
    },
    overscroll: {
      auto: "",
      contain: "overscroll-contain",
      none: "overscroll-none",
    },
  },
});

/** Scroll containers are never Tab stops. Controls inside them retain focus. */
export const ScrollArea = ({
  asChild = false,
  axis,
  className,
  overscroll,
  ...props
}: Omit<ComponentProps<"div">, "tabIndex"> &
  VariantProps<typeof scrollVariants> & { asChild?: boolean }) => {
  const Component = asChild ? Slot.Root : "div";
  return (
    <Component
      className={cn(scrollVariants({ axis, overscroll }), className)}
      {...props}
      tabIndex={-1}
    />
  );
};
