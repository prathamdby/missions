import { AUTH_SCHEME, OPERATION_HEADER } from "@missions/protocol/http";

export interface ProxyRequestInfo {
  fetchSite: string | null;
  host: string | null;
  method: string;
  origin: string | null;
  port: number | string;
}

export type GuardResult = { ok: true } | { message: string; ok: false };

const SAFE_METHODS = new Set(["GET", "HEAD"]);

/** The only Host values the web server answers to; anything else is DNS rebinding. */
export const allowedHosts = (port: number | string) =>
  new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

export const checkProxyRequest = ({
  fetchSite,
  host,
  method,
  origin,
  port,
}: ProxyRequestInfo): GuardResult => {
  const normalizedHost = host?.trim().toLowerCase() ?? "";
  if (!allowedHosts(port).has(normalizedHost)) {
    return { message: `Host "${host ?? ""}" is not allowed.`, ok: false };
  }
  if (fetchSite === "cross-site") {
    return { message: "Cross-site requests are not allowed.", ok: false };
  }
  const expectedOrigin = `http://${normalizedHost}`;
  if (origin !== null && origin.toLowerCase() !== expectedOrigin) {
    return { message: `Origin "${origin}" is not allowed.`, ok: false };
  }
  if (!SAFE_METHODS.has(method.toUpperCase()) && origin === null) {
    return {
      message: "Requests that change state need an Origin header.",
      ok: false,
    };
  }
  return { ok: true };
};

/** Allowlist: cookies, auth, and x-forwarded-* never reach the daemon. */
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "cache-control",
  "content-type",
  "last-event-id",
  OPERATION_HEADER,
] as const;

export const forwardRequestHeaders = (incoming: Headers, token: string) => {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = incoming.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }
  headers.set("authorization", `${AUTH_SCHEME} ${token}`);
  return headers;
};

// fetch() already decoded the body, so length and encoding no longer apply.
const DROPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "set-cookie",
  "transfer-encoding",
]);

export const forwardResponseHeaders = (upstream: Headers) => {
  const headers = new Headers();
  for (const [name, value] of upstream) {
    if (!DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) {
      headers.set(name, value);
    }
  }
  if (headers.get("content-type")?.startsWith("text/event-stream")) {
    headers.set("cache-control", "no-cache, no-transform");
    headers.set("x-accel-buffering", "no");
  }
  return headers;
};

/** Maps catch-all segments to a daemon path; only `/v1/...` is reachable. */
export const upstreamPath = (segments: readonly string[] | undefined) => {
  if (!segments || segments[0] !== "v1" || segments.length < 2) {
    return null;
  }
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === ".."
    )
  ) {
    return null;
  }
  return `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
};
