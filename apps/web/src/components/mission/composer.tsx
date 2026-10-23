"use client";

import type { Autonomy, DeliveryMode } from "@missions/protocol/common";
import { useMutation } from "@tanstack/react-query";
import { ArrowUpIcon } from "lucide-react";
import { useState } from "react";
import type { KeyboardEvent } from "react";

import { useMission } from "@/components/mission/mission-context";
import { QueueTray } from "@/components/mission/queue-tray";
import { reportMutationError } from "@/components/mission/report-error";
import { AutonomyChip } from "@/components/missions/autonomy-chip";
import {
  ComposerFrame,
  ComposerHints,
} from "@/components/missions/composer-frame";
import { IconButton } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Hint } from "@/components/ui/tooltip";
import { api } from "@/lib/api/endpoints";
import { useOperationIds } from "@/lib/api/use-operation";
import { nextAutonomy } from "@/lib/autonomy";
import { isMissionActive } from "@/lib/format";

/**
 * Enter steers (delivered after the current tool call); Alt+Enter queues
 * (delivered when the turn ends) while agents are working.
 */
export const MissionComposer = () => {
  const { applyLocal, live, missionId, refresh } = useMission();
  const { mission } = live;
  const [text, setText] = useState("");
  const ops = useOperationIds();
  const working = isMissionActive(mission.status);
  const archived = mission.status === "archived";

  const send = useMutation({
    mutationFn: (input: { mode: DeliveryMode; text: string }) =>
      api.submitMessage(missionId, {
        ...input,
        operationId: ops.idFor(`${input.mode}:${input.text}`),
      }),
    onError: (error, input) => {
      setText((current) => current || input.text);
      reportMutationError(error, refresh, "Message not sent");
    },
    onSuccess: (value) => {
      ops.settle();
      applyLocal({ kind: "queue", value });
    },
  });

  const autonomy = useMutation({
    mutationFn: (value: Autonomy) =>
      api.updateMission(missionId, {
        autonomy: value,
        expectedRevision: mission.revision,
      }),
    onError: (error) =>
      reportMutationError(error, refresh, "Could not change autonomy"),
    onSuccess: (value) => applyLocal({ kind: "mission", value }),
  });

  const submit = (mode: DeliveryMode) => {
    const trimmed = text.trim();
    if (!trimmed || archived) {
      return;
    }
    setText("");
    send.mutate({ mode, text: trimmed });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit(event.altKey && working ? "queue" : "steer");
    } else if (event.key === "Tab" && event.shiftKey) {
      event.preventDefault();
      autonomy.mutate(nextAutonomy(mission.autonomy));
    }
  };

  return (
    <div className="flex flex-col gap-sm">
      <QueueTray />
      <ComposerFrame
        toolbar={
          <>
            <AutonomyChip
              disabled={archived || autonomy.isPending}
              onChange={(value) => autonomy.mutate(value)}
              value={mission.autonomy}
            />
            <span className="flex-1" />
            <Hint label={working ? "Steer now · ⌥↵ to queue" : "Send"}>
              <IconButton
                disabled={!text.trim() || archived}
                icon={<ArrowUpIcon />}
                label="Send message"
                onClick={() => submit("steer")}
                shape="round"
                size="sm"
                variant="primary"
              />
            </Hint>
          </>
        }
      >
        <Textarea
          aria-label="Message the Orchestrator"
          disabled={archived}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            archived ? "This mission is archived" : "Reply to the Orchestrator…"
          }
          rows={1}
          value={text}
          variant="bare"
        />
      </ComposerFrame>
      <ComposerHints>
        {working ? (
          <>
            <span className="flex items-center gap-xs">
              <Kbd>↵</Kbd> steer
            </span>
            <span className="flex items-center gap-xs">
              <Kbd>⌥</Kbd>
              <Kbd>↵</Kbd> queue
            </span>
            <span>Pause clears anything not yet sent.</span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-xs">
              <Kbd>↵</Kbd> send
            </span>
            <span className="flex items-center gap-xs">
              <Kbd>⇧</Kbd>
              <Kbd>↵</Kbd> new line
            </span>
          </>
        )}
      </ComposerHints>
    </div>
  );
};
