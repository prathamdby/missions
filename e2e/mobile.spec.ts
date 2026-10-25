import { expect, test } from "@playwright/test";

import { addProject, gitRepo, useScriptedModels } from "./fixtures";
import { mountUI, populateSidebar, uiMission } from "./ui-fixtures";

test.beforeAll(async ({ request }) => {
  await useScriptedModels(request);
});

test("mobile details keep independent sections and reopen a closed worker tab", async ({
  page,
  request,
}, info) => {
  const snapshot = await uiMission(request, "mobile-ui-sections");
  populateSidebar(snapshot);
  await mountUI(page, snapshot);
  const tabs = page.getByRole("tablist", { name: "Agent conversations" });
  const worker = tabs.getByRole("tab", { exact: true, name: "Task 1" });
  const close = tabs.getByRole("button", {
    exact: true,
    name: "Close Task 1 conversation",
  });
  await expect(close).toHaveCSS("opacity", "0");
  const hiddenClose = await close.boundingBox();
  if (!hiddenClose) {
    throw new Error("Missing worker close control");
  }
  // The invisible close hit area must select the inactive tab, not close it.
  await page.touchscreen.tap(
    hiddenClose.x + hiddenClose.width / 2,
    hiddenClose.y + hiddenClose.height / 2
  );
  await expect(worker).toHaveAttribute("aria-selected", "true");
  await expect(close).toHaveCSS("opacity", "1");
  await close.click();
  await expect(worker).toHaveCount(0);
  await page.getByRole("button", { name: /^Mission details/u }).click();
  const todos = page.getByLabel("Todos content", { exact: true });
  const agents = page.getByLabel("Agents content", { exact: true });
  await expect
    .poll(() => todos.evaluate((node) => node.scrollHeight - node.clientHeight))
    .toBeGreaterThan(100);
  await expect
    .poll(() =>
      agents.evaluate((node) => node.scrollHeight - node.clientHeight)
    )
    .toBeGreaterThan(100);
  await page.screenshot({ path: info.outputPath("mobile-overview.png") });
  await page
    .getByRole("button", { exact: true, name: "Open Worker 1 conversation" })
    .click();
  await expect(worker).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("dialog", { name: "Mission details" })
  ).toHaveCount(0);
});

test("mobile attachments wrap without page overflow and removing one keeps the draft", async ({
  page,
  request,
}, info) => {
  const project = await addProject(request, gitRepo("mobile-ui-attachments"));
  await page.goto("/");
  await page.getByRole("button", { exact: true, name: "Project" }).click();
  await page.getByRole("option", { name: project.name }).click();
  const goal = page.getByRole("textbox", { name: "Mission goal" });
  await goal.fill("Keep this draft");
  await page.getByLabel("Choose attachments").setInputFiles([
    {
      buffer: Buffer.from("notes"),
      mimeType: "text/plain",
      name: "one-long-file-name-with-evidence-and-notes.txt",
    },
    {
      buffer: Buffer.from("notes"),
      mimeType: "text/plain",
      name: "another-file.txt",
    },
    {
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yImcAAAAASUVORK5CYII=",
        "base64"
      ),
      mimeType: "image/png",
      name: "screenshot.png",
    },
  ]);
  const attachments = page.getByRole("list", {
    exact: true,
    name: "Attachments",
  });
  await expect(
    attachments.getByRole("img", { name: "screenshot.png" })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBeTruthy();
  await page.screenshot({ path: info.outputPath("mobile-attachments.png") });
  await attachments
    .getByRole("button", { exact: true, name: "Remove another-file.txt" })
    .click();
  await expect(goal).toHaveValue("Keep this draft");
  await expect(attachments.getByRole("link")).toHaveCount(2);
});

test("a phone can start a mission and open the navigation", async ({
  page,
  request,
}) => {
  const project = await addProject(request, gitRepo("mobile"));
  await page.goto("/");
  await page.getByRole("button", { exact: true, name: "Project" }).click();
  await page.getByRole("option", { name: project.name }).click();
  await page
    .getByRole("textbox", { name: "Mission goal" })
    .fill("Write a NOTES.md file summarizing the project Plan it first.");
  await page.getByRole("button", { name: "Start mission" }).click();
  await expect(page).toHaveURL(/\/missions\//u);
  await expect(page.getByTestId("plan-card")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
});
