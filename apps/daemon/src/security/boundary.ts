import { AUTH_SCHEME } from "@missions/protocol/http";
import type { MiddlewareHandler } from "hono";

import { AppError } from "../lib/app-error";
import { tokensMatch } from "./token";

export interface BoundaryOptions {
  token: string;
  port: number;
  /** Paths served without the token (health only). */
  publicPaths: readonly string[];
}

export const allowedHosts = (port: number) =>
  new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);

/**
 * Loopback boundary: rejects DNS-rebinding hosts, any browser-originated
 * request (only the Next.js server talks to the daemon), and missing tokens.
 * Forwarded headers are never consulted.
 */
export const localBoundary = (options: BoundaryOptions): MiddlewareHandler => {
  const hosts = allowedHosts(options.port);
  const publicPaths = new Set(options.publicPaths);
  return async (c, next) => {
    const host = c.req.header("host")?.toLowerCase() ?? "";
    if (!hosts.has(host)) {
      throw new AppError("forbidden", "Unexpected host");
    }
    if (c.req.header("origin") !== undefined) {
      throw new AppError(
        "forbidden",
        "Browser requests must use the app proxy"
      );
    }
    if (!publicPaths.has(c.req.path)) {
      const header = c.req.header("authorization") ?? "";
      const prefix = `${AUTH_SCHEME} `;
      const provided = header.startsWith(prefix)
        ? header.slice(prefix.length)
        : "";
      if (!tokensMatch(options.token, provided)) {
        throw new AppError("unauthorized", "Missing or invalid daemon token");
      }
    }
    return await next();
  };
};
