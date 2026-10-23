import { expect, test } from "@playwright/test";

import {
  addProject,
  createMission,
  gitRepo,
  missionSnapshot,
  useScriptedModels,
} from "./fixtures";

test.beforeAll(async ({ request }) => {
  await useScriptedModels(request);
});

test("a mission goes from goal to plan approval to completion", async ({
  page,
  request,
}) => {
  const repo = gitRepo("lifecycle");
  const project = await addProject(request, repo);
  await page.goto("/");
  await page.getByRole("button", { name: "Project" }).click();
  await page.getByRole("option", { name: project.name }).click();
  await page
    .getByRole("textbox", { name: "Mission goal" })
    .fill("Write a NOTES.md file summarizing the project");
  await page.getByRole("button", { name: "Start mission" }).click();
  await expect(page).toHaveURL(/\/missions\//u);

  await expect(page.getByTestId("plan-card")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("plan-approve").click();
  await expect(page.getByTestId("mission-complete")).toBeVisible({
    timeout: 30_000,
  });
  const missionId = page.url().split("/missions/")[1] ?? "";
  const snapshot = (await missionSnapshot(request, missionId)) as {
    mission: { status: string };
  };
  expect(snapshot.mission.status).toBe("completed");
});

test("autonomy off asks before the Worker writes", async ({
  page,
  request,
}) => {
  const project = await addProject(request, gitRepo("permission"));
  const mission = await createMission(request, project.id, "off");
  await page.goto(`/missions/${mission.id}`);
  await page.getByTestId("plan-approve").click({ timeout: 30_000 });
  const allow = page.getByTestId("permission-allow-once");
  await expect(allow).toBeVisible({ timeout: 30_000 });
  await allow.click();
  await expect(page.getByTestId("mission-complete")).toBeVisible({
    timeout: 30_000,
  });
});

test("sending changes back revises the plan", async ({ page, request }) => {
  const project = await addProject(request, gitRepo("revise"));
  const mission = await createMission(request, project.id);
  await page.goto(`/missions/${mission.id}`);
  await page.getByRole("button", { name: "Keep planning" }).click();
  await page
    .getByRole("textbox", { name: "What should change in the plan?" })
    .fill("Mention the README too");
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByText("Revised plan 2")).toBeVisible({
    timeout: 30_000,
  });
});
