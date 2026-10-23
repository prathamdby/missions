/**
 * CLI initialization includes inherited MCP startup followed by the supplied
 * SDK MCP merge. Two 30s connection attempts exceed the SDK's 60s default.
 * Keep the user's integrations, allow that bounded initialization to finish,
 * and still put a deadline on every stage (including transport/MCP factories).
 */
export const SESSION_START_TIMEOUT_MS = 120_000;
export const MODEL_PROBE_TIMEOUT_MS = 30_000;

export const withDeadline = async <T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
  signal?: AbortSignal
): Promise<T> => {
  const deadline = Promise.withResolvers<never>();
  const cancel = () =>
    deadline.reject(new Error("Droid startup operation was cancelled"));
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) {
    cancel();
  }
  const timer = setTimeout(
    () => deadline.reject(new Error(message)),
    timeoutMs
  );
  try {
    return await Promise.race([operation, deadline.promise]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
};
