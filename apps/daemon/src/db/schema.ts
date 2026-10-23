import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * Entities are stored as their protocol JSON (`data`) plus the columns the
 * daemon filters or orders by. The JSON is the source of truth; indexed
 * columns are derived on every write.
 */
const doc = () => text("data", { mode: "json" }).notNull();

export const projects = sqliteTable("projects", {
  createdAt: text("created_at").notNull(),
  data: doc(),
  id: text("id").primaryKey(),
  path: text("path").notNull().unique(),
});

export const cloneJobs = sqliteTable("clone_jobs", {
  createdAt: text("created_at").notNull(),
  data: doc(),
  id: text("id").primaryKey(),
  status: text("status").notNull(),
});

export const missions = sqliteTable(
  "missions",
  {
    data: doc(),
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    status: text("status").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("missions_project_idx").on(t.projectId, t.updatedAt)]
);

export const agents = sqliteTable(
  "agents",
  {
    data: doc(),
    id: text("id").primaryKey(),
    missionId: text("mission_id").notNull(),
    /** Null marks a legacy native session whose system prompt predates v2. */
    promptVersion: text("prompt_version"),
    sessionGeneration: integer("session_generation").notNull().default(0),
    status: text("status").notNull(),
  },
  (t) => [index("agents_mission_idx").on(t.missionId, t.status)]
);

const missionDoc = (name: string) =>
  sqliteTable(
    name,
    {
      data: doc(),
      id: text("id").primaryKey(),
      missionId: text("mission_id").notNull(),
      status: text("status").notNull(),
      updatedAt: text("updated_at").notNull(),
    },
    (t) => [index(`${name}_mission_idx`).on(t.missionId, t.status)]
  );

export const plans = missionDoc("plans");
export const todos = missionDoc("todos");
export const assignments = missionDoc("assignments");
export const questions = missionDoc("questions");
export const permissions = missionDoc("permissions");
export const queueItems = missionDoc("queue_items");
export const artifacts = missionDoc("artifacts");

export const grants = sqliteTable("grants", {
  data: doc(),
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
});

export const operations = sqliteTable(
  "operations",
  {
    data: doc(),
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    missionId: text("mission_id"),
    result: text("result", { mode: "json" }),
    status: text("status").notNull(),
  },
  (t) => [index("operations_status_idx").on(t.status)]
);

export const transcript = sqliteTable(
  "transcript",
  {
    data: doc(),
    id: text("id").primaryKey(),
    missionId: text("mission_id").notNull(),
    seq: integer("seq").notNull(),
  },
  (t) => [index("transcript_mission_seq_idx").on(t.missionId, t.seq)]
);

/** One gap-free sequence per stream: a mission ID, or "" for global events. */
export const events = sqliteTable(
  "events",
  {
    at: text("at").notNull(),
    data: doc(),
    seq: integer("seq").notNull(),
    stream: text("stream").notNull(),
    type: text("type").notNull(),
  },
  (t) => [primaryKey({ columns: [t.stream, t.seq] })]
);

export const settings = sqliteTable("settings", {
  data: doc(),
  key: text("key").primaryKey(),
});
