"use client";

import type { Project } from "@missions/protocol/projects";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  createContext,
  use,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";

import { AddProjectDialog } from "@/components/projects/add-project-dialog";
import { useHomeDir } from "@/components/projects/use-home-dir";
import { api } from "@/lib/api/endpoints";
import { OperationIntents } from "@/lib/api/operation-intents";
import { useCloneJob, useProjects } from "@/lib/api/queries";
import { queryKeys } from "@/lib/api/query-keys";
import { tildePath } from "@/lib/format";
import { upsertById } from "@/lib/live/global-cache";
import { toast } from "@/lib/toast-store";

import { AddProjectSession } from "./add-project-session";
import type { StartStep } from "./add-project-session";

interface AddProjectState {
  /** Most recently added project, so the new-mission form can select it. */
  lastAdded: Project | null;
  openAddProject: (start?: StartStep) => void;
}

const AddProjectContext = createContext<AddProjectState>({
  lastAdded: null,
  openAddProject: () => null,
});

export const AddProjectProvider = ({ children }: { children: ReactNode }) => {
  const router = useRouter();
  const home = useHomeDir();
  const client = useQueryClient();
  const [lastAdded, setLastAdded] = useState<Project | null>(null);
  const session = useMemo(
    () =>
      new AddProjectSession({
        add: api.addProject,
        clone: api.clone,
        intents: new OperationIntents(),
        rememberJob: (job) =>
          client.setQueryData(queryKeys.cloneJob(job.id), job),
        rememberProject: (project) =>
          client.setQueryData<Project[]>(queryKeys.projects, (list) =>
            upsertById(list, project)
          ),
      }),
    [client]
  );
  useEffect(() => {
    session.setOnAdded((project, via) => {
      setLastAdded(project);
      const where = tildePath(project.path, home);
      toast({
        action: { href: "/settings", label: "Settings" },
        description:
          via === "clone"
            ? `Cloned to ${where}.`
            : `${where} is ready for missions.`,
        title: `Added ${project.name}`,
        tone: "success",
      });
      router.push("/");
    });
  }, [home, router, session]);
  useEffect(() => () => session.close(), [session]);
  const state = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot
  );
  const job = useCloneJob(
    state.open && state.step.kind === "cloning" ? state.step.jobId : null
  );
  const projects = useProjects();
  useEffect(() => {
    session.observeClone(job.data, projects.data ?? []);
    if (
      state.open &&
      state.step.kind === "cloning" &&
      job.data?.id === state.step.jobId &&
      job.data.status === "succeeded" &&
      !projects.data?.some((project) => project.id === job.data?.projectId)
    ) {
      client.invalidateQueries({ queryKey: queryKeys.projects });
    }
  }, [client, job.data, projects.data, session, state.open, state.step]);
  const openAddProject = session.open;

  const value = useMemo(
    () => ({ lastAdded, openAddProject }),
    [lastAdded, openAddProject]
  );

  return (
    <AddProjectContext value={value}>
      {children}
      <AddProjectDialog
        key={state.generation}
        session={session}
        state={state}
      />
    </AddProjectContext>
  );
};

export const useAddProject = () => use(AddProjectContext);
