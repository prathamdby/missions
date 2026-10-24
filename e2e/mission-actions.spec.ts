import { existsSync } from "node:fs";

import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import type { ModelOption } from "../packages/protocol/src/settings";
import {
  addProject,
  controlMission,
  createMission,
  gitRepo,
  missionSnapshot,
  missionStatus,
  renameMission,
  updateSettings,
  useScriptedModels,
} from "./fixtures";

const API = "/api/daemon/v2";
const CATALOG: ModelOption[] = [
  {
    defaultReasoningEffort: "high",
    displayName: "Scripted (offline)",
    id: "scripted",
    supportedReasoningEfforts: ["low", "medium", "high"],
  },
];

test.beforeAll(async ({ request }) => {
  await useScriptedModels(request);
});

const pageScroll = (page: Page) =>
  page.evaluate(() => ({
    overflow:
      document.documentElement.scrollHeight -
      document.documentElement.clientHeight,
    y: window.scrollY,
  }));

test("the page itself never scrolls and shows no shortcut hints", async ({
  page,
  request,
}) => {
  const project = await addProject(request, gitRepo("contained"));
  const mission = await createMission(
    request,
    project.id,
    "Write a NOTES.md file summarizing the project",
    "work"
  );
  await page.goto(`/missions/${mission.id}`);
  await expect(page.getByTestId("mission-complete")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId("composer-input").hover();
  await page.mouse.wheel(0, 4000);
  await page.keyboard.press("End");
  expect(await pageScroll(page)).toEqual({ overflow: 0, y: 0 });
  await expect(page.locator("kbd")).toHaveCount(0);
  await page.goto("/");
  await expect(page.locator("kbd")).toHaveCount(0);
  expect(await pageScroll(page)).toEqual({ overflow: 0, y: 0 });
});

test("the composer button sends with text and resumes a paused mission", async ({
  page,
  request,
}) => {
  const project = await addProject(request, gitRepo("composer-action"));
  const mission = await createMission(
    request,
    project.id,
    "Summarize the composer project"
  );
  await expect
    .poll(() => missionStatus(request, mission.id), { timeout: 30_000 })
    .toBe("awaiting_approval");
  await page.goto(`/missions/${mission.id}`);
  const action = page.getByTestId("composer-send");
  await expect(action).toHaveAttribute("data-action", "send");
  await expect(action).toHaveAttribute("aria-disabled", "true");
  await page.getByTestId("composer-input").fill("Mention the README");
  await expect(action).toHaveAttribute("aria-disabled", "false");
  await page.getByTestId("composer-input").fill("");

  await controlMission(request, mission.id, "pause");
  await expect(action).toHaveAttribute("data-action", "resume", {
    timeout: 30_000,
  });
  await expect(action).toHaveAccessibleName("Resume mission");
  await action.click();
  await expect
    .poll(() => missionStatus(request, mission.id), { timeout: 30_000 })
    .not.toBe("paused");
  await expect(action).not.toHaveAttribute("data-action", "resume");
});

test("a new mission starts with the picked models and the default workspace", async ({
  page,
  request,
}) => {
  const project = await addProject(request, gitRepo("new-defaults"));
  await page.route(`**${API}/models`, (route) =>
    route.fulfill({ json: { models: CATALOG, source: "droid" } })
  );
  try {
    await page.goto("/settings");
    const workspaceSetting = page.getByTestId("settings-default-workspace");
    await workspaceSetting.selectOption("current_checkout");
    await expect(workspaceSetting).toHaveValue("current_checkout");
    await page.reload();
    await expect(workspaceSetting).toHaveValue("current_checkout");

    await page.goto("/");
    await page.getByRole("button", { exact: true, name: "Project" }).click();
    await page.getByRole("option", { name: project.name }).click();
    await expect(
      page.getByRole("button", { exact: true, name: "Workspace" })
    ).toContainText("Current checkout");

    await page.getByTestId("model-picker").click();
    await expect(page.getByTestId("new-orchestrator-model-row")).toBeVisible();
    await expect(page.getByTestId("new-worker-model-row")).toBeVisible();
    await page.getByRole("combobox", { name: "Orchestrator thinking" }).click();
    await page.getByRole("option", { exact: true, name: "Low" }).click();
    await page.keyboard.press("Escape");

    await page
      .getByRole("textbox", { name: "Mission goal" })
      .fill("Write a NOTES.md file summarizing the project");
    const created = page.waitForRequest(
      (sent) =>
        sent.method() === "POST" && sent.url().endsWith(`${API}/missions`)
    );
    await page.getByRole("button", { name: "Start mission" }).click();
    const sent = await created;
    const body = sent.postDataJSON() as {
      orchestrator: unknown;
      worker: unknown;
      workspace: { mode: string };
    };
    expect(body.orchestrator).toEqual({
      modelId: "scripted",
      reasoningEffort: "low",
    });
    expect(body.worker).toEqual({ modelId: "scripted", reasoningEffort: null });
    expect(body.workspace.mode).toBe("current_checkout");
    await expect(page).toHaveURL(/\/missions\//u);
  } finally {
    await updateSettings(request, { defaultWorkspaceMode: "new_worktree" });
  }
});

test("sidebar actions rename and delete a stopped mission but keep its files", async ({
  page,
  request,
}) => {
  const repo = gitRepo("sidebar-actions");
  const project = await addProject(request, repo);
  const mission = await createMission(
    request,
    project.id,
    "Describe the sidebar project"
  );
  await expect
    .poll(() => missionStatus(request, mission.id), { timeout: 30_000 })
    .toBe("awaiting_approval");
  await controlMission(request, mission.id, "pause");
  await expect
    .poll(() => missionStatus(request, mission.id), { timeout: 30_000 })
    .toBe("paused");
  const { mission: current } = (await missionSnapshot(request, mission.id)) as {
    mission: { title: string };
  };

  await page.goto(`/missions/${mission.id}`);
  const sidebar = page.getByRole("navigation", { name: "Missions" });
  await sidebar
    .getByRole("button", { name: `More actions for ${current.title}` })
    .click();
  await page.getByTestId("mission-action-rename").click();
  const input = page.getByTestId("rename-mission-input");
  await expect(input).toBeFocused();
  await input.fill("Renamed sidebar mission");
  await page.getByTestId("rename-mission-save").click();
  await expect(page.getByTestId("rename-mission-dialog")).toBeHidden();
  const link = sidebar.getByRole("link", { name: /Renamed sidebar mission/u });
  await expect(link).toBeVisible();

  await link.click({ button: "right" });
  await page.getByTestId("mission-action-delete").click();
  await expect(page.getByTestId("delete-mission-dialog")).toContainText(
    "stay on disk"
  );
  await page.getByTestId("delete-mission-confirm").click();
  await expect(page).toHaveURL(/\/$/u);
  await expect(link).toHaveCount(0);
  await expect(missionSnapshot(request, mission.id)).rejects.toThrow("404");
  expect(existsSync(`${repo}/README.md`)).toBe(true);
});

const stoppedMission = async (
  request: APIRequestContext,
  name: string,
  goal: string
) => {
  const project = await addProject(request, gitRepo(name));
  const mission = await createMission(request, project.id, goal);
  await expect
    .poll(() => missionStatus(request, mission.id), { timeout: 30_000 })
    .toBe("awaiting_approval");
  await controlMission(request, mission.id, "pause");
  await expect
    .poll(() => missionStatus(request, mission.id), { timeout: 30_000 })
    .toBe("paused");
  const { mission: current } = (await missionSnapshot(request, mission.id)) as {
    mission: { id: string; title: string };
  };
  return current;
};

test("a rename that hits a newer revision saves on retry and keeps the typed title", async ({
  page,
  request,
}) => {
  const mission = await stoppedMission(
    request,
    "stale-rename",
    "Outline the stale rename project"
  );
  await page.goto("/");
  const sidebar = page.getByRole("navigation", { name: "Missions" });
  await sidebar
    .getByRole("button", { name: `More actions for ${mission.title}` })
    .click();
  await page.getByTestId("mission-action-rename").click();
  const input = page.getByTestId("rename-mission-input");
  await input.fill("Typed in the dialog");
  await renameMission(request, mission.id, "Renamed elsewhere");
  await page.getByTestId("rename-mission-save").click();
  await expect(
    page.getByText("Already updated", { exact: true })
  ).toBeVisible();
  await expect(input).toHaveValue("Typed in the dialog");
  await page.getByTestId("rename-mission-save").click();
  await expect(page.getByTestId("rename-mission-dialog")).toBeHidden();
  await expect(
    sidebar.getByRole("link", { name: /Typed in the dialog/u })
  ).toBeVisible();
});

test("a delete answered with not_found stays put when the mission cannot be re-read", async ({
  page,
  request,
}) => {
  const mission = await stoppedMission(
    request,
    "unconfirmed-delete",
    "Outline the unconfirmed delete project"
  );
  await page.goto("/");
  const sidebar = page.getByRole("navigation", { name: "Missions" });
  await sidebar
    .getByRole("button", { name: `More actions for ${mission.title}` })
    .click();
  await page.getByTestId("mission-action-delete").click();
  await page.route(`**${API}/missions/${mission.id}`, async (route) => {
    if (route.request().method() === "DELETE") {
      await route.fulfill({
        json: { error: { code: "not_found", message: "Not found" } },
        status: 404,
      });
      return;
    }
    await route.abort("connectionreset");
  });
  await page.getByTestId("delete-mission-confirm").click();
  await expect(
    page.getByText("Could not delete", { exact: true })
  ).toBeVisible();
  const dialog = page.getByTestId("delete-mission-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { exact: true, name: "Cancel" }).click();
  await expect(
    sidebar.getByRole("link", { name: mission.title })
  ).toBeVisible();
  await expect(missionStatus(request, mission.id)).resolves.toBe("paused");
});
