import { setImmediate as nextTurn } from "node:timers/promises";

import {
  createSdkMcpServer,
  ProcessTransport,
  ToolConfirmationOutcome,
} from "@factory/droid-sdk/node";
import type { DroidClientTransport } from "@factory/droid-sdk/node";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProcessSupervisor } from "../processes/process-supervisor";
import { AgentRuntime, normalizeMessage } from "./agent-runtime";
import type { AgentEvent, AgentRuntimeOptions } from "./agent-runtime";
import { MAIN_PROMPT, WORKER_PROMPT } from "./prompts";
import { SESSION_START_TIMEOUT_MS } from "./startup";

type WireMessage = Parameters<DroidClientTransport["send"]>[0];
interface Request {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

const message = (id: string, text: string, requestId?: string) => ({
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
class MockTransport implements DroidClientTransport {
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
      jsonrpc: "2.0",
      ...payload,
    } as WireMessage);
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

const setup = (overrides: Partial<AgentRuntimeOptions> = {}) => {
  const transport = new MockTransport();
  const supervisor = new ProcessSupervisor({
    binDir: "/unused",
    droidPath: "/unused",
  });
  const stop = vi.spyOn(supervisor, "stop").mockResolvedValue({
    stopped: true,
    survivors: [],
  });
  const events: AgentEvent[] = [];
  const runtime = new AgentRuntime({
    agentId: "agent",
    createTransport: () => transport,
    cwd: "/workspace",
    modelId: "model",
    onAskUser: () => Promise.resolve({ answers: [], cancelled: true }),
    onEvent: (event) => events.push(event),
    onPermission: () => Promise.resolve(true),
    reasoningEffort: null,
    role: "worker",
    supervisor,
    ...overrides,
  });
  return { events, runtime, stop, transport };
};

describe(AgentRuntime, () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([undefined, "saved-session"])(
    "reports only safe MCP fields after startup (resume: %s)",
    async (resumeId) => {
      vi.useFakeTimers();
      const onTiming = vi.fn<NonNullable<AgentRuntimeOptions["onTiming"]>>();
      const log = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      const { runtime, transport } = setup({ onTiming });
      transport.mcpResult.servers = [
        {
          args: ["secret-argument"],
          command: "secret-command",
          env: { TOKEN: "secret-env" },
          error: "secret-error",
          headers: { Authorization: "secret-header" },
          isManaged: false,
          name: "fixture",
          serverType: "stdio",
          source: "project",
          status: "failed",
        },
      ];
      transport.onRequest = (request) => {
        if (
          request.method === "droid.initialize_session" ||
          request.method === "droid.load_session"
        ) {
          transport.receive({
            method: "droid.session_notification",
            params: {
              notification: {
                servers: [
                  {
                    isManaged: false,
                    name: "fixture",
                    serverType: "stdio",
                    source: "project",
                    status: "connecting",
                  },
                ],
                summary: { connected: 0, connecting: 1, failed: 0, total: 1 },
                type: "mcp_status_changed",
              },
            },
            type: "notification",
          });
          vi.setSystemTime(Date.now() + 32_000);
        }
      };
      await runtime.start(resumeId);
      await vi.advanceTimersByTimeAsync(0);
      expect(onTiming).toHaveBeenCalledWith("startup.mcp.fixture", {
        durationMs: 32_000,
        status: "failed",
      });
      expect(log).toHaveBeenCalledWith(
        `${JSON.stringify({
          event: "mcp.server_status",
          ms: 32_000,
          name: "fixture",
          status: "failed",
        })}\n`
      );
      expect(
        JSON.stringify([onTiming.mock.calls, log.mock.calls])
      ).not.toContain("secret");
      expect(
        transport.requests.filter((r) => r.method === "droid.list_mcp_servers")
      ).toHaveLength(1);
      await runtime.close();
    }
  );

  it("does not invent a connection duration when no transitions were observed", async () => {
    const onTiming = vi.fn<NonNullable<AgentRuntimeOptions["onTiming"]>>();
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const { runtime, transport } = setup({ onTiming });
    transport.mcpResult.servers = [
      {
        isManaged: false,
        name: "healthy",
        serverType: "stdio",
        source: "user",
        status: "connected",
      },
    ];
    await runtime.start();
    await nextTurn();
    expect(onTiming).toHaveBeenCalledWith("startup.mcp.healthy", {
      durationMs: null,
      status: "connected",
    });
    await runtime.close();
  });

  it.each(["reject", "hang"])(
    "does not delay or fail startup when MCP diagnostics %s",
    async (failure) => {
      const onTiming = vi.fn<NonNullable<AgentRuntimeOptions["onTiming"]>>();
      const { runtime, transport } = setup({ onTiming });
      if (failure === "reject") {
        transport.rejectMethod = "droid.list_mcp_servers";
      } else {
        transport.deferMethod = "droid.list_mcp_servers";
      }
      await expect(runtime.start()).resolves.toMatchObject({
        sessionId: "session",
      });
      await runtime.submit("first", "hello", "steer");
      expect(
        transport.requests.some((r) => r.method === "droid.add_user_message")
      ).toBeTruthy();
      expect(
        onTiming.mock.calls.some(([stage]) =>
          String(stage).startsWith("startup.mcp.")
        )
      ).toBeFalsy();
      await runtime.close();
    }
  );

  it.each([
    { role: "orchestrator" as const, systemPrompt: MAIN_PROMPT },
    { role: "worker" as const, systemPrompt: WORKER_PROMPT },
  ])(
    "appends $role guidance without replacing the SDK Droid preset",
    async (options) => {
      const { runtime, transport } = setup(options);
      await runtime.start();
      const initialize = transport.requests.find(
        (request) => request.method === "droid.initialize_session"
      );
      expect(initialize?.params.systemPrompt).toStrictEqual({
        append: options.systemPrompt,
        preset: "droid",
        type: "preset",
      });
      await runtime.close();
    }
  );

  it("leaves the SDK default prompt untouched when there is no append", async () => {
    const { runtime, transport } = setup();
    await runtime.start();
    const initialize = transport.requests.find(
      (request) => request.method === "droid.initialize_session"
    );
    expect(initialize?.params).not.toHaveProperty("systemPrompt");
    await runtime.close();
  });

  it("allows native initialization to finish after two inherited MCP connection attempts exceed 60 seconds", async () => {
    vi.useFakeTimers();
    const { runtime, transport } = setup();
    transport.deferMethod = "droid.initialize_session";
    const entered = Promise.withResolvers<Request>();
    transport.onRequest = (request) => entered.resolve(request);
    const starting = runtime.start();
    const request = await entered.promise;
    // Recorded CLI startup awaited inherited MCP, then merged supplied MCP.
    // ProcessTransport.connect itself only spawns; it is not readiness.
    await vi.advanceTimersByTimeAsync(65_000);
    transport.respond(request);
    await expect(starting).resolves.toMatchObject({ sessionId: "session" });
    await runtime.close();
  });

  it("bounds an unresponsive initialize and closes pending SDK requests with an actionable error", async () => {
    vi.useFakeTimers();
    const { runtime, stop, transport } = setup();
    transport.deferMethod = "droid.initialize_session";
    const entered = Promise.withResolvers<undefined>();
    transport.onRequest = () => entered.resolve(undefined);
    const starting = Promise.allSettled([runtime.start()]);
    await entered.promise;
    await vi.advanceTimersByTimeAsync(SESSION_START_TIMEOUT_MS);
    await expect(starting).resolves.toMatchObject([
      {
        reason: {
          message: expect.stringMatching(
            /session initialization.*120 seconds.*MCP.*No new mission turn/u
          ),
        },
        status: "rejected",
      },
    ]);
    expect(stop).toHaveBeenCalledWith("agent");
    expect(transport.close).toHaveBeenCalledOnce();
    expect({
      sentGoal: transport.requests.some(
        (request) => request.method === "droid.add_user_message"
      ),
      sessionId: runtime.sessionId,
      timers: vi.getTimerCount(),
    }).toStrictEqual({ sentGoal: false, sessionId: null, timers: 0 });
  });

  it("bounds a hung transport factory and still disposes its late resource", async () => {
    vi.useFakeTimers();
    const factory = Promise.withResolvers<DroidClientTransport>();
    const { runtime, transport, stop } = setup({
      createTransport: () => factory.promise,
    });
    const starting = Promise.allSettled([runtime.start()]);
    await vi.advanceTimersByTimeAsync(SESSION_START_TIMEOUT_MS);
    await expect(starting).resolves.toMatchObject([
      {
        reason: { message: expect.stringContaining("transport creation") },
        status: "rejected",
      },
    ]);
    expect(stop).toHaveBeenCalledOnce();
    factory.resolve(transport);
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.close).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledTimes(2);
    expect({
      requests: transport.requests,
      timers: vi.getTimerCount(),
    }).toStrictEqual({ requests: [], timers: 0 });
  });

  it("owns a late MCP sibling even when another server never finishes startup", async () => {
    vi.useFakeTimers();
    const hung = createSdkMcpServer({ name: "hung", tools: [] });
    const late = createSdkMcpServer({ name: "late", tools: [] });
    const started =
      Promise.withResolvers<Awaited<ReturnType<typeof late.start>>>();
    const entered = Promise.withResolvers<undefined>();
    vi.spyOn(hung, "start").mockReturnValue(
      Promise.withResolvers<Awaited<ReturnType<typeof hung.start>>>().promise
    );
    vi.spyOn(late, "start").mockImplementation(() => {
      entered.resolve(undefined);
      return started.promise;
    });
    const closeLate = vi.spyOn(late, "close").mockResolvedValue(undefined);
    vi.spyOn(hung, "close").mockResolvedValue(undefined);
    const { runtime, transport } = setup({ mcpServers: [hung, late] });
    const starting = Promise.allSettled([runtime.start()]);
    await entered.promise;
    await vi.advanceTimersByTimeAsync(SESSION_START_TIMEOUT_MS);
    await expect(starting).resolves.toMatchObject([
      {
        reason: { message: expect.stringContaining("tool server startup") },
        status: "rejected",
      },
    ]);
    expect(closeLate).toHaveBeenCalledOnce();
    started.resolve({
      headers: [],
      name: "late",
      type: "http",
      url: "http://127.0.0.1:1",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(closeLate).toHaveBeenCalledTimes(2);
    expect(transport.requests).toStrictEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses native update_session_settings in place, including explicit default effort", async () => {
    const { runtime, transport } = setup();
    await runtime.start();
    await expect(
      runtime.updateModel({ modelId: "next", reasoningEffort: null })
    ).resolves.toStrictEqual({ modelId: "next", reasoningEffort: "high" });
    await expect(
      runtime.updateModel({ modelId: "next", reasoningEffort: "low" })
    ).resolves.toStrictEqual({ modelId: "next", reasoningEffort: "low" });
    expect(transport.requests.map((request) => request.method)).toStrictEqual([
      "droid.initialize_session",
      "droid.list_mcp_servers",
      "droid.update_session_settings",
      "droid.update_session_settings",
    ]);
    expect(transport.requests[2]?.params).toStrictEqual({
      modelId: "next",
      reasoningEffort: "high",
    });
    expect(runtime.sessionId).toBe("session");
    await runtime.close();
  });

  it("uses authoritative native settings notifications rather than silently persisting rejected values", async () => {
    const { runtime, transport } = setup();
    await runtime.start();
    transport.onRequest = (request) => {
      if (request.method === "droid.update_session_settings") {
        transport.receive({
          method: "droid.session_notification",
          params: {
            notification: {
              settings: { modelId: "model", reasoningEffort: "low" },
              type: "settings_updated",
            },
          },
          type: "notification",
        });
      }
    };
    await expect(
      runtime.updateModel({ modelId: "next", reasoningEffort: "high" })
    ).resolves.toStrictEqual({ modelId: "model", reasoningEffort: "low" });
    transport.rejectMethod = "droid.update_session_settings";
    transport.onRequest = null;
    await expect(
      runtime.updateModel({ modelId: "next", reasoningEffort: "high" })
    ).rejects.toThrow(/settings request failed/u);
    expect(runtime.model).toStrictEqual({
      modelId: "model",
      reasoningEffort: "low",
    });
    await runtime.close();
  });

  it.each([undefined, "saved"])(
    "switches both ways without inventing an effort after start(%s), including no-effort rollback",
    async (sessionId) => {
      const { runtime, transport } = setup();
      await runtime.start(sessionId);
      const plain = { modelId: "plain", reasoningEffort: null };
      await expect(runtime.updateModel(plain)).resolves.toStrictEqual(plain);
      await runtime.updateModel({ modelId: "next", reasoningEffort: null });
      await expect(runtime.updateModel(plain)).resolves.toStrictEqual(plain);
      expect(
        transport.requests.slice(2).map((request) => request.params)
      ).toStrictEqual([
        { modelId: "plain" },
        { modelId: "next", reasoningEffort: "high" },
        { modelId: "plain" },
      ]);
      await runtime.close();
    }
  );

  it.each([undefined, "none"])(
    "clears inherited effort from a no-effort native notification (%s)",
    async (reasoningEffort) => {
      const { runtime, transport } = setup();
      await runtime.start();
      transport.onRequest = () =>
        transport.receive({
          method: "droid.session_notification",
          params: {
            notification: {
              settings: { modelId: "plain", reasoningEffort },
              type: "settings_updated",
            },
          },
          type: "notification",
        });
      await expect(
        runtime.updateModel({ modelId: "plain", reasoningEffort: null })
      ).resolves.toStrictEqual({ modelId: "plain", reasoningEffort: null });
      expect(transport.requests.at(-1)?.params).toStrictEqual({
        modelId: "plain",
      });
      await runtime.close();
    }
  );

  it("normalizes full no-effort startup settings before using them for rollback", async () => {
    const { runtime, transport } = setup();
    transport.initializeResult.settings = {
      modelId: "plain",
      reasoningEffort: "none",
    };
    await runtime.start();
    expect(runtime.model).toStrictEqual({
      modelId: "plain",
      reasoningEffort: null,
    });
    await runtime.close();
  });

  it.each(["none", "high"] as const)(
    "rejects unsupported explicit %s effort for a no-effort model before sending",
    async (reasoningEffort) => {
      const { runtime, transport } = setup();
      await runtime.start();
      await expect(
        runtime.updateModel({
          modelId: "plain",
          reasoningEffort,
        })
      ).rejects.toThrow(/does not support/u);
      expect(transport.requests.map((request) => request.method)).toStrictEqual(
        ["droid.initialize_session", "droid.list_mcp_servers"]
      );
      await runtime.close();
    }
  );

  it("requires native settings for an unknown default instead of inventing confirmation from an empty ack", async () => {
    const { runtime, transport } = setup();
    await runtime.start();
    await expect(
      runtime.updateModel({ modelId: "unknown", reasoningEffort: null })
    ).rejects.toThrow(/did not confirm/u);
    expect(runtime.model).toStrictEqual({
      modelId: "model",
      reasoningEffort: "medium",
    });
    transport.onRequest = () =>
      transport.receive({
        method: "droid.session_notification",
        params: {
          notification: {
            settings: { modelId: "unknown" },
            type: "settings_updated",
          },
        },
        type: "notification",
      });
    await expect(
      runtime.updateModel({ modelId: "unknown", reasoningEffort: null })
    ).resolves.toStrictEqual({ modelId: "unknown", reasoningEffort: null });
    await runtime.close();
  });

  it("does not adopt a native settings acknowledgement after close", async () => {
    const { runtime, transport } = setup();
    await runtime.start();
    transport.deferMethod = "droid.update_session_settings";
    const updating = Promise.allSettled([
      runtime.updateModel({ modelId: "next", reasoningEffort: "high" }),
    ]);
    await runtime.close();
    const request = transport.requests.find(
      (entry) => entry.method === "droid.update_session_settings"
    );
    if (!request) {
      throw new Error("No settings request");
    }
    transport.respond(request);
    await expect(updating).resolves.toMatchObject([{ status: "rejected" }]);
    expect(runtime.model).toStrictEqual({
      modelId: "model",
      reasoningEffort: "medium",
    });
  });

  it("merges partial model notifications and ignores unrelated settings acknowledgements", async () => {
    const { runtime, transport } = setup();
    await runtime.start();
    transport.onRequest = () =>
      transport.receive({
        method: "droid.session_notification",
        params: {
          notification: {
            settings: { reasoningEffort: "low" },
            type: "settings_updated",
          },
        },
        type: "notification",
      });
    await expect(
      runtime.updateModel({ modelId: "model", reasoningEffort: "high" })
    ).resolves.toStrictEqual({ modelId: "model", reasoningEffort: "low" });
    transport.onRequest = () =>
      transport.receive({
        method: "droid.session_notification",
        params: {
          notification: {
            settings: { autonomyLevel: "off" },
            type: "settings_updated",
          },
        },
        type: "notification",
      });
    await expect(
      runtime.updateModel({ modelId: "next", reasoningEffort: "high" })
    ).resolves.toStrictEqual({ modelId: "next", reasoningEffort: "high" });
    await runtime.close();
  });

  it("admits one start attempt, including while transport creation is pending and after close", async () => {
    const gate = Promise.withResolvers<DroidClientTransport>();
    const createTransport = vi
      .fn<() => Promise<DroidClientTransport>>()
      .mockReturnValue(gate.promise);
    const { runtime, transport } = setup({ createTransport });
    const starting = runtime.start();
    await expect(runtime.start()).rejects.toThrow(/already started/u);
    gate.resolve(transport);
    await starting;
    await runtime.close();
    await expect(runtime.start()).rejects.toThrow(/already started/u);
    expect(createTransport).toHaveBeenCalledOnce();
  });

  it("never creates a transport when closed before its first start", async () => {
    const createTransport = vi.fn<() => DroidClientTransport>(
      () => new MockTransport()
    );
    const { runtime } = setup({ createTransport });
    await runtime.close();
    await expect(runtime.start()).rejects.toThrow(/cancelled/u);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("owns a transport returned after successful early close and rejects startup only after disposal", async () => {
    const gate = Promise.withResolvers<DroidClientTransport>();
    const { runtime, stop, transport } = setup({
      createTransport: () => gate.promise,
    });
    const startup = Promise.allSettled([runtime.start()]);
    await expect(runtime.close()).resolves.toMatchObject({ stopped: true });
    gate.resolve(transport);
    await expect(startup).resolves.toMatchObject([
      {
        reason: { message: "Runtime startup was cancelled" },
        status: "rejected",
      },
    ]);
    expect({
      closes: transport.close.mock.calls.length,
      connected: runtime.connected,
      requests: transport.requests,
      sessionId: runtime.sessionId,
      stops: stop.mock.calls.length,
    }).toStrictEqual({
      closes: 1,
      connected: false,
      requests: [],
      sessionId: null,
      stops: 2,
    });
    await runtime.close();
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("does not reuse an early successful close when late cleanup remains unconfirmed", async () => {
    const gate = Promise.withResolvers<DroidClientTransport>();
    const { runtime, stop, transport } = setup({
      createTransport: () => gate.promise,
    });
    stop
      .mockResolvedValueOnce({ stopped: true, survivors: [] })
      .mockResolvedValue({ stopped: false, survivors: [], unobservable: true });
    const startup = Promise.allSettled([runtime.start()]);
    await expect(runtime.close()).resolves.toMatchObject({ stopped: true });
    gate.resolve(transport);
    await expect(startup).resolves.toMatchObject([{ status: "rejected" }]);
    await expect(runtime.close()).resolves.toMatchObject({
      stopped: false,
      unobservable: true,
    });
    expect({
      closes: transport.close.mock.calls.length,
      stops: stop.mock.calls.length,
    }).toStrictEqual({ closes: 1, stops: 3 });
  });

  it("joins an earlier in-flight close before disposing an arriving transport", async () => {
    const factory = Promise.withResolvers<DroidClientTransport>();
    const stopping = Promise.withResolvers<{
      stopped: boolean;
      survivors: number[];
    }>();
    const { runtime, stop, transport } = setup({
      createTransport: () => factory.promise,
    });
    stop.mockReturnValueOnce(stopping.promise);
    const startup = Promise.allSettled([runtime.start()]);
    const closing = runtime.close();
    factory.resolve(transport);
    await nextTurn();
    stopping.resolve({ stopped: true, survivors: [] });
    await expect(closing).resolves.toMatchObject({ stopped: true });
    await expect(startup).resolves.toMatchObject([{ status: "rejected" }]);
    expect({
      closes: transport.close.mock.calls.length,
      requests: transport.requests,
      stops: stop.mock.calls.length,
    }).toStrictEqual({ closes: 1, requests: [], stops: 2 });
  });

  it("disposes a ProcessTransport that finishes connecting after its initial close", async () => {
    const transport = new ProcessTransport({ droidExecPath: "/unused" });
    const connecting = Promise.withResolvers<undefined>();
    const entered = Promise.withResolvers<undefined>();
    vi.spyOn(transport, "connect").mockImplementation(() => {
      entered.resolve(undefined);
      return connecting.promise;
    });
    const closeTransport = vi
      .spyOn(transport, "close")
      .mockResolvedValue(undefined);
    const send = vi.spyOn(transport, "send").mockResolvedValue(undefined);
    const { runtime, stop } = setup({ createTransport: () => transport });
    const startup = Promise.allSettled([runtime.start()]);
    await entered.promise;
    await expect(runtime.close()).resolves.toMatchObject({ stopped: true });
    expect(closeTransport).toHaveBeenCalledOnce();
    connecting.resolve(undefined);
    await expect(startup).resolves.toMatchObject([
      {
        reason: { message: "Runtime startup was cancelled" },
        status: "rejected",
      },
    ]);
    expect({
      closes: closeTransport.mock.calls.length,
      sends: send.mock.calls.length,
      sessionId: runtime.sessionId,
      stops: stop.mock.calls.length,
    }).toStrictEqual({ closes: 2, sends: 0, sessionId: null, stops: 2 });
  });

  it.each([
    { method: "droid.initialize_session", sessionId: undefined },
    { method: "droid.load_session", sessionId: "saved" },
  ])(
    "fences a deferred $method response after close",
    async ({ method, sessionId }) => {
      const { events, runtime, stop, transport } = setup();
      const entered = Promise.withResolvers<undefined>();
      transport.deferMethod = method;
      transport.onRequest = (request) => {
        if (request.method === method) {
          entered.resolve(undefined);
        }
      };
      const startup = Promise.allSettled([runtime.start(sessionId)]);
      await entered.promise;
      await runtime.close();
      await expect(startup).resolves.toMatchObject([
        {
          reason: { message: "Runtime startup was cancelled" },
          status: "rejected",
        },
      ]);
      const request = transport.requests.find(
        (entry) => entry.method === method
      );
      if (!request) {
        throw new Error("The deferred session request was not sent");
      }
      transport.respond(request);
      await nextTurn();
      expect({
        closes: transport.close.mock.calls.length,
        connected: runtime.connected,
        events,
        sessionId: runtime.sessionId,
        stops: stop.mock.calls.length,
      }).toStrictEqual({
        closes: 1,
        connected: false,
        events: [],
        sessionId: null,
        stops: 2,
      });
      await runtime.close();
      expect(stop).toHaveBeenCalledTimes(2);
    }
  );

  it("joins and disposes a late MCP start without initializing a cancelled session", async () => {
    const server = createSdkMcpServer({ name: "late", tools: [] });
    const gate =
      Promise.withResolvers<Awaited<ReturnType<typeof server.start>>>();
    const entered = Promise.withResolvers<undefined>();
    vi.spyOn(server, "start").mockImplementation(() => {
      entered.resolve(undefined);
      return gate.promise;
    });
    const closeServer = vi.spyOn(server, "close").mockResolvedValue(undefined);
    const { runtime, stop, transport } = setup({ mcpServers: [server] });
    const startup = Promise.allSettled([runtime.start()]);
    await entered.promise;
    await runtime.close();
    gate.resolve({
      headers: [],
      name: "late",
      type: "http",
      url: "http://127.0.0.1:1",
    });
    await expect(startup).resolves.toMatchObject([
      {
        reason: { message: "Runtime startup was cancelled" },
        status: "rejected",
      },
    ]);
    expect(closeServer).toHaveBeenCalledTimes(2);
    expect({
      requests: transport.requests,
      stops: stop.mock.calls.length,
    }).toStrictEqual({ requests: [], stops: 2 });
  });

  it("sends structured agent senders, model-only context and native Spec mode", async () => {
    const { runtime, transport } = setup();
    await runtime.start();
    await runtime.submit("from-worker", "report", "steer", {
      sender: { kind: "agent", sessionId: "worker-session", title: "Worker 1" },
    });
    await runtime.submit("from-user", "hello", "steer");
    await runtime.addContext("sys:plan-guidance:1", "guidance");
    await runtime.setInteractionMode("spec");
    const [worker, user, context, mode] = transport.requests.slice(2);
    expect(worker).toMatchObject({
      id: "from-worker",
      method: "droid.add_user_message",
      params: {
        queuePlacement: "end_of_turn",
        sender: {
          kind: "agent",
          sessionId: "worker-session",
          title: "Worker 1",
        },
        text: "report",
      },
    });
    expect(user?.params).not.toHaveProperty("sender");
    expect(context).toMatchObject({
      id: "sys:plan-guidance:1",
      method: "droid.add_user_message",
      params: {
        role: "system",
        skipAgentLoop: true,
        text: "guidance",
        visibility: "llm_only",
      },
    });
    expect(mode).toMatchObject({
      method: "droid.update_session_settings",
      params: { interactionMode: "spec" },
    });
    await runtime.close();
  });

  it("initializes with mandatory broker permissions and native queue placements", async () => {
    const { runtime, transport } = setup();
    await expect(runtime.start()).resolves.toMatchObject({
      cwd: "/workspace",
      sessionId: "session",
    });
    expect(transport.requests[0]).toMatchObject({
      params: { autonomyLevel: "off", cwd: "/workspace", worktree: false },
    });
    await runtime.submit("queue", "queued", "queue");
    await runtime.submit("steer", "steered", "steer");
    expect(transport.requests.slice(2)).toMatchObject([
      { id: "queue", params: { queuePlacement: "end_of_loop" } },
      { id: "steer", params: { queuePlacement: "end_of_turn" } },
    ]);
    expect(runtime.queue.get("queue")?.state).toBe("queued");
    await runtime.changeMode("queue", "steer");
    expect(transport.requests.at(-1)).toMatchObject({
      method: "droid.resolve_queued_user_message",
      params: {
        action: "update_queue",
        queuePlacement: "end_of_turn",
        requestId: "queue",
      },
    });
    await runtime.close();
  });

  it("edits only after confirmed deletion, with a new native admission position", async () => {
    const { runtime, transport } = setup();
    await runtime.start();
    await runtime.submit("old", "old text", "queue");
    await runtime.submit("middle", "middle text", "queue");
    await expect(runtime.edit("old", "replacement", "new text")).resolves.toBe(
      "replaced"
    );
    expect(transport.requests.slice(-2)).toMatchObject([
      {
        method: "droid.resolve_queued_user_message",
        params: { action: "delete", requestId: "old" },
      },
      {
        id: "replacement",
        method: "droid.add_user_message",
        params: { queuePlacement: "end_of_loop", text: "new text" },
      },
    ]);
    expect(runtime.queue.list().map((entry) => entry.id)).toStrictEqual([
      "old",
      "middle",
      "replacement",
    ]);
    expect(runtime.queue.get("old")?.state).toBe("removed");
    await runtime.close();
  });

  it("lets consumption win over an editing delete response", async () => {
    const { runtime, transport } = setup();
    await runtime.start();
    await runtime.submit("old", "old text", "queue");
    transport.onRequest = (request) => {
      if (request.method === "droid.resolve_queued_user_message") {
        transport.userMessage("message", "old text", "old");
      }
    };
    await expect(runtime.edit("old", "new", "new text")).resolves.toBe(
      "already_sent"
    );
    expect(runtime.queue.get("old")?.state).toBe("sent");
    expect(
      transport.requests.some((request) => request.id === "new")
    ).toBeFalsy();
    await runtime.close();
  });

  it("does not requeue an edit when deletion is unconfirmed", async () => {
    vi.useFakeTimers();
    const { runtime, transport } = setup();
    await runtime.start();
    await runtime.submit("old", "old text", "queue");
    transport.rejectMethod = "droid.resolve_queued_user_message";
    const editing = runtime.edit("old", "new", "new text");
    await vi.advanceTimersByTimeAsync(400);
    await expect(editing).resolves.toBe("delete_unconfirmed");
    expect(runtime.queue.get("old")?.state).toBe("unknown");
    expect(runtime.queue.get("new")).toBeNull();
    await runtime.close();
  });

  it("rechecks consumption between confirmed deletion and replacement", async () => {
    const { runtime, transport } = setup({
      onEvent: (event) => {
        if (event.type === "queue" && event.entry.state === "removed") {
          queueMicrotask(() =>
            transport.userMessage("message", "old text", "old")
          );
        }
      },
    });
    await runtime.start();
    await runtime.submit("old", "old text", "queue");
    await expect(runtime.edit("old", "new", "new text")).resolves.toBe(
      "already_sent"
    );
    expect(runtime.queue.get("old")?.state).toBe("sent");
    expect(runtime.queue.get("new")).toBeNull();
    await runtime.close();
  });

  it("distinguishes definite rejection from an uncertain send", async () => {
    const { runtime, transport } = setup();
    await runtime.start();
    transport.rejectMethod = "droid.add_user_message";
    await expect(runtime.submit("rejected", "text", "queue")).rejects.toThrow(
      /Add user message request failed/u
    );
    expect(runtime.queue.get("rejected")?.state).toBe("failed");
    transport.rejectMethod = null;
    transport.failMethod = "droid.add_user_message";
    await expect(runtime.submit("unknown", "text", "queue")).rejects.toThrow(
      /Failed to send request/u
    );
    expect(runtime.queue.get("unknown")?.state).toBe("unknown");
    await runtime.close();
  });

  it("preserves explicit restored request identity through the SDK parser", async () => {
    const { runtime, transport } = setup();
    transport.loadResult.session.messages = [
      message("sdk-message", "same text", "consumed"),
      message("not-a-request-id", "same text"),
    ];
    const restored = await runtime.start("saved");
    expect(restored.messages).toMatchObject([
      { id: "sdk-message", requestId: "consumed" },
      { id: "not-a-request-id", requestId: null },
    ]);
    expect(restored).toMatchObject({
      pendingIds: ["pending"],
      queuedIds: ["queued"],
    });
    runtime.queue.hydrate([
      {
        error: null,
        id: "consumed",
        mode: "queue",
        state: "unknown",
        text: "same text",
      },
      {
        error: null,
        id: "unidentified",
        mode: "queue",
        state: "unknown",
        text: "same text",
      },
    ]);
    runtime.queue.reconcile({
      consumedIds: new Set(
        restored.messages.flatMap((entry) =>
          entry.requestId ? [entry.requestId] : []
        )
      ),
      pendingIds: restored.pendingIds,
      queuedIds: restored.queuedIds,
    });
    expect(runtime.queue.get("consumed")?.state).toBe("sent");
    expect(runtime.queue.get("unidentified")?.state).toBe("unknown");
    await runtime.close();
  });

  it("still rejects malformed restored messages through SDK validation", async () => {
    const { events, runtime, stop, transport } = setup();
    transport.loadResult.session.messages = [
      {
        content: [{ text: "invalid", type: "text" }],
        id: "invalid",
        role: "user",
      },
    ];
    await expect(runtime.start("saved")).rejects.toThrow(
      /Load session request failed/u
    );
    expect(events.some((event) => event.type === "message")).toBeFalsy();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("returns restored initialize messages too, without inventing identities", async () => {
    const { runtime, transport } = setup();
    transport.initializeResult.session.messages = [
      message("message", "restored", "real-request"),
    ];
    const started = await runtime.start();
    expect(started.messages[0]?.requestId).toBe("real-request");
    await runtime.close();
  });

  it("does not infer live consumption from matching message text", async () => {
    const { events, runtime, transport } = setup();
    await runtime.start();
    await runtime.submit("queued", "same text", "queue");
    transport.userMessage("unidentified", "same text");
    expect(runtime.queue.get("queued")?.state).toBe("queued");
    expect(events.at(-1)).toMatchObject({
      message: { requestId: null },
      type: "message",
    });
    await runtime.close();
  });

  it("answers SDK permission requests once, never with persistent approval", async () => {
    const { runtime, transport } = setup();
    await runtime.start();
    transport.receive({
      id: "permission",
      method: "droid.request_permission",
      params: {
        options: [
          { label: "Once", value: ToolConfirmationOutcome.ProceedOnce },
          { label: "Always", value: ToolConfirmationOutcome.ProceedAlways },
          { label: "Cancel", value: ToolConfirmationOutcome.Cancel },
        ],
        toolUses: [],
      },
      type: "request",
    });
    await vi.waitFor(() => {
      expect(transport.sent.at(-1)).toMatchObject({
        id: "permission",
        result: { selectedOption: ToolConfirmationOutcome.ProceedOnce },
        type: "response",
      });
    });
    await runtime.close();
  });

  it("reaches supervision when transport and MCP close both hang", async () => {
    vi.useFakeTimers();
    const mcp = createSdkMcpServer({ name: "test", tools: [] });
    vi.spyOn(mcp, "config", "get").mockReturnValue({
      headers: [],
      name: "test",
      type: "http",
      url: "http://127.0.0.1:1",
    });
    const mcpClose = vi
      .spyOn(mcp, "close")
      .mockReturnValue(Promise.withResolvers<undefined>().promise);
    const { runtime, stop, transport } = setup({ mcpServers: [mcp] });
    transport.close.mockReturnValue(Promise.withResolvers<undefined>().promise);
    await runtime.start();
    const closing = runtime.close();
    const repeated = runtime.close();
    expect(stop).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(closing).resolves.toStrictEqual({
      stopped: true,
      survivors: [],
    });
    await repeated;
    expect(transport.close).toHaveBeenCalledOnce();
    expect(mcpClose).toHaveBeenCalledOnce();
  });

  it("retries supervision after an unconfirmed close without reopening the client", async () => {
    const { runtime, stop, transport } = setup();
    await runtime.start();
    stop.mockResolvedValueOnce({
      stopped: false,
      survivors: [],
      unobservable: true,
    });
    await expect(runtime.close()).resolves.toMatchObject({ stopped: false });
    await expect(runtime.close()).resolves.toMatchObject({ stopped: true });
    expect(stop).toHaveBeenCalledTimes(2);
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it.each(["rejected", "thrown"] as const)(
    "keeps %s supervision inside the bounded disposal lifetime and permits retry",
    async (failure) => {
      vi.useFakeTimers();
      const { runtime, stop, transport } = setup();
      await runtime.start();
      const failed = new Error("Process supervision failed");
      if (failure === "rejected") {
        stop.mockRejectedValueOnce(failed);
      } else {
        stop.mockImplementationOnce(() => {
          throw failed;
        });
      }
      const cleanup = Promise.withResolvers<undefined>();
      transport.close.mockReturnValue(cleanup.promise);
      const settled: unknown[] = [];
      const observeClose = async () => {
        try {
          const result = await runtime.close();
          settled.push(result);
          return result;
        } catch (error) {
          settled.push(error);
          return error;
        }
      };
      const closing = observeClose();
      const repeated = observeClose();
      await vi.advanceTimersByTimeAsync(999);
      expect({
        closes: transport.close.mock.calls.length,
        settled,
        stops: stop.mock.calls.length,
      }).toStrictEqual({ closes: 1, settled: [], stops: 1 });
      await vi.advanceTimersByTimeAsync(1);
      const outcomes = await Promise.all([closing, repeated]);
      expect({ outcomes, timers: vi.getTimerCount() }).toStrictEqual({
        outcomes: [failed, failed],
        timers: 0,
      });
      await expect(runtime.close()).resolves.toMatchObject({ stopped: true });
      expect(stop).toHaveBeenCalledTimes(2);
      expect(transport.close).toHaveBeenCalledOnce();
      cleanup.resolve(undefined);
    }
  );
});

describe(normalizeMessage, () => {
  it("preserves structured senders and hides model-only context", () => {
    expect(
      normalizeMessage(
        {
          ...message("m", "report", "r"),
          sender: { kind: "agent", sessionId: "s", title: "Worker 1" },
        },
        null
      )
    ).toMatchObject({
      sender: { kind: "agent", sessionId: "s", title: "Worker 1" },
    });
    expect(normalizeMessage(message("m", "text"), null)).toMatchObject({
      sender: null,
    });
    expect(
      normalizeMessage(
        { ...message("m", "guidance"), role: "system", visibility: "llm_only" },
        null
      )
    ).toBeNull();
  });

  it("keeps real request IDs but never promotes message IDs to request IDs", () => {
    expect(
      normalizeMessage(message("m", "text", "request"), null)
    ).toMatchObject({
      requestId: "request",
    });
    expect(normalizeMessage(message("m", "text"), null)).toMatchObject({
      requestId: null,
    });
  });
});
