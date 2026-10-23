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
