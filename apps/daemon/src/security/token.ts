import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const TOKEN_BYTES = 32;

/** Reuses the existing token so a running web server keeps working across daemon restarts. */
export const ensureToken = async (tokenPath: string): Promise<string> => {
  await mkdir(path.dirname(tokenPath), { mode: 0o700, recursive: true });
  try {
    const raw = await readFile(tokenPath, "utf-8");
    const existing = raw.trim();
    if (existing.length >= TOKEN_BYTES) {
      await chmod(tokenPath, 0o600);
      return existing;
    }
  } catch {
    // Missing or unreadable: write a fresh one below.
  }
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  await writeFile(tokenPath, `${token}\n`, { mode: 0o600 });
  await chmod(tokenPath, 0o600);
  return token;
};

export const tokensMatch = (expected: string, provided: string) => {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
};
