"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { isApiError } from "@/lib/api/api-error";

const MAX_RETRIES = 2;
const STALE_MS = 5000;

const retryable = (error: unknown) =>
  !isApiError(error) || error.code === "internal" || error.status === 0;

const makeClient = () =>
  new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: {
        refetchOnWindowFocus: true,
        retry: (count, error) => retryable(error) && count < MAX_RETRIES,
        staleTime: STALE_MS,
      },
    },
  });

let browserClient: QueryClient | undefined;

// One client per browser tab; the server renders with a throwaway client.
const getClient = () => {
  if (typeof window === "undefined") {
    return makeClient();
  }
  browserClient ??= makeClient();
  return browserClient;
};

export const QueryProvider = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={getClient()}>{children}</QueryClientProvider>
);
