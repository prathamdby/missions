"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAddProject } from "@/components/projects/add-project-context";
import { useShell } from "@/components/shell/shell-context";

export const COMPOSER_ID = "mission-goal";
const FOCUS_ATTEMPTS = 20;

const focusComposer = (attempt = 0) => {
  const field = document.querySelector(`#${COMPOSER_ID}`);
  if (field instanceof HTMLTextAreaElement && !field.disabled) {
    field.focus();
    return;
  }
  if (attempt < FOCUS_ATTEMPTS) {
    requestAnimationFrame(() => focusComposer(attempt + 1));
  }
};

/** Cmd/Ctrl+N new mission, Cmd/Ctrl+K search, Cmd/Ctrl+O open a local folder, Cmd/Ctrl+, settings. */
export const GlobalShortcuts = () => {
  const router = useRouter();
  const pathname = usePathname();
  const { searchOpen, setSearchOpen } = useShell();
  const { openAddProject } = useAddProject();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier || event.altKey || event.isComposing) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "n" && !event.shiftKey) {
        event.preventDefault();
        setSearchOpen(false);
        if (pathname !== "/") {
          router.push("/");
        }
        focusComposer();
      } else if (key === "k") {
        event.preventDefault();
        setSearchOpen(!searchOpen);
      } else if (key === "o" && !event.shiftKey) {
        event.preventDefault();
        setSearchOpen(false);
        openAddProject("browse");
      } else if (key === ",") {
        event.preventDefault();
        router.push("/settings");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openAddProject, pathname, router, searchOpen, setSearchOpen]);

  return null;
};
