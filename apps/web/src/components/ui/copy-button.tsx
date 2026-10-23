"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { IconButton } from "@/components/ui/button";

const RESET_MS = 1500;

export const CopyButton = ({
  label = "Copy",
  value,
}: {
  label?: string;
  value: string;
}) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), RESET_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <IconButton
      icon={copied ? <CheckIcon /> : <CopyIcon />}
      label={copied ? "Copied" : label}
      onClick={copy}
      size="sm"
    />
  );
};
