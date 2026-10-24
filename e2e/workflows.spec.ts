import { writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  addProject,
  createMission,
  gitRepo,
  missionSnapshot,
  repoFile,
  useScriptedModels,
  withRemote,
} from "./fixtures";

test.beforeAll(async ({ request }) => {
  await useScriptedModels(request);
});

test("local onboarding requires acknowledgement before using a dirty checkout", async ({
  page,
  request,
}) => {
  // Keep this independent of projects left by earlier tests.
  await addProject(request, gitRepo("onboarding-seed"));
  const repo = gitRepo("onboarding");
  writeFileSync(path.join(repo, "README.md"), "# Uncommitted user work\n");
  await page.goto("/");
  await page.getByRole("button", { exact: true, name: "Project" }).click();
  await page.getByRole("button", { name: "Open local folder…" }).click();
  const dialog = page.getByRole("dialog", { name: "Open local folder" });
  await dialog.getByRole("textbox", { name: "Folder path" }).fill(repo);
  await dialog.getByRole("textbox", { name: "Folder path" }).press("Enter");
  await expect(
    dialog.getByRole("textbox", { name: "Folder path" })
  ).toHaveValue(`${repo}/`);
  await dialog
    .getByRole("button", { exact: true, name: "Add project" })
    .click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { exact: true, name: "Workspace" }).click();
  await page.getByRole("menuitemradio", { name: /Current checkout/u }).click();
  await page
    .getByRole("textbox", { name: "Mission goal" })
    .fill("Review this local project");
  const start = page.getByRole("button", { name: "Start mission" });
  await expect(
    page.getByRole("button", { name: "Continue in checkout" })
  ).toBeVisible();
  await expect(start).toBeDisabled();
  await page.getByRole("button", { name: "Continue in checkout" }).click();
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page).toHaveURL(/\/missions\//u);
  const missionId = page.url().split("/missions/")[1] ?? "";
  const snapshot = (await missionSnapshot(request, missionId)) as {
    mission: {
      workspace: { path: string; mode: string; baselineDirtyFiles: string[] };
    };
  };
  expect(snapshot.mission.workspace.path).toBe(repo);
  expect(snapshot.mission.workspace.mode).toBe("current_checkout");
  expect(snapshot.mission.workspace.baselineDirtyFiles).toContain("README.md");
  expect(repoFile(repo, "diff", "--", "README.md")).toContain(
    "Uncommitted user work"
  );
});

test("settings persist across reload and recover after a failed save", async ({
  page,
}) => {
  await page.goto("/settings");
  const cleanup = page.getByTestId("settings-cleanup-after-merge");
  await expect(cleanup).toBeEnabled();
  const initial = await cleanup.isChecked();
  await page.route("**/api/daemon/v2/settings", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        error: { code: "unavailable", message: "Save interrupted" },
      }),
      contentType: "application/json",
      status: 503,
    });
  });
  await cleanup.click();
  await expect(
    page.getByText("Could not save the setting", { exact: true })
  ).toBeVisible();
  await expect(cleanup).toBeChecked({ checked: initial });
  await page.unroute("**/api/daemon/v2/settings");
  await cleanup.click();
  await expect(cleanup).toBeChecked({ checked: !initial });
  await page.reload();
  await expect(cleanup).toBeChecked({ checked: !initial });
  await cleanup.click();
  await expect(cleanup).toBeChecked({ checked: initial });
});

test("queued messages can be edited, switched and removed while an agent waits", async ({
  page,
  request,
}) => {
  const project = await addProject(request, gitRepo("queue-edit"));
  // The unanswered question holds the scripted turn; no timing race or sleep.
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
  await composer.fill("Keep the public behavior");
  await composer.press("Enter");
  const queue = page.getByRole("list", { name: "Message queue" });
  await expect(
    queue.getByText("Keep the public behavior", { exact: true })
  ).toBeVisible();
  await queue.getByRole("button", { exact: true, name: "Edit" }).click();
  await queue
    .getByRole("textbox", { name: "Edit queued message" })
    .fill("Keep public behavior and add tests");
  await queue.getByRole("button", { exact: true, name: "Save" }).click();
  await expect(
    queue.getByText("Keep public behavior and add tests", { exact: true })
  ).toBeVisible();
  await queue
    .getByRole("button", { exact: true, name: "Queue instead" })
    .click();
  await expect(
    queue.getByRole("button", { exact: true, name: "Steer instead" })
  ).toBeVisible();
  await page.reload();
  await expect(
    queue.getByRole("button", { exact: true, name: "Steer instead" })
  ).toBeVisible();
  await queue.getByRole("button", { name: "Remove from queue" }).click();
  await expect(
    queue.getByRole("button", { exact: true, name: "Edit" })
  ).toHaveCount(0);
  const snapshot = (await missionSnapshot(request, mission.id)) as {
    queue: { text: string; state: string; mode: string }[];
  };
  expect(snapshot.queue).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        mode: "queue",
        state: "removed",
        text: "Keep public behavior and add tests",
      }),
    ])
  );
});

test("completed work commits and pushes only to a local bare remote", async ({
  page,
  request,
}) => {
  const repo = gitRepo("local-publish");
  const remote = withRemote(repo);
  const project = await addProject(request, repo);
  const mission = await createMission(request, project.id);
  await page.goto(`/missions/${mission.id}`);
  await page.getByTestId("plan-approve").click({ timeout: 30_000 });
  await expect(page.getByTestId("mission-complete")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId("commit-message").fill("Document the local project");
  await page.getByTestId("commit-submit").click();
  await expect(page.getByTestId("push-card")).toBeVisible();
  expect(repoFile(repo, "log", "-1", "--format=%s").trim()).toBe(
    "Document the local project"
  );
  await page.getByTestId("push-submit").click();
  await expect(page.getByTestId("pr-create-card")).toBeVisible();
  expect(repoFile(remote, "rev-parse", "refs/heads/main").trim()).toBe(
    repoFile(repo, "rev-parse", "HEAD").trim()
  );
  // No PR creation: this flow never invokes an external platform mutation.
  await page.getByTestId("archive-mission").click();
  await expect(page.getByTestId("composer-input")).toBeDisabled();
});

test("Radix default workspace selection persists across reload", async ({
  page,
}) => {
  await page.goto("/settings");
  const workspace = page.getByRole("combobox", { name: "Default workspace" });
  const initial = await workspace.textContent();
  const next = initial?.includes("New worktree")
    ? "Current checkout"
    : "New worktree";
  await workspace.click();
  await page.getByRole("option", { exact: true, name: next }).click();
  await expect(workspace).toContainText(next);
  await page.reload();
  await expect(workspace).toContainText(next);
  await workspace.click();
  await page
    .getByRole("option", {
      exact: true,
      name: next === "New worktree" ? "Current checkout" : "New worktree",
    })
    .click();
});
