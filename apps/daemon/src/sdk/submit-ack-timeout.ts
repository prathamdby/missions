export const SUBMIT_ACK_TIMEOUT_MS = 30_000;

export class SubmitAckTimeoutError extends Error {
  constructor() {
    super(
      "Native message submission acknowledgement timed out after 30 seconds"
    );
    this.name = "SubmitAckTimeoutError";
  }
}
