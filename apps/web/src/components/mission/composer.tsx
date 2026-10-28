"use client";

import type { DeliveryMode } from "@missions/protocol/common";
import type { MissionStatus, QueueItem } from "@missions/protocol/missions";
import { useMutation } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";

import { AttachmentPreview } from "@/components/composer/attachment-chips";
import { ComposerField } from "@/components/composer/composer-field";
import {
  ArrowUpIcon,
  CheckIcon,
  CloseIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
} from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import type { TranscriptEdit } from "@/components/mission/mission-context";
import { QueueTray, useVisibleQueue } from "@/components/mission/queue-tray";
import { reportMutationError } from "@/components/mission/report-error";
import { useMissionControl } from "@/components/mission/use-mission-control";
import { useSendMessage } from "@/components/mission/use-send-message";
import { IconButton } from "@/components/ui/button";
import { EditIcon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { Hint } from "@/components/ui/tooltip";
import { errorMessage } from "@/lib/api/api-error";
import { canResume } from "@/lib/format";
import { missionCapabilities } from "@/lib/mission/capabilities";
import type { MissionCommandInputs } from "@/lib/mission/commands";
import { composerAction } from "@/lib/mission/composer-action";
import type { ComposerAction } from "@/lib/mission/composer-action";
import { modeStatus } from "@/lib/mission/execution-mode";
import { orchestratorTurnRunning } from "@/lib/mission/idle-send";
import { MessageDraft } from "@/lib/mission/message-draft";
import {
  latestEditable,
  queuedEditEnd,
  resolveQueuedEditExit,
} from "@/lib/mission/queued-edit";
import { toast } from "@/lib/toast-store";
import { cn } from "@/lib/utils";

const placeholderFor = (status: MissionStatus) => {
  if (status === "archived") {
    return "This mission is archived";
  }
  if (status === "completed") {
    return "Start a follow-up from this mission…";
  }
  if (canResume(status)) {
    return "Resume the mission to send a message…";
  }
  return "Reply to the orchestrator…";
};

const ACTION_BUTTON =
  "flex size-7 cursor-pointer items-center justify-center rounded-full bg-accent text-on-accent transition-colors duration-fast hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-overlay disabled:text-text-disabled aria-disabled:cursor-not-allowed aria-busy:bg-surface-overlay";

const actionPresentation = (action: ComposerAction, working: boolean) => {
  switch (action.kind) {
    case "pause": {
      return {
        hint: "Pause all agents",
        icon: <PauseIcon className="size-3.5" />,
        label: "Pause mission",
      };
    }
    case "resume": {
      return {
        hint:
          action.label === "Resume"
            ? "Resume the mission"
            : "Resume from last checkpoint",
        icon:
          action.label === "Resume" ? (
            <PlayIcon className="size-3.5" />
          ) : (
            <RepeatIcon className="size-3.5" />
          ),
        label: `${action.label} mission`,
      };
    }
    case "progress": {
      return {
        hint: action.label,
        icon: <Spinner label={action.label} pattern="wave" size="sm" />,
        label: action.label,
      };
    }
    default: {
      return {
        hint: working ? "Steer now" : "Send",
        icon: <ArrowUpIcon className="size-3.5" />,
        label: "Send message",
      };
    }
  }
};

/**
 * One button for the composer's current action: Send while there is text,
 * Pause while agents work and the draft is empty, Resume or Retry once
 * stopped. Only a click runs Pause or Resume; Enter only ever sends.
 */
const ComposerActionButton = ({
  onSend,
  hasDraft,
  ready,
}: {
  ready: boolean;
  onSend: () => void;
  hasDraft: boolean;
}) => {
  const { live } = useMission();
  const { status } = live.mission;
  const { control, pause, resume } = useMissionControl();
  const action = composerAction({
    agents: Object.values(live.agents),
    hasDraft,
    pending: control,
    status,
  });
  const capabilities = missionCapabilities(status);
  const { hint, icon, label } = actionPresentation(
    action,
    orchestratorTurnRunning(status, Object.values(live.agents))
  );
  const inert =
    action.kind === "progress" ||
    (action.kind === "send" && (!action.enabled || !ready));
  const run = () => {
    if (action.kind === "send") {
      onSend();
    } else if (action.kind === "pause") {
      pause();
    } else if (action.kind === "resume") {
      resume();
    }
  };
  return (
    <Hint label={hint}>
      <button
        aria-busy={action.kind === "progress" || undefined}
        aria-disabled={inert}
        aria-label={label}
        className={ACTION_BUTTON}
        data-action={action.kind}
        data-testid="composer-send"
        disabled={action.kind === "send" && !capabilities.message}
        onClick={inert ? undefined : run}
        type="button"
      >
        {icon}
      </button>
    </Hint>
  );
};

const EDIT_OUTCOME = {
  delete_unconfirmed: {
    description:
      "The original could not be confirmed removed, so the edit was not sent and the original may still be delivered. Your edit is still here.",
    title: "Edit not sent",
    tone: "warning",
  },
} as const;

interface EditSession {
  draft: MessageDraft;
  itemId: string;
  originalText: string;
}

/** Check-icon save action that replaces Pause/Resume/Send while editing. */
const EditSaveButton = ({
  draft,
  saving,
  onSave,
}: {
  draft: MessageDraft;
  saving: boolean;
  onSave: () => void;
}) => {
  const text = useSyncExternalStore(
    draft.subscribe,
    draft.snapshot,
    draft.snapshot
  );
  const ready = text.trim().length > 0 && draft.uploadsReady();
  return (
    <Hint label={saving ? "Updating queued message" : "Update queued message"}>
      <button
        aria-busy={saving || undefined}
        aria-disabled={!ready || saving}
        aria-label={
          saving ? "Updating queued message" : "Update queued message"
        }
        className={ACTION_BUTTON}
        data-testid="composer-save-edit"
        disabled={!ready || saving}
        onClick={onSave}
        type="button"
      >
        {saving ? (
          <Spinner label="Updating queued message" pattern="wave" size="sm" />
        ) : (
          <CheckIcon className="size-3.5" />
        )}
      </button>
    </Hint>
  );
};

interface RewindSession {
  draft: MessageDraft;
  itemId: string;
  originalText: string;
}

const rewindPreview = (text: string) =>
  text.includes("\n") ? (text.split("\n")[0] ?? text) : text;

const RewindSaveButton = ({
  draft,
  onSave,
  saving,
}: {
  draft: MessageDraft;
  onSave: () => void;
  saving: boolean;
}) => {
  const text = useSyncExternalStore(
    draft.subscribe,
    draft.snapshot,
    draft.snapshot
  );
  const ready = text.trim().length > 0;
  return (
    <Hint label={saving ? "Restarting from this message" : "Update message"}>
      <button
        aria-busy={saving || undefined}
        aria-disabled={!ready || saving}
        aria-label={saving ? "Restarting from this message" : "Update message"}
        className={cn(
          "flex size-7 items-center justify-center rounded-full transition-colors duration-fast",
          ready && !saving
            ? "cursor-pointer bg-accent text-on-accent hover:bg-accent-hover"
            : "cursor-not-allowed bg-surface-active text-text-disabled"
        )}
        data-testid="composer-rewind"
        disabled={!ready || saving}
        onClick={onSave}
        type="button"
      >
        {saving ? (
          <Spinner label="Restarting from this message" size="sm" />
        ) : (
          <CheckIcon className="size-3.5" />
        )}
      </button>
    </Hint>
  );
};

/** Attachments of the message being edited; Phase one keeps them read-only. */
const ExistingAttachments = ({
  missionId,
  item,
}: {
  missionId: string;
  item: QueueItem;
}) =>
  item.attachments.length ? (
    <ul
      aria-label="Message attachments"
      className="flex flex-wrap gap-control pt-xs pr-xs"
    >
      {item.attachments.map((attachment) => (
        <li className="flex max-w-full min-w-0" key={attachment.id}>
          <AttachmentPreview attachment={attachment} missionId={missionId} />
        </li>
      ))}
    </ul>
  ) : null;

const attachmentRow = (item: QueueItem | undefined, missionId: string) =>
  item && item.attachments.length > 0 ? (
    <ExistingAttachments item={item} missionId={missionId} />
  ) : null;

/** Old message stacked on the composer, matching the queue tray. */
const TranscriptEditTray = ({
  onDismiss,
  saving,
  text,
}: {
  onDismiss: () => void;
  saving: boolean;
  text: string;
}) => (
  <div className="-mb-hairline flex w-[calc(100%-var(--spacing-3xl))] flex-col rounded-t-lg rounded-b-none bg-surface px-card py-sm shadow-sm">
    <div className="flex items-start gap-md">
      <span className="mt-2xs text-text-tertiary">
        <EditIcon className="size-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2xs">
        <span className="text-xs leading-sm text-text-tertiary">
          Editing message
        </span>
        <p className="line-clamp-2 text-sm leading-sm text-text-secondary">
          {rewindPreview(text)}
        </p>
      </div>
      <IconButton
        disabled={saving}
        icon={<CloseIcon />}
        label="Stop editing"
        onClick={onDismiss}
        size="sm"
      />
    </div>
  </div>
);

/**
 * Paper composer. Enter steers (delivered after the current tool call);
 * Alt+Enter queues (delivered when the turn ends) while agents are working.
 * While a queued message is being edited the same field saves it instead.
 */
const releaseRewind = (ending: RewindSession, missionDraft: MessageDraft) => {
  const edited = ending.draft.snapshot();
  const outcome = resolveQueuedEditExit({
    editChanged: edited !== ending.originalText,
    missionDraftEmpty: missionDraft.isEmpty(),
  });
  if (outcome !== "kept") {
    return;
  }
  missionDraft.adopt(edited);
  toast({
    description: "It is back in the composer. Nothing was sent.",
    title: "Edit kept",
    tone: "info",
  });
};

const useTranscriptRewind = ({
  draft,
  finish,
  savingRef,
  sessionRef,
  setFocusRequest,
}: {
  draft: MessageDraft;
  finish: (ending: EditSession, reason?: "already_sent" | "saving") => void;
  savingRef: { current: boolean };
  sessionRef: { current: EditSession | null };
  setFocusRequest: (update: (request: number) => number) => void;
}) => {
  const {
    cancelTranscriptEdit,
    commands,
    live,
    setRewindSaving,
    setTranscriptEditError,
    transcriptEdit,
  } = useMission();
  const [rewind, setRewind] = useState<RewindSession | null>(null);
  const rewindRef = useRef<RewindSession | null>(null);
  const replaceRewind = useCallback((next: RewindSession | null) => {
    rewindRef.current = next;
    setRewind(next);
  }, []);
  const rewindCommand = useMutation({
    mutationFn: (input: MissionCommandInputs["rewind"]) =>
      commands.run("rewind", input),
  });
  const dismissRewind = useCallback(() => {
    if (rewindCommand.isPending) {
      return;
    }
    const ending = rewindRef.current;
    if (ending) {
      releaseRewind(ending, draft);
    }
    replaceRewind(null);
    cancelTranscriptEdit();
    setFocusRequest((request) => request + 1);
  }, [
    cancelTranscriptEdit,
    draft,
    replaceRewind,
    rewindCommand.isPending,
    setFocusRequest,
  ]);
  useEffect(() => {
    if (!transcriptEdit) {
      if (rewindRef.current) {
        replaceRewind(null);
      }
      return;
    }
    if (rewindRef.current?.itemId === transcriptEdit.itemId) {
      return;
    }
    if (rewindRef.current) {
      releaseRewind(rewindRef.current, draft);
    }
    if (sessionRef.current) {
      finish(sessionRef.current, savingRef.current ? "saving" : undefined);
    }
    const next = new MessageDraft();
    next.change(transcriptEdit.originalText);
    replaceRewind({
      draft: next,
      itemId: transcriptEdit.itemId,
      originalText: transcriptEdit.originalText,
    });
    setFocusRequest((request) => request + 1);
  }, [
    draft,
    finish,
    replaceRewind,
    savingRef,
    sessionRef,
    setFocusRequest,
    transcriptEdit,
  ]);
  const saveRewind = async () => {
    const active = rewindRef.current;
    if (!(active && transcriptEdit)) {
      return;
    }
    const { draft: activeDraft, itemId } = active;
    const nextText = activeDraft.snapshot().trim();
    if (!nextText) {
      return;
    }
    setRewindSaving(true);
    setTranscriptEditError(null);
    try {
      await rewindCommand.mutateAsync({
        expectedRevision: live.mission.revision,
        itemId,
        text: nextText,
      });
      if (rewindRef.current?.itemId === itemId) {
        replaceRewind(null);
        cancelTranscriptEdit();
        setFocusRequest((request) => request + 1);
      }
    } catch (error) {
      if (rewindRef.current?.itemId === itemId) {
        setTranscriptEditError(errorMessage(error));
      }
    }
    setRewindSaving(false);
  };
  return {
    dismissRewind,
    editingTranscript: transcriptEdit !== null && rewind !== null,
    rewind,
    rewindSaving: rewindCommand.isPending,
    saveRewind,
    transcriptEdit,
  };
};

const dockAction = ({
  attachments,
  draft,
  editingTranscript,
  onSaveEdit,
  onSaveRewind,
  onSteer,
  rewind,
  rewindSaving,
  saving,
  session,
  text,
}: {
  attachments: readonly unknown[];
  draft: MessageDraft;
  editingTranscript: boolean;
  onSaveEdit: () => void;
  onSaveRewind: () => void;
  onSteer: () => void;
  rewind: RewindSession | null;
  rewindSaving: boolean;
  saving: boolean;
  session: EditSession | null;
  text: string;
}): ReactNode => {
  if (editingTranscript && rewind) {
    return (
      <RewindSaveButton
        draft={rewind.draft}
        onSave={onSaveRewind}
        saving={rewindSaving}
      />
    );
  }
  if (session) {
    return (
      <EditSaveButton
        draft={session.draft}
        onSave={onSaveEdit}
        saving={saving}
      />
    );
  }
  return (
    <ComposerActionButton
      hasDraft={text.trim().length > 0 || attachments.length > 0}
      onSend={onSteer}
      ready={draft.uploadsReady()}
    />
  );
};

const composerLabel = (
  editingTranscript: boolean,
  session: EditSession | null
) => {
  if (editingTranscript) {
    return "Editing message";
  }
  if (session) {
    return "Edit queued message";
  }
  return "Message the Orchestrator";
};

const ComposerDock = ({
  attachments,
  beginEdit,
  beginLatest,
  cancelEdit,
  dismissRewind,
  draft,
  editing,
  editingItem,
  editingTranscript,
  focusRequest,
  missionId,
  missionStatus,
  onSaveEdit,
  onSaveRewind,
  onSubmit,
  rewind,
  rewindSaving,
  saving,
  sentItem,
  session,
  status,
  text,
  transcriptEdit,
  working,
}: {
  attachments: readonly unknown[];
  beginEdit: (item: QueueItem) => void;
  beginLatest: () => boolean;
  cancelEdit: () => void;
  dismissRewind: () => void;
  draft: MessageDraft;
  editing: boolean;
  editingItem: QueueItem | undefined;
  editingTranscript: boolean;
  focusRequest: number;
  missionId: string;
  missionStatus: MissionStatus;
  onSaveEdit: () => void;
  onSaveRewind: () => void;
  onSubmit: (mode: DeliveryMode) => void;
  rewind: RewindSession | null;
  rewindSaving: boolean;
  saving: boolean;
  sentItem: QueueItem | undefined;
  session: EditSession | null;
  status: string | null;
  text: string;
  transcriptEdit: TranscriptEdit | null;
  working: boolean;
}) => (
  <div
    className={cn(
      "flex w-full max-w-chat flex-col",
      editingTranscript ? "items-center gap-0" : "gap-sm"
    )}
  >
    {editingTranscript ? null : (
      <QueueTray
        editingItemId={session?.itemId ?? null}
        onBeginEdit={beginEdit}
        onCancelEdit={cancelEdit}
        saving={saving}
      />
    )}
    {editingTranscript && transcriptEdit && rewind ? (
      <TranscriptEditTray
        onDismiss={dismissRewind}
        saving={rewindSaving}
        text={transcriptEdit.originalText}
      />
    ) : null}
    <div className="w-full">
      <ComposerField
        action={dockAction({
          attachments,
          draft,
          editingTranscript,
          onSaveEdit,
          onSaveRewind,
          onSteer: () => onSubmit("steer"),
          rewind,
          rewindSaving,
          saving,
          session,
          text,
        })}
        allowAttachments={!editing}
        disabled={
          saving || rewindSaving || (!editing && missionStatus === "archived")
        }
        draft={rewind?.draft ?? session?.draft ?? draft}
        existingAttachments={attachmentRow(editingItem ?? sentItem, missionId)}
        focusRequest={focusRequest}
        label={composerLabel(editingTranscript, session)}
        onEditLatest={editing ? undefined : beginLatest}
        onSubmit={(mode) =>
          onSubmit(mode === "queue" && working ? "queue" : "steer")
        }
        placeholder={placeholderFor(missionStatus)}
        scope={{ id: missionId, kind: "mission" }}
        size="touch"
        testId="composer-input"
      />
    </div>
    {status ? (
      <p
        className="px-card text-xs leading-sm font-book tracking-tight text-info md:hidden"
        data-testid="mode-status"
      >
        {status}
      </p>
    ) : null}
  </div>
);

export const MissionComposer = ({ onSend }: { onSend: () => void }) => {
  const { commands, draft, live, refresh } = useMission();
  const { mission } = live;
  const text = useSyncExternalStore(
    draft.subscribe,
    draft.snapshot,
    draft.snapshot
  );
  const attachments = useSyncExternalStore(
    draft.subscribe,
    draft.attachmentSnapshot,
    draft.attachmentSnapshot
  );
  const [session, setSession] = useState<EditSession | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  // A save in flight pauses the exit check; the ref gates before the first await.
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  // Mirrors the session for save continuations, whose closure is stale.
  const sessionRef = useRef<EditSession | null>(null);
  // A save that outlived its edit still decides where its text belongs.
  const held = useRef<readonly EditSession[]>([]);
  const markSaving = useCallback((value: boolean) => {
    savingRef.current = value;
    setSaving(value);
  }, []);
  const updateSession = useCallback(
    (change: (current: EditSession | null) => EditSession | null) => {
      sessionRef.current = change(sessionRef.current);
      setSession(sessionRef.current);
    },
    []
  );
  const isActive = useCallback(
    (candidate: EditSession) => sessionRef.current === candidate,
    []
  );
  const { disabled, send, working } = useSendMessage({
    onError: (delivery) => draft.restore(delivery),
    onSend,
  });
  const status = modeStatus(mission);
  // Each edit is its own intent, like a send: a shared single-flight would hold
  // a stalled save's ticket and block the retry after the edit is cancelled.
  const edit = useMutation({
    mutationFn: (input: MissionCommandInputs["editQueue"]) =>
      commands.run("editQueue", input),
    onError: (error) =>
      reportMutationError(error, refresh, "Could not edit the message"),
  });
  const queue = useVisibleQueue();
  const editingItem = session ? live.queue[session.itemId] : undefined;

  /**
   * Ends the session and moves an unsaved edit into the composer only when it
   * would not overwrite what the user already typed there. Delivered messages
   * have their own wording, and the kept notice is left to that caller.
   */
  const finish = useCallback(
    (ending: EditSession, reason?: "already_sent" | "saving") => {
      // A late completion for an edit the composer has already moved past.
      if (sessionRef.current !== ending) {
        return;
      }
      if (reason === "saving") {
        // The request already carries this text, so keeping a copy in the
        // composer would invite sending a second one. Its result decides.
        held.current = [...held.current, ending];
        toast({
          description:
            "The update is already on its way. Its text is not in the composer, so check the queued message before sending it again.",
          title: "Update may still complete",
          tone: "info",
        });
        markSaving(false);
        updateSession(() => null);
        return;
      }
      const edited = ending.draft.snapshot();
      const outcome = resolveQueuedEditExit({
        editChanged: edited !== ending.originalText,
        missionDraftEmpty: draft.isEmpty(),
      });
      const kept = outcome === "kept";
      if (kept) {
        draft.adopt(edited);
      }
      if (reason === "already_sent") {
        toast({
          description: kept
            ? "The agent already received it. Your text is back in the composer and nothing was sent again."
            : "The agent already received it. Nothing was sent again, and your other draft is untouched.",
          title: "Already delivered",
          tone: "info",
        });
      } else if (kept) {
        toast({
          description: "It is back in the composer. Nothing was sent.",
          title: "Edit kept",
          tone: "info",
        });
      } else if (outcome === "discarded") {
        toast({
          description:
            "The message can no longer be edited. Your other draft is untouched.",
          title: "Edit discarded",
          tone: "warning",
        });
      }
      markSaving(false);
      updateSession(() => null);
    },
    [draft, markSaving, updateSession]
  );

  /**
   * Settles an edit cancelled mid-save: a replaced message already holds the
   * text, so only a save that did not apply gives it back.
   */
  const settleHeld = useCallback(
    (ending: EditSession, applied: boolean) => {
      held.current = held.current.filter((item) => item !== ending);
      const edited = ending.draft.snapshot();
      if (applied || edited === ending.originalText) {
        return;
      }
      if (draft.adopt(edited)) {
        toast({
          description: "The update did not apply. Your text is back.",
          title: "Edit kept",
          tone: "info",
        });
      } else {
        toast({
          description:
            "The update did not apply. Your other draft is untouched, so the text was not restored.",
          title: "Edit dropped",
          tone: "warning",
        });
      }
    },
    [draft]
  );

  // A save pauses the check; otherwise an ended message settles its edit now.
  // The frame keeps the settlement out of the effect's render pass.
  useEffect(() => {
    if (!session || saving) {
      return;
    }
    const end = queuedEditEnd(live.queue[session.itemId]);
    if (end === null) {
      return;
    }
    const ending = session;
    const frame = requestAnimationFrame(() =>
      finish(ending, end === "delivered" ? "already_sent" : undefined)
    );
    return () => cancelAnimationFrame(frame);
  }, [finish, live.queue, saving, session]);

  const {
    dismissRewind,
    editingTranscript,
    rewind,
    rewindSaving,
    saveRewind,
    transcriptEdit,
  } = useTranscriptRewind({
    draft,
    finish,
    savingRef,
    sessionRef,
    setFocusRequest,
  });
  const editing = session !== null || editingTranscript;

  const beginEdit = useCallback(
    (item: QueueItem) => {
      if (!item.text.trim() || rewind) {
        return;
      }
      // Swapping sessions under a save would settle the wrong edit, so the row
      // waits until the save it started has finished.
      if (savingRef.current) {
        return;
      }
      // A second row must not silently drop the text typed into the first.
      if (sessionRef.current) {
        finish(sessionRef.current);
      }
      const next = new MessageDraft();
      next.change(item.text);
      markSaving(false);
      updateSession(() => ({
        draft: next,
        itemId: item.id,
        originalText: item.text,
      }));
      setFocusRequest((request) => request + 1);
    },
    [finish, markSaving, rewind, updateSession]
  );

  const cancelEdit = useCallback(() => {
    // Always available, including mid-save: a stalled save must not trap the
    // editor, and the identity check makes a late completion inert.
    if (session) {
      finish(session, savingRef.current ? "saving" : undefined);
      setFocusRequest((request) => request + 1);
    }
  }, [finish, session]);
  const beginLatest = useCallback(() => {
    if (session) {
      return false;
    }
    const item = latestEditable(queue);
    if (!item) {
      return false;
    }
    beginEdit(item);
    return true;
  }, [beginEdit, queue, session]);

  const saveEdit = async () => {
    const active = sessionRef.current;
    if (!active || savingRef.current) {
      return;
    }
    const next = active.draft.snapshot().trim();
    if (!next || !active.draft.uploadsReady()) {
      return;
    }
    const latest = live.queue[active.itemId];
    if (!latest) {
      finish(active);
      return;
    }
    markSaving(true);
    try {
      const result = await edit.mutateAsync({
        expectedRevision: latest.revision,
        itemId: latest.id,
        text: next,
      });
      // The session may have been settled already; only act while it is ours.
      if (isActive(active)) {
        if (result.outcome === "replaced") {
          markSaving(false);
          updateSession(() => null);
          setFocusRequest((request) => request + 1);
          return;
        }
        if (result.outcome === "already_sent") {
          // The original was delivered, so this edit can no longer be applied.
          finish(active, "already_sent");
          return;
        }
        toast(EDIT_OUTCOME[result.outcome]);
      } else if (held.current.includes(active)) {
        settleHeld(active, result.outcome === "replaced");
      }
    } catch {
      // The command reports the failure; the edit and its draft stay put.
      if (!isActive(active) && held.current.includes(active)) {
        settleHeld(active, false);
      }
    }
    // A newer save may own the flag by now, so only the active one clears it.
    if (isActive(active)) {
      markSaving(false);
    }
  };

  const submit = (mode: DeliveryMode) => {
    if (rewind && transcriptEdit) {
      void saveRewind();
      return;
    }
    if (session) {
      void saveEdit();
      return;
    }
    if (disabled) {
      return;
    }
    const delivery = draft.take(mode);
    if (delivery) {
      void send(delivery);
    }
  };

  return (
    <ComposerDock
      attachments={attachments}
      beginEdit={beginEdit}
      beginLatest={beginLatest}
      cancelEdit={cancelEdit}
      dismissRewind={dismissRewind}
      draft={draft}
      editing={editing}
      editingItem={editingItem}
      editingTranscript={editingTranscript}
      focusRequest={focusRequest}
      missionId={mission.id}
      missionStatus={mission.status}
      onSaveEdit={() => {
        void saveEdit();
      }}
      onSaveRewind={() => {
        void saveRewind();
      }}
      onSubmit={submit}
      rewind={rewind}
      rewindSaving={rewindSaving}
      saving={saving}
      sentItem={
        transcriptEdit?.requestId
          ? live.queue[transcriptEdit.requestId]
          : undefined
      }
      session={session}
      status={status}
      text={text}
      transcriptEdit={transcriptEdit}
      working={working}
    />
  );
};
