import { DotmSquare3 } from "@/components/ui/dotm-square-3";
import { DotmSquare12 } from "@/components/ui/dotm-square-12";
import { cn } from "@/lib/utils";

/*
 * Paper's two pixel loaders, taken from the Dot Matrix registry: Core Spiral
 * (dotm-square-3, accent) means an agent is working; Origin Wave
 * (dotm-square-12, white) covers commands, todos, and uploads. The library
 * holds a still frame under reduced motion.
 */

const DIMENSIONS = {
  md: { dotSize: 3, size: 19 },
  sm: { dotSize: 2, size: 14 },
} as const;

// The library sets `color` inline, so a text-color class cannot reach the dots.
const LOADERS = {
  spiral: { Loader: DotmSquare3, color: "var(--color-accent)" },
  wave: { Loader: DotmSquare12, color: "var(--color-text)" },
} as const;

interface SpinnerProps {
  className?: string;
  label?: string;
  pattern?: keyof typeof LOADERS;
  size?: keyof typeof DIMENSIONS;
}

/** Pixel-dot loader from the Paper "Loaders" set. */
export const Spinner = ({
  className,
  label = "Working",
  pattern = "spiral",
  size = "md",
}: SpinnerProps) => {
  const { color, Loader } = LOADERS[pattern];
  return (
    <Loader
      ariaLabel={label}
      className={cn("shrink-0", className)}
      color={color}
      {...DIMENSIONS[size]}
    />
  );
};
