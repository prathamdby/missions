import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { tempDir } from "./fixtures";
import { addHangingMcp, HANGING_MCP_NAME } from "./hanging-mcp";

describe("hanging MCP fixture", () => {
  it("writes a hanging server only inside the disposable project and never overwrites configuration", async () => {
    const cwd = await tempDir("hanging-mcp");
    try {
      await addHangingMcp(cwd);
      const file = path.join(cwd, ".factory", "mcp.json");
      const original = await readFile(file, "utf-8");
      expect(JSON.parse(original)).toStrictEqual({
        mcpServers: {
          [HANGING_MCP_NAME]: {
            args: [
              "-e",
              "process.stdin.resume(); setInterval(() => {}, 60000);",
            ],
            command: process.execPath,
            type: "stdio",
          },
        },
      });
      await expect(addHangingMcp(cwd)).rejects.toMatchObject({
        code: "EEXIST",
      });
      await expect(readFile(file, "utf-8")).resolves.toBe(original);
    } finally {
      await rm(cwd, { force: true, recursive: true });
    }
  });
});
