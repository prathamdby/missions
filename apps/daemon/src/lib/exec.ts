import { execa } from "execa";

export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  /** The executable was not found. */
  missing: boolean;
}

export interface RunOptions {
  signal?: AbortSignal;
  input?: string | Uint8Array;
  inputFile?: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  onStderrLine?: (line: string) => void;
}

const BASE_ENV = {
  // Never block on an interactive credential prompt.
  GH_PROMPT_DISABLED: "1",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
};

const killGroup = (pid: number | undefined, signal: NodeJS.Signals) => {
  if (!pid || process.platform === "win32") {
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
};

/** Argument-array execution only: nothing is ever passed through a shell. */
export const run = async (
  file: string,
  args: readonly string[],
  options: RunOptions = {}
): Promise<RunResult> => {
  const child = execa(file, args, {
    cancelSignal: options.signal,
    cwd: options.cwd,
    detached: process.platform !== "win32",
    env: { ...BASE_ENV, ...options.env },
    input: options.input,
    inputFile: options.inputFile,
    reject: false,
    stdin:
      options.input === undefined && options.inputFile === undefined
        ? "ignore"
        : "pipe",
    stripFinalNewline: true,
    timeout: options.timeoutMs ?? 120_000,
  });
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  const cancelGroup = () => {
    cancelled = true;
    killGroup(child.pid, "SIGTERM");
    forceTimer ??= setTimeout(() => killGroup(child.pid, "SIGKILL"), 1000);
    forceTimer.unref();
  };
  const timeout = setTimeout(cancelGroup, options.timeoutMs ?? 120_000);
  timeout.unref();
  options.signal?.addEventListener("abort", cancelGroup, { once: true });
  if (options.signal?.aborted) {
    cancelGroup();
  }
  let callbackError: unknown;
  if (options.onStderrLine) {
    const { onStderrLine } = options;
    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (chunk: string) => {
      for (const line of chunk.split(/[\r\n]+/u)) {
        if (line.trim()) {
          try {
            onStderrLine(line.trim());
          } catch (error) {
            callbackError = error;
            cancelGroup();
          }
        }
      }
    });
  }
  const result = await child.finally(() => {
    clearTimeout(timeout);
    clearTimeout(forceTimer);
    options.signal?.removeEventListener("abort", cancelGroup);
    if (cancelled) {
      killGroup(child.pid, "SIGKILL");
    }
  });
  if (callbackError !== undefined) {
    throw callbackError;
  }
  const missing =
    result.failed &&
    result.exitCode === undefined &&
    (result.cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
  return {
    code: result.exitCode ?? null,
    missing,
    ok: result.exitCode === 0,
    stderr: String(result.stderr ?? ""),
    stdout: String(result.stdout ?? ""),
  };
};

export const git = (
  cwd: string,
  args: readonly string[],
  options: RunOptions = {}
) =>
  run("git", args, {
    ...options,
    cwd,
    env: { ...options.env, GIT_LITERAL_PATHSPECS: "1" },
  });

/** Strips credentials from URLs before they reach storage, logs, or the UI. */
export const redactUrl = (url: string) =>
  url.replaceAll(/(?<scheme>[a-z][\w+.-]*:\/\/)[^/@\s]+@/giu, "$<scheme>");
