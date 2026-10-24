import { expect, test } from "@playwright/test";

import { PageSchema } from "../packages/protocol/src/common";
import {
  MissionSnapshotSchema,
  TranscriptItemSchema,
} from "../packages/protocol/src/missions";
import {
  addProject,
  createMission,
  gitRepo,
  missionSnapshot,
} from "./fixtures";

const SETTLED = /^awaiting_approval(?:,(?:idle|waiting_permission))+$/u;

test("earlier transcript failures stay visible and retry loads the missing page", async ({
  page,
  request,
}) => {
  const project = await addProject(request, gitRepo("transcript-pagination"));
  const mission = await createMission(request, project.id);
  // Wait until the real scripted turn rests on its plan approval so its SSE
  // tail cannot race the paginated snapshot. MissionView still uses its real
  // context and session.
  await expect
    .poll(
      async () => {
        const current = MissionSnapshotSchema.parse(
          await missionSnapshot(request, mission.id)
        );
        return [
          current.mission.status,
          ...current.agents.map((agent) => agent.status),
        ].join(",");
      },
      { timeout: 30_000 }
    )
    .toMatch(SETTLED);
  const snapshot = MissionSnapshotSchema.parse(
    await missionSnapshot(request, mission.id)
  );
  const agentId = snapshot.agents[0]?.id;
  if (!agentId) {
    throw new Error("The scripted mission did not create an agent");
  }
  const earlierText = "Earlier page: preserve the public interface.";
  const currentText = "Current page: review the proposed plan.";
  const earlier = TranscriptItemSchema.parse({
    agentId,
    createdAt: snapshot.mission.createdAt,
    id: "pagination-earlier",
    isError: false,
    kind: "user",
    missionId: mission.id,
    requestId: null,
    seq: 100,
    text: earlierText,
    toolName: null,
    toolUseId: null,
  });
  const tail = MissionSnapshotSchema.parse({
    ...snapshot,
    transcript: [
      {
        ...earlier,
        createdAt: new Date(Date.parse(earlier.createdAt) + 1000).toISOString(),
        id: "pagination-current",
        seq: 200,
        text: currentText,
      },
    ],
    transcriptHasMore: true,
  });
  const olderPage = PageSchema(TranscriptItemSchema).parse({
    items: [earlier],
    nextCursor: null,
  });
  const requests: { before: string | null; limit: string | null }[] = [];
  await page.route(
    `**/api/daemon/v2/missions/${mission.id}/snapshot`,
    async (route) => {
      await route.fulfill({ json: tail });
    }
  );
  await page.route(
    `**/api/daemon/v2/missions/${mission.id}/transcript?*`,
    async (route) => {
      const url = new URL(route.request().url());
      requests.push({
        before: url.searchParams.get("before"),
        limit: url.searchParams.get("limit"),
      });
      if (requests.length === 1) {
        await route.fulfill({
          json: {
            error: {
              code: "unavailable",
              message: "Earlier-page transport failed",
            },
          },
          status: 503,
        });
        return;
      }
      await route.fulfill({ json: olderPage });
    }
  );

  await page.goto(`/missions/${mission.id}`);
  await expect(page.getByText(currentText, { exact: true })).toBeVisible();
  const load = page.getByRole("button", {
    exact: true,
    name: "Load earlier messages",
  });
  await load.click();
  const error = page.locator('p[role="alert"]');
  await expect(error).toHaveText("Earlier-page transport failed");
  await expect(page.getByText(earlierText, { exact: true })).toHaveCount(0);
  await expect(load).toBeEnabled();
  expect(requests).toStrictEqual([{ before: "200", limit: "100" }]);

  await load.click();
  const earlierMessage = page.getByText(earlierText, { exact: true });
  await earlierMessage.scrollIntoViewIfNeeded();
  await expect(earlierMessage).toBeVisible();
  await expect(error).toHaveCount(0);
  await expect(load).toHaveCount(0);
  expect(requests).toStrictEqual([
    { before: "200", limit: "100" },
    { before: "200", limit: "100" },
  ]);
});

test("thought markdown and Pele render with inherited colors and fall back on invalid input", async ({
  page,
  request,
}, info) => {
  const project = await addProject(request, gitRepo("diagrams"));
  const mission = await createMission(request, project.id);
  await expect
    .poll(
      async () =>
        MissionSnapshotSchema.parse(await missionSnapshot(request, mission.id))
          .mission.status,
      { timeout: 30_000 }
    )
    .toBe("awaiting_approval");
  const snapshot = MissionSnapshotSchema.parse(
    await missionSnapshot(request, mission.id)
  );
  const agentId = snapshot.agents[0]?.id;
  if (!agentId) {
    throw new Error("Missing scripted agent");
  }
  const item = {
    agentId,
    createdAt: snapshot.mission.createdAt,
    isError: false,
    missionId: mission.id,
    requestId: null,
    toolName: null,
    toolUseId: null,
  };
  snapshot.transcript = [
    TranscriptItemSchema.parse({
      ...item,
      id: "diagram-thought",
      kind: "thinking",
      seq: 100,
      text: "**Reasoning** about the graph",
    }),
    TranscriptItemSchema.parse({
      ...item,
      id: "diagram-valid",
      kind: "assistant",
      seq: 101,
      text: "```mermaid\nflowchart LR\nA[Input] --> B[Output]\n```",
    }),
    TranscriptItemSchema.parse({
      ...item,
      id: "diagram-invalid",
      kind: "assistant",
      seq: 102,
      text: "```mermaid\nnot a diagram\n```",
    }),
  ];
  await page.route(
    `**/api/daemon/v2/missions/${mission.id}/snapshot`,
    (route) => route.fulfill({ json: snapshot })
  );
  await page.goto(`/missions/${mission.id}`);
  await page.getByRole("button", { exact: true, name: "Thought" }).click();
  await expect(
    page.locator("strong").filter({ hasText: "Reasoning" })
  ).toBeVisible();
  const diagram = page.locator('[data-slot="diagram"] svg');
  await expect(diagram).toBeVisible();
  await expect(diagram).toContainText("Input");
  await expect(
    page.getByText("Diagram unavailable", { exact: true })
  ).toBeVisible();
  await expect(
    page.locator("pre").filter({ hasText: "not a diagram" })
  ).toBeVisible();
  await expect(page.getByText(/No diagram type detected/u)).toHaveCount(0);
  await expect(diagram.locator("a, image, foreignObject, script")).toHaveCount(
    0
  );
  const dark = await diagram.evaluate((node) => getComputedStyle(node).color);
  await page.screenshot({ path: info.outputPath("diagram-dark.png") });
  await page.locator('[data-slot="diagram"]').evaluate((node) => {
    node.style.setProperty("--color-text", "rgb(20, 20, 20)");
    node.style.setProperty("--color-text-secondary", "rgb(80, 80, 80)");
    node.style.setProperty("--color-surface-raised", "rgb(250, 250, 250)");
    node.style.setProperty("--color-surface-overlay", "rgb(238, 238, 238)");
    node.style.setProperty("--color-surface-active", "rgb(229, 229, 229)");
    node.style.setProperty("--color-border-strong", "rgb(180, 180, 180)");
  });
  await expect(diagram).toHaveCSS("color", "rgb(20, 20, 20)");
  expect(dark).not.toBe("rgb(20, 20, 20)");
  await page.screenshot({ path: info.outputPath("diagram-light.png") });
});
