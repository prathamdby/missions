"use client";

import type {
  Mission,
  MissionStatus,
  MissionSummary,
} from "@missions/protocol/missions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent, ReactNode, RefObject } from "react";

import { reportMutationError } from "@/components/mission/report-error";
import { useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogSection,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontalIcon } from "@/components/ui/icons";
import { FieldHint, FieldLabel, Input } from "@/components/ui/input";
import { isApiError } from "@/lib/api/api-error";
import { api } from "@/lib/api/endpoints";
import { removeMission } from "@/lib/live/global-cache";
import { missionCapabilities } from "@/lib/mission/capabilities";
import { missionCommandsFor } from "@/lib/mission/command-registry";
import { toast } from "@/lib/toast-store";
import { cn } from "@/lib/utils";

const TITLE_LIMIT = 200;

type ControlKind = "archive" | "pause" | "resume";
type DialogKind = "delete" | "rename";

const CONTROL_ERRORS: Record<ControlKind, string> = {
  archive: "Could not archive",
  pause: "Could not pause",
  resume: "Could not resume",
};

/** Paused and interrupted missions continue; failed ones retry. */
const resumeLabel = (status: MissionStatus) =>
  status === "paused" || status === "interrupted" ? "Resume" : "Retry";

/**
 * The full mission carries the revision every mutation must send. Opening a
 * menu re-reads it, so actions act on what the user just reviewed; an open
 * dialog follows each later re-read, such as the refresh after a stale save.
 */
const useReviewedMission = (summary: MissionSummary) => {
  const detail = useQuery({
    enabled: false,
    queryFn: ({ signal }) => api.mission(summary.id, signal),
    queryKey: ["mission", summary.id, "controls"],
  });
  const review = async () => {
    const result = await detail.refetch();
    return result.isSuccess;
  };
  // Only the daemon answering not_found proves the mission is gone; a failed
  // read proves nothing.
  const confirmMissing = async () => {
    const result = await detail.refetch();
    return isApiError(result.error) && result.error.code === "not_found";
  };
  const ready = detail.isSuccess && !detail.isFetching;
  return {
    confirmMissing,
    latest: detail.data,
    mission: ready ? detail.data : undefined,
    review,
  };
};

const copyLink = async (href: string) => {
  try {
    await navigator.clipboard.writeText(
      new URL(href, window.location.origin).toString()
    );
    toast({ title: "Link copied", tone: "success" });
  } catch {
    toast({
      description: "The browser did not allow access to the clipboard.",
      title: "Could not copy the link",
      tone: "danger",
    });
  }
};

interface MenuParts {
  Item: typeof DropdownMenuItem | typeof ContextMenuItem;
  Separator: typeof DropdownMenuSeparator | typeof ContextMenuSeparator;
}

const DROPDOWN: MenuParts = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
};
const CONTEXT: MenuParts = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
};

interface ActionItemsProps {
  busy: boolean;
  href: string;
  mission: Mission | undefined;
  onControl: (kind: ControlKind, mission: Mission) => void;
  onDialog: (kind: DialogKind, mission: Mission) => void;
  onNewMission: () => void;
  parts: MenuParts;
  summary: MissionSummary;
}

const ActionItems = ({
  busy,
  href,
  mission,
  onControl,
  onDialog,
  onNewMission,
  parts: { Item, Separator },
  summary,
}: ActionItemsProps) => {
  const status = mission?.status ?? summary.status;
  const can = missionCapabilities(status);
  const blocked = mission === undefined || busy;
  const control = (kind: ControlKind) => () => {
    if (mission) {
      onControl(kind, mission);
    }
  };
  const dialog = (kind: DialogKind) => () => {
    if (mission) {
      onDialog(kind, mission);
    }
  };
  return (
    <>
      <Item asChild data-testid="mission-action-open-tab">
        <a href={href} rel="noopener noreferrer" target="_blank">
          Open in new tab
        </a>
      </Item>
      <Item
        data-testid="mission-action-copy-link"
        onSelect={() => {
          void copyLink(href);
        }}
      >
        Copy mission link
      </Item>
      <Separator />
      <Item
        data-testid="mission-action-rename"
        disabled={mission === undefined || !can.update}
        onSelect={dialog("rename")}
      >
        Rename…
      </Item>
      <Item data-testid="mission-action-new-mission" onSelect={onNewMission}>
        New mission in this project
      </Item>
      {can.pause || can.resume || can.archive ? <Separator /> : null}
      {can.pause ? (
        <Item
          data-testid="mission-action-pause"
          disabled={blocked}
          onSelect={control("pause")}
        >
          Pause
        </Item>
      ) : null}
      {can.resume ? (
        <Item
          data-testid="mission-action-resume"
          disabled={blocked}
          onSelect={control("resume")}
        >
          {resumeLabel(status)}
        </Item>
      ) : null}
      {can.archive ? (
        <Item
          data-testid="mission-action-archive"
          disabled={blocked}
          onSelect={control("archive")}
        >
          Archive
        </Item>
      ) : null}
      {can.delete ? (
        <>
          <Separator />
          <Item
            data-testid="mission-action-delete"
            disabled={blocked}
            onSelect={dialog("delete")}
            variant="danger"
          >
            Delete…
          </Item>
        </>
      ) : null}
    </>
  );
};

interface DialogProps {
  mission: Mission;
  onClose: () => void;
  returnFocus: RefObject<HTMLElement | null>;
  review: () => Promise<boolean>;
}

const restoreFocus =
  (target: RefObject<HTMLElement | null>) => (event: Event) => {
    event.preventDefault();
    target.current?.focus();
  };

const RenameDialog = ({
  mission,
  onClose,
  returnFocus,
  review,
}: DialogProps) => {
  const client = useQueryClient();
  const inputId = useId();
  const hintId = useId();
  const [title, setTitle] = useState(mission.title);
  const trimmed = title.trim();
  const tooLong = trimmed.length > TITLE_LIMIT;
  const rename = useMutation({
    mutationFn: (next: string) =>
      missionCommandsFor(client, mission.id).run("update", {
        expectedRevision: mission.revision,
        title: next,
      }),
    onError: (error) => reportMutationError(error, review, "Could not rename"),
    onSuccess: onClose,
  });
  const unchanged = trimmed === mission.title;
  const invalid = trimmed === "" || tooLong;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (invalid || rename.isPending) {
      return;
    }
    if (unchanged) {
      onClose();
      return;
    }
    rename.mutate(trimmed);
  };
  return (
    <DialogContent
      aria-describedby={undefined}
      data-testid="rename-mission-dialog"
      onCloseAutoFocus={restoreFocus(returnFocus)}
      size="sm"
    >
      <form onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>Rename mission</DialogTitle>
        </DialogHeader>
        <DialogSection divider={false} padding="field">
          <FieldLabel htmlFor={inputId} size="xs">
            Title
          </FieldLabel>
          <Input
            aria-describedby={tooLong ? hintId : undefined}
            aria-invalid={invalid || undefined}
            autoComplete="off"
            autoFocus
            data-testid="rename-mission-input"
            id={inputId}
            onChange={(event) => setTitle(event.target.value)}
            value={title}
          />
          {tooLong ? (
            <FieldHint id={hintId} tone="danger">
              Use {TITLE_LIMIT} characters or fewer.
            </FieldHint>
          ) : null}
        </DialogSection>
        <DialogFooter>
          <span className="flex-1" />
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button
            data-testid="rename-mission-save"
            disabled={invalid || rename.isPending}
            type="submit"
            variant="primary"
          >
            {rename.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
};

const DeleteDialog = ({
  confirmMissing,
  mission,
  onClose,
  returnFocus,
  review,
}: DialogProps & { confirmMissing: () => Promise<boolean> }) => {
  const client = useQueryClient();
  const remove = useMutation({
    mutationFn: () =>
      missionCommandsFor(client, mission.id).run("delete", {
        expectedRevision: mission.revision,
      }),
    onError: async (error) => {
      // An older daemon answers an unknown route with not_found too, so only
      // a confirmed missing mission counts as already deleted.
      if (isApiError(error) && error.code === "not_found") {
        const confirmedGone = await confirmMissing();
        if (confirmedGone) {
          removeMission(client, mission.id);
          onClose();
          return;
        }
      }
      await reportMutationError(error, review, "Could not delete");
    },
    onSuccess: () => {
      toast({
        description: "Its worktree, branch, and files are still on disk.",
        title: "Mission deleted",
        tone: "success",
      });
      onClose();
    },
  });
  return (
    <DialogContent
      data-testid="delete-mission-dialog"
      onCloseAutoFocus={restoreFocus(returnFocus)}
      size="sm"
    >
      <DialogHeader>
        <DialogTitle>Delete “{mission.title}”?</DialogTitle>
        <DialogDescription>
          Missions forgets its conversation, plans, and history. The worktree,
          branch, and every file it changed stay on disk, so nothing in your
          project is deleted.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <span className="flex-1" />
        <Button onClick={onClose} variant="ghost">
          Cancel
        </Button>
        <Button
          data-testid="delete-mission-confirm"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
          variant="danger-solid"
        >
          {remove.isPending ? "Deleting…" : "Delete mission"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
};

/**
 * Right-click menu on the row plus a More button with the same actions, so
 * touch and keyboard users never depend on right-click.
 */
export const MissionActions = ({
  children,
  href,
  summary,
  touch,
}: {
  children: ReactNode;
  href: string;
  summary: MissionSummary;
  touch: boolean;
}) => {
  const client = useQueryClient();
  const router = useRouter();
  const { preferProject } = useShell();
  const commands = missionCommandsFor(client, summary.id);
  const pending = useSyncExternalStore(
    commands.subscribe,
    commands.pendingControl,
    commands.pendingControl
  );
  const { confirmMissing, latest, mission, review } =
    useReviewedMission(summary);
  const [dialog, setDialog] = useState<{
    kind: DialogKind;
    mission: Mission;
  } | null>(null);
  const rowRef = useRef<HTMLElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  // Set synchronously on select: the menu's close handler runs before React
  // re-renders with the open dialog.
  const openingDialog = useRef(false);

  const control = useMutation({
    mutationFn: ({ kind, target }: { kind: ControlKind; target: Mission }) =>
      commands.run(kind, { expectedRevision: target.revision }),
    onError: (error, { kind }) =>
      reportMutationError(error, review, CONTROL_ERRORS[kind]),
  });

  const opened = (from: "more" | "row") => (open: boolean) => {
    if (open) {
      returnFocus.current = from === "row" ? rowRef.current : moreRef.current;
      void review();
    }
  };
  const items = (parts: MenuParts) => (
    <ActionItems
      busy={pending !== null}
      href={href}
      mission={mission}
      onControl={(kind, target) => control.mutate({ kind, target })}
      onDialog={(kind, target) => {
        openingDialog.current = true;
        setDialog({ kind, mission: target });
      }}
      onNewMission={() => {
        preferProject(summary.projectId);
        router.push("/");
      }}
      parts={parts}
      summary={summary}
    />
  );
  const keepFocusForDialog = (event: Event) => {
    if (openingDialog.current) {
      openingDialog.current = false;
      event.preventDefault();
    }
  };
  const close = () => setDialog(null);
  const dialogProps = dialog && {
    mission: latest ?? dialog.mission,
    onClose: close,
    returnFocus,
    review,
  };

  return (
    <div
      className={cn(
        "group/mission relative",
        touch && "flex items-center gap-xs"
      )}
    >
      <ContextMenu modal={false} onOpenChange={opened("row")}>
        <ContextMenuTrigger asChild ref={rowRef}>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent
          aria-label={`Actions for ${summary.title}`}
          onCloseAutoFocus={keepFocusForDialog}
        >
          {items(CONTEXT)}
        </ContextMenuContent>
      </ContextMenu>
      <DropdownMenu modal={false} onOpenChange={opened("more")}>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`More actions for ${summary.title}`}
            className={cn(
              "flex shrink-0 cursor-pointer items-center justify-center rounded-xs text-text-secondary outline-none hover:bg-surface-active hover:text-text focus-visible:shadow-focus data-[state=open]:bg-surface-active data-[state=open]:text-text",
              touch
                ? "size-10"
                : "absolute top-1/2 right-xs size-6 -translate-y-1/2 bg-surface-overlay opacity-0 group-focus-within/mission:opacity-100 group-hover/mission:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            )}
            data-testid="mission-actions-trigger"
            ref={moreRef}
            type="button"
          >
            <MoreHorizontalIcon size="sm" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onCloseAutoFocus={keepFocusForDialog}>
          {items(DROPDOWN)}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            close();
          }
        }}
        open={dialog !== null}
      >
        {dialogProps && dialog?.kind === "rename" ? (
          <RenameDialog {...dialogProps} />
        ) : null}
        {dialogProps && dialog?.kind === "delete" ? (
          <DeleteDialog confirmMissing={confirmMissing} {...dialogProps} />
        ) : null}
      </Dialog>
    </div>
  );
};
