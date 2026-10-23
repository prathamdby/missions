import type { TranscriptItem } from "@missions/protocol/missions";

import type { ToolCall } from "./timeline";

export type LineTone = "danger" | "secondary" | "success" | "warning";

const EXIT_CODE = /exit(?:ed)?(?:\s+with)?\s+code:?\s*(?<code>\d+)/iu;
const PASS = /^\s*(?:PASS\b|✓|√|ok\b)/u;
const FAIL = /^\s*(?:FAIL\b|✗|×|ERR(?:!|_)|Error\b|error\b|AssertionError\b)/u;
const RUNS = /^\s*RUNS\b/u;
const PASSED = /(?<count>\d+)\s+passed/u;
const SECONDS_LIMIT = 60_000;
/** Paper shows the tail of a command's output, not the whole log. */
export const OUTPUT_TAIL = 8;
/** Edits longer than this collapse to their first lines. */
export const DIFF_LINES = 12;

/** "Exit 1" from Droid's Execute output, when it reports the code. */
export const exitCodeOf = (text: string) => {
  const code = EXIT_CODE.exec(text)?.groups?.code;
  return code === undefined ? null : Number(code);
};

/** Test-runner colors: passes green, failures red, in-flight amber. */
export const lineTone = (line: string): LineTone => {
  if (RUNS.test(line)) {
    return "warning";
  }
  if (FAIL.test(line)) {
    return "danger";
  }
  return PASS.test(line) ? "success" : "secondary";
};

/** The last lines worth showing, without the exit code footer. */
export const outputTail = (text: string) =>
  text
    .split("\n")
    .filter((line) => line.trim() !== "" && !EXIT_CODE.test(line))
    .slice(-OUTPUT_TAIL);

/** "9 passed" from a test run's summary. */
export const passedCount = (text: string) => {
  const count = PASSED.exec(text)?.groups?.count;
  return count === undefined ? null : `${count} passed`;
};

/** Short run time: "3.4s" under a minute, "2m 05s" after. */
export const runTime = (ms: number) => {
  if (ms >= SECONDS_LIMIT) {
    const seconds = Math.floor(ms / 1000);
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
  }
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
};

export interface DiffLine {
  kind: "add" | "del";
  text: string;
}

const linesOf = (value: unknown) =>
  typeof value === "string" && value !== "" ? value.split("\n") : [];

/** Removed then added lines for an Edit or Create call's input. */
export const editDiff = (
  name: string,
  input: Readonly<Record<string, unknown>>
): DiffLine[] => {
  if (name === "Create") {
    return linesOf(input.content).map((text) => ({ kind: "add", text }));
  }
  const removed = linesOf(input.old_str ?? input.old_string);
  const added = linesOf(input.new_str ?? input.new_string);
  return [
    ...removed.map((text) => ({ kind: "del" as const, text })),
    ...added.map((text) => ({ kind: "add" as const, text })),
  ];
};

/** Short tool output reads as a status ("2 of 10 failed"); longer output does not. */
const SHORT_OUTPUT = 32;

export const toolNameOf = (call: ToolCall) =>
  call.call?.toolName ?? call.result?.toolName ?? "Tool";

export const inputOf = (call: ToolCall): Record<string, unknown> => {
  const input = call.call?.toolInput;
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
};

export const stringField = (
  input: Record<string, unknown>,
  ...keys: string[]
) => {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value) {
      return value;
    }
    if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      return value.join(" ");
    }
  }
  return null;
};

export const relativeTo = (root: string | null, value: string) =>
  root && value.startsWith(`${root}/`) ? value.slice(root.length + 1) : value;

/** The mono argument in a Paper tool row: a path, pattern, or command. */
export const argumentOf = (call: ToolCall, root: string | null) => {
  const input = inputOf(call);
  const name = toolNameOf(call);
  const path = stringField(input, "file_path", "path", "directory_path");
  if (name === "Grep") {
    const pattern = stringField(input, "pattern") ?? "";
    return path ? `"${pattern}" in ${relativeTo(root, path)}` : `"${pattern}"`;
  }
  const value =
    stringField(
      input,
      "command",
      "file_path",
      "patterns",
      "pattern",
      "url",
      "query",
      "path",
      "directory_path"
    ) ??
    Object.values(input).find((entry) => typeof entry === "string") ??
    "";
  return relativeTo(root, String(value));
};

const countLines = (text: string) =>
  text.split("\n").filter((line) => line.trim() !== "").length;

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** Right-aligned mono meta: line and match counts, or a short failure status. */
export const toolMeta = (call: ToolCall) => {
  const { result } = call;
  if (!result) {
    return null;
  }
  const name = toolNameOf(call);
  if (result.isError) {
    const last = result.text.trim().split("\n").at(-1)?.trim() ?? "";
    return {
      text: last && last.length <= SHORT_OUTPUT ? last : "failed",
      warning: true,
    };
  }
  const lines = countLines(result.text);
  const counts: Record<string, string> = {
    Glob: plural(lines, "file"),
    Grep: plural(lines, "match", "matches"),
    LS: plural(lines, "entry", "entries"),
    Read: plural(lines, "line"),
  };
  return counts[name] ? { text: counts[name], warning: false } : null;
};

const PHRASES: Record<string, [string, string, string?]> = {
  ApplyPatch: ["edited", "file"],
  Create: ["created", "file"],
  Edit: ["edited", "file"],
  Execute: ["ran", "command"],
  FetchUrl: ["fetched", "page"],
  Glob: ["ran", "search", "searches"],
  Grep: ["ran", "search", "searches"],
  LS: ["listed", "folder"],
  MultiEdit: ["edited", "file"],
  Read: ["read", "file"],
  WebSearch: ["searched the web", "time"],
};

/** "Read 4 files, ran 2 searches" in first-use order. */
export const toolSummary = (calls: readonly ToolCall[]) => {
  const counts = new Map<string, number>();
  for (const call of calls) {
    const name = toolNameOf(call);
    const phrase = PHRASES[name];
    const key = phrase ? `${phrase[0]}|${phrase[1]}|${phrase[2] ?? ""}` : name;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const text = [...counts.entries()]
    .map(([key, count]) => {
      const [verb, one, many] = key.split("|");
      if (one === undefined) {
        return count > 1 ? `used ${key} ×${count}` : `used ${key}`;
      }
      return `${verb} ${plural(count, one, many || `${one}s`)}`;
    })
    .join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const inputText = (item: TranscriptItem | null) => {
  if (item?.toolInput === undefined || item.toolInput === null) {
    return null;
  }
  return typeof item.toolInput === "string"
    ? item.toolInput
    : JSON.stringify(item.toolInput, null, 2);
};

const EDIT_TOOLS = new Set(["Create", "Edit", "MultiEdit"]);

/** A lone command that failed or is still running reads as a card (Paper I9X). */
export const isCommandCard = (calls: readonly ToolCall[], running: boolean) => {
  const [only] = calls;
  if (calls.length !== 1 || !only || toolNameOf(only) !== "Execute") {
    return false;
  }
  return only.result === null ? running : only.result.isError;
};

/** A lone command that succeeded reads as one "Ran" row (Paper I9X). */
export const isRanRow = (calls: readonly ToolCall[]) => {
  const [only] = calls;
  return (
    calls.length === 1 &&
    only !== undefined &&
    toolNameOf(only) === "Execute" &&
    only.result !== null &&
    !only.result.isError
  );
};

/** Edits with their input render as diff cards (Paper I9X). */
export const isEditGroup = (calls: readonly ToolCall[]) =>
  calls.length > 0 &&
  calls.every(
    (call) =>
      EDIT_TOOLS.has(toolNameOf(call)) &&
      editDiff(toolNameOf(call), inputOf(call)).length > 0
  );

export const elapsedOf = (call: ToolCall, now: number) => {
  const start = Date.parse(
    call.call?.createdAt ?? call.result?.createdAt ?? ""
  );
  const end = call.result ? Date.parse(call.result.createdAt) : now;
  return Number.isNaN(start) ? 0 : end - start;
};

/** One classification policy for folding and renderer selection. */
export const toolCardKind = (calls: readonly ToolCall[], running: boolean) => {
  if (isCommandCard(calls, running)) {
    return "command";
  }
  if (isRanRow(calls)) {
    return "ran";
  }
  return isEditGroup(calls) ? "edit" : null;
};
