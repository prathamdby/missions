/**
 * Goal keywords that switch the scripted Orchestrator into a richer demo
 * flow, so offline browser runs can reach states the default walk never
 * shows (clarifying questions, rate limits, blocked workers, startup failure).
 */
export type Scenario = "blocked" | "default" | "explore" | "rate_limit";

export const PLAN_REQUEST = /\bplan (?:it |this )?first\b/iu;

const RATE_LIMIT = /rate limit/iu;
const BLOCKED = /\bblocked\b/iu;
const EXPLORE = /\bflak(?:y|es)\b/iu;
/** A goal containing this makes the Orchestrator fail to start. */
export const START_FAILURE = /fails to start/iu;

export const scenarioOf = (goal: string): Scenario => {
  if (RATE_LIMIT.test(goal)) {
    return "rate_limit";
  }
  if (BLOCKED.test(goal)) {
    return "blocked";
  }
  return EXPLORE.test(goal) ? "explore" : "default";
};

/** Phrases the Orchestrator puts in worker instructions; Workers have no goal. */
export const WORKER_RATE_LIMIT = "Expect provider rate limits.";
export const WORKER_INSTALL = "Run pnpm install before editing.";

const lines = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`).join(
    "\n"
  );

export interface ScriptedTool {
  content: string;
  input: Record<string, unknown>;
  isError?: boolean;
  name: string;
}

export const EXPLORE_TOOLS: readonly ScriptedTool[] = [
  {
    content: lines(88, "line"),
    input: { file_path: "tests/webhooks/retry.test.ts" },
    name: "Read",
  },
  {
    content: lines(212, "line"),
    input: { file_path: "src/webhooks/retry-queue.ts" },
    name: "Read",
  },
  {
    content: lines(7, "src/webhooks/retry-queue.ts: setTimeout(retry, delay)"),
    input: { path: "src/webhooks/", pattern: "setTimeout|Date.now" },
    name: "Grep",
  },
  {
    content: lines(41, "line"),
    input: { file_path: "src/webhooks/backoff.ts" },
    name: "Read",
  },
  {
    content: "",
    input: { patterns: ["tests/**/*fake-timers*"] },
    name: "Glob",
  },
  {
    content: lines(22, "line"),
    input: { file_path: "vitest.config.ts" },
    name: "Read",
  },
];

export const TEST_RUN: ScriptedTool = {
  content:
    "Test Files  1 failed | 9 passed (10)\nAssertionError: expected retry to fire before the assertion\n2 of 10 failed",
  input: {
    command: "pnpm vitest run tests/webhooks/retry.test.ts --repeat 10",
  },
  isError: true,
  name: "Execute",
};

export const INSTALL_RUN: ScriptedTool = {
  content:
    "ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/@acme%2Fclock: Not Found - 404\nThis error happened while installing a direct dependency of /workspace",
  input: { command: "pnpm install" },
  isError: true,
  name: "Execute",
};

export const QUESTIONS = [
  {
    index: 1,
    multiSelect: false,
    options: [
      "Inject a clock into the retry queue (Recommended) — Production code takes a Clock. Tests pass a fake one. Touches 4 call sites.",
      "Fake timers in the test only — Smallest change. Production code stays as is.",
      "Retry the test on failure — Hides the flake instead of fixing it.",
    ],
    question: "How should the test control time?",
    topic: "Approach",
  },
  {
    index: 2,
    multiSelect: false,
    options: ["Yes, all 3 that use real timers", "Only the retry test"],
    question: "Fix the other timer tests too?",
    topic: "Scope",
  },
];

export const RICH_PLAN = [
  "Give the retry queue an injectable clock so tests control time, then prove the suite is stable.",
  "",
  "1. **Add a Clock interface** — src/time/clock.ts with a system clock and a fake clock for tests",
  "2. **Inject the clock into the retry queue** — Replace Date.now() and setTimeout in retry-queue.ts and backoff.ts",
  "3. **Make the 3 timer tests deterministic** — retry.test.ts, backoff.test.ts, dlq.test.ts",
  "4. **Prove it** — Run the webhook suite 50 times in a row with zero failures",
].join("\n");

export const RICH_TODOS = [
  "Add Clock interface with system and fake clocks",
  "Inject clock into retry-queue.ts",
  "Inject clock into backoff.ts",
  "Rewrite 3 timer tests with the fake clock",
  "Run webhook suite 50×",
  "Remove real timers from src/webhooks",
];

export const WORKER_TODOS = RICH_TODOS.slice(0, 2);
