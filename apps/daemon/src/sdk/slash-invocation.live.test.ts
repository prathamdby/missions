import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { pollUntil } from "../lib/async";
import { ProcessSupervisor } from "../processes/process-supervisor";
import { tempDir } from "../test/fixtures";
import { AgentRuntime } from "./agent-runtime";
import { ComposerCatalog } from "./composer-catalog";

const DROID =
  process.env.MISSIONS_DROID_PATH ??
  path.join(os.homedir(), ".local/bin/droid");

describe("live literal slash invocation", () => {
  it.each(["skill", "command"] as const)(
    "probes literal slash %s expansion",
    { timeout: 120_000 },
    async (kind) => {
      const cwd = await tempDir("slash-probe");
      const name = `missions-probe-${kind}`;
      const marker = `PROBE_${randomUUID()}`;
      const directory =
        kind === "skill"
          ? path.join(cwd, ".factory/skills", name)
          : path.join(cwd, ".factory/commands");
      await mkdir(directory, { recursive: true });
      const file =
        kind === "skill"
          ? path.join(directory, "SKILL.md")
          : path.join(directory, `${name}.md`);
      await writeFile(
        file,
        `---\nname: ${name}\ndescription: A disposable slash invocation probe\n---\nReply with exactly ${marker}. Do not use tools.\n`
      );
      let complete = false;
      let output = "";
      let userExpanded = false;
      const runtime = new AgentRuntime({
        agentId: `slash-probe-${kind}`,
        blockOnMcpLoad: false,
        cwd,
        modelId: process.env.MISSIONS_LIVE_MODEL ?? "glm-5.3-flash",
        onAskUser: () => Promise.resolve({ answers: [], cancelled: true }),
        onEvent: (event) => {
          if (event.type === "turn_completed") {
            complete = true;
          }
          if (event.type === "message") {
            if (event.message.role === "assistant") {
              output += event.message.text;
            }
            if (event.message.role === "user") {
              userExpanded ||= event.message.text.includes(marker);
            }
          }
        },
        onPermission: () =>
          Promise.resolve({
            approved: false,
            attribution: "policy",
            reason: "Tools are disabled in this fixture",
          }),
        reasoningEffort: null,
        role: "orchestrator",
        supervisor: new ProcessSupervisor({
          binDir: path.join(cwd, "bin"),
          droidPath: DROID,
        }),
      });
      try {
        const catalog = new ComposerCatalog(DROID);
        try {
          const discovered = await catalog.list(cwd);
          expect(discovered.commands.map((command) => command.name)).toContain(
            name
          );
        } finally {
          await catalog.close();
        }
        await runtime.start();
        const listed =
          kind === "skill"
            ? await runtime.listSkills()
            : await runtime.listCommands();
        expect(listed.map((command) => command.name)).toContain(name);
        await runtime.submit(`probe-${kind}`, `/${name}`, "steer");
        await pollUntil(
          () => Promise.resolve(complete),
          Boolean,
          Date.now() + 90_000,
          50
        );
        const expanded = output.includes(marker);
        process.stdout.write(
          `Literal slash ${kind}: outputExpanded=${String(expanded)}, userExpanded=${String(userExpanded)}\n`
        );
        expect(complete).toBeTruthy();
        expect(expanded).toBeTruthy();
        expect(userExpanded).toBeTruthy();
      } finally {
        await runtime.close();
      }
    }
  );
});
