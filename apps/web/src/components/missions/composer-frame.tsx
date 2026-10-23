import type { ReactNode } from "react";

/** Raised box shared by the new-mission and chat composers. */
export const ComposerFrame = ({
  children,
  toolbar,
}: {
  children: ReactNode;
  toolbar: ReactNode;
}) => (
  <div className="flex flex-col gap-sm rounded-lg bg-surface-raised px-lg pt-md pb-sm shadow-sm transition-shadow duration-fast focus-within:shadow-md">
    {children}
    <div className="-mx-sm flex items-center gap-xs">{toolbar}</div>
  </div>
);

/** Keyboard legend under a composer. */
export const ComposerHints = ({ children }: { children: ReactNode }) => (
  <div className="hidden flex-wrap items-center justify-center gap-lg type-caption text-text-tertiary md:flex">
    {children}
  </div>
);
