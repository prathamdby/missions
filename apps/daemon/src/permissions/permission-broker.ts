import { randomUUID } from "node:crypto";
import path from "node:path";

import type { Role } from "@missions/protocol/common";
import type {
  Grant,
  PermissionDecision,
  PermissionRequest,
  ToolUseSummary,
} from "@missions/protocol/missions";

import { errorMessage } from "../lib/async";
import type {
  PermissionToolUse,
  PermissionVerdict,
} from "../runtime/contracts";
import { commandCategory, isHighImpactGit } from "./command-policy";
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
  epoch: number;
  /** Plan mode: every agent in the mission is read-only until approval. */
  planMode: boolean;
  fenced: boolean;
  /** Assignment capability. Omitted means writable for older callers. */
  canWrite?: boolean;
  /** Titles of other agents that may still write the shared checkout. */
  otherWriters?: string[];
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

export type AskResult = PermissionVerdict;

export const WRITE_LEASE_WAIT_TIMEOUT_MS = 30_000;

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
    const impact =
      category === "vcs" && isHighImpactGit(command)
        ? "high"
        : impactOf(details.impactLevel);
    return {
      action: "Execute",
      category,
      impact,
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

/** YOLO approval follows mandatory capability gates, never replaces them. */
export const autoApproves = (use: ClassifiedUse) => use.category !== "blocked";

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

/** Shared-checkout administration: publishing, branch changes, destructive Git. */
const isRepositoryAdmin = (use: ClassifiedUse) =>
  use.category === "publish" ||
  (use.category === "vcs" && use.impact === "high");

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
  if (context.planMode && uses.some(isWritable)) {
    return "Plan mode is read-only until the user approves the plan";
  }
  const vcs = uses.some(
    (use) => use.category === "vcs" || use.category === "publish"
  );
  if (context.role === "worker" && vcs) {
    return "Repository administration, including clone/init outside the checkout, belongs to the main agent. Ask the main agent to obtain the dependency repository; list required repository actions in your handoff.";
  }
  const writers = context.otherWriters ?? [];
  if (writers.length > 0 && uses.some(isRepositoryAdmin)) {
    return `Wait until ${writers.join(", ")} finish writing before branch changes, destructive Git or publishing`;
  }
  return null;
};

const pendingPermissions = (_missionId: string): PermissionRequest[] => [];

const decidePermission = (
  _requestId: string,
  _decision: PermissionDecision,
  _epoch: number
): PermissionRequest => {
  throw new StaleDecisionError("This approval is no longer pending");
};

/**
 * One policy point for SDK permission requests. Mandatory gates (Pause fence,
 * read-only assignments, Plan mode, repository coordination) run before
 * automatic approval and cannot be bypassed.
 */
export class PermissionBroker {
  readonly #options: PermissionBrokerOptions;
  readonly #aborts = new Map<string, AbortController>();

  constructor(options: PermissionBrokerOptions) {
    this.#options = options;
  }

  async ask(
    agentId: string,
    toolUses: PermissionToolUse[]
  ): Promise<AskResult> {
    const context = this.#options.context(agentId);
    if (!context) {
      return {
        approved: false,
        attribution: "lifecycle",
        reason: "Agent is not part of an active mission",
      };
    }
    const uses = flattenToolUses(toolUses).map((use) =>
      classifyToolUse(use, context.workspacePath, this.#options.roleToolServer)
    );
    const denied = mandatoryDenial(context, uses);
    if (denied) {
      return {
        approved: false,
        attribution: context.fenced ? "lifecycle" : "policy",
        reason: denied,
      };
    }
    const writable = uses.some(isWritable);
    if (writable) {
      const deniedLease = await this.#acquireLease(agentId, context);
      if (deniedLease) {
        return deniedLease;
      }
    }
    // Re-check the fence: Pause may have landed while we waited.
    const latest = this.#options.context(agentId);
    if (!latest || latest.fenced || latest.epoch !== context.epoch) {
      return {
        approved: false,
        attribution: "lifecycle",
        reason: "Mission is paused or its execution changed",
      };
    }
    const latestDenial = mandatoryDenial(latest, uses);
    if (latestDenial) {
      return { approved: false, attribution: "policy", reason: latestDenial };
    }
    return { approved: true, via: "policy" };
  }

  async #acquireLease(
    agentId: string,
    context: AgentContext
  ): Promise<Extract<AskResult, { approved: false }> | null> {
    const controller = new AbortController();
    const key = `${context.missionId}:${agentId}:${randomUUID()}`;
    this.#aborts.set(key, controller);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, WRITE_LEASE_WAIT_TIMEOUT_MS);
    try {
      await this.#options.acquireWriteLease(agentId, controller.signal);
      return null;
    } catch (error) {
      let reason = `Could not acquire the shared-checkout write lease: ${errorMessage(error)}`;
      if (controller.signal.aborted) {
        reason = "Mission is paused or its execution changed";
      }
      if (timedOut) {
        reason =
          "Shared-checkout write lease wait timed out after 30 seconds. Ask the main agent to coordinate the current writer, then retry when it finishes.";
      }
      return {
        approved: false,
        attribution:
          !timedOut && controller.signal.aborted ? "lifecycle" : "runtime",
        reason,
      };
    } finally {
      clearTimeout(timer);
      this.#aborts.delete(key);
    }
  }

  readonly pending = pendingPermissions;
  readonly decide = decidePermission;

  /** Pause: abort every lease waiter for the mission. */
  cancelMission(missionId: string) {
    for (const [key, controller] of this.#aborts) {
      if (key.startsWith(`${missionId}:`)) {
        controller.abort();
      }
    }
  }
}
