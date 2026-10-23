/// <reference lib="dom" />

import type {
  APIRequestContext,
  Locator,
  Page,
  TestInfo,
} from "@playwright/test";
import { expect, test } from "@playwright/test";

import { UpdateMissionRequestSchema } from "../packages/protocol/src/commands";
import type { UpdateMissionRequest } from "../packages/protocol/src/commands";
import { MissionSnapshotSchema } from "../packages/protocol/src/missions";
import type { ModelOption } from "../packages/protocol/src/settings";
import {
  addProject,
  createMission,
  gitRepo,
  missionSnapshot,
} from "./fixtures";

const API = "/api/daemon/v2";
const CATALOG: ModelOption[] = [
  {
    defaultReasoningEffort: "high",
    displayName: "Scripted (offline)",
    id: "scripted",
    supportedReasoningEfforts: ["low", "medium", "high"],
  },
  {
    defaultReasoningEffort: "medium",
    displayName: "Balanced (fixture)",
    id: "fixture-balanced",
    supportedReasoningEfforts: ["low", "medium"],
  },
  {
    defaultReasoningEffort: null,
    displayName: "No thinking (fixture)",
    id: "fixture-no-thinking",
    supportedReasoningEfforts: [],
  },
];

const startedMission = async (request: APIRequestContext, name: string) => {
  const project = await addProject(request, gitRepo(name));
  const mission = await createMission(request, project.id);
  await expect
    .poll(
      async () => {
        const snapshot = MissionSnapshotSchema.parse(
          await missionSnapshot(request, mission.id)
        );
        return snapshot.mission.status;
      },
      { timeout: 30_000 }
    )
    .toBe("awaiting_approval");
  return MissionSnapshotSchema.parse(
    await missionSnapshot(request, mission.id)
  );
};

/**
 * Start with a real scripted mission. Extra catalog models and PATCH outcomes
 * are browser-boundary fixtures, not additional Droid sessions. The first test
 * below separately proves actual daemon persistence for supported live values.
 */
const pickerFixture = async (page: Page, request: APIRequestContext) => {
  const snapshot = await startedMission(request, "model-picker");
  snapshot.mission.orchestrator = {
    modelId: "scripted",
    reasoningEffort: "high",
  };
  snapshot.mission.worker = { modelId: "scripted", reasoningEffort: "medium" };
  const fixture = {
    failure: null as { code: string; message: string; status: number } | null,
    hold: null as PromiseWithResolvers<undefined> | null,
    patches: [] as UpdateMissionRequest[],
    settingsWrites: 0,
    snapshot,
  };
  const { id } = snapshot.mission;
  page.on("request", (sent) => {
    if (sent.method() === "PATCH" && sent.url().endsWith(`${API}/settings`)) {
      fixture.settingsWrites += 1;
    }
  });
  await page.route(`**${API}/models`, (route) =>
    route.fulfill({ json: { models: CATALOG, source: "droid" } })
  );
  await page.route(`**${API}/missions/${id}/snapshot`, (route) =>
    route.fulfill({ json: fixture.snapshot })
  );
  await page.route(`**${API}/missions/${id}`, async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.fallback();
      return;
    }
    const body = UpdateMissionRequestSchema.parse(
      route.request().postDataJSON()
    );
    fixture.patches.push(body);
    if (fixture.hold) {
      await fixture.hold.promise;
    }
    if (fixture.failure) {
      const { code, message, status } = fixture.failure;
      fixture.failure = null;
      await route.fulfill({ json: { error: { code, message } }, status });
      return;
    }
    if (body.expectedRevision !== fixture.snapshot.mission.revision) {
      await route.fulfill({
        json: { error: { code: "stale_revision", message: "Mission changed" } },
        status: 409,
      });
      return;
    }
    fixture.snapshot.mission = {
      ...fixture.snapshot.mission,
      ...body,
      revision: fixture.snapshot.mission.revision + 1,
    };
    await route.fulfill({ json: fixture.snapshot.mission });
  });
  return fixture;
};

const screenshot = async (page: Page, info: TestInfo, name: string) => {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ animations: "disabled", path });
  await info.attach(name, { contentType: "image/png", path });
};

const expectContained = async (page: Page, menu?: Locator) => {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBeTruthy();
  if (menu) {
    const box = await menu.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (box && viewport) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }
  }
};

const expectShadow = async (element: Locator, token: string) => {
  const shadows = await element.evaluate((node, variable) => {
    const probe = document.createElement("div");
    probe.style.boxShadow = `var(${variable})`;
    document.body.append(probe);
    const expected = getComputedStyle(probe).boxShadow;
    probe.remove();
    let actual = getComputedStyle(node).boxShadow;
    // Tailwind v4 prepends transparent, zero-geometry ring/shadow scaffolding.
    // Remove only those exact leading no-ops, preserving every token layer.
    const scaffold = "rgba(0, 0, 0, 0) 0px 0px 0px 0px, ";
    while (actual.startsWith(scaffold)) {
      actual = actual.slice(scaffold.length);
    }
    return { actual, expected };
  }, token);
  expect(shadows.actual).toBe(shadows.expected);
};

const expectClosedGeometry = async (page: Page) => {
  const section = page.getByRole("region", { exact: true, name: "Models" });
  await expect(section).toHaveCSS("gap", "4px");
  const heading = section.getByRole("button", { exact: true, name: "Models" });
  await expect(heading).toHaveCSS("height", "20px");
  await expect(heading).toHaveCSS("font-size", "13px");
  await expect(heading).toHaveCSS("font-weight", "600");
  await Promise.all(
    ["Orchestrator", "Workers"].map(async (label) => {
      const model = page.getByRole("combobox", {
        exact: true,
        name: `${label} model`,
      });
      const thinking = page.getByRole("combobox", {
        exact: true,
        name: `${label} thinking`,
      });
      const row = model.locator("..");
      await expect(row).toHaveCSS("height", "36px");
      await expect(row).toHaveCSS("gap", "12px");
      await expect(model).toHaveCSS("width", "116px");
      await expect(thinking).toHaveCSS("width", "144px");
      await Promise.all(
        [model, thinking].map(async (trigger) => {
          await expect(trigger).toHaveCSS("height", "28px");
          await expect(trigger).toHaveCSS("padding-left", "10px");
          await expect(trigger).toHaveCSS("gap", "6px");
          await expect(trigger).toHaveCSS("border-radius", "6px");
          await expect(trigger).toHaveCSS(
            "background-color",
            "rgb(23, 23, 23)"
          );
          await expectShadow(trigger, "--shadow-button");
          await expect(trigger.locator("svg")).toHaveCSS("width", "12px");
        })
      );
      await expect(model).toHaveCSS("font-size", "11px");
      await expect(model).toHaveCSS("line-height", "14px");
      await expect(model).toHaveCSS("font-weight", "400");
      expect(
        await model.evaluate((node) => getComputedStyle(node).fontFamily)
      ).toMatch(/Geist.*Mono/u);
      await expect(thinking).toHaveCSS("font-size", "12px");
      await expect(thinking).toHaveCSS("line-height", "16px");
      await expect(thinking.locator(":scope > span").first()).toHaveCSS(
        "font-weight",
        "450"
      );
      await expect(thinking.locator(":scope > span").first()).toHaveCSS(
        "color",
        "rgb(138, 138, 138)"
      );
      await expect(thinking.locator(":scope > span").nth(1)).toHaveCSS(
        "font-weight",
        "500"
      );
    })
  );
};

const expectMenuGeometry = async (
  menu: Locator,
  appearance: "model" | "thinking"
) => {
  await expect(menu).toHaveCSS(
    "width",
    appearance === "model" ? "200px" : "144px"
  );
  await expect(menu).toHaveCSS("border-radius", "8px");
  await expect(menu).toHaveCSS("background-color", "rgb(29, 29, 29)");
  await expectShadow(menu, "--shadow-lg");
  const viewport = menu.locator("[data-radix-select-viewport]");
  await expect(viewport).toHaveCSS("padding", "4px");
  const rows = menu.getByRole("option");
  const options = await rows.all();
  await Promise.all(
    options.map(async (row) => {
      await expect(row).toHaveCSS(
        "height",
        appearance === "model" ? "32px" : "28px"
      );
      await expect(row).toHaveCSS("flex-shrink", "0");
      await expect(row).toHaveCSS("padding-left", "8px");
      await expect(row).toHaveCSS(
        "gap",
        appearance === "model" ? "10px" : "8px"
      );
      await expect(row).toHaveCSS("border-radius", "3px");
      await expect(row).toHaveCSS(
        "font-size",
        appearance === "model" ? "13px" : "12px"
      );
      await expect(row).toHaveCSS("line-height", "16px");
      await expect(row.locator(":scope > span").last()).toHaveCSS(
        "width",
        appearance === "model" ? "14px" : "12px"
      );
    })
  );
  const selected = menu.locator('[role="option"][data-state="checked"]');
  await expect(selected).toHaveCSS("background-color", "rgb(36, 36, 36)");
  await expect(selected).toHaveCSS("color", "rgb(245, 245, 245)");
  await expect(selected).toHaveCSS(
    "font-weight",
    appearance === "model" ? "450" : "500"
  );
  await expect(selected.locator("svg")).toHaveAttribute("stroke-width", "1.75");
  await expect(selected.locator("path")).toHaveAttribute(
    "d",
    "M5 14L8.5 17.5L19 6.5"
  );
};

test("started mission thinking changes use the real mission PATCH and persist without changing defaults", async ({
  page,
  request,
}, info) => {
  const snapshot = await startedMission(request, "model-persistence");
  const { id } = snapshot.mission;
  const before = await request.get(`${API}/settings`);
  const defaults = await before.json();
  const patches: UpdateMissionRequest[] = [];
  let settingsWrites = 0;
  page.on("request", (sent) => {
    if (sent.method() !== "PATCH") {
      return;
    }
    if (sent.url().endsWith(`${API}/settings`)) {
      settingsWrites += 1;
    }
    if (sent.url().endsWith(`${API}/missions/${id}`)) {
      patches.push(UpdateMissionRequestSchema.parse(sent.postDataJSON()));
    }
  });
  await page.goto(`/missions/${id}`);
  await expect(page.getByTestId("plan-card")).toBeVisible();
  const orchestrator = page.getByRole("combobox", {
    name: "Orchestrator thinking",
  });
  await orchestrator.click();
  await expect(
    page.getByRole("option", { exact: true, name: "Off" })
  ).toHaveCount(0);
  await expect(
    page.getByRole("option", { exact: true, name: "Max" })
  ).toHaveCount(0);
  await page.getByRole("option", { exact: true, name: "Medium" }).click();
  await expect(orchestrator).toContainText("Medium");
  const workers = page.getByRole("combobox", { name: "Workers thinking" });
  await workers.click();
  await page.getByRole("option", { exact: true, name: "High" }).click();
  await expect(workers).toContainText("High");
  expect(patches).toHaveLength(2);
  expect(patches[0]).toStrictEqual({
    expectedRevision: snapshot.mission.revision,
    orchestrator: { modelId: "scripted", reasoningEffort: "medium" },
  });
  expect(patches[1]?.worker).toStrictEqual({
    modelId: "scripted",
    reasoningEffort: "high",
  });
  expect(patches[1]?.expectedRevision).toBeGreaterThan(
    snapshot.mission.revision
  );
  expect(settingsWrites).toBe(0);
  await expect(page).toHaveURL(`/missions/${id}`);
  await page.reload();
  await expect(orchestrator).toContainText("Medium");
  await expect(workers).toContainText("High");
  const persisted = MissionSnapshotSchema.parse(
    await missionSnapshot(request, id)
  );
  expect(persisted.mission.orchestrator.reasoningEffort).toBe("medium");
  expect(persisted.mission.worker.reasoningEffort).toBe("high");
  expect(persisted.mission.status).toBe("awaiting_approval");
  const after = await request.get(`${API}/settings`);
  expect(await after.json()).toStrictEqual(defaults);
  await screenshot(page, info, "mission-models-real-persistence");
});

test("Paper model and thinking pickers preserve geometry, role scope, keyboard selection and catalog effort rules", async ({
  page,
  request,
}, info) => {
  const fixture = await pickerFixture(page, request);
  const { id, revision } = fixture.snapshot.mission;
  await page.goto(`/missions/${id}`);
  await expect(
    page.getByRole("combobox", { name: "Orchestrator model" })
  ).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await expectClosedGeometry(page);
  await screenshot(page, info, "paper-models-closed");

  // Radix hides the background panel from AT while its modal listbox is open.
  const model = page.getByRole("combobox", {
    includeHidden: true,
    name: "Orchestrator model",
  });
  await expect(model).toHaveAccessibleDescription(
    /next turn without interrupting/u
  );
  await model.focus();
  await model.press("ArrowDown");
  const menu = page.getByRole("listbox", { name: "Orchestrator models" });
  await expectMenuGeometry(menu, "model");
  await expect(model).toHaveAttribute("aria-expanded", "true");
  await expect(model).toHaveAttribute("data-state", "open");
  await expect(model).toHaveCSS("background-color", "rgb(36, 36, 36)");
  await expectShadow(model, "--shadow-button-active");
  await expect(menu.getByRole("group", { name: "Orchestrator" })).toHaveCSS(
    "gap",
    "1px"
  );
  await expectContained(page, menu);
  await screenshot(page, info, "paper-models-open");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("option", { name: "Balanced (fixture)" })
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(model).toContainText("Balanced (fixture)");
  await expect(model).toBeFocused();
  expect(fixture.patches[0]).toStrictEqual({
    expectedRevision: revision,
    orchestrator: { modelId: "fixture-balanced", reasoningEffort: "medium" },
  });
  const thinking = page.getByRole("combobox", {
    includeHidden: true,
    name: "Orchestrator thinking",
  });
  await expect(thinking).toContainText("Medium");
  await thinking.click();
  const efforts = page.getByRole("listbox", {
    name: "Orchestrator thinking levels",
  });
  await expectMenuGeometry(efforts, "thinking");
  await expect(thinking).toHaveAttribute("aria-expanded", "true");
  await expect(thinking).toHaveAttribute("data-state", "open");
  await expect(thinking).toHaveCSS("background-color", "rgb(36, 36, 36)");
  await expectShadow(thinking, "--shadow-button-active");
  await expect(efforts.getByRole("option")).toHaveText(["Low", "Medium"]);
  const boxes = await Promise.all([
    thinking.boundingBox(),
    efforts.boundingBox(),
  ]);
  const [triggerBox, menuBox] = boxes;
  if (triggerBox && menuBox) {
    const distance = Math.max(
      menuBox.y - (triggerBox.y + triggerBox.height),
      triggerBox.y - (menuBox.y + menuBox.height)
    );
    expect(distance).toBeCloseTo(6);
  }
  await expectContained(page, efforts);
  await screenshot(page, info, "paper-thinking-open");
  await page.keyboard.press("Escape");
  await expect(thinking).toBeFocused();
  await thinking.press("ArrowDown");
  await expect(efforts.getByRole("option", { name: "Medium" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(efforts.getByRole("option", { name: "Low" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(thinking).toContainText("Low");

  const worker = page.getByRole("combobox", { name: "Workers model" });
  await expect(worker).toHaveAccessibleDescription(
    /future Workers; existing Workers/u
  );
  await worker.click();
  await page.getByRole("option", { name: "No thinking (fixture)" }).click();
  const workerThinking = page.getByRole("combobox", {
    name: "Workers thinking",
  });
  await expect(workerThinking).toContainText("N/A");
  await expect(workerThinking).toBeDisabled();
  await expect(workerThinking).toHaveAccessibleDescription(
    /does not expose thinking/u
  );
  expect(fixture.patches.at(-1)).toStrictEqual({
    expectedRevision: revision + 2,
    worker: { modelId: "fixture-no-thinking", reasoningEffort: null },
  });
  expect(fixture.snapshot.mission.orchestrator).toStrictEqual({
    modelId: "fixture-balanced",
    reasoningEffort: "low",
  });
  await page.mouse.move(0, 0);
  await screenshot(page, info, "paper-models-selected");
  await page.reload();
  await expect(model).toContainText("Balanced (fixture)");
  await expect(thinking).toContainText("Low");
  await expect(worker).toContainText("No thinking (fixture)");
  expect(fixture.settingsWrites).toBe(0);
  await expect(page).toHaveURL(`/missions/${id}`);
  await expect(page.getByTestId("plan-card")).toBeVisible();

  await page.setViewportSize({ height: 812, width: 375 });
  await page
    .getByRole("button", { exact: true, name: "Mission details" })
    .click();
  await expect(model).toBeVisible();
  await model.click();
  await expectContained(
    page,
    page.getByRole("listbox", { name: "Orchestrator models" })
  );
  await screenshot(page, info, "paper-models-contained-mobile");
  await page.keyboard.press("Escape");
});

test("model PATCH failures are visible, retryable and single-flight; stale changes require review", async ({
  page,
  request,
}, info) => {
  const fixture = await pickerFixture(page, request);
  fixture.failure = {
    code: "internal",
    message: "Native settings update failed",
    status: 503,
  };
  await page.goto(`/missions/${fixture.snapshot.mission.id}`);
  const model = page.getByRole("combobox", { name: "Orchestrator model" });
  const thinking = page.getByRole("combobox", {
    name: "Orchestrator thinking",
  });
  await model.click();
  await page.getByRole("option", { name: "Balanced (fixture)" }).click();
  const alert = page
    .getByRole("region", { exact: true, name: "Models" })
    .getByRole("alert");
  await expect(alert).toContainText("Native settings update failed");
  await expect(model).toContainText("Scripted (offline)");
  await expect(thinking).toContainText("High");
  await screenshot(page, info, "paper-models-update-error");
  fixture.hold = Promise.withResolvers<undefined>();
  await page
    .getByRole("button", { name: "Retry Orchestrator settings" })
    .click();
  await expect(model).toBeDisabled();
  await expect(thinking).toBeDisabled();
  await expect(
    page.getByRole("combobox", { name: "Workers model" })
  ).toBeEnabled();
  await expect.poll(() => fixture.patches.length).toBe(2);
  await page.getByRole("tab", { exact: true, name: "Digest" }).click();
  await page.getByRole("tab", { exact: true, name: "Overview" }).click();
  await expect(model).toBeDisabled();
  await expect(thinking).toBeDisabled();
  expect(fixture.patches).toHaveLength(2);
  fixture.hold.resolve(undefined);
  fixture.hold = null;
  await expect(model).toContainText("Balanced (fixture)");
  await expect(alert).toBeHidden();
  fixture.failure = {
    code: "stale_revision",
    message: "Mission changed",
    status: 409,
  };
  fixture.snapshot.mission = {
    ...fixture.snapshot.mission,
    orchestrator: { modelId: "scripted", reasoningEffort: "low" },
    revision: fixture.snapshot.mission.revision + 1,
  };
  await thinking.click();
  await page.getByRole("option", { exact: true, name: "Low" }).click();
  await expect(alert).toContainText("Review the latest choices");
  await expect(model).toContainText("Scripted (offline)");
  await expect(thinking).toContainText("Low");
  await expect(
    page.getByRole("button", { name: "Retry Orchestrator settings" })
  ).toHaveCount(0);
  expect(fixture.settingsWrites).toBe(0);
});

test("loading, failed and empty catalogs cannot send settings; missing saved models remain honest", async ({
  page,
  request,
}, info) => {
  const fixture = await pickerFixture(page, request);
  const loaded = Promise.withResolvers<undefined>();
  let state: "error" | "empty" | "ready" = "error";
  await page.route(`**${API}/models`, async (route) => {
    await loaded.promise;
    if (state === "error") {
      await route.fulfill({
        json: { error: { code: "internal", message: "Catalog probe failed" } },
        status: 503,
      });
      return;
    }
    await route.fulfill({
      json: { models: state === "ready" ? CATALOG : [], source: "droid" },
    });
  });
  await page.goto(`/missions/${fixture.snapshot.mission.id}`);
  const model = page.getByRole("combobox", { name: "Orchestrator model" });
  await expect(page.getByText("Loading model catalog…")).toBeVisible();
  await expect(model).toBeDisabled();
  loaded.resolve(undefined);
  const section = page.getByRole("region", { exact: true, name: "Models" });
  await expect(section.getByRole("alert")).toContainText(
    "Catalog probe failed",
    { timeout: 20_000 }
  );
  await expect(model).toBeDisabled();
  await screenshot(page, info, "paper-models-catalog-error");
  state = "empty";
  await section.getByRole("button", { name: "Retry model catalog" }).click();
  await expect(section.getByRole("alert")).toContainText(
    "No models are available"
  );
  await expect(model).toBeDisabled();
  expect(fixture.patches).toHaveLength(0);
  state = "ready";
  await section.getByRole("button", { name: "Retry model catalog" }).click();
  await expect(model).toBeEnabled();
  fixture.snapshot.mission.orchestrator = {
    modelId: "removed-from-catalog",
    reasoningEffort: null,
  };
  await page.reload();
  await expect(model).toContainText("removed-from-catalog");
  const thinking = page.getByRole("combobox", {
    name: "Orchestrator thinking",
  });
  await expect(thinking).toBeDisabled();
  await expect(model).toHaveAccessibleDescription(/not in the live catalog/u);
  await model.click();
  await page.getByRole("option", { name: "Balanced (fixture)" }).click();
  await expect(thinking).toContainText("Medium");
  expect(fixture.settingsWrites).toBe(0);
});
