import { writeFile } from "node:fs/promises";

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import type { CreateMissionRequest } from "../packages/protocol/src/commands";
import type { Branch, Project } from "../packages/protocol/src/projects";

const project: Project = {
  createdAt: "2026-01-01T00:00:00Z",
  defaultBranch: "main",
  id: "scrawl-draft-project",
  kind: "git",
  name: "Draft fixture",
  path: "/tmp/scrawl-draft-fixture",
  remoteUrl: null,
};
const branches: Branch[] = [
  { current: true, name: "main", remote: false },
  // An exact match that also matches the default branch's name.
  { current: false, name: "ma", remote: false },
  ...Array.from({ length: 30 }, (_, index) => ({
    current: false,
    name: `feature/${String(index).padStart(2, "0")}-very-long-branch-name-to-exercise-ellipsis-and-indicator-slots`,
    remote: false,
  })),
  ...Array.from({ length: 30 }, (_, index) => ({
    current: false,
    name: `origin/remote-${String(index).padStart(2, "0")}-very-long-branch-name`,
    remote: true,
  })),
];
const busyBranch = branches[2]?.name ?? "";
const lastBranch = branches.at(-1)?.name ?? "";
const placeholder = "Describe the mission. What should be true when it’s done?";

/** All daemon traffic is intercepted: no real folders, missions, or agents. */
const mockDraft = async (page: Page) => {
  const submissions: CreateMissionRequest[] = [];
  const responses: Record<string, unknown> = {
    "/connection": {
      daemon: {
        startedAt: project.createdAt,
        url: "http://local",
        version: "test",
      },
      droid: { message: null, state: "ready", version: "test" },
      git: { version: "test" },
      github: { message: null, state: "signed_out", user: null },
    },
    "/fs/browse": { entries: [], parent: null, path: "/tmp" },
    "/missions": { missions: [] },
    "/projects": { projects: [project] },
    [`/projects/${project.id}/branches`]: { branches },
    [`/projects/${project.id}/checkout`]: {
      branch: "main",
      dirty: false,
      dirtyFiles: [],
      path: project.path,
    },
    [`/projects/${project.id}/worktrees`]: {
      worktrees: [
        {
          branch: busyBranch,
          dirty: false,
          head: "fixture-head",
          isMain: false,
          path: "/tmp/scrawl-draft-busy",
        },
      ],
    },
    "/settings": {
      cleanupAfterMerge: false,
      defaultAutonomy: "medium",
      maxConcurrentWorkers: 2,
      orchestrator: { modelId: "scripted", reasoningEffort: null },
      worker: { modelId: "scripted", reasoningEffort: null },
      worktreeRoot: "/tmp/scrawl-draft-worktrees",
    },
  };
  await page.route("**/api/daemon/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname.replace(
      "/api/daemon/v2",
      ""
    );
    if (pathname === "/missions" && request.method() === "POST") {
      submissions.push(request.postDataJSON() as CreateMissionRequest);
      await route.fulfill({
        json: {
          error: { code: "unavailable", message: "Offline draft capture" },
        },
        status: 503,
      });
      return;
    }
    if (pathname === "/events") {
      await route.fulfill({
        body: ": offline\n\n",
        contentType: "text/event-stream",
      });
      return;
    }
    await route.fulfill({ json: responses[pathname] ?? {} });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Base branch" }).filter({ visible: true })
  ).toContainText("main");
  return submissions;
};

const branchTrigger = (page: Page) =>
  page
    .getByRole("button", { exact: true, name: "Base branch" })
    .filter({ visible: true });

test("Paper branch rows keep their full geometry in a bounded scrolling menu", async ({
  page,
}, testInfo) => {
  await mockDraft(page);
  await branchTrigger(page).click();
  const menu = page.getByRole("dialog");
  const search = menu.getByRole("textbox", {
    name: "Search or create a branch",
  });
  const footer = menu.getByText(
    "Missions branch off this base. Your checkout stays where it is."
  );
  const options = menu.getByRole("option");
  await expect(options).toHaveCount(branches.length);
  await expect(menu).toHaveCSS("width", "360px");
  await expect(menu).toHaveCSS("border-radius", "8px");
  await expect(menu).toHaveCSS("background-color", "rgb(29, 29, 29)");
  await expect(menu).toHaveCSS("padding", "4px");
  await expect(menu).toHaveCSS("gap", "1px");
  await expect(search.locator("..")).toHaveCSS("height", "36px");
  await expect(search.locator("..")).toHaveCSS("padding-left", "12px");
  await expect(options.first()).toHaveCSS("height", "32px");
  await expect(options.first()).toHaveCSS("padding-left", "8px");
  await expect(options.first()).toHaveCSS("gap", "10px");
  await expect(options.first()).toHaveCSS("border-radius", "3px");
  const label = options.first().locator("span").first();
  await expect(label).toHaveCSS("font-size", "12px");
  await expect(label).toHaveCSS("line-height", "16px");
  await expect(label).toHaveCSS("font-weight", "450");
  await expect(label).toHaveCSS("font-family", /Geist Mono/u);
  await expect(options.first().getByText("Default")).toHaveCSS(
    "height",
    "18px"
  );
  await expect(
    options.filter({ hasText: busyBranch }).getByText("In a mission")
  ).toHaveCSS("height", "18px");
  const geometry = await options.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      const indicator = element.lastElementChild?.getBoundingClientRect();
      return {
        bottom: box.bottom,
        height: box.height,
        indicatorWidth: indicator?.width,
        top: box.top,
      };
    })
  );
  for (const [index, row] of geometry.entries()) {
    expect(row.height).toBe(32);
    expect(row.indicatorWidth).toBe(14);
    if (index > 0) {
      expect(row.top).toBeGreaterThanOrEqual(geometry[index - 1]?.bottom ?? 0);
    }
  }
  const longLabel = options
    .filter({ hasText: busyBranch })
    .locator("span")
    .first();
  expect(
    await longLabel.evaluate(
      (element) => element.scrollWidth > element.clientWidth
    )
  ).toBeTruthy();
  const scroll = menu
    .getByRole("listbox", { name: "Local branches" })
    .locator("..");
  expect(
    await scroll.evaluate(
      (element) => element.scrollHeight > element.clientHeight
    )
  ).toBeTruthy();
  const pinnedFooter = await footer.boundingBox();
  const geometryPath = testInfo.outputPath("branch-geometry.json");
  await writeFile(
    geometryPath,
    JSON.stringify(
      {
        footer: pinnedFooter,
        groups: await menu.getByRole("listbox").evaluateAll((elements) =>
          elements.map((element) => ({
            height: element.getBoundingClientRect().height,
            label: element.getAttribute("aria-label"),
            scrollHeight: element.scrollHeight,
          }))
        ),
        menu: await menu.boundingBox(),
        rows: geometry,
        search: await search.locator("..").boundingBox(),
        viewport: await scroll.evaluate((element) => ({
          height: element.clientHeight,
          scrollHeight: element.scrollHeight,
        })),
      },
      null,
      2
    )
  );
  await testInfo.attach("paper-branch-geometry", {
    contentType: "application/json",
    path: geometryPath,
  });
  await page.screenshot({ path: testInfo.outputPath("branches-top.png") });
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(options.last()).toBeInViewport();
  // Radix may reposition the whole popover when the surrounding page settles;
  // the search and footer must remain docked to its edges, not its old coordinates.
  expect(
    await menu.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const searchBox = element
        .querySelector("input")
        ?.parentElement?.getBoundingClientRect();
      const noteBox = element.lastElementChild?.getBoundingClientRect();
      return {
        footerBottom: noteBox ? box.bottom - noteBox.bottom : null,
        searchTop: searchBox ? searchBox.top - box.top : null,
      };
    })
  ).toEqual({ footerBottom: 4, searchTop: 0 });
  await expect(
    menu.getByRole("button", { name: "Create branch from main…" })
  ).toBeInViewport();
  await expect(footer).toBeInViewport();
  const bounds = await menu.boundingBox();
  expect(bounds?.y).toBeGreaterThanOrEqual(8);
  expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(892);
  await page.screenshot({ path: testInfo.outputPath("branches-scrolled.png") });
});

test("branch search selects exact keyboard matches and preserves the selected creation base", async ({
  page,
}, testInfo) => {
  const submissions = await mockDraft(page);
  const trigger = branchTrigger(page);
  const search = page.getByRole("textbox", {
    name: "Search or create a branch",
  });
  await trigger.click();
  await search.fill("ma");
  await search.press("Enter");
  await expect(trigger).toHaveText("ma");
  await trigger.click();
  await expect(search).toHaveValue("");
  await page.getByRole("option", { exact: true, name: lastBranch }).click();
  await expect(trigger).toContainText(lastBranch);
  await trigger.click();
  const selected = page.getByRole("option", { exact: true, name: lastBranch });
  await selected.scrollIntoViewIfNeeded();
  await expect(selected).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: testInfo.outputPath("branch-selected.png") });
  await search.fill("draft/mouse-created");
  await page
    .getByRole("button", {
      name: `Create “draft/mouse-created” from ${lastBranch}`,
    })
    .click();
  await expect(trigger).toContainText("draft/mouse-created");
  await trigger.click();
  await search.fill("draft/keyboard-created");
  await search.press("Enter");
  await expect(trigger).toContainText("draft/keyboard-created");
  await page
    .getByRole("textbox", { name: "Mission goal" })
    .fill("Use the chosen branch base");
  await page.getByRole("button", { name: "Start mission" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Could not start the mission" })
  ).toContainText("Offline draft capture");
  expect(submissions).toHaveLength(1);
  expect(submissions[0]?.workspace).toEqual({
    baseBranch: lastBranch,
    branchName: "draft/keyboard-created",
    mode: "new_worktree",
  });
});

test("composer hint is only a native placeholder and branch picks never retarget the current checkout", async ({
  page,
}, testInfo) => {
  const submissions = await mockDraft(page);
  const goal = page.getByRole("textbox", { name: "Mission goal" });
  const start = page.getByRole("button", { name: "Start mission" });
  await expect(goal).toHaveAttribute("placeholder", placeholder);
  await expect(goal).toHaveValue("");
  await expect(start).toBeDisabled();
  await goal.focus();
  await goal.press("ControlOrMeta+A");
  expect(
    await goal.evaluate((element) => {
      if (!(element instanceof HTMLTextAreaElement)) {
        throw new TypeError("Mission goal must be a native textarea");
      }
      return {
        placeholderShown: element.matches(":placeholder-shown"),
        selection: element.value.slice(
          element.selectionStart,
          element.selectionEnd
        ),
        textContent: element.textContent,
      };
    })
  ).toEqual({ placeholderShown: true, selection: "", textContent: "" });
  await goal.press("Enter");
  expect(submissions).toHaveLength(0);
  await goal.press("x");
  await expect(goal).toHaveValue("x");
  expect(
    await goal.evaluate((element) => element.matches(":placeholder-shown"))
  ).toBeFalsy();
  await expect(start).toBeEnabled();
  await goal.fill("");
  expect(
    await goal.evaluate((element) => element.matches(":placeholder-shown"))
  ).toBeTruthy();
  await expect(start).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("composer-empty.png") });
  await goal.fill("   ");
  await goal.press("Enter");
  await expect(start).toBeDisabled();
  expect(submissions).toHaveLength(0);
  await page
    .getByRole("button", { exact: true, name: "Workspace" })
    .filter({ visible: true })
    .click();
  await page.getByRole("menuitemradio", { name: /Current checkout/u }).click();
  await branchTrigger(page).click();
  const search = page.getByRole("textbox", {
    name: "Search or create a branch",
  });
  await search.fill(lastBranch);
  await search.press("Enter");
  await expect(
    page
      .getByRole("button", { exact: true, name: "Workspace" })
      .filter({ visible: true })
  ).toContainText("Current checkout");
  await goal.fill("Only this typed goal is submitted");
  await goal.press("Enter");
  await expect(
    page.getByRole("alert").filter({ hasText: "Could not start the mission" })
  ).toContainText("Offline draft capture");
  expect(submissions).toHaveLength(1);
  expect(submissions[0]?.goal).toBe("Only this typed goal is submitted");
  expect(submissions[0]?.workspace).toEqual({
    acknowledgeDirty: false,
    mode: "current_checkout",
  });
});

test("long branch lists stay contained on a narrow draft viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await mockDraft(page);
  await branchTrigger(page).click();
  const menu = page.getByRole("dialog");
  const bounds = await menu.boundingBox();
  expect(bounds?.width).toBe(358);
  expect(bounds?.x).toBeGreaterThanOrEqual(8);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(382);
  expect(bounds?.y).toBeGreaterThanOrEqual(8);
  expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(836);
  await expect(menu.getByRole("textbox")).toBeInViewport();
  await menu.getByRole("option").last().scrollIntoViewIfNeeded();
  await expect(menu.getByRole("option").last()).toHaveCSS("height", "32px");
  await expect(menu.getByRole("textbox")).toBeInViewport();
  await expect(
    menu.getByRole("button", { name: "Create branch from main…" })
  ).toBeInViewport();
  await expect(
    menu.getByText(
      "Missions branch off this base. Your checkout stays where it is."
    )
  ).toBeInViewport();
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth)
  ).toBe(390);
  await page.screenshot({ path: testInfo.outputPath("branches-narrow.png") });
});
