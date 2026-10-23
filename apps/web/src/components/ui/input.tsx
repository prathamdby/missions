import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

const fieldChrome =
  "rounded-sm bg-surface-raised text-sm leading-sm font-book tracking-tight text-text shadow-[inset_0_0_0_1px_var(--color-border-strong)] transition-shadow duration-fast";
const fieldState =
  "aria-invalid:shadow-[0_0_0_1px_var(--color-danger),0_0_0_4px_var(--color-danger-muted)] disabled:bg-surface disabled:text-text-disabled disabled:shadow-[inset_0_0_0_1px_var(--color-border)]";
const fieldFocus =
  "focus-visible:shadow-[0_0_0_1px_var(--color-focus),0_0_0_4px_var(--color-accent-muted)]";
const groupFocus =
  "focus-within:shadow-[0_0_0_1px_var(--color-focus),0_0_0_4px_var(--color-accent-muted)] has-[input[aria-invalid=true]]:shadow-[0_0_0_1px_var(--color-danger),0_0_0_4px_var(--color-danger-muted)] has-[input:disabled]:bg-surface has-[input:disabled]:shadow-[inset_0_0_0_1px_var(--color-border)]";
const publishChrome =
  "w-full rounded-sm bg-surface px-lg py-control text-sm leading-chat font-book tracking-tight text-text outline-none ring-1 ring-border placeholder:text-text-tertiary focus-visible:ring-border-strong";

type InputProps = Omit<ComponentProps<"input">, "size"> & {
  leading?: ReactNode;
  trailing?: ReactNode;
  mono?: boolean;
  /** `touch` is the 40px field used in mobile sheets. */
  size?: "md" | "touch";
  /** `sunken` sits darker than its container, as fields inside Paper dialogs do. */
  surface?: "raised" | "sunken";
  variant?: "field" | "publish";
};

export const Input = ({
  className,
  leading,
  mono = false,
  size = "md",
  surface = "raised",
  trailing,
  type = "text",
  variant = "field",
  ...props
}: InputProps) => {
  const text = mono ? "font-mono text-xs" : "";
  const fill = surface === "sunken" ? "bg-surface" : "";
  const box = size === "touch" ? "h-10 px-lg" : "h-8 px-control";
  if (leading === undefined && trailing === undefined) {
    return (
      <input
        className={cn(
          variant === "publish"
            ? publishChrome
            : cn(
                fieldChrome,
                fieldState,
                fieldFocus,
                box,
                fill,
                "w-full min-w-0 outline-none placeholder:text-text-tertiary"
              ),
          text,
          className
        )}
        data-slot="input"
        type={type}
        {...props}
      />
    );
  }
  return (
    <div
      className={cn(
        variant === "publish"
          ? cn(publishChrome, "focus-within:ring-border-strong")
          : cn(fieldChrome, groupFocus, box, fill),
        "flex w-full min-w-0 items-center gap-md text-text-tertiary [&_svg]:size-4 [&_svg]:shrink-0",
        className
      )}
      data-slot="input-group"
    >
      {leading}
      <input
        className={cn(
          "h-full min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-text-tertiary focus-visible:shadow-none disabled:text-text-disabled",
          text
        )}
        type={type}
        {...props}
      />
      {trailing}
    </div>
  );
};

type TextareaProps = ComponentProps<"textarea"> & {
  mono?: boolean;
  /** Publish fields retain native rows and vertical resizing, not content sizing. */
  size?: "md" | "sm";
  variant?: "bare" | "field" | "publish";
};

export const Textarea = ({
  className,
  mono = false,
  size = "md",
  variant = "field",
  ...props
}: TextareaProps) => (
  <textarea
    className={cn(
      variant === "publish"
        ? cn(publishChrome, "resize-y", size === "sm" ? "min-h-20" : "min-h-24")
        : cn(
            "field-sizing-content w-full min-w-0 resize-none text-sm placeholder:text-text-tertiary disabled:text-text-disabled",
            variant === "field"
              ? cn(
                  fieldChrome,
                  fieldState,
                  fieldFocus,
                  "min-h-24 px-control py-md leading-lg outline-none"
                )
              : "min-h-6 bg-transparent leading-chat font-book tracking-tight text-text outline-none focus-visible:shadow-none"
          ),
      mono && "font-mono text-xs leading-md",
      className
    )}
    data-slot="textarea"
    {...props}
  />
);

/** Field label above an input. */
export const FieldLabel = ({
  className,
  htmlFor,
  size = "sm",
  ...props
}: ComponentProps<"label"> & {
  htmlFor: string;
  /** `xs` is the dialog form label (ONT, NAA). */
  size?: "sm" | "xs";
}) => (
  <label
    className={cn(
      "font-medium tracking-tight text-text-secondary",
      // The size goes before leading: tailwind-merge drops a leading class that precedes a text size.
      size === "xs" ? "text-xs" : "text-sm",
      "leading-sm",
      className
    )}
    htmlFor={htmlFor}
    {...props}
  />
);

/** Helper or error line under an input. */
export const FieldHint = ({
  className,
  tone = "default",
  ...props
}: ComponentProps<"p"> & { tone?: "danger" | "default" }) => (
  <p
    className={cn(
      "text-xs leading-sm font-book tracking-tight",
      tone === "danger" ? "text-danger" : "text-text-tertiary",
      className
    )}
    {...props}
  />
);
