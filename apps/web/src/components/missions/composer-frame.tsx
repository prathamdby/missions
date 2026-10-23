import type { ReactNode } from "react";

import {
  ComposerBox,
  ComposerLegend,
  ComposerToolbar,
} from "@/components/ui/composer-box";

/** Raised box shared by the new-mission and chat composers. */
export const ComposerFrame = ({
  children,
  inert,
  toolbar,
}: {
  children: ReactNode;
  inert?: boolean;
  toolbar: ReactNode;
}) => (
  <ComposerBox inert={inert}>
    {children}
    <ComposerToolbar>{toolbar}</ComposerToolbar>
  </ComposerBox>
);

/** Keyboard legend under a composer; each child is one group. */
export const ComposerHints = ({ children }: { children: ReactNode }) => (
  <ComposerLegend>{children}</ComposerLegend>
);
