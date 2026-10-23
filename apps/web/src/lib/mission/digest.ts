import type {
  Agent,
  Artifact,
  Assignment,
  Mission,
  PermissionRequest,
  PlanRevision,
  Question,
  Todo,
} from "@missions/protocol/missions";

import { isMissionActive } from "../format";

export type DigestIcon = "done" | "file" | "pr" | "working";

export type DigestNeed =
  | { at: string; id: string; kind: "permission"; request: PermissionRequest }
  | { at: string; id: string; kind: "plan"; plan: PlanRevision }
  | { at: string; id: string; kind: "question"; question: Question };

export interface DigestItem {
  at: string;
  detail: string;
  icon: DigestIcon;
  id: string;
  title: string;
}

export interface Digest {
  inProgress: DigestItem[];
  needsYou: DigestNeed[];
  recent: DigestItem[];
}

export interface DigestInput {
  agents: Readonly<Record<string, Agent>>;
  artifacts: Readonly<Record<string, Artifact>>;
  assignments: Readonly<Record<string, Assignment>>;
  labels: Readonly<Record<string, string>>;
  mission: Mission;
  permissions: Readonly<Record<string, PermissionRequest>>;
  plans: Readonly<Record<string, PlanRevision>>;
  questions: Readonly<Record<string, Question>>;
  todos: Readonly<Record<string, readonly Todo[]>>;
}

const MAX_RECENT = 8;

const newestFirst = <T extends { at: string }>(items: T[]) =>
  items.toSorted((a, b) => b.at.localeCompare(a.at));

const latestPlan = (plans: Readonly<Record<string, PlanRevision>>) =>
  Object.values(plans).toSorted((a, b) => b.revision - a.revision)[0];

const needsOf = (input: DigestInput): DigestNeed[] => {
  const needs: DigestNeed[] = [];
  for (const request of Object.values(input.permissions)) {
    if (request.status === "pending") {
      needs.push({
        at: request.createdAt,
        id: `permission:${request.id}`,
        kind: "permission",
        request,
      });
    }
  }
  for (const question of Object.values(input.questions)) {
    if (question.status === "pending") {
      needs.push({
        at: question.createdAt,
        id: `question:${question.id}`,
        kind: "question",
        question,
      });
    }
  }
  const plan = latestPlan(input.plans);
  const planning = Object.values(input.agents).some(
    (agent) =>
      agent.role === "orchestrator" &&
      (agent.status === "working" || agent.status === "starting")
  );
  if (plan && input.mission.status === "awaiting_approval" && !planning) {
    needs.push({
      at: plan.createdAt,
      id: `plan:${plan.id}`,
      kind: "plan",
      plan,
    });
  }
  return newestFirst(needs);
};

const workerName = (input: DigestInput, agentId: string | null) => {
  if (!agentId) {
    return "Worker";
  }
  return input.labels[agentId] ?? "Worker";
};

const recentOf = (input: DigestInput): DigestItem[] => {
  const items: DigestItem[] = [];
  for (const assignment of Object.values(input.assignments)) {
    if (assignment.status === "handed_off") {
      items.push({
        at: assignment.updatedAt,
        detail:
          assignment.handoff?.summary ??
          workerName(input, assignment.workerAgentId),
        icon: "done",
        id: `assignment:${assignment.id}`,
        title: assignment.title,
      });
    }
  }
  const { pr } = input.mission.publish;
  if (pr) {
    items.push({
      at: pr.updatedAt,
      detail: input.mission.title,
      icon: "pr",
      id: `pr:${pr.number}`,
      title:
        pr.state === "merged" ? `Merged #${pr.number}` : `Opened #${pr.number}`,
    });
  }
  for (const artifact of Object.values(input.artifacts)) {
    items.push({
      at: artifact.createdAt,
      detail: artifact.agentId
        ? workerName(input, artifact.agentId)
        : "Orchestrator",
      icon: "file",
      id: `artifact:${artifact.id}`,
      title: `Added ${artifact.name}`,
    });
  }
  return newestFirst(items).slice(0, MAX_RECENT);
};

const inProgressOf = (input: DigestInput): DigestItem[] => {
  const items: DigestItem[] = [];
  // Agents leave todos in progress when a mission ends; nothing runs after that.
  if (!isMissionActive(input.mission.status)) {
    return items;
  }
  for (const assignment of Object.values(input.assignments)) {
    if (assignment.status !== "running") {
      continue;
    }
    const agent = assignment.workerAgentId
      ? input.agents[assignment.workerAgentId]
      : undefined;
    const name = workerName(input, assignment.workerAgentId);
    items.push({
      at: assignment.createdAt,
      detail: agent?.workingState ? `${name} · ${agent.workingState}` : name,
      icon: "working",
      id: `assignment:${assignment.id}`,
      title: assignment.title,
    });
  }
  if (items.length === 0) {
    for (const todo of Object.values(input.todos).flat()) {
      if (todo.status === "in_progress") {
        items.push({
          at: input.mission.updatedAt,
          detail: todo.agentId ? workerName(input, todo.agentId) : "Mission",
          icon: "working",
          id: `todo:${todo.id}`,
          title: todo.content,
        });
      }
    }
  }
  return items;
};

/** Paper GDH digest: what waits on you, what just landed, what is running. */
export const buildDigest = (input: DigestInput): Digest => ({
  inProgress: inProgressOf(input),
  needsYou: needsOf(input),
  recent: recentOf(input),
});
