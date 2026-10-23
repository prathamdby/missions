"use client";

import { ChevronsUpDownIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/ui/button";

type PickerButtonProps = Omit<ComponentProps<typeof Button>, "children"> & {
  icon: ReactNode;
  label: ReactNode;
};

/** Secondary pill with a leading icon and an up/down chevron, used as picker triggers. */
export const PickerButton = ({ icon, label, ...props }: PickerButtonProps) => (
  <Button variant="secondary" {...props}>
    {icon}
    <span className="max-w-48 truncate">{label}</span>
    <ChevronsUpDownIcon aria-hidden="true" />
  </Button>
);
