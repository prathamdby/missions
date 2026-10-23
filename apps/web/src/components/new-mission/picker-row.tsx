"use client";

import type { ComponentProps, ReactNode } from "react";

import { ChevronRightIcon } from "@/components/ui/icons";
import { ListRow } from "@/components/ui/list-row";

type PickerRowProps = Omit<ComponentProps<typeof ListRow>, "children"> & {
  icon: ReactNode;
  label: string;
  meta?: ReactNode;
  value: ReactNode;
};

/** YL0: one picker as a row in the grouped card on touch screens. */
export const PickerRow = ({
  icon,
  label,
  meta,
  value,
  ...props
}: PickerRowProps) => (
  <ListRow size="group" {...props}>
    {icon}
    <span className="w-18 shrink-0">{label}</span>
    <span className="min-w-0 flex-1 truncate font-medium text-text">
      {value}
    </span>
    {meta}
    <ChevronRightIcon tone="tertiary" />
  </ListRow>
);
