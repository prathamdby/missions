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

test("a Work mission goes from goal to completion without a plan gate", async ({
  page,
  request,
}) => {
  const project = await addProject(request, gitRepo("work-mode"));
  await page.goto("/");
  await page.getByRole("button", { exact: true, name: "Project" }).click();
  await page.getByRole("option", { name: project.name }).click();
  await page
    .getByRole("textbox", { name: "Mission goal" })
    .fill("Write a NOTES.md file summarizing the project");
  await page.getByRole("button", { name: "Start mission" }).click();
  await expect(page).toHaveURL(/\/missions\//u);
  await expect(page.getByTestId("mission-complete")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("plan-card")).toHaveCount(0);
});

test("a Plan mission goes from goal to plan approval to completion", async ({
  page,
  request,
}) => {
  const repo = gitRepo("lifecycle");
  const project = await addProject(request, repo);
  await page.goto("/");
  await page.getByRole("button", { exact: true, name: "Project" }).click();
  await page.getByRole("option", { name: project.name }).click();
  await page
    .getByRole("textbox", { name: "Mission goal" })
    .fill("Write a NOTES.md file summarizing the project. Plan it first.");
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
