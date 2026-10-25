import { expect, test } from "@playwright/test";

import { QueueItemSchema } from "../packages/protocol/src/missions";
import { addProject, gitRepo, useScriptedModels } from "./fixtures";
import { emitUI, mountUI, uiItem, uiMission } from "./ui-fixtures";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yImcAAAAASUVORK5CYII=";

test("idle sends appear inline immediately, acknowledge once and retain uncertain delivery in the tray", async ({
  page,
  request,
}) => {
  const snapshot = await uiMission(request, "ui-idle-send");
  await mountUI(page, snapshot);
  const { promise: responseReady, resolve: release } =
    Promise.withResolvers<boolean>();
  await page.route("**/messages", async (route) => {
    const body = route.request().postDataJSON() as {
      operationId: string;
      text: string;
      mode: "queue" | "steer";
    };
    const item = QueueItemSchema.parse({
      agentId: snapshot.agents[0]?.id,
      attachments: [],
      createdAt: new Date().toISOString(),
      error: null,
      id: body.operationId,
      missionId: snapshot.mission.id,
      mode: body.mode,
      replacedById: null,
      replacesId: null,
      revision: 1,
      state: body.text === "Unknown delivery" ? "unknown" : "accepted",
      text: body.text,
      updatedAt: new Date().toISOString(),
    });
    snapshot.queue.push(item);
    if (item.state === "unknown") {
      await emitUI(page, snapshot, { data: { item }, type: "queue.updated" });
      await route.fulfill({
        json: {
          error: { code: "unavailable", message: "Receipt unavailable" },
        },
        status: 503,
      });
      return;
    }
    await responseReady;
    await route.fulfill({ json: item });
    await emitUI(page, snapshot, {
      data: {
        item: uiItem(snapshot, 200, "user", body.text, { requestId: item.id }),
      },
      type: "transcript.item",
    });
  });
  const composer = page.getByTestId("composer-input");
  await composer.fill("Idle instruction");
  const sent = page.waitForRequest("**/messages");
  await composer.press("Alt+Enter");
  const submitted = await sent;
  expect(submitted.postDataJSON()).toMatchObject({ mode: "steer" });
  await expect(page.getByTestId("pending-message")).toHaveText(
    "Idle instruction"
  );
  await expect(page.getByRole("list", { name: "Message queue" })).toHaveCount(
    0
  );
  release(true);
  await expect(page.getByTestId("pending-message")).toHaveCount(0);
  await expect(page.getByText("Idle instruction", { exact: true })).toHaveCount(
    1
  );
  await composer.fill("Unknown delivery");
  await composer.press("Enter");
  const queue = page.getByRole("list", { name: "Message queue" });
  await expect(queue).toContainText("Delivery uncertain");
  await expect(
    queue.getByRole("button", { exact: true, name: "Retry" })
  ).toBeVisible();
});

test("pasted images preview before upload and retry keeps the source and text", async ({
  page,
  request,
}, info) => {
  await useScriptedModels(request);
  const project = await addProject(request, gitRepo("ui-preview-retry"));
  await page.goto("/");
  await page.getByRole("button", { exact: true, name: "Project" }).click();
  await page.getByRole("option", { name: project.name }).click();
  const composer = page.getByRole("textbox", { name: "Mission goal" });
  await composer.fill("Keep this text");
  const { promise: uploadReady, resolve: release } =
    Promise.withResolvers<boolean>();
  await page.route(
    "**/attachments",
    async (route) => {
      await uploadReady;
      await route.fulfill({
        json: { error: { code: "unavailable", message: "Upload failed" } },
        status: 503,
      });
    },
    { times: 1 }
  );
  await composer.evaluate((element, png) => {
    const bytes = Uint8Array.from(
      atob(png),
      (character) => character.codePointAt(0) ?? 0
    );
    const data = new DataTransfer();
    data.items.add(new File([bytes], "snapshot.png", { type: "image/png" }));
    element.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, clipboardData: data })
    );
  }, PNG);
  const attachments = page.getByRole("list", {
    exact: true,
    name: "Attachments",
  });
  await expect(
    attachments.getByRole("img", { name: "snapshot.png" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { exact: true, name: "Start mission" })
  ).toBeDisabled();
  release(true);
  await expect(attachments.getByRole("alert")).toContainText(
    "snapshot.png: Upload failed"
  );
  await attachments.getByRole("button", { exact: true, name: "Retry" }).click();
  await expect(attachments.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { exact: true, name: "Start mission" })
  ).toBeEnabled();
  await expect(composer).toHaveValue("Keep this text");
  const remove = attachments.getByRole("button", {
    exact: true,
    name: "Remove snapshot.png",
  });
  await remove.focus();
  await page.screenshot({
    path: info.outputPath("attachment-ready-focus.png"),
  });
  await remove.press("Enter");
  await expect(attachments).toHaveCount(0);
  await expect(composer).toHaveValue("Keep this text");
});

test("recognized skill styling preserves input metrics, focus and picker keyboard controls", async ({
  page,
  request,
}, info) => {
  const project = await addProject(request, gitRepo("ui-skill-metrics"));
  await page.route("**/composer-catalog", (route) =>
    route.fulfill({
      json: {
        commands: [
          { description: "Review changes", kind: "skill", name: "review" },
        ],
        source: "droid",
      },
    })
  );
  await page.goto("/");
  await page.getByRole("button", { exact: true, name: "Project" }).click();
  await page.getByRole("option", { name: project.name }).click();
  const composer = page.getByRole("textbox", { name: "Mission goal" });
  await composer.fill("/revie");
  const before = await composer.boundingBox();
  await composer.press("w");
  await expect(composer).toBeFocused();
  await expect(page.locator("mark")).toHaveText("/review");
  const mark = page.locator("mark");
  const metrics = await composer.evaluate((node) => {
    const style = getComputedStyle(node);
    return [
      style.fontFamily,
      style.fontSize,
      style.fontWeight,
      style.letterSpacing,
      style.lineHeight,
    ];
  });
  expect(
    await mark.evaluate((node) => {
      const style = getComputedStyle(node);
      return [
        style.fontFamily,
        style.fontSize,
        style.fontWeight,
        style.letterSpacing,
        style.lineHeight,
      ];
    })
  ).toStrictEqual(metrics);
  const after = await composer.boundingBox();
  expect(after?.height).toBe(before?.height);
  await composer.press("Escape");
  await page.screenshot({ path: info.outputPath("skill-highlight.png") });
  await composer.fill("Run /review");
  await expect(mark).toHaveCount(0);
  await composer.fill("/unknown");
  await expect(mark).toHaveCount(0);
});
