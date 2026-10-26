import { expect, test } from "@playwright/test";

import { addProject, createMission, gitRepo } from "./fixtures";

test("renders generated UI in both agent conversations and agent messages without egress", async ({
  page,
  request,
}) => {
  const outside: string[] = [];
  page.on("request", (event) => {
    const url = new URL(event.url());
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      outside.push(event.url());
    }
  });
  const project = await addProject(request, gitRepo("generated-ui"));
  const mission = await createMission(
    request,
    project.id,
    "Show generated UI",
    { plan: false }
  );
  await page.goto(`/missions/${mission.id}`);
  const ui = page.locator('[data-slot="generated-ui"]');
  await expect(
    ui.filter({ hasText: "Orchestrator interface" }).last()
  ).toBeVisible();
  const message = page
    .getByTestId("agent-message")
    .or(page.getByTestId("agent-exchange"));
  await expect(
    message
      .locator('[data-slot="generated-ui"]')
      .filter({ hasText: "Worker interface" })
      .first()
  ).toBeVisible();
  await page.getByRole("tab", { name: "Generated UI Worker" }).click();
  await expect(
    ui.filter({ hasText: "Worker interface" }).first()
  ).toBeVisible();
  await expect(
    page.getByText("Interface unavailable", { exact: true })
  ).toHaveCount(0);
  expect(outside).toStrictEqual([]);
});
