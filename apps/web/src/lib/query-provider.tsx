"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { isApiError } from "./api/api-error";
import { backoffDelay } from "./live/backoff";

const MAX_RETRIES = 2;
const STALE_MS = 5000;

const retryable = (error: unknown) =>
  !(error instanceof Error && error.name === "AbortError") &&
  (!isApiError(error) || error.code === "internal" || error.status === 0);

export const makeQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: {
        refetchOnWindowFocus: true,
        retry: (count, error) => retryable(error) && count < MAX_RETRIES,
        retryDelay: (attempt) => backoffDelay(attempt + 1),
        staleTime: STALE_MS,
      },
    },
  });

let browserClient: QueryClient | undefined;

// One client per browser tab; the server renders with a throwaway client.
const getClient = () => {
  if (typeof window === "undefined") {
    return makeQueryClient();
  }
  browserClient ??= makeQueryClient();
  return browserClient;
};

export const QueryProvider = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={getClient()}>{children}</QueryClientProvider>
);
