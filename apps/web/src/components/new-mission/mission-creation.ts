import type { CreateMissionRequest } from "@missions/protocol/commands";
import type { MissionSnapshot } from "@missions/protocol/missions";

import {
  OperationIntents,
  operationIntentKey,
} from "../../lib/api/operation-intents";
import type { MissionDraft } from "./mission-draft";

interface Creation {
  create: (request: CreateMissionRequest) => Promise<MissionSnapshot>;
  intents?: OperationIntents;
}

/** Captures complete immutable intents and retains only uncertain retries. */
export class MissionCreation {
  private readonly create: Creation["create"];
  private readonly intents: OperationIntents;

  constructor(dependencies: Creation) {
    this.create = dependencies.create;
    this.intents = dependencies.intents ?? new OperationIntents();
  }

  submit = async (draft: MissionDraft): Promise<MissionSnapshot> => {
    const payload = structuredClone(draft);
    const key = operationIntentKey("create-mission", payload);
    const operationId = this.intents.idFor(key);
    try {
      const result = await this.create({ ...payload, operationId });
      this.intents.settle(key);
      return result;
    } catch (error) {
      this.intents.release(error, key);
      throw error;
    }
  };
}
