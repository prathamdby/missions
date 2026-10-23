import { errorStatus } from "@missions/protocol/errors";
import type { ApiError, ErrorCode } from "@missions/protocol/errors";
import type { NextRequest } from "next/server";

import {
  daemonOrigin,
  readDaemonToken,
  webPort,
} from "@/lib/proxy/daemon-config";
import {
  checkProxyRequest,
  forwardRequestHeaders,
  forwardResponseHeaders,
  upstreamPath,
} from "@/lib/proxy/request-guard";

export const dynamic = "force-dynamic";

const CLIENT_CLOSED = 499;

const apiError = (code: ErrorCode, message: string) =>
  Response.json({ error: { code, message } } satisfies ApiError, {
    headers: { "cache-control": "no-store" },
    status: errorStatus[code],
  });

const handle = async (
  request: NextRequest,
  context: RouteContext<"/api/daemon/[...path]">
) => {
  const guard = checkProxyRequest({
    fetchSite: request.headers.get("sec-fetch-site"),
    host: request.headers.get("host"),
    method: request.method,
    origin: request.headers.get("origin"),
    port: webPort(),
  });
  if (!guard.ok) {
    return apiError("forbidden", guard.message);
  }
  const { path: segments } = await context.params;
  const target = upstreamPath(segments);
  if (!target) {
    return apiError("not_found", "Unknown daemon route.");
  }
  const token = await readDaemonToken();
  if (!token) {
    return apiError(
      "unavailable",
      "The Missions daemon is not running: no daemon token was found."
    );
  }
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(
      `${daemonOrigin()}${target}${request.nextUrl.search}`,
      {
        body: hasBody ? await request.arrayBuffer() : undefined,
        cache: "no-store",
        headers: forwardRequestHeaders(request.headers, token),
        method: request.method,
        redirect: "manual",
        signal: request.signal,
      }
    );
  } catch {
    if (request.signal.aborted) {
      return new Response(null, { status: CLIENT_CLOSED });
    }
    return apiError("unavailable", "Could not reach the Missions daemon.");
  }
  return new Response(upstream.body, {
    headers: forwardResponseHeaders(upstream.headers),
    status: upstream.status,
    statusText: upstream.statusText,
  });
};

export {
  handle as DELETE,
  handle as GET,
  handle as HEAD,
  handle as PATCH,
  handle as POST,
  handle as PUT,
};
