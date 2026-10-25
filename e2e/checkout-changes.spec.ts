import { writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { addProject, gitRepo, useScriptedModels } from "./fixtures";

const scenarios = [
  { count: 1, label: "one file on desktop", width: 1440 },
  { count: 45, label: "45 files on desktop", width: 1440 },
  { count: 45, label: "45 files on a narrow screen", width: 390 },
] as const;

test.beforeAll(async ({ request }) => {
  await useScriptedModels(request);
});

for (const scenario of scenarios) {
  test(`checkout changes preview keeps readable rows for ${scenario.label}`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ height: 900, width: scenario.width });
    const repo = gitRepo("checkout-changes");
    for (let index = 0; index < scenario.count; index += 1) {
      const name =
        index === 0
          ? `${"long-component-name-".repeat(8)}.tsx`
          : `changed-${String(index).padStart(2, "0")}.tsx`;
      writeFileSync(path.join(repo, name), "export {};\n");
    }
    const project = await addProject(request, repo);
    await page.goto("/");
    await page.getByRole("button", { exact: true, name: "Project" }).click();
    await page.getByRole("option", { name: project.name }).click();
    await page.getByRole("button", { exact: true, name: "Workspace" }).click();
    await page
      .getByRole("menuitemradio", { name: /Current checkout/u })
      .click();
    const goal = page.getByRole("textbox", { name: "Mission goal" });
    await goal.fill("Preserve my draft");
    await page
      .getByRole("button", { exact: true, name: "View changes" })
      .click();
    const preview = page
      .getByRole("dialog")
      .filter({ hasText: "Uncommitted in your checkout" });
    const list = preview.getByRole("list");
    const rows = list.getByRole("listitem");
    await expect(rows).toHaveCount(scenario.count);
    await page.screenshot({
      path: info.outputPath("checkout-changes-top.png"),
    });
    await expect
      .poll(() =>
        rows.evaluateAll((nodes) =>
          Math.min(
            ...nodes.map(
              (node) =>
                node.clientHeight -
                Number(getComputedStyle(node).lineHeight.replace("px", ""))
            )
          )
        )
      )
      .toBeGreaterThanOrEqual(0);
    expect(
      await list.evaluate((node) => node.scrollWidth - node.clientWidth)
    ).toBeLessThanOrEqual(1);
    if (scenario.count > 1) {
      expect(
        await list.evaluate((node) => node.scrollHeight - node.clientHeight)
      ).toBeGreaterThan(100);
      await list.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      await expect(rows.last()).toBeInViewport();
    }
    await page.screenshot({ path: info.outputPath("checkout-changes.png") });
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
    await expect(
      page.getByRole("button", { exact: true, name: "View changes" })
    ).toBeFocused();
    await expect(goal).toHaveValue("Preserve my draft");
    await expect(
      page.getByRole("button", { name: "Continue in checkout" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { exact: true, name: "Start mission" })
    ).toBeDisabled();
  });
}
