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

/** Argument-array execution only: nothing is ever passed through a shell. */
export const run = async (
  file: string,
  args: readonly string[],
  options: RunOptions = {}
): Promise<RunResult> => {
  const child = execa(file, args, {
    cwd: options.cwd,
    env: { ...BASE_ENV, ...options.env },
    reject: false,
    stdin: "ignore",
    stripFinalNewline: true,
    timeout: options.timeoutMs ?? 120_000,
  });
  if (options.onStderrLine) {
    const { onStderrLine } = options;
    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (chunk: string) => {
      for (const line of chunk.split(/[\r\n]+/u)) {
        if (line.trim()) {
          onStderrLine(line.trim());
        }
      }
    });
  }
  const result = await child;
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
) => run("git", args, { ...options, cwd });

/** Strips credentials from URLs before they reach storage, logs, or the UI. */
export const redactUrl = (url: string) =>
  url.replaceAll(/(?<scheme>[a-z][\w+.-]*:\/\/)[^/@\s]+@/giu, "$<scheme>");
