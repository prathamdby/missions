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

test("attachments upload in both composers and survive a lost message receipt", async ({
  page,
  request,
}) => {
  await useScriptedModels(request);
  await addProject(request, gitRepo("composer-attachments"));
  await page.goto("/");
  await page.getByRole("button", { exact: true, name: "Project" }).click();
  await page
    .getByRole("option")
    .filter({ hasText: "composer-attachments" })
    .click();
  const picker = page.waitForEvent("filechooser");
  await page.getByRole("button", { exact: true, name: "Attach files" }).click();
  const chooser = await picker;
  await chooser.setFiles({
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yImcAAAAASUVORK5CYII=",
      "base64"
    ),
    mimeType: "image/png",
    name: "evidence.png",
  });
  await expect(
    page
      .getByRole("list", { exact: true, name: "Attachments" })
      .getByRole("img", { name: "evidence.png" })
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Mission goal" })
    .fill("Fix flaky retry tests");
  await page
    .getByRole("button", { exact: true, name: "Start mission" })
    .click();
  await expect(page).toHaveURL(/\/missions\/[^/]+$/u);
  await expect(page.getByTestId("question-card")).toBeVisible({
    timeout: 30_000,
  });
  const rendered = page
    .getByRole("list", { name: "Message attachments" })
    .getByRole("img", { name: "evidence.png" });
  await expect(rendered).toBeVisible();
  await page.reload();
  await expect(rendered).toBeVisible();
  const composer = page.getByTestId("composer-input");
  await composer.evaluate((element) => {
    const data = new DataTransfer();
    data.items.add(
      new File(["pasted notes"], "pasted.txt", { type: "text/plain" })
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, clipboardData: data })
    );
  });
  const chips = page.getByRole("list", { exact: true, name: "Attachments" });
  await expect(chips.getByRole("link", { name: "pasted.txt" })).toBeVisible();
  await composer.evaluate((element) => {
    const data = new DataTransfer();
    data.items.add(
      new File(["drop notes"], "dropped.txt", { type: "text/plain" })
    );
    element.dispatchEvent(
      new DragEvent("drop", { bubbles: true, dataTransfer: data })
    );
  });
  await expect(chips.getByRole("link", { name: "dropped.txt" })).toBeVisible();
  await page
    .getByRole("button", { exact: true, name: "Remove dropped.txt" })
    .click();
  await expect(chips.getByText("dropped.txt")).toHaveCount(0);
  let firstPayload: Record<string, unknown> | null = null;
  await page.route(
    "**/messages",
    async (route) => {
      firstPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 }
  );
  await composer.fill("Read pasted evidence");
  await composer.press("Enter");
  await expect(composer).toHaveValue("Read pasted evidence");
  await expect(chips.getByRole("link", { name: "pasted.txt" })).toBeVisible();
  const retry = page.waitForRequest("**/messages");
  await composer.press("Enter");
  const retried = await retry;
  expect(retried.postDataJSON()).toEqual(firstPayload);
  await expect(composer).toHaveValue("");
  await expect(chips).toHaveCount(0);
});
