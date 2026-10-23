import { describe, expect, it } from "vitest";

import {
  checkProxyRequest,
  forwardRequestHeaders,
  forwardResponseHeaders,
  upstreamPath,
} from "./request-guard";
import type { ProxyRequestInfo } from "./request-guard";

const base: ProxyRequestInfo = {
  fetchSite: null,
  host: "127.0.0.1:4318",
  method: "GET",
  origin: null,
  port: 4318,
};

const allowed = (overrides: Partial<ProxyRequestInfo>) =>
  checkProxyRequest({ ...base, ...overrides }).ok;

describe(checkProxyRequest, () => {
  it("accepts loopback hosts on the web port", () => {
    expect([
      allowed({}),
      allowed({ host: "localhost:4318" }),
      allowed({ host: "LOCALHOST:4318" }),
    ]).toStrictEqual([true, true, true]);
  });

  it("rejects other hosts, ports, and a missing host", () => {
    expect([
      allowed({ host: "evil.test:4318" }),
      allowed({ host: "127.0.0.1:4317" }),
      allowed({ host: "127.0.0.1" }),
      allowed({ host: null }),
    ]).toStrictEqual([false, false, false, false]);
  });

  it("honors a custom web port", () => {
    expect([
      allowed({ host: "127.0.0.1:5000", port: "5000" }),
      allowed({ host: "127.0.0.1:4318", port: "5000" }),
    ]).toStrictEqual([true, false]);
  });

  it("requires a same-origin Origin on mutations", () => {
    expect([
      allowed({ method: "POST" }),
      allowed({ method: "POST", origin: "http://127.0.0.1:4318" }),
      allowed({ method: "DELETE", origin: "http://localhost:4318" }),
      allowed({ method: "PATCH", origin: "https://127.0.0.1:4318" }),
      allowed({ method: "POST", origin: "null" }),
    ]).toStrictEqual([false, true, false, false, false]);
  });

  it("rejects cross-origin reads and cross-site fetch metadata", () => {
    expect([
      allowed({ origin: "http://evil.test" }),
      allowed({ fetchSite: "cross-site" }),
      allowed({ fetchSite: "same-origin" }),
    ]).toStrictEqual([false, false, true]);
  });
});

describe(forwardRequestHeaders, () => {
  it("drops credentials and forwarding headers and attaches the token", () => {
    const incoming = new Headers({
      accept: "text/event-stream",
      authorization: "Bearer stolen",
      "content-type": "application/json",
      cookie: "session=1",
      "last-event-id": "42",
      "x-forwarded-for": "10.0.0.1",
      "x-forwarded-host": "evil.test",
      "x-missions-operation": "op-12345678",
    });
    expect(
      Object.fromEntries(forwardRequestHeaders(incoming, "secret"))
    ).toStrictEqual({
      accept: "text/event-stream",
      authorization: "Bearer secret",
      "content-type": "application/json",
      "last-event-id": "42",
      "x-missions-operation": "op-12345678",
    });
  });
});

describe(forwardResponseHeaders, () => {
  it("disables buffering for SSE and drops hop-by-hop headers", () => {
    const headers = forwardResponseHeaders(
      new Headers({
        "content-encoding": "gzip",
        "content-length": "10",
        "content-type": "text/event-stream",
        "set-cookie": "a=b",
      })
    );
    expect(Object.fromEntries(headers)).toStrictEqual({
      "cache-control": "no-cache, no-transform",
      "content-type": "text/event-stream",
      "x-accel-buffering": "no",
    });
  });
});

describe(upstreamPath, () => {
  it("only maps v1 paths and re-encodes segments", () => {
    const cases: (string[] | undefined)[] = [
      ["v1", "missions", "abc"],
      ["v1", "a b"],
      ["v1", "x/y"],
      ["v2", "missions"],
      ["v1"],
      ["v1", "..", "secret"],
      undefined,
    ];
    expect(cases.map((segments) => upstreamPath(segments))).toStrictEqual([
      "/v1/missions/abc",
      "/v1/a%20b",
      "/v1/x%2Fy",
      null,
      null,
      null,
      null,
    ]);
  });
});
