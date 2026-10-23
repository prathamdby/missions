import { expect, test } from "@playwright/test";

import { addProject, gitRepo, useScriptedModels } from "./fixtures";

test.beforeAll(async ({ request }) => {
  await useScriptedModels(request);
});

test("a phone can start a mission and open the navigation", async ({
  page,
  request,
}) => {
  const project = await addProject(request, gitRepo("mobile"));
  await page.goto("/");
  await page.getByRole("button", { name: "Project" }).click();
  await page.getByRole("option", { name: project.name }).click();
  await page
    .getByRole("textbox", { name: "Mission goal" })
    .fill("Write a NOTES.md file summarizing the project");
  await page.getByRole("button", { name: "Start mission" }).click();
  await expect(page).toHaveURL(/\/missions\//u);
  await expect(page.getByTestId("plan-card")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
});
