import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AttachmentStore } from "../files/attachment-store";
import { pollUntil } from "../lib/async";
import { ProcessSupervisor } from "../processes/process-supervisor";
import { tempDir } from "../test/fixtures";
import { AgentRuntime } from "./agent-runtime";
import { attachmentPayload } from "./attachments";

const RED_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdLep8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3IPanc8OLDQitxAAAAAElFTkSuQmCC";

describe("live attachment delivery", () => {
  it(
    "reads an image and a text file supplied as native SDK attachments",
    { timeout: 120_000 },
    async () => {
      const cwd = await tempDir("attachment-live");
      const store = new AttachmentStore(path.join(cwd, "attachments"));
      const marker = `EVIDENCE_${randomUUID()}`;
      const refs = await Promise.all([
        store.upload("color.png", Buffer.from(RED_PNG, "base64")),
        store.upload("notes.txt", Buffer.from(marker)),
      ]);
      const missionId = randomUUID();
      const attachments = await store.claim(
        refs.map((ref) => ref.id),
        missionId
      );
      const options = await attachmentPayload(store, {
        attachments,
        missionId,
      });
      let complete = false;
      let output = "";
      let failure: string | null = null;
      const runtime = new AgentRuntime({
        agentId: "attachment-live",
        blockOnMcpLoad: false,
        cwd,
        modelId: process.env.MISSIONS_LIVE_MODEL ?? "glm-5.3-flash",
        onAskUser: () => Promise.resolve({ answers: [], cancelled: true }),
        onEvent: (event) => {
          if (event.type === "error") {
            failure = event.message;
          }
          if (event.type === "turn_completed") {
            complete = true;
          }
          if (event.type === "message" && event.message.role === "assistant") {
            output += event.message.text;
          }
        },
        onPermission: () => Promise.resolve(false),
        reasoningEffort: null,
        role: "orchestrator",
        supervisor: new ProcessSupervisor({
          binDir: path.join(cwd, "bin"),
          droidPath:
            process.env.MISSIONS_DROID_PATH ??
            path.join(os.homedir(), ".local/bin/droid"),
        }),
      });
      try {
        await runtime.start();
        await runtime.submit(
          "attachment-evidence",
          "Describe the attached image's dominant color and quote the complete contents of the attached notes file. Do not use tools.",
          "steer",
          options
        );
        await pollUntil(
          () => Promise.resolve(complete),
          Boolean,
          Date.now() + 90_000,
          50
        );
        expect(complete).toBeTruthy();
        expect(failure).toBeNull();
        expect(output.toLowerCase()).toContain("red");
        expect(output).toContain(marker);
      } finally {
        await runtime.close();
      }
    }
  );
});
