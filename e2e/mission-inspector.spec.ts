import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { MissionSnapshotSchema } from "../packages/protocol/src/missions";
import {
  addProject,
  createMission,
  gitRepo,
  missionSnapshot,
  useScriptedModels,
} from "./fixtures";

test.beforeAll(async ({ request }) => {
  await useScriptedModels(request);
});

const completedMission = async (page: Page, request: APIRequestContext) => {
  const project = await addProject(request, gitRepo("inspector"));
  const mission = await createMission(request, project.id);
  await page.goto(`/missions/${mission.id}`);
  await page.getByTestId("plan-approve").click({ timeout: 30_000 });
  await expect(page.getByTestId("mission-complete")).toBeVisible({
    timeout: 30_000,
  });
  return MissionSnapshotSchema.parse(
    await missionSnapshot(request, mission.id)
  );
};

test("native worker todos populate separate sections and horizontal read-only conversations", async ({
  page,
  request,
}, info) => {
  const snapshot = await completedMission(page, request);
  const worker = snapshot.agents.find((agent) => agent.role === "worker");
  const nativeCall = snapshot.transcript.find(
    (item) => item.agentId === worker?.id && item.toolName === "TodoWrite"
  );
  expect(nativeCall).toBeDefined();
  expect(
    snapshot.todos.some(
      (todo) => todo.agentId === worker?.id && todo.content === "Write NOTES.md"
    )
  ).toBeTruthy();
  const todos = page.getByRole("region", { exact: true, name: "Todos" });
  const agents = page.getByRole("region", { exact: true, name: "Agents" });
  await expect(todos).toContainText("Review the change");
  await expect(agents).toBeVisible();
  const toggle = agents.getByRole("button", { name: /Worker 1 todos/u });
  if ((await toggle.getAttribute("aria-expanded")) === "true") {
    await toggle.click();
  }
  await agents.getByRole("button", { name: "Expand Worker 1 todos" }).click();
  await expect(agents.getByText(/In progress:.*Write NOTES\.md/u)).toHaveCount(
    1
  );
  await agents.getByRole("button", { name: "Collapse Worker 1 todos" }).click();
  await expect(agents.getByText(/In progress:.*Write NOTES\.md/u)).toHaveCount(
    0
  );
  await expect(agents.getByText("Write NOTES.md", { exact: true })).toHaveCount(
    1
  );
  const tabs = page.getByRole("tablist", { name: "Agent conversations" });
  await expect(tabs.locator("..")).toHaveCSS("height", "52px");
  const workerTab = tabs.getByRole("tab", { name: /Write NOTES\.md/u });
  await expect(workerTab).toHaveCSS("height", "28px");
  await expect(workerTab).toHaveCSS("padding-left", "10px");
  await agents
    .getByRole("button", { name: "Open Worker 1 conversation" })
    .click();
  await expect(workerTab).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByText("Read-only agent conversation.", { exact: false })
  ).toBeVisible();
  await expect(page.getByTestId("composer-input")).toHaveCount(0);
  await expect(
    page.getByRole("list", { name: "Mission transcript" })
  ).not.toContainText("The plan is ready for your review.");
  await page.screenshot({ path: info.outputPath("agent-conversation.png") });
  await tabs.getByRole("tab", { name: /Orchestrator/u }).click();
  await expect(page.getByTestId("composer-input")).toBeVisible();
  await tabs.getByRole("tab", { name: /Orchestrator/u }).press("ArrowRight");
  await expect(workerTab).toHaveAttribute("aria-selected", "true");
});

test("Files shows durable mission knowledge, and Changes selects real comparison modes", async ({
  page,
  request,
}, info) => {
  await completedMission(page, request);
  await page.getByRole("tab", { exact: true, name: "Files" }).click();
  const files = page.getByRole("navigation", { name: "Shared mission files" });
  await expect(
    files.getByRole("button", { exact: true, name: "AGENTS.md" })
  ).toBeVisible();
  await expect(
    files.getByRole("button", { exact: true, name: "CREW.md" })
  ).toBeVisible();
  await expect(files.getByRole("button", { name: "README.md" })).toHaveCount(0);
  await files.getByRole("button", { exact: true, name: "plans" }).click();
  await files.getByRole("button", { exact: true, name: "plan-1.md" }).click();
  await expect(
    page.getByRole("heading", { exact: true, name: "Plan 1" })
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("shared-plan.png") });
  await page.reload();
  await page.getByRole("tab", { exact: true, name: "Files" }).click();
  await files.getByRole("button", { exact: true, name: "results" }).click();
  await files.getByRole("button", { exact: true, name: "summary.md" }).click();
  await expect(page.getByRole("tabpanel", { name: "Files" })).toContainText(
    "Added NOTES.md and reviewed it."
  );
  await page.getByRole("tab", { exact: true, name: "Changes" }).click();
  const compare = page.getByRole("combobox", { name: "Compare changes" });
  await expect(compare).toContainText("Uncommitted");
  await expect(page.getByTestId("changes-list")).toContainText("NOTES.md");
  await compare.click();
  await expect(page.getByRole("option")).toHaveText([
    "Uncommitted",
    "Branch vs default",
    "Last commit",
  ]);
  await page.screenshot({
    path: info.outputPath("changes-comparison-menu.png"),
  });
  await page.getByRole("option", { name: "Branch vs default" }).click();
  await expect(page.getByRole("tabpanel", { name: "Changes" })).toContainText(
    "merge-base comparison"
  );
  await expect(page.getByTestId("changes-list")).toHaveCount(0);
  await compare.click();
  await page.getByRole("option", { name: "Last commit" }).click();
  await expect(page.getByTestId("changes-list")).toContainText("README.md");
  await page.screenshot({ path: info.outputPath("changes-last-commit.png") });
});

test("Digest renders agent Markdown as headings, lists, code and safe links", async ({
  page,
  request,
}, info) => {
  const snapshot = await completedMission(page, request);
  const assignments = snapshot.assignments.map((assignment) => ({
    ...assignment,
    handoff: assignment.handoff
      ? {
          ...assignment.handoff,
          summary:
            "## Coverage\n\nThe **inventory** is complete.\n\n- Shared instructions\n- Tool policy in `src/prompt.ts`\n\n[Review handoff](https://example.com/handoff)",
        }
      : null,
  }));
  await page.route(
    `**/api/daemon/v1/missions/${snapshot.mission.id}/snapshot`,
    async (route) => {
      await route.fulfill({ json: { ...snapshot, assignments } });
    }
  );
  await page.reload();
  await page.getByRole("tab", { exact: true, name: "Digest" }).click();
  const digest = page.getByRole("tabpanel", { name: "Digest" });
  await expect(digest.getByRole("heading", { name: "Coverage" })).toBeVisible();
  await expect(digest.locator("strong")).toHaveText("inventory");
  await expect(digest.locator("code")).toHaveText("src/prompt.ts");
  await expect(
    digest.getByRole("link", { name: "Review handoff" })
  ).toHaveAttribute("rel", "noopener noreferrer");
  await page.screenshot({ path: info.outputPath("digest-markdown.png") });
});
