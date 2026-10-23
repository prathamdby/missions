"use client";

import { useSyncExternalStore } from "react";

const subscribeTo = (query: string) => (listener: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
};

/** `md` in design/tokens.json; below it the layout switches to drawers. */
export const DESKTOP_QUERY = "(min-width: 1024px)";
/** `lg`; the right panel docks inline at this width. */
export const WIDE_QUERY = "(min-width: 1440px)";

export const useMediaQuery = (query: string, serverValue = true) =>
  useSyncExternalStore(
    subscribeTo(query),
    () => window.matchMedia(query).matches,
    () => serverValue
  );
