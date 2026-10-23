import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const listRowVariants = cva(
  "group/list-row flex w-full min-w-0 cursor-pointer items-center gap-md rounded-sm px-md text-left text-sm leading-md tracking-tight transition-colors duration-fast outline-none hover:bg-surface-overlay focus-visible:shadow-focus disabled:cursor-default disabled:text-text-disabled disabled:hover:bg-transparent aria-selected:bg-surface-active aria-[current=page]:bg-surface-raised data-[highlighted]:bg-surface-active [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-text-tertiary",
  {
    defaultVariants: { size: "md" },
    variants: {
      size: {
        lg: "min-h-11 py-sm",
        md: "h-8 text-text-secondary hover:text-text aria-[current=page]:font-medium aria-[current=page]:text-text",
        nav: "h-8 font-medium text-text hover:bg-surface-raised",
      },
    },
  }
);

type ListRowProps = ComponentProps<"button"> &
  VariantProps<typeof listRowVariants> & { asChild?: boolean };

/** Row used by the sidebar, pickers, and browsers. */
export const ListRow = ({
  asChild = false,
  className,
  size,
  ...props
}: ListRowProps) => {
  const classes = cn(listRowVariants({ size }), className);
  if (asChild) {
    return <Slot.Root className={classes} {...props} />;
  }
  return <button className={classes} type="button" {...props} />;
};

export const ListLabel = ({ className, ...props }: ComponentProps<"p">) => (
  <p
    className={cn(
      "px-md pt-lg pb-xs type-caption text-text-tertiary",
      className
    )}
    {...props}
  />
);
