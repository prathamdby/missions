import { describe, expect, it } from "vitest";

import { ORCHESTRATOR_PROMPT, WORKER_PROMPT } from "./role-tools";

describe("appended Missions guidance", () => {
  it.each([ORCHESTRATOR_PROMPT, WORKER_PROMPT])(
    "keeps shared approval, checklist, and workspace safety guidance",
    (prompt) => {
      expect(prompt).toContain("prefer native TodoWrite");
      expect(prompt).toContain("same list, not a second list");
      expect(prompt).toContain("Autonomy is not plan approval");
      expect(prompt).toContain("preserve pre-existing and other agents' work");
      expect(prompt).toContain("never as app approval");
    }
  );

  it.each([ORCHESTRATOR_PROMPT, WORKER_PROMPT])(
    "keeps durable knowledge, honest verification, and resume guidance",
    (prompt) => {
      expect(prompt).toContain(
        "separate shared mission files area is durable knowledge"
      );
      expect(prompt).toContain("Before approval or on a read-only assignment");
      expect(prompt).toContain("After resume, inspect saved conversation");
      expect(prompt).toContain("publishing belongs to the user");
      expect(prompt).toContain("checks run from checks not run");
    }
  );

  it("retains the original role instructions before the added guidance", () => {
    expect(
      ORCHESTRATOR_PROMPT.startsWith(
        "You are the Orchestrator of a Missions run."
      )
    ).toBeTruthy();
    expect(ORCHESTRATOR_PROMPT.indexOf("Workflow:")).toBeLessThan(
      ORCHESTRATOR_PROMPT.indexOf("Missions operating guidance:")
    );
    expect(
      WORKER_PROMPT.startsWith("You are a Worker in a Missions run.")
    ).toBeTruthy();
    expect(WORKER_PROMPT).toContain("Do only your assignment.");
  });

  it("adds plan explanation, lifecycle, and completion guidance for the orchestrator", () => {
    expect(ORCHESTRATOR_PROMPT).toContain(
      "before calling missions.propose_plan"
    );
    expect(ORCHESTRATOR_PROMPT).toContain(
      "final substantive action for that turn"
    );
    expect(ORCHESTRATOR_PROMPT).toContain(
      "ask the user before replacing the worker"
    );
    expect(ORCHESTRATOR_PROMPT).toContain(
      "A prose claim alone does not complete the mission"
    );
    expect(ORCHESTRATOR_PROMPT).not.toContain("Worker coordination:");
  });

  it("retains the worker assignment workflow and adds scoped, verifiable handoffs", () => {
    expect(WORKER_PROMPT).toContain(
      "do not edit repository files, shared notes"
    );
    expect(WORKER_PROMPT).toContain("Do not delegate further");
    expect(WORKER_PROMPT).toContain("Its summary appears in the Digest");
    expect(WORKER_PROMPT).toContain(
      "Do not retry an already successful handoff"
    );
    expect(WORKER_PROMPT).not.toContain("Orchestrator coordination:");
  });
});
