import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DAEMON_PORT,
  TOKEN_FILE_NAME,
  WEB_PORT,
} from "@missions/protocol/http";

const HOME_PREFIX = /^~(?=$|[/\\])/u;

const missionsHome = () => {
  const configured = process.env.MISSIONS_HOME;
  if (!configured) {
    return path.join(os.homedir(), ".missions");
  }
  return path.resolve(configured.replace(HOME_PREFIX, os.homedir()));
};

export const webPort = () => process.env.MISSIONS_WEB_PORT ?? String(WEB_PORT);

export const daemonOrigin = () =>
  `http://127.0.0.1:${process.env.MISSIONS_DAEMON_PORT ?? String(DAEMON_PORT)}`;

let cached: { file: string; mtimeMs: number; token: string } | null = null;

/** Server-only. Re-reads the token when the daemon rewrites the file. */
export const readDaemonToken = async (): Promise<string | null> => {
  const file = path.join(missionsHome(), TOKEN_FILE_NAME);
  try {
    const info = await stat(file);
    if (cached?.file === file && cached.mtimeMs === info.mtimeMs) {
      return cached.token;
    }
    const contents = await readFile(file, "utf-8");
    const token = contents.trim();
    if (!token) {
      cached = null;
      return null;
    }
    cached = { file, mtimeMs: info.mtimeMs, token };
    return token;
  } catch {
    cached = null;
    return null;
  }
};
