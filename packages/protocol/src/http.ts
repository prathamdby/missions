/** Loopback ports; both servers bind 127.0.0.1 only. */
export const DAEMON_PORT = 4317;
export const WEB_PORT = 4318;

/**
 * The daemon writes a random token to `<MISSIONS_HOME>/daemon-token` (mode
 * 0600). Only the Next.js server reads it and attaches it; the browser never
 * sees it. `MISSIONS_HOME` defaults to `~/.missions`.
 */
export const TOKEN_FILE_NAME = "daemon-token";
export const AUTH_SCHEME = "Bearer";

/** Same-origin browser path that the Next.js server forwards to the daemon. */
export const PROXY_PREFIX = "/api/daemon";

/** SSE event names on `GET /v2/events`. Every `event` frame carries `id: seq`. */
export const SSE_EVENT = "event";
export const SSE_RESYNC = "resync";
export const SSE_HEARTBEAT_MS = 15_000;

/** Header carrying a client's idempotency key on retries of the same command. */
export const OPERATION_HEADER = "x-missions-operation";
