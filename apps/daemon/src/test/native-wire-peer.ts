export const PEER = `#!/usr/bin/env node
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
    if (request.params.text === "__exit_worker__") {
      send({ type: "response", id: request.id, result: {} });
      process.exit(17);
    }
    appendFileSync(process.env.WIRE_MESSAGE_RECORD, JSON.stringify(request.params) + "\\n");
    send({ type: "notification", method: "droid.session_notification",
      params: { notification: { type: "assistant_text_delta",
        blockIndex: 0, messageId: "wire-turn", textDelta: settings.modelId + ":" + settings.reasoningEffort } } });
    send({ type: "response", id: request.id, result: {} });
  }
});
`;
