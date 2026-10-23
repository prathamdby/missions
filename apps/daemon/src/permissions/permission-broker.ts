import { randomUUID } from "node:crypto";
import path from "node:path";

import type { Autonomy, Role } from "@missions/protocol/common";
import type {
  Grant,
  PermissionDecision,
  PermissionRequest,
  ToolUseSummary,
} from "@missions/protocol/missions";

import type { PermissionToolUse } from "../sdk/agent-runtime";
import { commandCategory } from "./command-policy";
import { StaleDecisionError } from "./stale-decision-error";

export { StaleDecisionError } from "./stale-decision-error";

export type ActionCategory =
  | "read"
  | "edit"
  | "execute"
  | "vcs"
  | "publish"
  | "role_tool"
  | "mcp"
  | "blocked"
  | "unknown";

export type Impact = "low" | "medium" | "high";

export interface ClassifiedUse {
  category: ActionCategory;
  action: string;
  impact: Impact;
  normalized: string;
  summary: ToolUseSummary;
}

export interface AgentContext {
  missionId: string;
  projectId: string;
  role: Role;
  workspacePath: string;
  autonomy: Autonomy;
  epoch: number;
  planApproved: boolean;
  fenced: boolean;
  /** Assignment capability. Omitted means writable for older callers. */
  canWrite?: boolean;
}

export interface BrokerStore {
  saveRequest: (request: PermissionRequest) => void;
  listGrants: () => Grant[];
  addGrant: (grant: Grant) => void;
}

export interface PermissionBrokerOptions {
  roleToolServer: string;
  store: BrokerStore;
  context: (agentId: string) => AgentContext | null;
  /** Resolves once the agent holds the shared workspace write lease. */
  acquireWriteLease: (agentId: string, signal: AbortSignal) => Promise<void>;
  now?: () => Date;
}

export type AskResult =
  | { approved: true; via: "policy" | "grant" | "user" }
  | { approved: false; reason: string };

const READ_TOOLS = new Set([
  "Read",
  "LS",
  "Glob",
  "Grep",
  "WebSearch",
  "FetchUrl",
]);
const BLOCKED_CONFIRMATIONS = new Set([
  "propose_mission",
  "start_mission_run",
  "recommend_mission",
]);

const impactOf = (value: unknown): Impact => {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return "high";
};

const str = (value: unknown) => (typeof value === "string" ? value : "");

const relative = (workspace: string, filePath: string) => {
  if (!filePath) {
    return "";
  }
  const rel = path.relative(workspace, path.resolve(workspace, filePath));
  return rel.startsWith("..") ? path.resolve(workspace, filePath) : rel;
};

const editDiff = (details: Record<string, unknown>) => {
  if (typeof details.patchContent === "string") {
    return details.patchContent;
  }
  const before = str(details.oldContent);
  const after = str(details.newContent) || str(details.content);
  if (!(before || after)) {
    return null;
  }
  const minus = before ? before.split("\n").map((line) => `-${line}`) : [];
  const plus = after ? after.split("\n").map((line) => `+${line}`) : [];
  return [...minus, ...plus].join("\n");
};

/** Classifies one SDK confirmation; Script batches are flattened by the caller. */
export const classifyToolUse = (
  use: PermissionToolUse,
  workspacePath: string,
  roleToolServer: string
): ClassifiedUse => {
  const { details, toolName } = use;
  const type = str(details.type) || use.confirmationType;
  const base = {
    diff: null as string | null,
    input: use.input,
    summary: toolName,
    toolName,
    toolUseId: use.toolUseId || null,
  };
  if (BLOCKED_CONFIRMATIONS.has(type)) {
    return {
      action: toolName,
      category: "blocked",
      impact: "high",
      normalized: type,
      summary: {
        ...base,
        summary: "Built-in Factory Missions are not used here",
      },
    };
  }
  if (type === "exec") {
    const command = str(details.fullCommand) || str(details.command);
    // Exact command identity: quoted whitespace can change arguments and must
    // never collide with an earlier Always allow grant. Version the key so
    // legacy whitespace-collapsed grants cannot authorize a different command.
    const normalized = `exec:v2:${command}`;
    const category = commandCategory(command);
    return {
      action: "Execute",
      category,
      impact: impactOf(details.impactLevel),
      normalized,
      summary: { ...base, summary: command },
    };
  }
  if (type === "edit" || type === "create" || type === "apply_patch") {
    const files = Array.isArray(details.files)
      ? details.files.map((file) =>
          relative(
            workspacePath,
            typeof file === "object" && file !== null && "filePath" in file
              ? str(file.filePath)
              : ""
          )
        )
      : [relative(workspacePath, str(details.filePath))];
    const outside = files.some((file) => path.isAbsolute(file));
    return {
      action: toolName,
      category: "edit",
      impact: outside ? "high" : "medium",
      normalized: files.join(","),
      summary: {
        ...base,
        diff: editDiff(details),
        summary: `${toolName} ${files.join(", ")}`,
      },
    };
  }
  if (type === "mcp_tool") {
    const server = str(details.serverName);
    const tool = str(details.actualToolName) || str(details.toolName);
    return {
      action: `${server}/${tool}`,
      category: server === roleToolServer ? "role_tool" : "mcp",
      impact: impactOf(details.impactLevel),
      normalized: `${server}/${tool}`,
      summary: { ...base, summary: `${server} → ${tool}` },
    };
  }
  if (READ_TOOLS.has(toolName)) {
    return {
      action: toolName,
      category: "read",
      impact: "low",
      normalized: toolName,
      summary: base,
    };
  }
  return {
    action: toolName,
    category: "unknown",
    impact: "high",
    normalized: `${type}:${toolName}`,
    summary: { ...base, summary: `${toolName} (${type || "unknown action"})` },
  };
};

export const flattenToolUses = (uses: PermissionToolUse[]) =>
  uses.flatMap((use) => {
    const { calls } = use.details;
    if (str(use.details.type) !== "script" || !Array.isArray(calls)) {
      return [use];
    }
    return calls.map((call: Record<string, unknown>) => ({
      confirmationType: str(
        (call.confirmation as Record<string, unknown>)?.type
      ),
      details: (call.confirmation ?? {}) as Record<string, unknown>,
      input: (call.toolInput ?? {}) as Record<string, unknown>,
      toolName: str(call.toolName),
      toolUseId: use.toolUseId,
    }));
  });

const AUTO_IMPACT: Record<Autonomy, ReadonlySet<Impact>> = {
  high: new Set(["low", "medium", "high"]),
  low: new Set(["low"]),
  medium: new Set(["low", "medium"]),
  off: new Set(),
};

/** Whether the user's autonomy level approves this use without asking. */
export const autoApproves = (autonomy: Autonomy, use: ClassifiedUse) => {
  switch (use.category) {
    case "read":
    case "role_tool": {
      return true;
    }
    case "edit": {
      return autonomy !== "off" && use.impact !== "high";
    }
    case "execute":
    case "mcp": {
      return AUTO_IMPACT[autonomy].has(use.impact);
    }
    default: {
      return false;
    }
  }
};

const isWritable = (use: ClassifiedUse) =>
  use.category === "edit" ||
  use.category === "vcs" ||
  use.category === "publish" ||
  ((use.category === "execute" ||
    use.category === "mcp" ||
    use.category === "unknown") &&
    use.impact !== "low");

const requiresWriteCapability = (use: ClassifiedUse) =>
  use.category !== "read" &&
  use.category !== "role_tool" &&
  use.category !== "blocked";

const mandatoryDenial = (
  context: AgentContext,
  uses: ClassifiedUse[]
): string | null => {
  if (context.fenced) {
    return "Mission is paused";
  }
  if (uses.some((use) => use.category === "blocked")) {
    return "Built-in Factory Missions are disabled";
  }
  if (context.canWrite === false && uses.some(requiresWriteCapability)) {
    return "This assignment is read-only";
  }
  if (!context.planApproved && uses.some(isWritable)) {
    return "Changes are blocked until the plan is approved";
  }
  return null;
};

interface Pending {
  request: PermissionRequest;
  resolve: (decision: PermissionDecision | null) => void;
  uses: ClassifiedUse[];
  context: AgentContext;
}

/**
 * One policy point for SDK permission requests. Mandatory gates (Pause fence,
 * plan approval, publishing) run before grants and autonomy so neither
 * "Always allow" nor High autonomy can bypass them.
 */
export class PermissionBroker {
  readonly #options: PermissionBrokerOptions;
  readonly #pending = new Map<string, Pending>();
  readonly #aborts = new Map<string, AbortController>();

  constructor(options: PermissionBrokerOptions) {
    this.#options = options;
  }

  #now() {
    return (this.#options.now ?? (() => new Date()))().toISOString();
  }

  #grantMatches(context: AgentContext, use: ClassifiedUse) {
    return this.#options.store
      .listGrants()
      .some(
        (grant) =>
          grant.projectId === context.projectId &&
          grant.workspacePath === context.workspacePath &&
          grant.role === context.role &&
          grant.action === use.action &&
          grant.normalizedRequest === use.normalized
      );
  }

  async ask(
    agentId: string,
    toolUses: PermissionToolUse[]
  ): Promise<AskResult> {
    const context = this.#options.context(agentId);
    if (!context) {
      return {
        approved: false,
        reason: "Agent is not part of an active mission",
      };
    }
    const uses = flattenToolUses(toolUses).map((use) =>
      classifyToolUse(use, context.workspacePath, this.#options.roleToolServer)
    );
    const denied = mandatoryDenial(context, uses);
    if (denied) {
      return { approved: false, reason: denied };
    }
    const writable = uses.some(isWritable);
    const needsPublishApproval = uses.some((use) => use.category === "publish");
    const covered = uses.every(
      (use) =>
        use.category !== "publish" &&
        (autoApproves(context.autonomy, use) ||
          this.#grantMatches(context, use))
    );
    let via: "policy" | "grant" | "user" = uses.every((use) =>
      autoApproves(context.autonomy, use)
    )
      ? "policy"
      : "grant";
    if (!covered) {
      const decision = await this.#askUser(
        agentId,
        context,
        uses,
        !needsPublishApproval
      );
      if (decision === null || decision === "deny") {
        return { approved: false, reason: "Denied" };
      }
      via = "user";
    }
    if (writable) {
      const lease = await this.#acquireLease(agentId, context);
      if (!lease) {
        return { approved: false, reason: "Mission is paused" };
      }
    }
    // Re-check the fence: Pause may have landed while we waited.
    const latest = this.#options.context(agentId);
    if (!latest || latest.fenced || latest.epoch !== context.epoch) {
      return { approved: false, reason: "Mission is paused" };
    }
    const latestDenial = mandatoryDenial(latest, uses);
    if (latestDenial) {
      return { approved: false, reason: latestDenial };
    }
    return { approved: true, via };
  }

  async #acquireLease(agentId: string, context: AgentContext) {
    const controller = new AbortController();
    const key = `${context.missionId}:${agentId}:${randomUUID()}`;
    this.#aborts.set(key, controller);
    try {
      await this.#options.acquireWriteLease(agentId, controller.signal);
      return true;
    } catch {
      return false;
    } finally {
      this.#aborts.delete(key);
    }
  }

  #askUser(
    agentId: string,
    context: AgentContext,
    uses: ClassifiedUse[],
    allowAlways: boolean
  ) {
    const request: PermissionRequest = {
      agentId,
      allowAlways,
      createdAt: this.#now(),
      decidedAt: null,
      decision: null,
      epoch: context.epoch,
      id: randomUUID(),
      kind: allowAlways ? "tool" : "publish",
      missionId: context.missionId,
      reason: null,
      status: "pending",
      toolUses: uses.map((use) => use.summary),
    };
    this.#options.store.saveRequest(request);
    const { promise, resolve } =
      Promise.withResolvers<PermissionDecision | null>();
    this.#pending.set(request.id, { context, request, resolve, uses });
    return promise;
  }

  pending(missionId: string) {
    return [...this.#pending.values()]
      .filter((entry) => entry.request.missionId === missionId)
      .map((entry) => entry.request);
  }

  decide(
    requestId: string,
    decision: PermissionDecision,
    epoch: number
  ): PermissionRequest {
    const entry = this.#pending.get(requestId);
    if (!entry) {
      throw new StaleDecisionError("This approval is no longer pending");
    }
    const current = this.#options.context(entry.request.agentId ?? "");
    if (
      epoch !== entry.request.epoch ||
      !current ||
      current.epoch !== entry.request.epoch ||
      mandatoryDenial(current, entry.uses) !== null
    ) {
      this.#finish(entry, "stale", null, "Mission state changed");
      throw new StaleDecisionError("This approval belongs to an earlier run");
    }
    if (decision === "always_allow") {
      if (!entry.request.allowAlways) {
        throw new StaleDecisionError(
          "This action always needs explicit approval"
        );
      }
      for (const use of entry.uses) {
        if (autoApproves(entry.context.autonomy, use)) {
          continue;
        }
        this.#options.store.addGrant({
          action: use.action,
          createdAt: this.#now(),
          id: randomUUID(),
          normalizedRequest: use.normalized,
          projectId: entry.context.projectId,
          role: entry.context.role,
          workspacePath: entry.context.workspacePath,
        });
      }
    }
    return this.#finish(
      entry,
      decision === "deny" ? "denied" : "approved",
      decision,
      null
    );
  }

  #finish(
    entry: Pending,
    status: PermissionRequest["status"],
    decision: PermissionDecision | null,
    reason: string | null
  ) {
    this.#pending.delete(entry.request.id);
    const request: PermissionRequest = {
      ...entry.request,
      decidedAt: this.#now(),
      decision,
      reason,
      status,
    };
    this.#options.store.saveRequest(request);
    entry.resolve(status === "approved" ? decision : null);
    return request;
  }

  /** Pause: settle every waiter for the mission as cancelled. */
  cancelMission(missionId: string) {
    for (const entry of this.#pending.values()) {
      if (entry.request.missionId === missionId) {
        this.#finish(entry, "cancelled", null, "Mission paused");
      }
    }
    for (const [key, controller] of this.#aborts) {
      if (key.startsWith(`${missionId}:`)) {
        controller.abort();
      }
    }
  }
}
