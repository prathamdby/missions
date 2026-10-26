import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";

import { SubmitMessageRequestSchema } from "../packages/protocol/src/commands";
import { MissionSnapshotSchema } from "../packages/protocol/src/missions";
import {
  addProject,
  createMission,
  gitRepo,
  missionSnapshot,
} from "./fixtures";

const interactiveMission = async (
  page: Page,
  request: APIRequestContext,
  name: string
) => {
  const project = await addProject(request, gitRepo(name));
  const mission = await createMission(
    request,
    project.id,
    "Show generated UI",
    { plan: false }
  );
  await expect
    .poll(async () => {
      const state = MissionSnapshotSchema.parse(
        await missionSnapshot(request, mission.id)
      );
      return (
        state.assignments.some(
          (assignment) => assignment.status === "handed_off"
        ) &&
        state.agents.find((agent) => agent.role === "orchestrator")?.status ===
          "idle"
      );
    })
    .toBeTruthy();
  await page.goto(`/missions/${mission.id}`);
  return mission;
};

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
  const messageUi = message
    .locator('[data-slot="generated-ui"]')
    .filter({ hasText: "Worker interface" })
    .first();
  await expect(messageUi).toBeVisible();
  await expect(
    messageUi.getByRole("button", { exact: true, name: "Use approach" })
  ).toBeDisabled();
  await page.getByRole("tab", { name: "Generated UI Worker" }).click();
  await expect(
    ui.filter({ hasText: "Worker interface" }).first()
  ).toBeVisible();
  await expect(
    ui
      .filter({ hasText: "Worker interface" })
      .first()
      .getByRole("button", { exact: true, name: "Use approach" })
  ).toBeDisabled();
  await expect(
    page.getByText("Interface unavailable", { exact: true })
  ).toHaveCount(0);
  expect(outside).toStrictEqual([]);
});

test("confirmation double clicks and tab switches send one visible user message", async ({
  page,
  request,
}) => {
  const mission = await interactiveMission(page, request, "generated-ui-click");
  const sent: unknown[] = [];
  page.on("request", (event) => {
    if (
      event.method() === "POST" &&
      event.url().endsWith(`/missions/${mission.id}/messages`)
    ) {
      sent.push(event.postDataJSON());
    }
  });
  const control = page
    .locator('[data-slot="generated-ui"]')
    .filter({ hasText: "Orchestrator interface" })
    .last()
    .getByRole("button", { exact: true, name: "Use approach" });
  await expect(control).toBeEnabled();
  await control.evaluate((node) => {
    if (!(node instanceof HTMLButtonElement)) {
      throw new TypeError("Missing action button");
    }
    node.click();
    node.click();
  });
  const text = "Use the recommended approach";
  const review = page.getByRole("region", { name: "Message to send" });
  await expect(review.locator("pre")).toHaveText(text);
  expect(sent).toHaveLength(0);
  const delivery = Promise.withResolvers<boolean>();
  await page.route(`**/missions/${mission.id}/messages`, async (route) => {
    await delivery.promise;
    await route.continue();
  });
  try {
    await review
      .getByRole("button", { name: "Send message" })
      .evaluate((node) => {
        if (!(node instanceof HTMLButtonElement)) {
          throw new TypeError("Missing confirmation button");
        }
        node.click();
        node.click();
      });
    await expect.poll(() => sent.length).toBe(1);
    await page.getByRole("tab", { name: "Generated UI Worker" }).click();
    await page.getByRole("tab", { name: "Orchestrator" }).click();
    await expect(control).toBeDisabled();
    expect(sent).toHaveLength(1);
  } finally {
    delivery.resolve(true);
  }
  await expect(page.getByText(text, { exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const state = MissionSnapshotSchema.parse(
        await missionSnapshot(request, mission.id)
      );
      return state.queue.find((item) => item.text === text)?.state;
    })
    .toBe("sent");
  expect(sent).toHaveLength(1);
  expect(SubmitMessageRequestSchema.parse(sent[0])).toStrictEqual({
    mode: "steer",
    operationId: expect.any(String),
    text,
  });
  const state = MissionSnapshotSchema.parse(
    await missionSnapshot(request, mission.id)
  );
  expect(
    state.transcript.filter(
      (item) => item.kind === "user" && item.text === text
    )
  ).toHaveLength(1);
});

test("submits input, textarea, and select values as the exact visible user message", async ({
  page,
  request,
}) => {
  const mission = await interactiveMission(page, request, "generated-ui-form");
  const ui = page
    .locator('[data-slot="generated-ui"]')
    .filter({ hasText: "Orchestrator interface" })
    .last();
  await ui
    .getByRole("textbox", { exact: true, name: "Project name" })
    .fill("Demo");
  await ui
    .getByRole("textbox", { exact: true, name: "Project notes" })
    .fill("Keep the public API.");
  await ui.getByRole("combobox", { name: "Approach" }).click();
  await page.getByRole("option", { exact: true, name: "Complete" }).click();
  const values = {
    project: {
      approach: { componentType: "Select", value: "Complete" },
      name: { componentType: "Input", value: "Demo" },
      notes: { componentType: "TextArea", value: "Keep the public API." },
    },
  };
  const response = page.waitForRequest(
    (event) =>
      event.method() === "POST" &&
      event.url().endsWith(`/missions/${mission.id}/messages`)
  );
  await ui.getByRole("button", { exact: true, name: "Send details" }).click();
  const review = ui.getByRole("region", { name: "Message to send" });
  const preview = await review.locator("pre").textContent();
  await review.getByRole("button", { name: "Send message" }).click();
  const submitted = await response;
  const { text } = SubmitMessageRequestSchema.parse(submitted.postDataJSON());
  const prefix = "Use these project details\n\nForm values:\n```json\n";
  expect(text).toBe(preview);
  expect(text.startsWith(prefix)).toBeTruthy();
  expect(text.endsWith("\n```")).toBeTruthy();
  expect(JSON.parse(text.slice(prefix.length, -4))).toStrictEqual(values);
  await expect(page.getByText(text, { exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const state = MissionSnapshotSchema.parse(
        await missionSnapshot(request, mission.id)
      );
      return state.queue.find((item) => item.text === text)?.state;
    })
    .toBe("sent");
});
