"use client";

import { useMutation } from "@tanstack/react-query";
import type {
  DefaultError,
  UseMutationOptions,
  UseMutationResult,
} from "@tanstack/react-query";
import { useMemo } from "react";

import { createSingleFlight, OperationIntents } from "./operation-intents";

export { isDefiniteFailure } from "./operation-intents";

/** Synchronously guards mutate AND mutateAsync before React publishes pending. */
export const useSingleFlightMutation = <
  TData = unknown,
  TError = DefaultError,
  TVariables = void,
  TContext = unknown,
>(
  options: UseMutationOptions<TData, TError, TVariables, TContext>
): UseMutationResult<TData, TError, TVariables, TContext> => {
  const flight = useMemo(() => createSingleFlight(), []);
  const mutation = useMutation({
    ...options,
    onSettled: async (...args) => {
      try {
        await options.onSettled?.(...args);
      } catch (error) {
        flight.leave();
        throw error;
      }
      flight.leave();
    },
  });
  const mutate: typeof mutation.mutate = (...args) =>
    flight.mutate(() => mutation.mutate(...args));
  const mutateAsync: typeof mutation.mutateAsync = (...args) =>
    flight.mutateAsync(() => mutation.mutateAsync(...args));
  return { ...mutation, mutate, mutateAsync };
};

/** No-key release/settle target only the most recently requested intent. */
export const useOperationIds = (): OperationIntents =>
  useMemo(() => new OperationIntents(), []);
