"use client";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { errorMessage } from "@/lib/api/api-error";
import { useGithubAuth } from "@/lib/api/queries";

import type { AddProjectSession } from "./add-project-session";
import { CloneProgress } from "./clone-progress";
import { FolderBrowser } from "./folder-browser";
import { GithubPicker } from "./github-picker";
import { UrlClone } from "./url-clone";

interface AddProjectDialogProps {
  session: AddProjectSession;
  state: ReturnType<AddProjectSession["getSnapshot"]>;
}

export const AddProjectDialog = ({ session, state }: AddProjectDialogProps) => {
  const { cloneParent, error, github, notGitPath, open, pending, step, url } =
    state;
  const auth = useGithubAuth(
    open && (step.kind === "github" || step.kind === "cloning")
  );
  let size: "lg" | "md" | "prose" | "wide" = "prose";
  if (step.kind === "browse" || step.kind === "pick_parent") {
    size = "lg";
  } else if (step.kind === "github") {
    size = auth.data?.state === "signed_in" ? "wide" : "prose";
  } else if (step.kind === "url") {
    size = "md";
  }
  const message = error ? errorMessage(error) : null;

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          session.close();
        }
      }}
      open={open}
    >
      <DialogContent size={size}>
        {step.kind === "browse" ? (
          <FolderBrowser
            error={message}
            mode="add"
            notGitPath={notGitPath}
            onConfirm={(path, initializeGit) =>
              session.add(path, initializeGit)
            }
            pending={pending}
          />
        ) : null}
        {step.kind === "pick_parent" ? (
          <FolderBrowser
            error={null}
            mode="choose"
            onCancel={() => session.back()}
            onConfirm={(path) => session.chooseParent(path)}
            pending={false}
            repoName={step.repoName}
            startPath={cloneParent}
          />
        ) : null}
        {step.kind === "github" ? (
          <GithubPicker
            auth={auth}
            draft={github}
            error={message}
            onChangeDraft={(draft) => session.setGithub(draft)}
            onChangeParent={() => session.pickParent()}
            onClone={(repo) => session.clone({ kind: "github", repo })}
            onUseUrl={() => session.chooseUrl()}
            parent={cloneParent}
            pending={pending}
          />
        ) : null}
        {step.kind === "url" ? (
          <UrlClone
            error={message}
            onChangeParent={() => session.pickParent()}
            onClone={(remote) => session.clone({ kind: "url", url: remote })}
            onUrlChange={(remote) => session.setUrl(remote)}
            parent={cloneParent}
            pending={pending}
            url={url}
          />
        ) : null}
        {step.kind === "cloning" ? (
          <CloneProgress
            jobId={step.jobId}
            key={step.jobId}
            onBack={() => session.back()}
            onRetry={() => session.clone()}
            retryError={message}
            retrying={pending}
            source={step.source}
            user={auth.data?.user ?? null}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
