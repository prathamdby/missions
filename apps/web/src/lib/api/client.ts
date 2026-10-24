import { ApiErrorSchema } from "@missions/protocol/errors";
import { OPERATION_HEADER, PROXY_PREFIX } from "@missions/protocol/http";
import type { z } from "zod";

import { ApiRequestError } from "./api-error";

export type Query = Record<string, number | string | null | undefined>;

export interface RequestOptions {
  body?: unknown;
  rawBody?: Blob;
  headers?: HeadersInit;
  method?: "DELETE" | "GET" | "PATCH" | "POST";
  query?: Query;
  signal?: AbortSignal;
}

const SERVER_ERROR = 500;

/** Same-origin URL for a daemon path; the Next.js server forwards it. */
export const proxyUrl = (path: string, query?: Query) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return `${PROXY_PREFIX}${path}${search ? `?${search}` : ""}`;
};

/** Idempotency key for one user intent; reuse it when retrying that intent. */
export const newOperationId = () => crypto.randomUUID();

const readJson = async (res: Response): Promise<unknown> => {
  const text = await res.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const operationOf = (body: unknown) => {
  if (typeof body === "object" && body !== null && "operationId" in body) {
    const { operationId } = body as { operationId: unknown };
    return typeof operationId === "string" ? operationId : null;
  }
  return null;
};

const send = async (path: string, options: RequestOptions) => {
  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
  let body: string | Blob | undefined = options.rawBody;
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.body);
    const operationId = operationOf(options.body);
    if (operationId) {
      headers.set(OPERATION_HEADER, operationId);
    }
  }
  let res: Response;
  try {
    res = await fetch(proxyUrl(path, options.query), {
      body,
      cache: "no-store",
      headers,
      method: options.method ?? "GET",
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) {
      throw error;
    }
    throw new ApiRequestError({
      cause: error,
      code: "unavailable",
      message: "Could not reach the Missions server.",
      status: 0,
    });
  }
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(await readJson(res));
    if (parsed.success) {
      throw ApiRequestError.fromPayload(parsed.data, res.status);
    }
    throw new ApiRequestError({
      code: res.status >= SERVER_ERROR ? "internal" : "bad_request",
      message: `Request failed with status ${res.status}.`,
      status: res.status,
    });
  }
  return res;
};

/** Sends a request and validates the JSON response against `schema`. */
export const apiRequest = async <S extends z.ZodType>(
  path: string,
  schema: S,
  options: RequestOptions = {}
): Promise<z.output<S>> => {
  const res = await send(path, options);
  const parsed = schema.safeParse(await readJson(res));
  if (!parsed.success) {
    throw new ApiRequestError({
      cause: parsed.error,
      code: "internal",
      message: `The daemon sent an unexpected response for ${path}.`,
      status: res.status,
    });
  }
  return parsed.data;
};

/** For routes that answer 204. */
export const apiRequestVoid = async (
  path: string,
  options: RequestOptions = {}
) => {
  await send(path, options);
};
