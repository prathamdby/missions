import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/*
 * `disabled` greys a button out. `aria-disabled` marks a mockup action this
 * app cannot do yet: it keeps Paper's look and stays focusable so a Hint
 * can explain why.
 */
export const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-sm rounded-sm text-sm leading-sm font-medium tracking-tight whitespace-nowrap transition-[background-color,color,box-shadow,scale] duration-fast ease-out select-none focus-visible:shadow-focus active:scale-press disabled:pointer-events-none disabled:text-text-disabled aria-disabled:cursor-default aria-disabled:active:scale-100 [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
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
        /** Composer chips such as Auto · Medium. */
        chip: "h-7 gap-sm pr-sm pl-md text-xs leading-sm",
        icon: "size-7",
        /** 28px on desktop, 32px on touch screens (YL0 composer). */
        "icon-responsive": "size-7 max-md:size-8",
        "icon-sm": "size-6 [&_svg]:size-3.5",
        md: "h-7 px-lg",
        /** Project, branch, and workspace pickers. */
        picker: "h-8 gap-md pr-md pl-control",
        sm: "h-6 px-md text-xs",
        /** Inline text action with no box, e.g. "View changes". */
        text: "h-auto px-0 text-xs leading-sm",
      },
      variant: {
        /** Quiet composer chip: hover and open fill, open adds a ring. */
        chip: "font-book text-text-secondary hover:bg-surface-active data-[state=open]:bg-surface-active data-[state=open]:shadow-[inset_0_0_0_1px_var(--color-border-strong)]",
        danger: "text-danger hover:bg-danger-muted",
        "danger-solid":
          "bg-danger text-on-accent hover:bg-danger/90 disabled:bg-surface-overlay disabled:shadow-[inset_0_0_0_1px_var(--color-border)]",
        ghost:
          "text-text-secondary hover:bg-surface-overlay hover:text-text data-[state=open]:bg-surface-overlay data-[state=open]:text-text",
        /** Quiet text action; pair with size `text`. */
        link: "text-text-secondary hover:text-text data-[state=open]:text-text",
        picker:
          "bg-surface-overlay text-text shadow-button hover:bg-surface-active data-[state=open]:shadow-[inset_0_1px_0_var(--color-highlight),0_0_0_1px_var(--color-border-strong),0_0_0_4px_var(--color-accent-muted)] [&>svg:first-child]:text-text-secondary",
        primary:
          "bg-accent text-on-accent hover:bg-accent-hover disabled:bg-surface-active",
        secondary:
          "bg-surface-overlay text-text shadow-button hover:bg-surface-active focus-visible:shadow-focus disabled:shadow-[inset_0_0_0_1px_var(--color-border)] data-[state=open]:bg-surface-active",
        /** Round composer send button: accent when ready, quiet when empty. */
        submit:
          "bg-accent text-on-accent hover:bg-accent-hover disabled:bg-surface-active disabled:text-text-disabled [&_svg]:size-3.5",
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
  size?: "md" | "responsive" | "sm";
};

const ICON_SIZE = {
  md: "icon",
  responsive: "icon-responsive",
  sm: "icon-sm",
} as const;

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
    size={ICON_SIZE[size]}
    variant={variant}
    {...props}
  >
    {icon}
  </Button>
);

/** A focusable, inert action with a short explanation. No click handler is accepted. */
export const UnavailableButton = ({
  children,
  reason,
  variant = "secondary",
  size,
}: {
  children: ReactNode;
  reason: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) => (
  <Hint label={reason}>
    <Button aria-disabled="true" size={size} variant={variant}>
      {children}
    </Button>
  </Hint>
);
