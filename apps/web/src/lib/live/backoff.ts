export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  random?: () => number;
}

const DEFAULT_BASE_MS = 500;
const DEFAULT_MAX_MS = 15_000;

/**
 * Reconnect delay for attempt 1, 2, 3, ... using "equal jitter": half of the
 * capped exponential step is fixed, the other half random, so clients spread
 * out without ever retrying immediately.
 */
export const backoffDelay = (
  attempt: number,
  {
    baseMs = DEFAULT_BASE_MS,
    maxMs = DEFAULT_MAX_MS,
    random = Math.random,
  }: BackoffOptions = {}
) => {
  const step = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(step / 2 + (random() * step) / 2);
};
