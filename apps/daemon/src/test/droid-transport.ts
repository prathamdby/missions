import type { DroidClientTransport } from "@factory/droid-sdk/node";
import { vi } from "vitest";

type WireMessage = Parameters<DroidClientTransport["send"]>[0];
export interface Request {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export const message = (id: string, text: string, requestId?: string) => ({
  content: [{ text, type: "text" }],
  createdAt: 1,
  id,
  role: "user",
  updatedAt: 1,
  ...(requestId ? { requestId } : {}),
});

/**
 * The ordinary adapter tests use the actual DroidClient and its Zod/wire
 * handling, replacing only the external runner transport.
 */
export class MockTransport implements DroidClientTransport {
  readonly sent: WireMessage[] = [];
  readonly requests: Request[] = [];
  isConnected = true;
  close = vi.fn<() => Promise<void>>(() => Promise.resolve());
  onRequest: ((request: Request) => void) | null = null;
  rejectMethod: string | null = null;
  failMethod: string | null = null;
  deferMethod: string | null = null;
  initializeResult = {
    availableModels: [
      {
        defaultReasoningEffort: "high",
        displayName: "Next",
        id: "next",
        modelProvider: "factory",
        shortDisplayName: "Next",
        supportedReasoningEfforts: ["low", "high"],
      },
      {
        defaultReasoningEffort: "none",
        displayName: "Plain",
        id: "plain",
        modelProvider: "factory",
        shortDisplayName: "Plain",
        supportedReasoningEfforts: [],
      },
    ],
    session: { messages: [] as unknown[] },
    sessionId: "session",
    settings: { modelId: "model", reasoningEffort: "medium" },
  };
  loadResult = {
    availableModels: this.initializeResult.availableModels,
    cwd: "/workspace",
    pendingMessageRequestIds: ["pending"],
    queuedMessages: [
      { queuePlacement: "end_of_loop", requestId: "queued", text: "queued" },
    ],
    session: { messages: [] as unknown[] },
    settings: { modelId: "model", reasoningEffort: "medium" },
    workingState: "idle",
  };
  mcpResult = {
    servers: [] as unknown[],
    summary: { connected: 0, connecting: 0, failed: 0, total: 0 },
  };
  #handler: ((message: WireMessage) => void) | null = null;
  #errorHandler: ((error: Error) => void) | null = null;

  onMessage(handler: (message: WireMessage) => void) {
    this.#handler = handler;
  }

  onError(handler: (error: Error) => void) {
    this.#errorHandler = handler;
  }

  fail(error: Error) {
    this.#errorHandler?.(error);
  }

  receive(payload: Record<string, unknown>) {
    this.#handler?.({
      factoryApiVersion: "1.0.0",
      factoryProtocolVersion: "1.78.0",
      jsonrpc: "2.0",
      ...payload,
    } as WireMessage);
  }

  notify(notification: Record<string, unknown>) {
    this.receive({
      method: "droid.session_notification",
      params: { notification },
      type: "notification",
    });
  }

  userMessage(id: string, text: string, requestId?: string) {
    this.receive({
      method: "droid.session_notification",
      params: {
        notification: {
          message: message(id, text),
          type: "create_message",
          ...(requestId ? { requestId } : {}),
        },
      },
      type: "notification",
    });
  }

  send(wire: WireMessage): Promise<void> {
    this.sent.push(wire);
    if (wire.type !== "request") {
      return Promise.resolve();
    }
    const request: Request = {
      id: String(wire.id),
      method: wire.method,
      params: wire.params as Record<string, unknown>,
    };
    this.requests.push(request);
    this.onRequest?.(request);
    if (request.method === this.failMethod) {
      return Promise.reject(new Error("Disconnected before response"));
    }
    if (request.method === this.rejectMethod) {
      this.receive({
        error: { code: -32_602, message: "Request rejected" },
        id: request.id,
        type: "response",
      });
      return Promise.resolve();
    }
    if (request.method !== this.deferMethod) {
      this.respond(request);
    }
    return Promise.resolve();
  }

  respond(request: Request) {
    let result: unknown = {};
    if (request.method === "droid.initialize_session") {
      result = this.initializeResult;
    } else if (request.method === "droid.load_session") {
      result = this.loadResult;
    } else if (request.method === "droid.list_mcp_servers") {
      result = this.mcpResult;
    }
    this.receive({ id: request.id, result, type: "response" });
  }
}
