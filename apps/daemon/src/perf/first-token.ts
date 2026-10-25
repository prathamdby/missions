import os from "node:os";
import path from "node:path";

import { createDaemon } from "../daemon";
import { pollUntil } from "../lib/async";
import type { TimingRecord } from "../lib/timing";
import { TitleGenerator } from "../missions/title-generator";
import { ProcessSupervisor } from "../processes/process-supervisor";
import { AgentRuntime } from "../sdk/agent-runtime";
import type { AgentEvent } from "../sdk/agent-runtime";
import { gitRepo, testConfig } from "../test/fixtures";
import { addHangingMcp } from "../test/hanging-mcp";

/**
 * Bounded first-token comparison between a direct SDK session and the app,
 * using the same CLI, model, reasoning, cwd and inherited MCP configuration.
 * Mission creation (cold) is measured separately from a later prompt (warm),
 * and first thinking text is kept apart from first assistant text.
 *
 *   pnpm perf:first-token -- --samples 3 --model glm-5.3-flash
 * Set MISSIONS_PERF_TITLES=0 for a baseline without background titles.
 * Set MISSIONS_PERF_HANG_MCP=1 to add a non-handshaking stdio server in
 * the disposable project only. User configuration is never changed.
 *
 * Opt-in only: it spawns real Droid sessions and spends model tokens.
 */

const MAX_SAMPLES = 10;
const TURN_MS = 120_000;
const COLD_PROMPT = "Reply with the single word: ready";
const WARM_PROMPT = "Reply with the single word: again";
const TITLES = process.env.MISSIONS_PERF_TITLES !== "0";
const HANG_MCP = process.env.MISSIONS_PERF_HANG_MCP === "1";

interface ProcessRegistration {
  agentId: string;
  at: number;
}

/** Count actual spawns, not /proc enrichment callbacks for an existing PID. */
const withRegistrations = async <T>(effect: () => Promise<T>) => {
  const registrations: ProcessRegistration[] = [];
  const original = ProcessSupervisor.prototype.register;
  ProcessSupervisor.prototype.register = function register(agentId, child) {
    registrations.push({ agentId, at: Date.now() });
    original.call(this, agentId, child);
  };
  try {
    return { registrations, result: await effect() };
  } finally {
    ProcessSupervisor.prototype.register = original;
  }
};

interface Sample {
  path: "direct" | "app";
  phase: "cold" | "warm";
  firstThinkingMs: number | null;
  firstTextMs: number | null;
}

const argValue = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const SAMPLES = Math.min(
  Math.max(Number(argValue("samples") ?? 3) || 3, 1),
  MAX_SAMPLES
);
const MODEL =
  argValue("model") ?? process.env.MISSIONS_LIVE_MODEL ?? "glm-5.3-flash";
const DROID =
  argValue("droid") ??
  process.env.MISSIONS_DROID_PATH ??
  path.join(os.homedir(), ".local/bin/droid");

const percentile = (values: number[], p: number) => {
  const sorted = values.toSorted((a, b) => a - b);
  if (sorted.length === 0) {
    return null;
  }
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[index] ?? null;
};

/** Measures one prompt on a direct runtime: submit → first thinking/text. */
const directTurn = async (
  runtime: AgentRuntime,
  events: { at: number; event: AgentEvent }[],
  id: string,
  text: string
) => {
  const from = events.length;
  const started = performance.now();
  await runtime.submit(id, text, "steer");
  const done = await pollUntil(
    () => Promise.resolve(events.slice(from)),
    (seen) => seen.some(({ event }) => event.type === "turn_completed"),
    Date.now() + TURN_MS,
    50
  );
  const first = (type: AgentEvent["type"]) => {
    const hit = done.find(({ event }) => event.type === type);
    return hit ? Math.round(hit.at - started) : null;
  };
  return {
    firstTextMs: first("text_delta"),
    firstThinkingMs: first("thinking_delta"),
  };
};

const directSample = async (cwd: string, index: number): Promise<Sample[]> => {
  const events: { at: number; event: AgentEvent }[] = [];
  const runtime = new AgentRuntime({
    agentId: `perf-direct-${index}`,
    cwd,
    modelId: MODEL,
    onAskUser: () => Promise.resolve({ answers: [], cancelled: true }),
    onEvent: (event) => events.push({ at: performance.now(), event }),
    onPermission: () => Promise.resolve(false),
    onTiming: (stage, detail) => {
      process.stderr.write(
        `${JSON.stringify({ detail, path: "direct", stage })}\n`
      );
    },
    reasoningEffort: null,
    role: "orchestrator",
    supervisor: new ProcessSupervisor({
      binDir: path.join(cwd, ".git", "missions-bin"),
      droidPath: DROID,
    }),
  });
  try {
    const started = performance.now();
    await runtime.start();
    const startup = performance.now() - started;
    const cold = await directTurn(
      runtime,
      events,
      `cold-${index}`,
      COLD_PROMPT
    );
    const warm = await directTurn(
      runtime,
      events,
      `warm-${index}`,
      WARM_PROMPT
    );
    return [
      {
        firstTextMs:
          cold.firstTextMs === null
            ? null
            : Math.round(cold.firstTextMs + startup),
        firstThinkingMs:
          cold.firstThinkingMs === null
            ? null
            : Math.round(cold.firstThinkingMs + startup),
        path: "direct",
        phase: "cold",
      },
      { ...warm, path: "direct", phase: "warm" },
    ];
  } finally {
    await runtime.close();
  }
};

const stageMs = (
  records: TimingRecord[],
  traceId: string,
  stage: string,
  from: number
) => {
  const hit = records.find(
    (record) => record.traceId === traceId && record.stage === stage
  );
  return hit ? Math.round(hit.at - from) : null;
};

const appSample = async (cwd: string, index: number): Promise<Sample[]> => {
  const records: TimingRecord[] = [];
  const config = { ...(await testConfig()), droidPath: DROID };
  const daemon = await createDaemon({
    config,
    timingSinks: [(record) => records.push(record)],
    titleGenerator: TITLES
      ? (models) => new TitleGenerator({ droidPath: DROID, models })
      : null,
    version: "perf",
  });
  try {
    const added = await daemon.projects.addLocal({
      operationId: `perf-project-${index}`,
      path: cwd,
    });
    if (added.status !== "added") {
      throw new Error("The perf project could not be added");
    }
    const model = { modelId: MODEL, reasoningEffort: null };
    const coldStart = Date.now();
    const created = await daemon.missions.create({
      goal: COLD_PROMPT,
      operationId: `perf-mission-${index}`,
      orchestrator: model,
      projectId: added.project.id,
      worker: model,
      // The opt-in fixture is the harness's own untracked project config.
      workspace: { acknowledgeDirty: HANG_MCP, mode: "current_checkout" },
    });
    const missionId = created.mission.id;
    const goalId = `${missionId}:goal`;
    const idle = async () =>
      await pollUntil(
        () => Promise.resolve(daemon.missions.snapshot(missionId)),
        (snap) =>
          snap.queue.every((item) => item.state !== "accepted") &&
          snap.agents[0]?.status === "idle",
        Date.now() + TURN_MS,
        100
      );
    await pollUntil(
      () => Promise.resolve(records),
      (seen) =>
        seen.some((r) => r.traceId === goalId && r.stage === "first_text"),
      Date.now() + TURN_MS,
      50
    );
    const readyAt = records.find((r) => r.stage === "startup.ready")?.at;
    process.stderr.write(
      `${JSON.stringify({
        event: "perf.startup",
        readyAt,
        stages: records.filter((r) => r.stage.startsWith("startup.")),
      })}\n`
    );
    await idle();
    const warmId = `perf-warm-${index}`;
    const warmStart = Date.now();
    await daemon.missions.submitMessage(missionId, {
      mode: "steer",
      operationId: warmId,
      text: WARM_PROMPT,
    });
    await pollUntil(
      () => Promise.resolve(records),
      (seen) =>
        seen.some((r) => r.traceId === warmId && r.stage === "first_text"),
      Date.now() + TURN_MS,
      50
    );
    return [
      {
        firstTextMs: stageMs(records, goalId, "first_text", coldStart),
        firstThinkingMs: stageMs(records, goalId, "first_thinking", coldStart),
        path: "app",
        phase: "cold",
      },
      {
        firstTextMs: stageMs(records, warmId, "first_text", warmStart),
        firstThinkingMs: stageMs(records, warmId, "first_thinking", warmStart),
        path: "app",
        phase: "warm",
      },
    ];
  } finally {
    await daemon.close();
  }
};

const summarize = (samples: Sample[]) => {
  const rows = [];
  for (const target of ["direct", "app"] as const) {
    for (const phase of ["cold", "warm"] as const) {
      for (const metric of ["firstThinkingMs", "firstTextMs"] as const) {
        const values = samples
          .filter((s) => s.path === target && s.phase === phase)
          .map((s) => s[metric])
          .filter((value): value is number => value !== null);
        rows.push({
          metric,
          n: values.length,
          p50: percentile(values, 50),
          p90: percentile(values, 90),
          path: target,
          phase,
        });
      }
    }
  }
  return rows;
};

const perfRepo = async (index: number) => {
  const repo = await gitRepo(`perf-${index}`);
  if (HANG_MCP) {
    await addHangingMcp(repo);
  }
  return repo;
};

const main = async () => {
  const samples: Sample[] = [];
  const processes = [];
  for (let index = 0; index < SAMPLES; index += 1) {
    // Sequential on purpose: concurrent sessions would distort latency.
    // oxlint-disable-next-line no-await-in-loop -- one live session at a time
    const repo = await perfRepo(index);
    // oxlint-disable-next-line no-await-in-loop -- one live session at a time
    const direct = await withRegistrations(() => directSample(repo, index));
    // oxlint-disable-next-line no-await-in-loop -- one live session at a time
    const app = await withRegistrations(() => appSample(repo, index));
    samples.push(...direct.result, ...app.result);
    processes.push({
      app: app.registrations,
      direct: direct.registrations,
      sample: index,
    });
  }
  process.stdout.write(
    `${JSON.stringify({ droid: DROID, hangingMcp: HANG_MCP, model: MODEL, processes, samples, summary: summarize(samples), titles: TITLES }, null, 2)}\n`
  );
};

await main();
