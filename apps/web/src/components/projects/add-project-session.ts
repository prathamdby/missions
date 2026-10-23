import type {
  AddLocalProjectRequest,
  AddLocalProjectResponse,
  CloneJob,
  CloneProjectRequest,
  CloneSource,
  Project,
} from "@missions/protocol/projects";

import { operationIntentKey } from "../../lib/api/operation-intents";
import type { OperationIntents } from "../../lib/api/operation-intents";
import { DEFAULT_CLONE_PARENT, repoNameOf } from "./clone-target";

export type StartStep = "browse" | "github" | "url";
export type AddedVia = "clone" | "local";
export type AddProjectStep =
  | { kind: StartStep }
  | { kind: "pick_parent"; from: "github" | "url"; repoName: string }
  | { kind: "cloning"; jobId: string; source: CloneSource };

export interface GithubDraft {
  chosen: string | null;
  owner: string;
  search: string;
}

interface SessionState {
  cloneParent: string;
  error: unknown;
  generation: number;
  github: GithubDraft;
  jobStatus: CloneJob["status"] | null;
  notGitPath: string | null;
  open: boolean;
  pending: boolean;
  step: AddProjectStep;
  url: string;
}

interface Dependencies {
  add: (request: AddLocalProjectRequest) => Promise<AddLocalProjectResponse>;
  clone: (request: CloneProjectRequest) => Promise<CloneJob>;
  intents: OperationIntents;
  onAdded?: (project: Project, via: AddedVia) => void;
  rememberJob: (job: CloneJob) => void;
  rememberProject: (project: Project) => void;
}

const initial = (
  generation: number,
  start: StartStep,
  open: boolean
): SessionState => ({
  cloneParent: DEFAULT_CLONE_PARENT,
  error: null,
  generation,
  github: { chosen: null, owner: "", search: "" },
  jobStatus: null,
  notGitPath: null,
  open,
  pending: false,
  step: { kind: start },
  url: "",
});

/** Owns admission, immutable retries and completion, independently of dialog mounts. */
export class AddProjectSession {
  private state = initial(0, "browse", false);
  private readonly listeners = new Set<() => void>();
  private completed = false;
  private cloneRequest: {
    destinationParent: string;
    source: CloneSource;
  } | null = null;

  private readonly dependencies: Dependencies;
  private onAdded: Dependencies["onAdded"];

  constructor(dependencies: Dependencies) {
    this.dependencies = dependencies;
    this.onAdded = dependencies.onAdded;
  }

  setOnAdded = (onAdded: NonNullable<Dependencies["onAdded"]>) => {
    this.onAdded = onAdded;
  };

  getSnapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }

  open = (start: StartStep = "browse") => {
    this.completed = false;
    this.cloneRequest = null;
    this.update(initial(this.state.generation + 1, start, true));
  };

  close = () => {
    this.update({
      generation: this.state.generation + 1,
      open: false,
      pending: false,
    });
  };

  chooseUrl = () => {
    if (
      !this.state.open ||
      this.state.pending ||
      this.state.step.kind !== "github"
    ) {
      return;
    }
    this.update({ error: null, step: { kind: "url" } });
  };

  pickParent = () => {
    const { step, github, url } = this.state;
    if (
      !this.state.open ||
      this.state.pending ||
      (step.kind !== "github" && step.kind !== "url")
    ) {
      return;
    }
    const source: CloneSource =
      step.kind === "github"
        ? { kind: "github", repo: github.chosen ?? "" }
        : { kind: "url", url: url.trim() };
    const selected = source.kind === "github" ? source.repo : source.url;
    const repoName = selected ? repoNameOf(source) : "the repository";
    this.update({
      error: null,
      step: { from: step.kind, kind: "pick_parent", repoName },
    });
  };

  back = () => {
    const { step, jobStatus } = this.state;
    if (!this.state.open || this.state.pending) {
      return;
    }
    if (step.kind === "pick_parent") {
      this.update({ error: null, step: { kind: step.from } });
    } else if (step.kind === "cloning" && jobStatus === "failed") {
      this.update({
        error: null,
        step: { kind: step.source.kind === "github" ? "github" : "url" },
      });
    }
  };

  setUrl = (url: string) => this.update({ url });
  setGithub = (github: GithubDraft) => this.update({ github });

  chooseParent = (cloneParent: string) => {
    if (
      !this.state.open ||
      this.state.pending ||
      this.state.step.kind !== "pick_parent"
    ) {
      return;
    }
    this.update({ cloneParent, step: { kind: this.state.step.from } });
  };

  private current(generation: number) {
    return (
      this.state.open && generation === this.state.generation && !this.completed
    );
  }

  private complete(project: Project, via: AddedVia) {
    this.completed = true;
    this.update({ open: false, pending: false });
    this.onAdded?.(project, via);
  }

  add = async (path: string, initializeGit: boolean) => {
    if (
      !this.state.open ||
      this.state.pending ||
      this.state.step.kind !== "browse"
    ) {
      return;
    }
    const { generation } = this.state;
    const payload = { initializeGit, path };
    const key = operationIntentKey("add-project", generation, payload);
    const request = {
      ...payload,
      operationId: this.dependencies.intents.idFor(key),
    };
    this.update({ error: null, pending: true });
    try {
      const response = await this.dependencies.add(request);
      this.dependencies.intents.settle(key);
      if (response.status === "added") {
        this.dependencies.rememberProject(response.project);
      }
      if (!this.current(generation)) {
        return;
      }
      if (response.status === "not_git") {
        this.update({ notGitPath: response.path, pending: false });
      } else {
        this.complete(response.project, "local");
      }
    } catch (error) {
      this.dependencies.intents.release(error, key);
      if (this.current(generation)) {
        this.update({ error, pending: false });
      }
    }
  };

  clone = async (source?: CloneSource) => {
    const { step } = this.state;
    if (
      !this.state.open ||
      this.state.pending ||
      !["github", "url", "cloning"].includes(step.kind)
    ) {
      return;
    }
    if (
      step.kind === "cloning" &&
      (source || this.state.jobStatus !== "failed")
    ) {
      return;
    }
    // Retry the captured destination, never the current presentation draft.
    const payload = source
      ? { destinationParent: this.state.cloneParent, source: { ...source } }
      : this.cloneRequest;
    if (!payload) {
      return;
    }
    this.cloneRequest = payload;
    const { generation } = this.state;
    const key = operationIntentKey("clone-project", generation, payload);
    const request = {
      ...payload,
      operationId: this.dependencies.intents.idFor(key),
    };
    this.update({ error: null, pending: true });
    try {
      const job = await this.dependencies.clone(request);
      this.dependencies.intents.settle(key);
      this.dependencies.rememberJob(job);
      if (this.current(generation)) {
        this.update({
          jobStatus: job.status,
          pending: false,
          step: { jobId: job.id, kind: "cloning", source: job.source },
        });
      }
    } catch (error) {
      this.dependencies.intents.release(error, key);
      if (this.current(generation)) {
        this.update({ error, pending: false });
      }
    }
  };

  observeClone = (job: CloneJob | undefined, projects: readonly Project[]) => {
    if (
      !this.state.open ||
      this.completed ||
      this.state.step.kind !== "cloning" ||
      job?.id !== this.state.step.jobId
    ) {
      return;
    }
    if (job.status !== this.state.jobStatus) {
      this.update({ jobStatus: job.status });
    }
    if (job.status !== "succeeded") {
      return;
    }
    const project = projects.find((entry) => entry.id === job.projectId);
    if (project) {
      this.complete(project, "clone");
    }
  };
}
