export class StaleDecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleDecisionError";
  }
}
