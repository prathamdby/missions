import { describe, expect, it } from "vitest";

import { normalizeMessage } from "../sdk/agent-runtime";
import { itemsFromMessage } from "./transcript";

describe("attachment-only transcript messages", () => {
  it("keeps a captionless image's request identity without copying its bytes", () => {
    const message = normalizeMessage(
      {
        content: [{ source: { data: "private image bytes" }, type: "image" }],
        id: "image-message",
        role: "user",
      },
      "image-request"
    );
    if (!message) {
      throw new Error("Missing attachment-only message");
    }
    const items = itemsFromMessage(
      {
        agentId: "agent",
        createdAt: "2026-01-01T00:00:00.000Z",
        missionId: "mission",
      },
      message
    );
    expect(items).toMatchObject([
      {
        id: "agent:image-message:text",
        kind: "user",
        requestId: "image-request",
        text: "",
      },
    ]);
    expect(JSON.stringify(items)).not.toContain("private image bytes");
  });

  it("still omits empty uncorrelated and assistant messages", () => {
    expect(
      normalizeMessage({ content: [], id: "empty", role: "user" }, null)
    ).toBeNull();
    expect(
      normalizeMessage(
        { content: [], id: "empty", role: "assistant" },
        "request"
      )
    ).toBeNull();
  });
});
