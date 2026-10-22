import { setTimeout as delay } from "node:timers/promises";

export const sleep = async (ms: number): Promise<void> => {
  await delay(ms);
};

/**
 * Re-reads until `done` holds or the deadline passes, returning the last
 * reading. Recursion keeps each poll strictly sequential.
 */
export const pollUntil = async <T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  deadline: number,
  intervalMs: number
): Promise<T> => {
  const value = await read();
  if (done(value) || Date.now() >= deadline) {
    return value;
  }
  await sleep(intervalMs);
  return await pollUntil(read, done, deadline, intervalMs);
};

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
