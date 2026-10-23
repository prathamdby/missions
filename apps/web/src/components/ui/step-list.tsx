import type { ComponentProps, ReactNode } from "react";

import { CheckIcon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type StepState = "active" | "done" | "pending";

export const StepList = ({ className, ...props }: ComponentProps<"ol">) => (
  <ol className={cn("flex flex-col", className)} {...props} />
);

const labelTone: Record<StepState, string> = {
  active: "font-medium text-text",
  done: "font-book text-text",
  pending: "font-book text-text-tertiary",
};

const StepMark = ({ state }: { state: StepState }) => {
  if (state === "done") {
    return <CheckIcon size="sm" tone="success" />;
  }
  if (state === "active") {
    return <Spinner label="In progress" pattern="wave" />;
  }
  return (
    <span className="size-sm rounded-full shadow-[inset_0_0_0_1.5px_var(--color-text-disabled)]" />
  );
};

/** One line of a progress checklist: a mark, a label, and optional mono meta (NZJ). */
export const Step = ({
  label,
  meta,
  state,
}: {
  label: ReactNode;
  meta?: ReactNode;
  state: StepState;
}) => (
  <li
    aria-current={state === "active" ? "step" : undefined}
    className="flex h-7 shrink-0 items-center gap-control"
  >
    <span className="flex w-[19px] shrink-0 justify-center">
      <StepMark state={state} />
    </span>
    <span
      className={cn(
        "min-w-0 flex-1 truncate text-sm leading-sm tracking-tight",
        labelTone[state]
      )}
    >
      {label}
    </span>
    {meta ? (
      <span className="shrink-0 font-mono text-xs leading-xs font-book text-text-tertiary">
        {meta}
      </span>
    ) : null}
  </li>
);
