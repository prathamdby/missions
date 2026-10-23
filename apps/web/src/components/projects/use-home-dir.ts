"use client";

import { useFsBrowse } from "@/lib/api/queries";

/** The daemon machine's home directory, used to show paths as `~/…`. */
export const useHomeDir = () => useFsBrowse(undefined).data?.path ?? null;
