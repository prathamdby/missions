"use client";

import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { DropdownMenu as MenuPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

import { CheckIcon, ChevronRightIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;
export const DropdownMenuSub = MenuPrimitive.Sub;
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

/** Paper menu surface; popovers that hold menu rows reuse it. */
export const menuSurface =
  "z-popover flex min-w-48 flex-col gap-hairline overflow-hidden rounded-md bg-surface-overlay p-xs text-text shadow-lg outline-none";

export const menuItemVariants = cva(
  "relative flex shrink-0 cursor-pointer gap-control rounded-xs px-md text-left text-sm leading-sm font-book tracking-tight transition-colors duration-fast outline-none select-none focus-visible:shadow-none data-[disabled]:pointer-events-none data-[disabled]:text-text-disabled data-[highlighted]:bg-surface-active data-[highlighted]:text-text [&_svg]:shrink-0",
  {
    defaultVariants: { size: "md", variant: "default" },
    variants: {
      size: {
        /** Icon and label on one 32px line. */
        md: "h-8 items-center [&>svg]:size-4",
        /** Icon, title with tag, and description (PNO workspace choices). */
        option: "items-start px-md py-control",
        /** Icon, title, description, and examples (autonomy levels). */
        rich: "items-start p-md",
      },
      variant: {
        danger: "text-danger data-[highlighted]:text-danger",
        default: "text-text-secondary",
      },
    },
  }
);

export const DropdownMenuContent = ({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) => (
  <MenuPrimitive.Portal>
    <MenuPrimitive.Content
      className={cn(menuSurface, className)}
      collisionPadding={8}
      sideOffset={sideOffset}
      {...props}
    />
  </MenuPrimitive.Portal>
);

type ItemVariants = VariantProps<typeof menuItemVariants>;

export const DropdownMenuItem = ({
  className,
  size,
  variant,
  ...props
}: ComponentProps<typeof MenuPrimitive.Item> & ItemVariants) => (
  <MenuPrimitive.Item
    className={cn(menuItemVariants({ size, variant }), className)}
    {...props}
  />
);

export const DropdownMenuRadioItem = ({
  children,
  className,
  size,
  ...props
}: ComponentProps<typeof MenuPrimitive.RadioItem> &
  Pick<ItemVariants, "size">) => (
  <MenuPrimitive.RadioItem
    className={cn(
      menuItemVariants({ size }),
      "data-[state=checked]:text-text",
      className
    )}
    {...props}
  >
    {children}
    <span
      className={cn(
        "ml-auto flex w-3.5 shrink-0 justify-center",
        (size === "rich" || size === "option") && "pt-hairline"
      )}
    >
      <MenuPrimitive.ItemIndicator>
        <CheckIcon size="sm" tone="text" />
      </MenuPrimitive.ItemIndicator>
    </span>
  </MenuPrimitive.RadioItem>
);

export const DropdownMenuLabel = ({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Label>) => (
  <MenuPrimitive.Label
    className={cn(
      "px-md pt-md pb-xs text-xs leading-sm font-medium tracking-tight text-text-tertiary",
      className
    )}
    {...props}
  />
);

export const DropdownMenuSeparator = ({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Separator>) => (
  <MenuPrimitive.Separator
    className={cn("-mx-xs my-xs h-px shrink-0 bg-border-subtle", className)}
    {...props}
  />
);

export const DropdownMenuSubTrigger = ({
  children,
  className,
  size,
  ...props
}: ComponentProps<typeof MenuPrimitive.SubTrigger> &
  Pick<ItemVariants, "size">) => (
  <MenuPrimitive.SubTrigger
    className={cn(
      menuItemVariants({ size }),
      "data-[state=open]:bg-surface-active data-[state=open]:text-text",
      className
    )}
    {...props}
  >
    {children}
    <ChevronRightIcon
      className={cn("ml-auto", size && size !== "md" && "mt-hairline")}
      size="sm"
      tone="tertiary"
    />
  </MenuPrimitive.SubTrigger>
);

export const DropdownMenuSubContent = ({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.SubContent>) => (
  <MenuPrimitive.Portal>
    <MenuPrimitive.SubContent
      className={cn(menuSurface, className)}
      {...props}
    />
  </MenuPrimitive.Portal>
);

/** Two-line menu text: a label with an optional description under it. */
export const MenuItemText = ({
  description,
  label,
  meta,
}: {
  description?: string;
  label: string;
  meta?: ReactNode;
}) => (
  <span className="flex min-w-0 flex-1 flex-col gap-2xs">
    <span className="flex items-center gap-md text-sm leading-sm font-medium text-text">
      <span className="truncate">{label}</span>
      {meta}
    </span>
    {description ? (
      <span className="text-xs leading-sm text-text-tertiary">
        {description}
      </span>
    ) : null}
  </span>
);
