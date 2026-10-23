"use client";

import type { Project } from "@missions/protocol/projects";
import { useRouter } from "next/navigation";
import { createContext, use, useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { AddProjectDialog } from "@/components/projects/add-project-dialog";
import type {
  AddProjectStep,
  AddedVia,
} from "@/components/projects/add-project-dialog";
import { useHomeDir } from "@/components/projects/use-home-dir";
import { tildePath } from "@/lib/format";
import { toast } from "@/lib/toast-store";

type StartStep = "browse" | "github" | "url";

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
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<AddProjectStep>({ kind: "browse" });
  const [lastAdded, setLastAdded] = useState<Project | null>(null);

  const openAddProject = useCallback((start: StartStep = "browse") => {
    setStep({ kind: start });
    setOpen(true);
  }, []);

  /** OZS: close, select the project on the new-mission screen, and confirm. */
  const onAdded = useCallback(
    (project: Project, via: AddedVia) => {
      setLastAdded(project);
      setOpen(false);
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
    },
    [home, router]
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
        open={open}
        setStep={setStep}
        step={step}
      />
    </AddProjectContext>
  );
};

export const useAddProject = () => use(AddProjectContext);
