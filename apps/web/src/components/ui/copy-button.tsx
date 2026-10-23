"use client";

import { useEffect, useState } from "react";

import { IconButton } from "@/components/ui/button";
import { CheckIcon, CopyIcon } from "@/components/ui/icons";

const RESET_MS = 1500;

export const CopyButton = ({
  label = "Copy",
  size = "sm",
  value,
}: {
  label?: string;
  /** `md` is the 28px button inside a command field (NNV). */
  size?: "md" | "sm";
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
      size={size}
    />
  );
};

/** OBV: a bare mono command followed by a small copy glyph; clicking copies it. */
export const InlineCommand = ({ value }: { value: string }) => {
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
    <button
      aria-label={copied ? "Copied" : `Copy ${value}`}
      className="flex w-fit cursor-pointer items-center gap-md rounded-xs font-mono text-2xs leading-xs font-book text-text outline-none focus-visible:shadow-focus [&>svg]:text-text-tertiary hover:[&>svg]:text-text"
      onClick={copy}
      type="button"
    >
      {value}
      {copied ? <CheckIcon size="xs" tone="success" /> : <CopyIcon size="xs" />}
    </button>
  );
};

/** X16: a command in a dark inset chip; clicking copies it. */
export const CopyChip = ({ value }: { value: string }) => {
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
    <button
      aria-label={copied ? "Copied" : `Copy ${value}`}
      className="flex shrink-0 cursor-pointer items-center gap-sm rounded-xs bg-bg px-md py-[3px] font-mono text-2xs leading-xs font-book text-text shadow-[inset_0_0_0_1px_var(--color-border)] transition-colors duration-fast outline-none hover:bg-surface focus-visible:shadow-focus"
      onClick={copy}
      type="button"
    >
      {value}
      {copied ? (
        <CheckIcon size="xs" tone="success" />
      ) : (
        <CopyIcon size="xs" tone="tertiary" />
      )}
    </button>
  );
};
