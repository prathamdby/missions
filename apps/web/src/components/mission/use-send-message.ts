"use client";

import { useMutation } from "@tanstack/react-query";

import { useMission } from "@/components/mission/mission-context";
import { reportMutationError } from "@/components/mission/report-error";
import { missionCapabilities } from "@/lib/mission/capabilities";
import { orchestratorTurnRunning } from "@/lib/mission/idle-send";
import type { MessageDelivery } from "@/lib/mission/message-draft";
import { markReceipt, markSubmit } from "@/lib/perf-marks";

export const useSendMessage = ({
  onError,
  onSend,
}: {
  onError?: (delivery: MessageDelivery) => void;
  onSend?: () => void;
} = {}) => {
  const { commands, failIdleSubmission, live, presentIdleSubmission, refresh } =
    useMission();
  const disabled = !missionCapabilities(live.mission.status).message;
  const working = orchestratorTurnRunning(
    live.mission.status,
    Object.values(live.agents)
  );
  // Composer submissions are distinct intents, not a shared single-flight lane.
  const mutation = useMutation({
    mutationFn: (delivery: MessageDelivery & { inlineId: string | null }) =>
      commands.run("message", delivery.input, delivery.occurrence),
    onError: (error, delivery) => {
      if (delivery.inlineId) {
        failIdleSubmission(delivery.inlineId);
      }
      onError?.(delivery);
      return reportMutationError(error, refresh, "Message not sent");
    },
    onSuccess: (item, delivery) => markReceipt(item.id, delivery.occurrence),
  });

  const send = async (delivery: MessageDelivery): Promise<boolean> => {
    if (disabled) {
      return false;
    }
    onSend?.();
    const inlineId = working
      ? null
      : commands.messageIdFor(delivery.input, delivery.occurrence);
    if (inlineId) {
      presentIdleSubmission({
        attachments: delivery.attachments ?? [],
        failed: false,
        id: inlineId,
        text: delivery.input.text,
      });
    }
    markSubmit(delivery.occurrence);
    try {
      await mutation.mutateAsync({ ...delivery, inlineId });
      return true;
    } catch {
      // The mutation reports the error and restores its owner's draft.
      return false;
    }
  };
  return { disabled, send, working };
};
