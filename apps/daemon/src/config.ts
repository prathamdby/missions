import os from "node:os";
import path from "node:path";

import { DAEMON_PORT, TOKEN_FILE_NAME } from "@missions/protocol/http";

export interface DaemonConfig {
  home: string;
  dbPath: string;
  tokenPath: string;
  binDir: string;
  reposDir: string;
  artifactsDir: string;
  defaultWorktreeRoot: string;
  droidPath: string;
  port: number;
}

const parsePort = (raw: string | undefined) => {
  if (raw === undefined) {
    return DAEMON_PORT;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid MISSIONS_DAEMON_PORT: ${raw}`);
  }
  return port;
};

export const expandHome = (value: string) =>
  value === "~" || value.startsWith("~/")
    ? path.join(os.homedir(), value.slice(1))
    : value;

export const loadConfig = (
  env: NodeJS.ProcessEnv = process.env
): DaemonConfig => {
  const home = path.resolve(
    expandHome(env.MISSIONS_HOME ?? path.join(os.homedir(), ".missions"))
  );
  return {
    artifactsDir: path.join(home, "artifacts"),
    binDir: path.join(home, "bin"),
    dbPath: path.join(home, "missions.db"),
    defaultWorktreeRoot: path.join(home, "worktrees"),
    droidPath:
      env.MISSIONS_DROID_PATH ?? path.join(os.homedir(), ".local/bin/droid"),
    home,
    port: parsePort(env.MISSIONS_DAEMON_PORT),
    reposDir: path.join(home, "repos"),
    tokenPath: path.join(home, TOKEN_FILE_NAME),
  };
};
