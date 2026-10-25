import { expect, test } from "@playwright/test";

import { SubmitMessageRequestSchema } from "../packages/protocol/src/commands";
import { mountUI, populateSidebar, uiItem, uiMission } from "./ui-fixtures";

const FIXED_TIME = "2026-10-25T12:00:00.000Z";

test("failed uploads and sends stay mount-local; retries reuse IDs and detached failures do not restore a new composer", async ({
  page,
  request,
}) => {
  const snapshot = await uiMission(request, "architecture-failed-draft");
  populateSidebar(snapshot);
  await mountUI(page, snapshot);
  const composer = page.getByTestId("composer-input");
  const tabs = page.getByRole("tablist", { name: "Agent conversations" });
  const remount = async () => {
    await tabs.getByRole("tab", { exact: true, name: "Task 1" }).click();
    await tabs.getByRole("tab", { exact: true, name: "Orchestrator" }).click();
  };
  await page.route("**/attachments", (route) =>
    route.fulfill({
      json: {
        error: { code: "unavailable", message: "Fixture upload failed" },
      },
      status: 503,
    })
  );
  await composer.fill("Text beside a failed upload");
  await page.getByLabel("Choose attachments").setInputFiles({
    buffer: Buffer.from("fixture"),
    mimeType: "text/plain",
    name: "mount-local.txt",
  });
  const attachments = page.getByRole("list", {
    exact: true,
    name: "Attachments",
  });
  await expect(attachments.getByRole("alert")).toContainText(
    "Fixture upload failed"
  );
  await remount();
  await expect(composer).toHaveValue("");
  await expect(attachments).toHaveCount(0);

  const requests: unknown[] = [];
  const delayed = Promise.withResolvers<boolean>();
  await page.route("**/messages", async (route) => {
    requests.push(
      SubmitMessageRequestSchema.parse(route.request().postDataJSON())
    );
    if (requests.length === 3) {
      await delayed.promise;
    }
    await route.fulfill({
      json: { error: { code: "unavailable", message: "Fixture send failed" } },
      status: 503,
    });
  });
  await composer.fill("Retry this exact message");
  await composer.press("Enter");
  await expect(composer).toHaveValue("Retry this exact message");
  await composer.press("Enter");
  await expect(composer).toHaveValue("Retry this exact message");
  expect(requests).toHaveLength(2);
  expect(requests[1]).toStrictEqual(requests[0]);
  await composer.press("Enter");
  await expect.poll(() => requests.length).toBe(3);
  await remount();
  await expect(composer).toHaveValue("");
  const failed = page.waitForResponse("**/messages");
  delayed.resolve(true);
  await failed;
  await expect(
    page.getByText("Fixture send failed", { exact: true }).first()
  ).toBeVisible();
  await expect(composer).toHaveValue("");
});

for (const width of [1440, 412]) {
  for (const colorScheme of ["dark", "light"] as const) {
    test(`conversation mount ownership, ${width}px ${colorScheme} preference`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ height: 900, width });
      await page.emulateMedia({ colorScheme });
      await page.clock.setFixedTime(new Date(FIXED_TIME));
      const snapshot = await uiMission(
        request,
        `architecture-${width}-${colorScheme}`
      );
      snapshot.mission.createdAt = FIXED_TIME;
      populateSidebar(snapshot);
      snapshot.agents = snapshot.agents.slice(0, 2);
      snapshot.assignments = snapshot.assignments.slice(0, 1);
      snapshot.todos = [];
      snapshot.transcript = [
        uiItem(snapshot, 100, "user", "Review the public interface"),
        uiItem(snapshot, 101, "tool_call", "", {
          toolInput: { command: "pnpm test" },
          toolName: "Execute",
          toolUseId: "architecture-call",
        }),
        uiItem(snapshot, 102, "tool_result", "All checks passed", {
          toolUseId: "architecture-call",
        }),
        uiItem(
          snapshot,
          103,
          "assistant",
          "The public interface is unchanged."
        ),
      ];
      await mountUI(page, snapshot);
      await page.evaluate(() => document.fonts.ready);
      const conversation = page.getByRole("region", {
        exact: true,
        name: "Conversation",
      });
      const header = page.getByTestId("turn-group").getByRole("button");
      const composer = page.getByTestId("composer-input");
      await expect(header).toHaveAttribute("aria-expanded", "false");
      await expect(conversation).toHaveScreenshot(
        `conversation-${width}-${colorScheme}-collapsed.png`,
        { animations: "disabled", maxDiffPixels: 0, threshold: 0 }
      );
      await header.click();
      await expect(header).toHaveAttribute("aria-expanded", "true");
      await composer.fill("Unsent mount-local draft");
      await expect(composer).toBeFocused();
      expect(
        `${JSON.stringify(
          {
            composer: await composer.boundingBox(),
            conversation: await conversation.boundingBox(),
            scroll: await conversation.evaluate((node) => ({
              height: node.clientHeight,
              scrollHeight: node.scrollHeight,
              top: node.scrollTop,
            })),
          },
          null,
          2
        )}\n`
      ).toMatchSnapshot(`conversation-${width}-${colorScheme}-geometry.json`);
      await expect(conversation).toHaveScreenshot(
        `conversation-${width}-${colorScheme}-expanded.png`,
        { animations: "disabled", maxDiffPixels: 0, threshold: 0 }
      );

      const tabs = page.getByRole("tablist", { name: "Agent conversations" });
      await tabs.getByRole("tab", { exact: true, name: "Task 1" }).click();
      await expect(composer).toHaveCount(0);
      await expect(
        page.getByText(
          "Read-only agent conversation. Send instructions through the Orchestrator.",
          { exact: true }
        )
      ).toBeVisible();
      await tabs
        .getByRole("tab", { exact: true, name: "Orchestrator" })
        .click();
      // Characterized on eafc235: switching remounts, it does not retain either.
      await expect(composer).toHaveValue("");
      await expect(header).toHaveAttribute("aria-expanded", "false");
      await expect(conversation).toHaveScreenshot(
        `conversation-${width}-${colorScheme}-collapsed.png`,
        { animations: "disabled", maxDiffPixels: 0, threshold: 0 }
      );
    });
  }
}
