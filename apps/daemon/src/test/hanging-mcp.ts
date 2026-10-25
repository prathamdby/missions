import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const HANGING_MCP_NAME = "missions-perf-hang";

/** Only call in a disposable project; inherited user configuration is untouched. */
export const addHangingMcp = async (cwd: string) => {
  const configDir = path.join(cwd, ".factory");
  await mkdir(configDir, { recursive: true });
  await writeFile(
    path.join(configDir, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        [HANGING_MCP_NAME]: {
          args: ["-e", "process.stdin.resume(); setInterval(() => {}, 60000);"],
          command: process.execPath,
          type: "stdio",
        },
      },
    }),
    { flag: "wx" }
  );
};
