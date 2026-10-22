export class LeaseAbortedError extends Error {
  constructor() {
    super("Write lease wait was cancelled");
    this.name = "LeaseAbortedError";
  }
}
