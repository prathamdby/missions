import type {
  Agent,
  Artifact,
  Assignment,
  Grant,
  Mission,
  Operation,
  PermissionRequest,
  PlanRevision,
  QueueItem,
  Question,
  Todo,
  TranscriptItem,
} from "@missions/protocol/missions";
import type { Project, CloneJob } from "@missions/protocol/projects";
import { and, desc, eq, inArray, like, lt, max } from "drizzle-orm";

import type { DatabaseHandle, Db } from "./database";
import {
  normalizeAgent,
  normalizeMission,
  normalizePlan,
  normalizeQueueItem,
  normalizeTranscriptItem,
} from "./normalize";
import {
  agents,
  artifacts,
  assignments,
  cloneJobs,
  grants,
  missions,
  operations,
  permissions,
  plans,
  projects,
  queueItems,
  questions,
  settings,
  todos,
  transcript,
} from "./schema";

type MissionDocTable = typeof plans;

const toMission = normalizeMission;

interface MissionDoc {
  id: string;
  missionId: string;
}

const missionRepo = <T extends MissionDoc>(
  db: Db,
  table: MissionDocTable,
  statusOf: (doc: T) => string,
  updatedOf: (doc: T) => string,
  normalize: (data: unknown) => T = (data) => data as T
) => ({
  delete: (id: string) => {
    db.delete(table).where(eq(table.id, id)).run();
  },
  get: (id: string): T | null => {
    const row = db.select().from(table).where(eq(table.id, id)).get();
    return row ? normalize(row.data) : null;
  },
  list: (missionId: string, statuses?: readonly string[]): T[] => {
    const where = statuses
      ? and(
          eq(table.missionId, missionId),
          inArray(table.status, [...statuses])
        )
      : eq(table.missionId, missionId);
    return db
      .select()
      .from(table)
      .where(where)
      .all()
      .map((row) => normalize(row.data));
  },
  listByStatus: (statuses: readonly string[]): T[] =>
    db
      .select()
      .from(table)
      .where(inArray(table.status, [...statuses]))
      .all()
      .map((row) => normalize(row.data)),
  put: (doc: T) => {
    const values = {
      data: doc,
      id: doc.id,
      missionId: doc.missionId,
      status: statusOf(doc),
      updatedAt: updatedOf(doc),
    };
    db.insert(table)
      .values(values)
      .onConflictDoUpdate({ set: values, target: table.id })
      .run();
    return doc;
  },
});

/** Typed persistence for every daemon entity. Callers own transactions. */
export class Store {
  readonly handle: DatabaseHandle;
  readonly db: Db;
  readonly plans;
  readonly todos;
  readonly assignments;
  readonly questions;
  readonly permissions;
  readonly queue;
  readonly artifacts;

  constructor(handle: DatabaseHandle) {
    this.handle = handle;
    this.db = handle.db;
    const { db } = this;
    this.plans = missionRepo<PlanRevision>(
      db,
      plans,
      (p) => p.status,
      (p) => p.decidedAt ?? p.createdAt,
      normalizePlan
    );
    this.todos = missionRepo<Todo>(
      db,
      todos,
      (t) => t.status,
      () => new Date().toISOString()
    );
    this.assignments = missionRepo<Assignment>(
      db,
      assignments,
      (a) => a.status,
      (a) => a.updatedAt
    );
    this.questions = missionRepo<Question>(
      db,
      questions,
      (q) => q.status,
      (q) => q.createdAt
    );
    this.permissions = missionRepo<PermissionRequest>(
      db,
      permissions,
      (p) => p.status,
      (p) => p.decidedAt ?? p.createdAt
    );
    this.queue = missionRepo<QueueItem>(
      db,
      queueItems,
      (q) => q.state,
      (q) => q.updatedAt,
      normalizeQueueItem
    );
    this.artifacts = missionRepo<Artifact>(
      db,
      artifacts,
      () => "ready",
      (a) => a.createdAt
    );
  }

  /** better-sqlite3 nests inner transactions as savepoints. */
  transaction<T>(fn: () => T): T {
    return this.handle.sqlite.transaction(fn)();
  }

  putProject(project: Project) {
    const values = {
      createdAt: project.createdAt,
      data: project,
      id: project.id,
      path: project.path,
    };
    this.db
      .insert(projects)
      .values(values)
      .onConflictDoUpdate({ set: values, target: projects.id })
      .run();
    return project;
  }

  getProject(id: string): Project | null {
    const row = this.db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .get();
    return row ? (row.data as Project) : null;
  }

  projectByPath(projectPath: string): Project | null {
    const row = this.db
      .select()
      .from(projects)
      .where(eq(projects.path, projectPath))
      .get();
    return row ? (row.data as Project) : null;
  }

  listProjects(): Project[] {
    return this.db
      .select()
      .from(projects)
      .orderBy(projects.createdAt)
      .all()
      .map((row) => row.data as Project);
  }

  deleteProject(id: string) {
    this.db.delete(projects).where(eq(projects.id, id)).run();
  }

  putCloneJob(job: CloneJob) {
    const values = {
      createdAt: job.createdAt,
      data: job,
      id: job.id,
      status: job.status,
    };
    this.db
      .insert(cloneJobs)
      .values(values)
      .onConflictDoUpdate({ set: values, target: cloneJobs.id })
      .run();
    return job;
  }

  getCloneJob(id: string): CloneJob | null {
    const row = this.db
      .select()
      .from(cloneJobs)
      .where(eq(cloneJobs.id, id))
      .get();
    return row ? (row.data as CloneJob) : null;
  }

  listCloneJobs(status: CloneJob["status"]): CloneJob[] {
    return this.db
      .select()
      .from(cloneJobs)
      .where(eq(cloneJobs.status, status))
      .all()
      .map((row) => row.data as CloneJob);
  }

  putMission(mission: Mission) {
    const values = {
      data: mission,
      id: mission.id,
      projectId: mission.projectId,
      status: mission.status,
      updatedAt: mission.updatedAt,
    };
    this.db
      .insert(missions)
      .values(values)
      .onConflictDoUpdate({ set: values, target: missions.id })
      .run();
    return mission;
  }

  getMission(id: string): Mission | null {
    const row = this.db
      .select()
      .from(missions)
      .where(eq(missions.id, id))
      .get();
    return row ? toMission(row.data) : null;
  }

  listMissions(projectId?: string): Mission[] {
    const query = this.db.select().from(missions);
    const rows = projectId
      ? query.where(eq(missions.projectId, projectId))
      : query;
    return rows
      .orderBy(desc(missions.updatedAt))
      .all()
      .map((row) => toMission(row.data));
  }

  listMissionsByStatus(statuses: readonly Mission["status"][]): Mission[] {
    return this.db
      .select()
      .from(missions)
      .where(inArray(missions.status, [...statuses]))
      .all()
      .map((row) => toMission(row.data));
  }

  putAgent(agent: Agent) {
    const values = {
      data: agent,
      id: agent.id,
      missionId: agent.missionId,
      promptVersion: agent.promptVersion,
      sessionGeneration: agent.sessionGeneration,
      status: agent.status,
    };
    this.db
      .insert(agents)
      .values(values)
      .onConflictDoUpdate({ set: values, target: agents.id })
      .run();
    return agent;
  }

  getAgent(id: string): Agent | null {
    const row = this.db.select().from(agents).where(eq(agents.id, id)).get();
    return row ? normalizeAgent(row.data) : null;
  }

  listAgents(missionId: string): Agent[] {
    return this.db
      .select()
      .from(agents)
      .where(eq(agents.missionId, missionId))
      .all()
      .map((row) => normalizeAgent(row.data))
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  putGrant(grant: Grant) {
    this.db
      .insert(grants)
      .values({ data: grant, id: grant.id, projectId: grant.projectId })
      .onConflictDoNothing()
      .run();
    return grant;
  }

  listGrants(): Grant[] {
    return this.db
      .select()
      .from(grants)
      .all()
      .map((row) => row.data as Grant);
  }

  deleteGrant(id: string) {
    return this.db.delete(grants).where(eq(grants.id, id)).run().changes > 0;
  }

  putOperation(operation: Operation, result: unknown = null) {
    const values = {
      data: operation,
      id: operation.id,
      kind: operation.kind,
      missionId: operation.missionId,
      result,
      status: operation.status,
    };
    this.db
      .insert(operations)
      .values(values)
      .onConflictDoUpdate({ set: values, target: operations.id })
      .run();
    return operation;
  }

  getOperation(id: string): { operation: Operation; result: unknown } | null {
    const row = this.db
      .select()
      .from(operations)
      .where(eq(operations.id, id))
      .get();
    return row
      ? { operation: row.data as Operation, result: row.result }
      : null;
  }

  listOperations(statuses: readonly Operation["status"][]): Operation[] {
    return this.db
      .select()
      .from(operations)
      .where(inArray(operations.status, [...statuses]))
      .all()
      .map((row) => row.data as Operation);
  }

  /** Assigns the next per-mission transcript sequence. */
  appendTranscript(item: Omit<TranscriptItem, "seq">): TranscriptItem {
    const [last] = this.db
      .select({ value: max(transcript.seq) })
      .from(transcript)
      .where(eq(transcript.missionId, item.missionId))
      .all();
    const full: TranscriptItem = { ...item, seq: (last?.value ?? 0) + 1 };
    this.db
      .insert(transcript)
      .values({
        data: full,
        id: full.id,
        missionId: full.missionId,
        seq: full.seq,
      })
      .onConflictDoUpdate({
        set: { data: full },
        target: transcript.id,
      })
      .run();
    return full;
  }

  getTranscriptItem(id: string): TranscriptItem | null {
    const row = this.db
      .select()
      .from(transcript)
      .where(eq(transcript.id, id))
      .get();
    return row ? normalizeTranscriptItem(row.data) : null;
  }

  /** Newest-first page, returned in ascending order. */
  transcriptPage(missionId: string, before: number | null, limit: number) {
    const where =
      before === null
        ? eq(transcript.missionId, missionId)
        : and(eq(transcript.missionId, missionId), lt(transcript.seq, before));
    const rows = this.db
      .select()
      .from(transcript)
      .where(where)
      .orderBy(desc(transcript.seq))
      .limit(limit + 1)
      .all();
    const hasMore = rows.length > limit;
    const items = rows
      .slice(0, limit)
      .map((row) => normalizeTranscriptItem(row.data))
      .toReversed();
    return { hasMore, items };
  }

  getSetting<T>(key: string): T | null {
    const row = this.db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .get();
    return row ? (row.data as T) : null;
  }

  putSetting(key: string, value: unknown) {
    this.db
      .insert(settings)
      .values({ data: value, key })
      .onConflictDoUpdate({ set: { data: value }, target: settings.key })
      .run();
  }

  settingsWithPrefix<T>(prefix: string): { key: string; value: T }[] {
    return this.db
      .select()
      .from(settings)
      .where(like(settings.key, `${prefix}%`))
      .all()
      .map((row) => ({ key: row.key, value: row.data as T }));
  }

  deleteSetting(key: string) {
    this.db.delete(settings).where(eq(settings.key, key)).run();
  }
}
