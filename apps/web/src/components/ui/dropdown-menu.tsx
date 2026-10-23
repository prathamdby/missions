"use client";

import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { DropdownMenu as MenuPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;
export const DropdownMenuSub = MenuPrimitive.Sub;
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

const menuSurface =
  "z-popover min-w-48 overflow-hidden rounded-md bg-surface-overlay p-xs text-text shadow-lg outline-none";

const itemBase =
  "relative flex cursor-pointer select-none items-center gap-md rounded-sm px-md py-sm text-sm leading-md outline-none transition-colors duration-fast data-[disabled]:pointer-events-none data-[highlighted]:bg-surface-active data-[disabled]:text-text-disabled [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-text-secondary";

export const DropdownMenuContent = ({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) => (
  <MenuPrimitive.Portal>
    <MenuPrimitive.Content
      className={cn(menuSurface, className)}
      sideOffset={sideOffset}
      {...props}
    />
  </MenuPrimitive.Portal>
);

export const DropdownMenuItem = ({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Item>) => (
  <MenuPrimitive.Item className={cn(itemBase, className)} {...props} />
);

export const DropdownMenuRadioItem = ({
  children,
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.RadioItem>) => (
  <MenuPrimitive.RadioItem
    className={cn(itemBase, "items-start pr-3xl", className)}
    {...props}
  >
    {children}
    <MenuPrimitive.ItemIndicator className="absolute top-sm right-md">
      <CheckIcon />
    </MenuPrimitive.ItemIndicator>
  </MenuPrimitive.RadioItem>
);

export const DropdownMenuLabel = ({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Label>) => (
  <MenuPrimitive.Label
    className={cn(
      "px-md pt-sm pb-xs type-caption text-text-tertiary",
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
    className={cn("-mx-xs my-xs h-px bg-border-subtle", className)}
    {...props}
  />
);

export const DropdownMenuSubTrigger = ({
  children,
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.SubTrigger>) => (
  <MenuPrimitive.SubTrigger
    className={cn(itemBase, "data-[state=open]:bg-surface-active", className)}
    {...props}
  >
    {children}
    <ChevronRightIcon className="ml-auto" />
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
    <span className="flex items-center gap-md type-label text-text">
      <span className="truncate">{label}</span>
      {meta}
    </span>
    {description ? (
      <span className="type-caption text-text-tertiary">{description}</span>
    ) : null}
  </span>
);
