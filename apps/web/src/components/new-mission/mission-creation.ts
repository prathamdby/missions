import type { CreateMissionRequest } from "@missions/protocol/commands";
import type { MissionSnapshot } from "@missions/protocol/missions";

import {
  isDefiniteFailure,
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
  private uncertain: { key: string; payload: MissionDraft } | null = null;

  constructor(dependencies: Creation) {
    this.create = dependencies.create;
    this.intents = dependencies.intents ?? new OperationIntents();
  }

  get uncertainDraft(): MissionDraft | null {
    return this.uncertain ? structuredClone(this.uncertain.payload) : null;
  }

  submit = async (draft: MissionDraft): Promise<MissionSnapshot> => {
    const payload = this.uncertain?.payload ?? structuredClone(draft);
    const key =
      this.uncertain?.key ?? operationIntentKey("create-mission", payload);
    const operationId = this.intents.idFor(key);
    try {
      const result = await this.create({ ...payload, operationId });
      this.intents.settle(key);
      if (this.uncertain?.key === key) {
        this.uncertain = null;
      }
      return result;
    } catch (error) {
      this.intents.release(error, key);
      if (!isDefiniteFailure(error)) {
        this.uncertain = { key, payload };
      } else if (this.uncertain?.key === key) {
        this.uncertain = null;
      }
      throw error;
    }
  };
}
