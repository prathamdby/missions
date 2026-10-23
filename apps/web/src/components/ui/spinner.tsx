import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Delay order for a 3x3 grid: "spiral" walks the ring (agents working),
// "wave" sweeps diagonally (a command running).
const DELAYS = {
  spiral: [
    "[animation-delay:0ms]",
    "[animation-delay:160ms]",
    "[animation-delay:320ms]",
    "[animation-delay:1120ms]",
    "[animation-delay:640ms]",
    "[animation-delay:480ms]",
    "[animation-delay:960ms]",
    "[animation-delay:800ms]",
    "[animation-delay:640ms]",
  ],
  wave: [
    "[animation-delay:0ms]",
    "[animation-delay:160ms]",
    "[animation-delay:320ms]",
    "[animation-delay:160ms]",
    "[animation-delay:320ms]",
    "[animation-delay:480ms]",
    "[animation-delay:320ms]",
    "[animation-delay:480ms]",
    "[animation-delay:640ms]",
  ],
} as const;

const CELL_KEYS = ["a", "b", "c", "d", "e", "f", "g", "h", "i"] as const;

const gridVariants = cva("grid shrink-0 grid-cols-3", {
  defaultVariants: { size: "md" },
  variants: {
    size: {
      md: "size-4 gap-2xs",
      sm: "size-2.5 gap-2xs",
    },
  },
});

type SpinnerProps = VariantProps<typeof gridVariants> & {
  className?: string;
  label?: string;
  pattern?: keyof typeof DELAYS;
};

/** Pixel-grid loader from the Paper "Loaders" set. */
export const Spinner = ({
  className,
  label = "Working",
  pattern = "spiral",
  size,
}: SpinnerProps) => (
  <output className={cn(gridVariants({ size }), className)}>
    <span className="sr-only">{label}</span>
    {CELL_KEYS.map((key, index) => (
      <span
        aria-hidden="true"
        className={cn(
          "animate-loader-cell bg-surface-active",
          DELAYS[pattern][index]
        )}
        key={key}
      />
    ))}
  </output>
);
