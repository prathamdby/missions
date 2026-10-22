import { HEALTH_PATH, HealthResponseSchema } from "@missions/protocol/health";
import type { HealthResponse } from "@missions/protocol/health";

const DEFAULT_DAEMON_PORT = "4317";
const TIMEOUT_MS = 2000;

export type DaemonHealth =
  | { status: "connected"; health: HealthResponse }
  | { status: "incompatible" }
  | { status: "unreachable" };

const daemonOrigin = () =>
  `http://127.0.0.1:${process.env.MISSIONS_DAEMON_PORT ?? DEFAULT_DAEMON_PORT}`;

const readJson = async (res: Response): Promise<unknown> => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

/** Server-only: the browser never talks to the daemon directly. */
export const getDaemonHealth = async (): Promise<DaemonHealth> => {
  let res: Response;
  try {
    res = await fetch(new URL(HEALTH_PATH, daemonOrigin()), {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { status: "unreachable" };
  }
  if (!res.ok) {
    return { status: "unreachable" };
  }
  const parsed = HealthResponseSchema.safeParse(await readJson(res));
  return parsed.success
    ? { health: parsed.data, status: "connected" }
    : { status: "incompatible" };
};
