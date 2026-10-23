"use client";

import type { Project } from "@missions/protocol/projects";
import { useRouter } from "next/navigation";
import { createContext, use, useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { AddProjectDialog } from "@/components/projects/add-project-dialog";
import type { AddProjectStep } from "@/components/projects/add-project-dialog";

type StartStep = "browse" | "choose" | "github" | "url";

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
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<AddProjectStep>({ kind: "choose" });
  const [lastAdded, setLastAdded] = useState<Project | null>(null);

  const openAddProject = useCallback((start: StartStep = "choose") => {
    setStep({ kind: start });
    setOpen(true);
  }, []);

  const onAdded = useCallback((project: Project) => {
    setLastAdded(project);
    setStep({ kind: "added", project });
  }, []);

  const onStartMission = useCallback(
    (project: Project) => {
      setLastAdded(project);
      setOpen(false);
      router.push("/");
    },
    [router]
  );

  const value = useMemo(
    () => ({ lastAdded, openAddProject }),
    [lastAdded, openAddProject]
  );

  return (
    <AddProjectContext value={value}>
      {children}
      <AddProjectDialog
        onAdded={onAdded}
        onOpenChange={setOpen}
        onStartMission={onStartMission}
        open={open}
        setStep={setStep}
        step={step}
      />
    </AddProjectContext>
  );
};

export const useAddProject = () => use(AddProjectContext);
