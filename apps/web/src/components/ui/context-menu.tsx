"use client";

import type { VariantProps } from "class-variance-authority";
import { ContextMenu as MenuPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { menuItemVariants, menuSurface } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Right-click menus share the dropdown's Paper surface and rows. */
export const ContextMenu = MenuPrimitive.Root;
export const ContextMenuTrigger = MenuPrimitive.Trigger;

export const ContextMenuContent = ({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) => (
  <MenuPrimitive.Portal>
    <MenuPrimitive.Content
      className={cn(menuSurface, className)}
      collisionPadding={8}
      {...props}
    />
  </MenuPrimitive.Portal>
);

export const ContextMenuItem = ({
  className,
  size,
  variant,
  ...props
}: ComponentProps<typeof MenuPrimitive.Item> &
  VariantProps<typeof menuItemVariants>) => (
  <MenuPrimitive.Item
    className={cn(menuItemVariants({ size, variant }), className)}
    {...props}
  />
);

export const ContextMenuSeparator = ({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Separator>) => (
  <MenuPrimitive.Separator
    className={cn("-mx-xs my-xs h-px shrink-0 bg-border-subtle", className)}
    {...props}
  />
);
