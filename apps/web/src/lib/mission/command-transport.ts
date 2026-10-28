import { api } from "../api/endpoints";
import type { LocalEntity } from "../live/mission-store";
import type { MissionCommandTransport } from "./commands";

/** Returned entities take the same revision-aware path as live events. */
export const missionCommandTransport = (
  missionId: string,
  apply: (entity: LocalEntity) => void,
  refresh: () => Promise<boolean>,
  onRemoved: () => void = () => null
): MissionCommandTransport => {
  const receive = async <K extends LocalEntity["kind"]>(
    kind: K,
    request: Promise<Extract<LocalEntity, { kind: K }>["value"]>
  ) => {
    const value = await request;
    apply({ kind, value } as LocalEntity);
    return value;
  };
  return {
    archive: (body, operationId) =>
      receive(
        "mission",
        api.archiveMission(missionId, { ...body, operationId })
      ),
    cleanup: (body, operationId) =>
      receive("mission", api.cleanup(missionId, { ...body, operationId })),
    commit: (body, operationId) =>
      receive("mission", api.commit(missionId, { ...body, operationId })),
    delete: async (body, operationId) => {
      const accepted = await api.deleteMission(missionId, {
        ...body,
        operationId,
      });
      onRemoved();
      return accepted;
    },
    editQueue: async ({ itemId, ...body }, operationId) => {
      const result = await api.editQueueItem(missionId, itemId, {
        ...body,
        operationId,
      });
      // The edit result contains IDs/outcome, not entities; reconcile both the
      // original and replacement even when a delivery event raced the response.
      await refresh();
      return result;
    },
    message: (body, operationId) =>
      receive("queue", api.submitMessage(missionId, { ...body, operationId })),
    pause: (body, operationId) =>
      receive("mission", api.pauseMission(missionId, { ...body, operationId })),
    permission: ({ requestId, ...body }) =>
      receive("permission", api.decidePermission(missionId, requestId, body)),
    plan: (body) => receive("plan", api.decidePlan(missionId, body)),
    pullRequest: (body, operationId) =>
      receive(
        "mission",
        api.createPullRequest(missionId, { ...body, operationId })
      ),
    push: (body, operationId) =>
      receive("mission", api.push(missionId, { ...body, operationId })),
    question: ({ questionId, ...body }) =>
      receive("question", api.answerQuestion(missionId, questionId, body)),
    queueMode: ({ itemId, ...body }) =>
      receive("queue", api.changeQueueMode(missionId, itemId, body)),
    removeQueue: ({ itemId, expectedRevision }) =>
      receive(
        "queue",
        api.removeQueueItem(missionId, itemId, expectedRevision)
      ),
    resume: (body, operationId) =>
      receive(
        "mission",
        api.resumeMission(missionId, { ...body, operationId })
      ),
    retryQueue: ({ itemId, ...body }, operationId) =>
      receive(
        "queue",
        api.retryQueueItem(missionId, itemId, { ...body, operationId })
      ),
    rewind: async ({ itemId, ...body }, operationId) => {
      const mission = await api.rewindTranscript(missionId, itemId, {
        ...body,
        operationId,
      });
      apply({ kind: "mission", value: mission });
      try {
        await refresh();
      } catch {
        // The mission response is already applied. A failed refresh leaves the
        // transcript for the next snapshot instead of failing a finished rewind.
      }
      return mission;
    },
    update: (body) => receive("mission", api.updateMission(missionId, body)),
  };
};
