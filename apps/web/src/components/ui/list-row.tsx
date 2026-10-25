import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const selectedState =
  "aria-selected:text-text aria-[current=page]:bg-surface-active aria-[current=page]:text-text aria-checked:bg-surface-active aria-checked:text-text data-[highlighted]:bg-surface-active data-[highlighted]:text-text";

/** Rows outside menus fill when selected; menu rows show a trailing check instead. */
const selectedFill = "aria-selected:bg-surface-active";

/** Menu rows brighten their leading icon with the label. */
const menuIcon =
  "[&>svg:not([class*='size-'])]:size-4 [&>svg]:text-text-secondary hover:[&>svg]:text-text aria-selected:[&>svg]:text-text data-[highlighted]:[&>svg]:text-text";

const listRowVariants = cva(
  `group/list-row flex w-full min-w-0 shrink-0 cursor-pointer items-center text-left text-sm leading-sm tracking-tight transition-colors duration-fast outline-none focus-visible:shadow-focus disabled:cursor-default disabled:text-text-disabled disabled:hover:bg-transparent aria-disabled:cursor-default aria-disabled:text-text-disabled aria-disabled:hover:bg-transparent [&_svg]:shrink-0 ${selectedState}`,
  {
    defaultVariants: { size: "menu" },
    variants: {
      size: {
        /** Fs browser entries, 36px. Selection adds a hairline ring. */
        browser: `h-9 gap-control rounded-xs px-control font-book text-text-secondary hover:bg-surface-overlay aria-selected:shadow-[0_0_0_1px_var(--color-border)] aria-selected:[&>svg:first-child]:text-text [&>svg:not([class*='size-'])]:size-4 ${selectedFill}`,
        /** Rows inside a ListCard (YL0 touch pickers), 48px with a divider. */
        group:
          "h-12 gap-lg border-b border-border-subtle pr-lg pl-card font-book text-text-secondary last:border-b-0 hover:bg-surface-overlay [&>svg]:text-text-secondary",
        /** Menu and popover rows, 32px. */
        menu: `h-8 gap-control rounded-xs px-md font-book text-text-secondary hover:bg-surface-active hover:text-text ${menuIcon}`,
        /** Two-line menu rows (project picker), 44px. */
        "menu-lg": `h-11 gap-control rounded-xs px-md font-book text-text-secondary hover:bg-surface-active ${menuIcon}`,
        /** Places column in the folder browser, 30px. */
        place: `h-7.5 gap-md rounded-xs px-md font-book text-text-secondary hover:bg-surface-overlay hover:text-text [&>svg]:size-4 [&>svg]:text-text-secondary aria-selected:[&>svg]:text-text ${selectedFill}`,
        /** Repository rows with an avatar and description (NAA), 52px. Already-added rows fade. */
        repo: `h-13 gap-lg rounded-xs px-control font-book text-text-secondary hover:bg-surface-overlay aria-disabled:text-text-secondary aria-disabled:opacity-55 aria-selected:shadow-[0_0_0_1px_var(--color-border)] ${selectedFill}`,
        /** Bottom-sheet choices, 56px. */
        sheet: `h-14 gap-lg rounded-sm px-lg font-book text-text hover:bg-surface-active [&>svg]:size-4 [&>svg]:text-text-secondary ${selectedFill}`,
        /** Bottom-sheet actions with a subtitle, 48px. */
        "sheet-action": `h-12 gap-lg rounded-sm px-lg font-medium text-text hover:bg-surface-active [&>svg]:size-4 [&>svg]:text-text-secondary ${selectedFill}`,
        /** Desktop sidebar mission rows, 30px. */
        sidebar: `h-7.5 gap-md rounded-sm px-md font-book text-text-secondary hover:bg-surface-overlay hover:text-text ${selectedFill}`,
        /** Desktop sidebar navigation rows, 30px, medium weight. */
        "sidebar-nav": `h-7.5 gap-md rounded-sm px-md font-medium text-text-secondary hover:bg-surface-overlay hover:text-text [&>svg]:size-4 [&>svg]:text-text-secondary ${selectedFill}`,
        suggestion: `h-8 gap-control rounded-xs px-md font-book text-text hover:bg-surface-active ${menuIcon} ${selectedFill}`,
        /** Drawer mission rows, 40px. */
        touch: `h-10 gap-md rounded-sm px-control font-book text-text-secondary hover:bg-surface-overlay aria-[current=page]:font-medium ${selectedFill}`,
        /** Drawer navigation rows, 40px. */
        "touch-nav": `h-10 gap-control rounded-sm px-control font-medium text-text-secondary hover:bg-surface-overlay [&>svg]:size-4 [&>svg]:text-text-secondary ${selectedFill}`,
      },
    },
  }
);

type ListRowProps = ComponentProps<"button"> &
  VariantProps<typeof listRowVariants> & { asChild?: boolean };

/** Row used by the sidebar, pickers, sheets, and browsers. */
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

/** Raised card that stacks `group` rows (YL0). */
export const ListCard = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    className={cn(
      "flex flex-col overflow-hidden rounded-md bg-surface-raised shadow-sm",
      className
    )}
    {...props}
  />
);

const listLabelVariants = cva(
  "shrink-0 text-xs leading-sm font-medium tracking-tight text-text-tertiary",
  {
    defaultVariants: { size: "menu" },
    variants: {
      size: {
        menu: "px-md pt-md pb-xs",
        place: "px-md pt-2xs pb-sm",
        sheet: "px-lg pt-control pb-xs",
        sidebar: "px-md pb-sm",
        touch: "px-control pb-sm",
      },
    },
  }
);

export const ListLabel = ({
  className,
  size,
  ...props
}: ComponentProps<"p"> & VariantProps<typeof listLabelVariants>) => (
  <p className={cn(listLabelVariants({ size }), className)} {...props} />
);

/*
 * Listbox semantics for rows with rich content (name, path, meta). No native
 * element can hold that markup, so these carry the WAI-ARIA roles.
 */
const LISTBOX_ROLE = "listbox";
const GROUP_ROLE = "group";
const OPTION_ROLE = "option";

/** Keep row groups at their intrinsic height; the containing viewport scrolls. */
export const Listbox = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    className={cn("flex min-h-0 shrink-0 flex-col gap-hairline", className)}
    role={LISTBOX_ROLE}
    {...props}
  />
);

export const ListboxGroup = ({
  className,
  ...props
}: ComponentProps<"div">) => (
  <div
    className={cn("flex flex-col gap-hairline", className)}
    role={GROUP_ROLE}
    {...props}
  />
);

/** A selectable row inside a Listbox; `selected` maps to aria-selected. */
export const ListOption = ({
  selected,
  virtualFocus = false,
  ...props
}: Omit<ListRowProps, "asChild" | "role"> & {
  selected: boolean;
  virtualFocus?: boolean;
}) => (
  <ListRow
    aria-selected={selected}
    role={OPTION_ROLE}
    {...props}
    tabIndex={virtualFocus ? -1 : props.tabIndex}
  />
);
