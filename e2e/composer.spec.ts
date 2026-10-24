import { writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  addProject,
  createMission,
  gitRepo,
  useScriptedModels,
} from "./fixtures";

test("both composers insert file mentions without sending on picker Enter", async ({
  page,
  request,
}) => {
  await useScriptedModels(request);
  const repo = gitRepo("composer-mentions");
  writeFileSync(path.join(repo, "settings-view.tsx"), "export {};\n");
  const project = await addProject(request, repo);
  await page.goto("/");
  await page.getByRole("button", { exact: true, name: "Project" }).click();
  await page
    .getByRole("option")
    .filter({ hasText: "composer-mentions" })
    .click();
  const goal = page.getByRole("textbox", { name: "Mission goal" });
  await goal.fill("@sett");
  const option = page.getByRole("option", { name: "settings-view.tsx" });
  await expect(option).toBeVisible();
  await goal.press("Enter");
  await expect(goal).toHaveValue("@settings-view.tsx ");
  await expect(page).toHaveURL("/");
  await goal.fill("@sett");
  await expect(option).toBeVisible();
  await goal.press("Escape");
  await expect(option).toBeHidden();
  await goal.fill("");
  await goal.fill("@sett");
  await expect(option).toBeVisible();
  await goal.press("Tab");
  await expect(goal).toHaveValue("@settings-view.tsx ");

  const mission = await createMission(
    request,
    project.id,
    "Fix flaky retry tests"
  );
  await page.goto(`/missions/${mission.id}`);
  await expect(page.getByTestId("question-card")).toBeVisible({
    timeout: 30_000,
  });
  const composer = page.getByTestId("composer-input");
  await composer.fill("Read @sett");
  await expect(option).toBeVisible();
  await composer.press("ArrowDown");
  await composer.press("Enter");
  await expect(composer).toHaveValue("Read @settings-view.tsx ");
  await expect(
    page
      .getByRole("list", { name: "Message queue" })
      .getByText("Read @settings-view.tsx")
  ).toHaveCount(0);
});

test("slash suggestions insert literal commands in both composers", async ({
  page,
  request,
}) => {
  await useScriptedModels(request);
  const project = await addProject(request, gitRepo("composer-slash"));
  await page.route("**/composer-catalog", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        commands: [
          {
            argumentHint: "<path>",
            description: "Inspect a file",
            kind: "command",
            name: "inspect",
          },
          { description: "Review changes", kind: "skill", name: "review" },
        ],
        source: "droid",
      },
    })
  );
  await page.goto("/");
  await page.getByRole("button", { exact: true, name: "Project" }).click();
  await page.getByRole("option").filter({ hasText: "composer-slash" }).click();
  const goal = page.getByRole("textbox", { name: "Mission goal" });
  await goal.fill("/rev");
  await expect(page.getByRole("option", { name: /\/review/u })).toBeVisible();
  await goal.press("Enter");
  await expect(goal).toHaveValue("/review ");
  await expect(page).toHaveURL("/");
  const mission = await createMission(
    request,
    project.id,
    "Fix flaky retry tests"
  );
  await page.goto(`/missions/${mission.id}`);
  await expect(page.getByTestId("question-card")).toBeVisible({
    timeout: 30_000,
  });
  const composer = page.getByTestId("composer-input");
  await composer.fill("/ins");
  await expect(page.getByRole("option", { name: /\/inspect/u })).toContainText(
    "<path>"
  );
  await composer.press("Tab");
  await expect(composer).toHaveValue("/inspect ");
  await composer.fill("/inspect README.md");
  await expect(page.getByRole("option", { name: /\/inspect/u })).toHaveCount(0);
});
