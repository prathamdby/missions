import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { APIRequestContext, Page } from "@playwright/test";

const ORIGIN = "http://127.0.0.1:4418";
const API = "/api/daemon/v2";

export const MODEL = { modelId: "scripted", reasoningEffort: null };

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe" }).toString();

/** A throwaway repository with one commit on `main`. */
export const gitRepo = (name: string) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), `e2e-${name}-`));
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(path.join(dir, "README.md"), `# ${name}\n\nE2E project.\n`);
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "init");
  return dir;
};

/** Adds a bare `origin` so push can succeed without the network. */
export const withRemote = (repo: string) => {
  const remote = mkdtempSync(path.join(os.tmpdir(), "e2e-remote-"));
  git(remote, "init", "-q", "--bare");
  git(repo, "remote", "add", "origin", remote);
  return remote;
};

export const repoFile = (repo: string, ...args: string[]) => git(repo, ...args);

let counter = 0;
export const operationId = (prefix: string) => {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
};

const call = async (
  request: APIRequestContext,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  route: string,
  data?: unknown
) => {
  const res = await request.fetch(`${API}${route}`, {
    data,
    headers: { "content-type": "application/json", origin: ORIGIN },
    method,
  });
  const text = await res.text();
  if (!res.ok()) {
    throw new Error(`${method} ${route} → ${res.status()}: ${text}`);
  }
  return text ? (JSON.parse(text) as unknown) : null;
};

export const addProject = async (request: APIRequestContext, repo: string) => {
  const added = await call(request, "POST", "/projects", {
    operationId: operationId("add"),
    path: repo,
  });
  return (added as { project: { id: string; name: string } }).project;
};

export const createMission = async (
  request: APIRequestContext,
  projectId: string,
  autonomy: "off" | "low" | "medium" | "high" = "medium",
  goal = "Write a NOTES.md file summarizing the project",
  // Most flows exercise plan approval; Work mode is covered explicitly.
  executionMode: "work" | "plan" = "plan"
) => {
  const snapshot = await call(request, "POST", "/missions", {
    autonomy,
    executionMode,
    goal,
    operationId: operationId("mission"),
    orchestrator: MODEL,
    projectId,
    worker: MODEL,
    workspace: { acknowledgeDirty: true, mode: "current_checkout" },
  });
  return (snapshot as { mission: { id: string } }).mission;
};

/** New missions default to the scripted model so the composer can start them. */
export const useScriptedModels = async (request: APIRequestContext) =>
  await call(request, "PATCH", "/settings", {
    orchestrator: MODEL,
    worker: MODEL,
  });

/** Picks Work or Plan in the composer's mode chip before sending. */
export const chooseExecutionMode = async (
  page: Page,
  mode: "Work" | "Plan"
) => {
  await page.getByTestId("execution-mode").click();
  await page
    .getByRole("menuitemradio", { name: new RegExp(`^${mode}`, "u") })
    .click();
};

export const missionSnapshot = async (
  request: APIRequestContext,
  missionId: string
) => await call(request, "GET", `/missions/${missionId}/snapshot`);

export const updateSettings = async (
  request: APIRequestContext,
  body: Record<string, unknown>
) => await call(request, "PATCH", "/settings", body);

/** Pause, resume, or archive with the mission's current revision. */
export const controlMission = async (
  request: APIRequestContext,
  missionId: string,
  action: "archive" | "pause" | "resume"
) => {
  const snapshot = (await missionSnapshot(request, missionId)) as {
    mission: { revision: number };
  };
  return await call(request, "POST", `/missions/${missionId}/${action}`, {
    expectedRevision: snapshot.mission.revision,
    operationId: operationId(action),
  });
};

/** The mission's current status, for polling. */
export const missionStatus = async (
  request: APIRequestContext,
  missionId: string
) => {
  const snapshot = (await missionSnapshot(request, missionId)) as {
    mission: { status: string };
  };
  return snapshot.mission.status;
};
