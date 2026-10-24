import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { MissionSnapshotSchema } from "../packages/protocol/src/missions";
import {
  addProject,
  createMission,
  gitRepo,
  missionSnapshot,
} from "./fixtures";

const INTERACTIVE =
  'a[href],button,input:not([type=hidden]),textarea,select,summary,[contenteditable="true"],[role=button],[role=link],[role=tab],[role=option],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=checkbox],[role=radio],[role=switch],[role=combobox],[role=slider],[role=treeitem]';

const auditTabs = async (
  page: Page,
  remaining = 80,
  stops = 0
): Promise<void> => {
  if (remaining === 0) {
    expect(stops).toBeGreaterThan(5);
    return;
  }
  await page.keyboard.press("Tab");
  const active = await page.evaluate((selector) => {
    const element = document.activeElement;
    return {
      body: element === document.body,
      html: element?.outerHTML.slice(0, 400),
      interactive: element?.matches(selector),
      shadow: element ? getComputedStyle(element).boxShadow : "none",
    };
  }, INTERACTIVE);
  // Browser chrome is not a document Tab stop.
  if (!active.body) {
    expect(active.interactive, active.html).toBe(true);
    expect(active.shadow, active.html).not.toBe("none");
  }
  await auditTabs(page, remaining - 1, stops + Number(!active.body));
};

const selection = (page: Page) =>
  page.evaluate(() => window.getSelection()?.toString() ?? "");

const checkSelection = async (
  page: Page,
  target: Locator,
  selectable: boolean
) => {
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await target.dblclick();
  if (selectable) {
    expect(await selection(page)).not.toBe("");
  } else {
    expect(await selection(page)).toBe("");
  }
};

const blankClick = async (page: Page, target: Locator) => {
  await target.click({ position: { x: 3, y: 3 } });
  const active = await page.evaluate((selector) => {
    const element = document.activeElement;
    return {
      body: element === document.body,
      interactive: element?.matches(selector),
      shadow: element ? getComputedStyle(element).boxShadow : "none",
    };
  }, INTERACTIVE);
  expect(active.body || (!active.interactive && active.shadow === "none")).toBe(
    true
  );
};

for (const width of [1440, 412]) {
  test(`focus and selection are opt-in at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ height: 900, width });
    const project = await addProject(request, gitRepo(`focus-${width}`));
    const mission = await createMission(
      request,
      project.id,
      "Write project notes",
      { plan: false }
    );
    await expect
      .poll(
        async () =>
          MissionSnapshotSchema.parse(
            await missionSnapshot(request, mission.id)
          ).mission.status,
        { timeout: 30_000 }
      )
      .toBe("completed");
    const snapshot = MissionSnapshotSchema.parse(
      await missionSnapshot(request, mission.id)
    );
    const agentId = snapshot.agents.find(
      (agent) => agent.role === "orchestrator"
    )?.id;
    const item = snapshot.transcript.find((entry) => entry.agentId === agentId);
    if (!item) {
      throw new Error("The scripted mission did not create a transcript");
    }
    await page.route(
      `**/api/daemon/v2/missions/${mission.id}/snapshot`,
      (route) =>
        route.fulfill({
          json: {
            ...snapshot,
            transcript: [
              {
                ...item,
                id: "focus-message",
                kind: "assistant",
                seq: 1000,
                text: "Selectable message\n\n```text\nSelectable code\n```",
              },
              {
                ...item,
                id: "focus-error",
                isError: true,
                kind: "error",
                seq: 1001,
                text: "Selectable error",
              },
            ],
          },
        })
    );
    await page.goto(`/missions/${mission.id}`);
    await expect(
      page.getByText("Selectable message", { exact: true })
    ).toBeVisible();
    await auditTabs(page);
    await blankClick(
      page,
      page.getByRole("region", { exact: true, name: "Conversation" })
    );
    await checkSelection(page, page.getByRole("heading", { level: 1 }), false);
    await checkSelection(
      page,
      page.getByText("Selectable message", { exact: true }),
      true
    );
    await checkSelection(page, page.locator("pre code"), true);
    await checkSelection(
      page,
      page.getByText("Selectable error", { exact: true }),
      true
    );
    if (width < 768) {
      await page.getByRole("button", { name: "Open navigation" }).click();
    }
    const sidebar = page.getByRole("navigation", {
      exact: true,
      name: "Missions",
    });
    await blankClick(
      page,
      sidebar.getByRole("region", { exact: true, name: "Missions" })
    );
    await checkSelection(
      page,
      sidebar
        .getByRole("link", { name: /Write project notes/u })
        .locator("span")
        .first(),
      false
    );
    if (width < 768) {
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /Mission details/u }).click();
    }
    await page.getByRole("tab", { exact: true, name: "Changes" }).click();
    await blankClick(page, page.getByRole("tabpanel", { name: "Changes" }));
    await checkSelection(
      page,
      page.getByRole("tab", { exact: true, name: "Changes" }),
      false
    );
    const diff = page.getByRole("region", { name: "Diff of NOTES.md" });
    await expect(diff).toBeVisible();
    await checkSelection(
      page,
      diff.getByText("# Notes", { exact: true }),
      true
    );
    await page.getByRole("tab", { exact: true, name: "Changes" }).focus();
    await auditTabs(page);
  });
}
