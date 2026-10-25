import { expect, test } from "@playwright/test";

import {
  emitUI,
  mountUI,
  populateSidebar,
  uiItem,
  uiMission,
} from "./ui-fixtures";

test("running work caps and follows its tail, then collapses with the final reply outside", async ({
  page,
  request,
}, info) => {
  const snapshot = await uiMission(request, "ui-turns");
  const [agent] = snapshot.agents;
  if (!agent) {
    throw new Error("Missing agent");
  }
  agent.status = "working";
  snapshot.transcript = [
    uiItem(snapshot, 100, "user", "Check the changes"),
    ...Array.from({ length: 14 }, (_, index) => [
      uiItem(
        snapshot,
        101 + index * 2,
        "assistant",
        `Intermediate ${index}. ${"Checking the public interface. ".repeat(12)}`
      ),
      uiItem(snapshot, 102 + index * 2, "tool_call", "", {
        toolInput: { command: `echo ${index}` },
        toolName: "Execute",
        toolUseId: `call-${index}`,
      }),
    ]).flat(),
    uiItem(snapshot, 140, "error", "Keep this error outside work"),
  ];
  await mountUI(page, snapshot);
  const group = page.getByTestId("turn-group").first();
  const header = group.getByRole("button", { name: /^Work/u }).first();
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await expect(
    page
      .getByLabel("Conversation")
      .locator("div")
      .filter({ has: page.getByText("Working", { exact: true }) })
      .last()
      .locator(".font-mono")
  ).toHaveCount(0);
  const work = group.getByLabel("Turn work", { exact: true });
  await expect(work).toHaveCSS("max-height", "320px");
  await expect
    .poll(() =>
      work.evaluate(
        (node) => node.scrollHeight - node.scrollTop - node.clientHeight
      )
    )
    .toBeLessThan(2);
  await expect(
    page.getByText("Keep this error outside work", { exact: true })
  ).toBeVisible();
  const final = uiItem(snapshot, 141, "assistant", "Final reply stays visible");
  await emitUI(page, snapshot, {
    data: { item: final },
    type: "transcript.item",
  });
  await emitUI(page, snapshot, {
    data: {
      agent: { ...agent, status: "idle", updatedAt: new Date().toISOString() },
    },
    type: "agent.updated",
  });
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText(final.text, { exact: true })).toBeVisible();
  await header.click();
  await expect(work).toHaveAttribute("data-fade-bottom", "true");
  await work.evaluate((node) => {
    node.scrollTop = (node.scrollHeight - node.clientHeight) / 2;
  });
  await expect(work).toHaveAttribute("data-fade-top", "true");
  await expect(work).toHaveAttribute("data-fade-bottom", "true");
  await expect(work).toHaveCSS("mask-image", /linear-gradient/u);
  await page.screenshot({ path: info.outputPath("turn-reopened.png") });
});

test("manual turn expansion survives interruption without inventing an unloaded duration", async ({
  page,
  request,
}) => {
  const snapshot = await uiMission(request, "ui-turn-manual");
  const [agent] = snapshot.agents;
  if (!agent) {
    throw new Error("Missing agent");
  }
  agent.status = "working";
  snapshot.transcript = [
    uiItem(snapshot, 100, "tool_call", "", {
      toolName: "Execute",
      toolUseId: "manual-call",
    }),
  ];
  await mountUI(page, snapshot);
  const group = page.getByTestId("turn-group");
  const header = group.getByRole("button", { exact: true, name: "Work" });
  await expect(header.locator(".font-mono")).toHaveCount(0);
  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await header.click();
  await emitUI(page, snapshot, {
    data: {
      agent: {
        ...agent,
        status: "failed",
        updatedAt: new Date().toISOString(),
      },
    },
    type: "agent.updated",
  });
  await emitUI(page, snapshot, {
    data: {
      item: uiItem(snapshot, 101, "error", "Interrupted without a final reply"),
    },
    type: "transcript.item",
  });
  await emitUI(page, snapshot, {
    data: {
      item: uiItem(snapshot, 102, "tool_call", "", {
        toolName: "Execute",
        toolUseId: "manual-call-2",
      }),
    },
    type: "transcript.item",
  });
  await expect(group).toHaveCount(1);
  const finished = group.getByRole("button", { exact: true, name: "Worked" });
  await expect(finished).toHaveAttribute("aria-expanded", "true");
  await expect(
    group.getByText("Interrupted without a final reply")
  ).toHaveCount(0);
  await expect(
    page.getByText("Interrupted without a final reply", { exact: true })
  ).toBeVisible();
});

test("a failed command is named on the collapsed work header", async ({
  page,
  request,
}) => {
  const snapshot = await uiMission(request, "ui-turn-failed");
  snapshot.transcript = [
    uiItem(snapshot, 100, "user", "Run the tests"),
    uiItem(snapshot, 101, "tool_call", "", {
      toolInput: { command: "pnpm test" },
      toolName: "Execute",
      toolUseId: "fail-1",
    }),
    uiItem(snapshot, 102, "tool_result", "exit 1", {
      isError: true,
      toolUseId: "fail-1",
    }),
    uiItem(snapshot, 103, "assistant", "The tests failed"),
  ];
  await mountUI(page, snapshot);
  const header = page.getByTestId("turn-group").getByRole("button");
  await expect(header).toContainText("Worked");
  await expect(header).toContainText("Failed");
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByText("The tests failed", { exact: true })
  ).toBeVisible();
  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("pnpm test", { exact: true })).toBeVisible();
});

test("agent messages use one measurable clamp and preserve text selection", async ({
  page,
  request,
}, info) => {
  const snapshot = await uiMission(request, "ui-agent-clamp");
  const [agent] = snapshot.agents;
  if (!agent) {
    throw new Error("Missing agent");
  }
  const sender = {
    agentId: "worker",
    role: "worker" as const,
    title: "Worker",
  };
  const recipient = { agentId: agent.id, role: agent.role, title: agent.title };
  snapshot.transcript = [
    uiItem(snapshot, 100, "agent_message", "Long report. ".repeat(140), {
      recipient,
      sender,
    }),
    uiItem(snapshot, 101, "assistant", "Acknowledged"),
    uiItem(snapshot, 102, "agent_message", "Short report.", {
      recipient,
      sender,
    }),
  ];
  await mountUI(page, snapshot);
  const long = page.getByTestId("agent-message").first();
  const header = long.getByRole("button");
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await expect(long.locator("[class*='mask-']")).toHaveCSS(
    "mask-image",
    /linear-gradient/u
  );
  await expect(
    page.getByTestId("agent-message").last().getByRole("button")
  ).toHaveCount(0);
  const body = long.locator("p").first();
  await body.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    window.getSelection()?.addRange(range);
    node.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, button: 0 })
    );
  });
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await body.click();
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await page.screenshot({ path: info.outputPath("agent-clamp.png") });
});

test("sidebar sections share overflow independently and closed tabs reopen from Overview and Digest", async ({
  page,
  request,
}, info) => {
  const snapshot = await uiMission(request, "ui-sidebar-tabs");
  populateSidebar(snapshot);
  await mountUI(page, snapshot);
  const todos = page.getByLabel("Todos content", { exact: true });
  const agents = page.getByLabel("Agents content", { exact: true });
  await expect
    .poll(() => todos.evaluate((node) => node.scrollHeight - node.clientHeight))
    .toBeGreaterThan(100);
  await expect
    .poll(() =>
      agents.evaluate((node) => node.scrollHeight - node.clientHeight)
    )
    .toBeGreaterThan(100);
  const todoHeight = await todos.evaluate((node) => node.clientHeight);
  const agentHeight = await agents.evaluate((node) => node.clientHeight);
  expect(Math.abs(todoHeight - agentHeight)).toBeLessThan(2);
  await todos.evaluate((node) => {
    node.scrollTop = 200;
  });
  expect(await agents.evaluate((node) => node.scrollTop)).toBe(0);
  await page
    .getByRole("region", { exact: true, name: "Todos" })
    .getByRole("button")
    .click();
  await expect
    .poll(() => agents.evaluate((node) => node.clientHeight))
    .toBeGreaterThan(agentHeight);
  const tabs = page.getByRole("tablist", { name: "Agent conversations" });
  const first = tabs.getByRole("tab", { exact: true, name: "Task 1" });
  await first.click();
  const close = tabs.getByRole("button", {
    exact: true,
    name: "Close Task 1 conversation",
  });
  await close.focus();
  await close.press("Enter");
  await expect(first).toHaveCount(0);
  await expect(
    tabs.getByRole("tab", { exact: true, name: "Task 2" })
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByRole("button", { exact: true, name: "Open Worker 1 conversation" })
    .click();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await first.hover();
  await expect(close).toHaveCSS("opacity", "1");
  await close.click();
  await page.getByRole("tab", { exact: true, name: "Digest" }).click();
  await page.getByRole("button", { exact: true, name: "Task 1" }).click();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await first.hover();
  await expect(close).toHaveCSS("opacity", "1");
  await close.click();
  await page.reload();
  await expect(first).toBeVisible();
  await expect(
    tabs.getByRole("button", { name: /Close Orchestrator/u })
  ).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("sidebar-independent.png") });
});

test("short sidebar sections keep their natural height and every file stays reachable", async ({
  page,
  request,
}, info) => {
  const snapshot = await uiMission(request, "ui-sidebar-files");
  populateSidebar(snapshot);
  snapshot.agents = snapshot.agents.slice(0, 2);
  snapshot.assignments = snapshot.assignments.slice(0, 1);
  snapshot.todos = snapshot.todos.slice(0, 1);
  snapshot.artifacts = Array.from({ length: 40 }, (_, index) => ({
    agentId: snapshot.agents[0]?.id ?? null,
    createdAt: snapshot.mission.createdAt,
    id: `artifact-${index}`,
    kind: "file",
    mediaType: "application/octet-stream",
    missionId: snapshot.mission.id,
    name: `report-${index + 1}.bin`,
    size: 1024,
  }));
  await mountUI(page, snapshot);
  const todos = page.getByLabel("Todos content", { exact: true });
  const files = page.getByLabel("Files content", { exact: true });
  expect(
    await todos.evaluate((node) => node.scrollHeight - node.clientHeight)
  ).toBeLessThan(2);
  await expect(files.getByRole("link")).toHaveCount(40);
  await page.screenshot({ path: info.outputPath("sidebar-files-initial.png") });
  await expect(files).toHaveAttribute("data-fade-bottom", "true");
  await expect(files).toHaveCSS("mask-image", /linear-gradient/u);
  await files.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(files).not.toHaveAttribute("data-fade-bottom");
  await expect(
    files.getByRole("link", { exact: true, name: "Open report-40.bin" })
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("sidebar-files-bottom.png") });
});

test("answered rows only expose expansion for real overflow", async ({
  page,
  request,
}, info) => {
  const snapshot = await uiMission(request, "ui-answers");
  const [agent] = snapshot.agents;
  if (!agent) {
    throw new Error("Missing agent");
  }
  snapshot.questions = [
    {
      agentId: agent.id,
      answers: [
        { answer: "Yes", index: 1 },
        { answer: "Detailed answer. ".repeat(50), index: 2 },
      ],
      createdAt: snapshot.mission.createdAt,
      epoch: 0,
      id: "answered",
      missionId: snapshot.mission.id,
      questions: [
        {
          index: 1,
          multiSelect: false,
          options: [],
          question: "Ship it?",
          topic: "Ship",
        },
        {
          index: 2,
          multiSelect: false,
          options: [],
          question: "How should this roll out?",
          topic: "Rollout",
        },
      ],
      status: "answered",
    },
  ];
  await mountUI(page, snapshot);
  const answers = page.getByRole("region", { name: "Your answers" });
  const expand = answers.getByRole("button");
  await expect(expand).toHaveCount(1);
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expand.click();
  await expect(expand).toHaveAttribute("aria-expanded", "true");
  await page.screenshot({ path: info.outputPath("answers-expanded.png") });
});
