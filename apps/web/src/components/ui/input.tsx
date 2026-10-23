import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

const fieldChrome =
  "rounded-sm bg-surface-overlay text-sm text-text shadow-[inset_0_0_0_1px_var(--color-border-strong)] transition-shadow duration-fast";
const fieldFocus =
  "focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent),var(--shadow-focus)]";

type InputProps = ComponentProps<"input"> & {
  leading?: ReactNode;
  trailing?: ReactNode;
  mono?: boolean;
};

export const Input = ({
  className,
  leading,
  mono = false,
  trailing,
  type = "text",
  ...props
}: InputProps) => {
  const text = mono ? "font-mono text-xs" : "";
  if (leading === undefined && trailing === undefined) {
    return (
      <input
        className={cn(
          fieldChrome,
          fieldFocus,
          "h-8 w-full min-w-0 px-lg placeholder:text-text-tertiary disabled:text-text-disabled",
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
        fieldChrome,
        "flex h-8 w-full min-w-0 items-center gap-md px-lg text-text-tertiary focus-within:shadow-[inset_0_0_0_1px_var(--color-accent)] [&_svg]:size-4 [&_svg]:shrink-0",
        className
      )}
      data-slot="input-group"
    >
      {leading}
      <input
        className={cn(
          "h-full min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-text-tertiary focus-visible:shadow-none",
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
  variant?: "bare" | "field";
};

export const Textarea = ({
  className,
  variant = "field",
  ...props
}: TextareaProps) => (
  <textarea
    className={cn(
      "field-sizing-content w-full min-w-0 resize-none text-sm leading-chat placeholder:text-text-tertiary disabled:text-text-disabled",
      variant === "field"
        ? cn(fieldChrome, fieldFocus, "min-h-16 px-lg py-md")
        : "min-h-6 bg-transparent text-text outline-none focus-visible:shadow-none",
      className
    )}
    data-slot="textarea"
    {...props}
  />
);
