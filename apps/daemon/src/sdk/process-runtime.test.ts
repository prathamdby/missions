import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createSdkMcpServer } from "@factory/droid-sdk/node";
import { describe, expect, it } from "vitest";

import { ProcessSupervisor } from "../processes/process-supervisor";
import { tempDir } from "../test/fixtures";
import { AgentRuntime } from "./agent-runtime";
import type { AgentEvent } from "./agent-runtime";

/**
 * A native-wire peer, not an AgentRuntime fake. The installed ProcessTransport
 * spawns it through our real session leader; the installed DroidClient parses
 * its JSON-RPC and a real SDK MCP server completes HTTP initialization.
 * No installed Droid CLI, credentials, user sessions or model turns are used.
 */
const PEER = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
let protocolVersion;
const send = (message) => process.stdout.write(JSON.stringify({
  factoryApiVersion: "1.0.0", factoryProtocolVersion: protocolVersion, jsonrpc: "2.0", ...message,
}) + "\\n");
let settings;
const availableModels = [
  { id: "initial-model", defaultReasoningEffort: "medium", supportedReasoningEfforts: ["medium"] },
  { id: "next-model", defaultReasoningEffort: "high", supportedReasoningEfforts: ["low", "high"] },
  { id: "plain-model", defaultReasoningEffort: "none", supportedReasoningEfforts: [] },
].map((model) => ({
  ...model, displayName: model.id, shortDisplayName: model.id, modelProvider: "factory",
}));
const rejectEffort = (request) => {
  if (request.params.modelId !== "plain-model" || !("reasoningEffort" in request.params)) return false;
  send({ type: "response", id: request.id, error: {
    code: -32602, message: "No reasoning field is accepted for plain-model",
  } });
  return true;
};
createInterface({ input: process.stdin }).on("line", async (line) => {
  const request = JSON.parse(line);
  protocolVersion = request.factoryProtocolVersion;
  appendFileSync(process.env.WIRE_RECORD, request.method + "\\n");
  if (rejectEffort(request)) return;
  if (request.method === "droid.initialize_session") {
    const p = request.params;
    const server = p.mcpServers[0];
    const response = await fetch(server.url, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...Object.fromEntries(server.headers.map(({ name, value }) => [name, value])),
      },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {},
          clientInfo: { name: "offline-wire-peer", version: "1" } },
      }),
    });
    await response.text();
    const valid = response.ok && p.autonomyLevel === "off" && p.worktree === false &&
      p.machineId === "default" && process.argv.includes("stream-jsonrpc");
    if (!valid) {
      send({ type: "response", id: request.id, error: { code: -32602, message: "Invalid initialization" } });
      return;
    }
    settings = { modelId: p.modelId,
      reasoningEffort: p.modelId === "plain-model" ? "none" : (p.reasoningEffort ?? "medium") };
    send({ type: "response", id: request.id, result: {
      sessionId: "wire-session", session: { messages: [] }, settings, availableModels,
    } });
  } else if (request.method === "droid.list_mcp_servers") {
    send({ type: "response", id: request.id, result: {
      servers: [], summary: { connected: 0, connecting: 0, failed: 0, total: 0 },
    } });
  } else if (request.method === "droid.update_session_settings") {
    appendFileSync(process.env.WIRE_SETTINGS_RECORD, JSON.stringify(request.params) + "\\n");
    settings = request.params.modelId === "plain-model"
      ? { modelId: "plain-model", reasoningEffort: "none" }
      : { ...settings, ...request.params };
    const notificationSettings = settings.modelId === "plain-model" &&
      process.env.NO_EFFORT_NOTIFICATION === "model-only" ? { modelId: settings.modelId } : settings;
    send({ type: "notification", method: "droid.session_notification",
      params: { notification: { type: "settings_updated", settings: notificationSettings } } });
    send({ type: "response", id: request.id, result: {} });
  } else if (request.method === "droid.resolve_queued_user_message") {
    send({ type: "response", id: request.id, result: {} });
  } else if (request.method === "droid.add_user_message") {
    appendFileSync(process.env.WIRE_MESSAGE_RECORD, JSON.stringify(request.params) + "\\n");
    send({ type: "notification", method: "droid.session_notification",
      params: { notification: { type: "assistant_text_delta",
        blockIndex: 0, messageId: "wire-turn", textDelta: settings.modelId + ":" + settings.reasoningEffort } } });
    send({ type: "response", id: request.id, result: {} });
  }
});
`;

const createWireRuntime = async (
  noEffortNotification = "model-only",
  modelId = "initial-model"
) => {
  const dir = await tempDir("native-wire");
  const executable = path.join(dir, "wire-peer.mjs");
  const record = path.join(dir, "methods");
  const settingsRecord = path.join(dir, "settings");
  const messagesRecord = path.join(dir, "messages");
  await writeFile(executable, PEER, { mode: 0o755 });
  const supervisor = new ProcessSupervisor({
    binDir: path.join(dir, "bin"),
    droidPath: executable,
  });
  const server = createSdkMcpServer({ name: "wire-tools", tools: [] });
  const events: AgentEvent[] = [];
  const runtime = new AgentRuntime({
    agentId: "wire-agent",
    cwd: dir,
    extraEnv: {
      NO_EFFORT_NOTIFICATION: noEffortNotification,
      WIRE_MESSAGE_RECORD: messagesRecord,
      WIRE_RECORD: record,
      WIRE_SETTINGS_RECORD: settingsRecord,
    },
    mcpServers: [server],
    modelId,
    onAskUser: () => Promise.resolve({ answers: [], cancelled: true }),
    onEvent: (event) => events.push(event),
    onPermission: () => Promise.resolve(false),
    reasoningEffort: modelId === "plain-model" ? null : "medium",
    role: "orchestrator",
    supervisor,
  });
  return {
    events,
    messagesRecord,
    record,
    runtime,
    server,
    settingsRecord,
    supervisor,
  };
};

describe("ProcessTransport integration", () => {
  it("starts and updates through the installed native transport, then confirms process and MCP disposal", async () => {
    const { events, record, runtime, server, supervisor } =
      await createWireRuntime();
    try {
      await expect(runtime.start()).resolves.toMatchObject({
        sessionId: "wire-session",
      });
      await expect(
        runtime.updateModel({ modelId: "next-model", reasoningEffort: "high" })
      ).resolves.toStrictEqual({
        modelId: "next-model",
        reasoningEffort: "high",
      });
      await runtime.submit(
        "offline-turn",
        "offline wire fixture only",
        "steer"
      );
      expect(events).toContainEqual({
        delta: "next-model:high",
        messageId: "wire-turn",
        type: "text_delta",
      });
      await expect(readFile(record, "utf-8")).resolves.toBe(
        "droid.initialize_session\ndroid.list_mcp_servers\ndroid.update_session_settings\ndroid.add_user_message\n"
      );
    } finally {
      await runtime.close();
    }
    expect({
      process: supervisor.record("wire-agent"),
      server: server.config,
    }).toStrictEqual({ process: null, server: null });
  });

  it.each(["model-only", "none"])(
    "switches thinking to no-effort and back with strict native %s notifications; subsequent turns use the selected model",
    async (notification) => {
      const { events, runtime, settingsRecord } =
        await createWireRuntime(notification);
      const plain = { modelId: "plain-model", reasoningEffort: null };
      try {
        await runtime.start();
        const noEffort = await runtime.updateModel(plain);
        await runtime.submit("plain-turn", "offline no-effort turn", "steer");
        const thinking = await runtime.updateModel({
          modelId: "next-model",
          reasoningEffort: null,
        });
        await runtime.submit("thinking-turn", "offline thinking turn", "steer");
        // Exercise the native model-only restoration path as well.
        const restored = await runtime.updateModel(plain);
        await runtime.submit("restored-turn", "offline restored turn", "steer");
        expect({ noEffort, restored, thinking }).toStrictEqual({
          noEffort: plain,
          restored: plain,
          thinking: { modelId: "next-model", reasoningEffort: "high" },
        });
        expect(
          events
            .filter((event) => event.type === "text_delta")
            .map((event) => event.delta)
        ).toStrictEqual([
          "plain-model:none",
          "next-model:high",
          "plain-model:none",
        ]);
        const wireSettings = await readFile(settingsRecord, "utf-8");
        expect(
          wireSettings
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
        ).toStrictEqual([
          { modelId: "plain-model" },
          { modelId: "next-model", reasoningEffort: "high" },
          { modelId: "plain-model" },
        ]);
      } finally {
        await runtime.close();
      }
    }
  );

  it("initializes a no-effort session without a reasoning field and switches it to thinking", async () => {
    const { events, runtime } = await createWireRuntime("none", "plain-model");
    try {
      await runtime.start();
      expect(runtime.model).toStrictEqual({
        modelId: "plain-model",
        reasoningEffort: null,
      });
      await runtime.updateModel({
        modelId: "next-model",
        reasoningEffort: "low",
      });
      await runtime.submit("next-turn", "offline next turn", "steer");
      expect(events).toContainEqual({
        delta: "next-model:low",
        messageId: "wire-turn",
        type: "text_delta",
      });
    } finally {
      await runtime.close();
    }
  });

  it("passes raw attachment payloads through the installed SDK on send and native edit", async () => {
    const { runtime, messagesRecord } = await createWireRuntime();
    const options = {
      files: [
        {
          data: "hello λ",
          mediaType: "text/plain" as const,
          name: "notes.txt",
          type: "text" as never,
        },
        {
          data: "JVBERi0xLjc=",
          mediaType: "application/pdf" as const,
          name: "doc.pdf",
          type: "base64" as never,
        },
      ],
      images: [
        {
          data: "iVBORw0KGgo=",
          mediaType: "image/png" as const,
          type: "base64" as const,
        },
      ],
    };
    try {
      await runtime.start();
      await runtime.submit("with-files", "Read attachments", "queue", options);
      await expect(
        runtime.edit("with-files", "edited-files", "Read again", options)
      ).resolves.toBe("replaced");
      const record = await readFile(messagesRecord, "utf-8");
      const messages: unknown[] = record
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(messages).toMatchObject([
        { ...options, text: "Read attachments" },
        { ...options, text: "Read again" },
      ]);
    } finally {
      await runtime.close();
    }
  });
});
