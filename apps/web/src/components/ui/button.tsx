import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-sm rounded-sm text-sm leading-sm font-medium tracking-tight whitespace-nowrap transition-[background-color,color,box-shadow,scale] duration-fast ease-out select-none focus-visible:shadow-focus active:scale-press disabled:pointer-events-none disabled:text-text-disabled aria-disabled:pointer-events-none aria-disabled:text-text-disabled [&_svg]:size-4 [&_svg]:shrink-0",
  {
    defaultVariants: {
      shape: "default",
      size: "md",
      variant: "secondary",
    },
    variants: {
      shape: {
        default: "",
        round: "rounded-full",
      },
      size: {
        icon: "size-7",
        "icon-sm": "size-6 [&_svg]:size-3.5",
        md: "h-7 px-lg",
        sm: "h-6 px-md text-xs",
      },
      variant: {
        danger: "text-danger hover:bg-danger-muted",
        "danger-solid":
          "bg-danger text-on-accent hover:bg-danger/90 disabled:bg-surface-overlay disabled:shadow-[inset_0_0_0_1px_var(--color-border)]",
        ghost:
          "text-text-secondary hover:bg-surface-overlay hover:text-text data-[state=open]:bg-surface-overlay data-[state=open]:text-text",
        primary:
          "bg-accent text-on-accent hover:bg-accent-hover disabled:bg-surface-overlay disabled:shadow-[inset_0_0_0_1px_var(--color-border)]",
        secondary:
          "bg-surface-overlay text-text shadow-button hover:bg-surface-active focus-visible:shadow-focus disabled:shadow-[inset_0_0_0_1px_var(--color-border)] data-[state=open]:bg-surface-active",
      },
    },
  }
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export const Button = ({
  asChild = false,
  className,
  shape,
  size,
  type = "button",
  variant,
  ...props
}: ButtonProps) => {
  const classes = cn(buttonVariants({ shape, size, variant }), className);
  if (asChild) {
    return <Slot.Root className={classes} data-slot="button" {...props} />;
  }
  if (type === "submit") {
    return (
      <button className={classes} data-slot="button" type="submit" {...props} />
    );
  }
  if (type === "reset") {
    return (
      <button className={classes} data-slot="button" type="reset" {...props} />
    );
  }
  return (
    <button className={classes} data-slot="button" type="button" {...props} />
  );
};

type IconButtonProps = Omit<ButtonProps, "children" | "size"> & {
  icon: ReactNode;
  label: string;
  size?: "md" | "sm";
};

/** Icon-only button; `label` becomes the accessible name. */
export const IconButton = ({
  icon,
  label,
  size = "md",
  variant = "ghost",
  ...props
}: IconButtonProps) => (
  <Button
    aria-label={label}
    size={size === "sm" ? "icon-sm" : "icon"}
    variant={variant}
    {...props}
  >
    {icon}
  </Button>
);
