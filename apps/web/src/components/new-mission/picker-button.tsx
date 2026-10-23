"use client";

import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { UnfoldIcon } from "@/components/ui/icons";

type PickerButtonProps = Omit<ComponentProps<typeof Button>, "children"> & {
  icon: ReactNode;
  label: ReactNode;
};

/** LFE picker trigger: leading icon, label, and an up/down chevron. Opening adds an accent ring. */
export const PickerButton = ({ icon, label, ...props }: PickerButtonProps) => (
  <Button size="picker" variant="picker" {...props}>
    {icon}
    <span className="max-w-48 truncate">{label}</span>
    <UnfoldIcon size="sm" tone="tertiary" />
  </Button>
);
