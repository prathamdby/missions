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

test("earlier transcript failures stay visible and retry loads the missing page", async ({
  page,
  request,
}) => {
  const project = await addProject(request, gitRepo("transcript-pagination"));
  const mission = await createMission(request, project.id);
  // Wait for the real scripted turn to finish so its SSE tail cannot race the
  // paginated snapshot. MissionView still uses its real context and session.
  await expect
    .poll(
      async () => {
        const current = MissionSnapshotSchema.parse(
          await missionSnapshot(request, mission.id)
        );
        return (
          current.mission.status === "awaiting_approval" &&
          current.agents.every((agent) => agent.status === "idle")
        );
      },
      { timeout: 30_000 }
    )
    .toBeTruthy();
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
    `**/api/daemon/v1/missions/${mission.id}/snapshot`,
    async (route) => {
      await route.fulfill({ json: tail });
    }
  );
  await page.route(
    `**/api/daemon/v1/missions/${mission.id}/transcript?*`,
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
