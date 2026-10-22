import type { Context } from "hono";
import type { z } from "zod";

import { badRequest } from "../lib/app-error";

export const parseBody = async <S extends z.ZodType>(
  c: Context,
  schema: S
): Promise<z.infer<S>> => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest("Request body must be JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((issue) => issue.path.join(".") || "body")
      .join(", ");
    throw badRequest(`Invalid request: ${fields}`);
  }
  return parsed.data;
};

/** Validates outgoing bodies so the daemon never sends an off-contract response. */
export const reply = <S extends z.ZodType>(
  c: Context,
  schema: S,
  body: z.input<S>,
  status: 200 | 201 | 202 = 200
) => c.json(schema.parse(body) as object, status);

export const param = (c: Context, name: string) => {
  const value = c.req.param(name);
  if (!value) {
    throw badRequest(`Missing ${name}`);
  }
  return value;
};
