import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  AttachmentIdsSchema,
  AttachmentRefSchema,
} from "@missions/protocol/attachments";
import type { AttachmentRef } from "@missions/protocol/attachments";
import { z } from "zod";

import { badRequest, conflict, notFound } from "../lib/app-error";
import { removeMissionFolder, sweepMissionFolders } from "./mission-folders";
import { sniffAttachment } from "./sniff-attachment";

const PENDING_TTL = 24 * 60 * 60_000;
const UUID = z.uuid();
const IMAGE_NAME = /\.(?:png|jpe?g|gif|webp)$/iu;
const PDF_NAME = /\.pdf$/iu;
const SVG_NAME = /\.svg$/iu;
const folderId = (id: string) => {
  if (!id || id === "." || id === ".." || path.basename(id) !== id) {
    throw badRequest("Invalid attachment folder");
  }
  return id;
};
const exists = async (file: string) => {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
};
const safeName = (name: string) =>
  path
    .basename(name.replaceAll("\\", "/"))
    .split("")
    .filter(
      (char) => (char.codePointAt(0) ?? 0) >= 32 && char.codePointAt(0) !== 127
    )
    .join("")
    .slice(0, 200)
    .toWellFormed() || "attachment";

/** Raw bytes stay outside SQLite. JSON sidecars are the only metadata index. */
export class AttachmentStore {
  readonly #dir: string;
  readonly #now: () => Date;
  readonly #removed = new Set<string>();
  #serial: Promise<unknown> = Promise.resolve();

  constructor(dir: string, now: () => Date = () => new Date()) {
    this.#dir = dir;
    this.#now = now;
  }

  #mutate<T>(use: () => Promise<T>): Promise<T> {
    const work = this.#serial.then(use, use);
    this.#serial = work.catch(() => null);
    return work;
  }

  #base(id: string, missionId?: string) {
    if (!UUID.safeParse(id).success) {
      throw badRequest("Invalid attachment ID");
    }
    return path.join(
      this.#dir,
      missionId ? folderId(missionId) : "pending",
      id
    );
  }

  static async #metadata(base: string): Promise<AttachmentRef> {
    const raw: unknown = JSON.parse(await readFile(`${base}.json`, "utf-8"));
    return AttachmentRefSchema.parse(raw);
  }

  async upload(name: string, data: Buffer): Promise<AttachmentRef> {
    const type = sniffAttachment(data);
    if (SVG_NAME.test(name)) {
      throw badRequest("SVG images are not supported");
    }
    if (IMAGE_NAME.test(name) && type.kind !== "image") {
      throw badRequest(
        "The image data does not match a supported image format"
      );
    }
    if (PDF_NAME.test(name) && type.kind !== "pdf") {
      throw badRequest("The PDF data is invalid");
    }
    return await this.#mutate(async () => {
      await this.#sweepPending();
      const ref: AttachmentRef = {
        ...type,
        createdAt: this.#now().toISOString(),
        id: randomUUID(),
        name: safeName(name),
        size: data.length,
      };
      const base = this.#base(ref.id);
      await mkdir(path.dirname(base), { mode: 0o700, recursive: true });
      try {
        await writeFile(base, data, { flag: "wx", mode: 0o600 });
        await writeFile(`${base}.json`, JSON.stringify(ref), {
          flag: "wx",
          mode: 0o600,
        });
      } catch (error) {
        await Promise.all([
          rm(base, { force: true }),
          rm(`${base}.json`, { force: true }),
        ]);
        throw error;
      }
      return ref;
    });
  }

  /** Moves bytes first and metadata last; retries finish either half after a crash. */
  async claim(
    ids: readonly string[],
    missionId: string
  ): Promise<AttachmentRef[]> {
    const parsed = AttachmentIdsSchema.parse(ids);
    return await this.#mutate(async () => {
      if (this.#removed.has(missionId)) {
        throw conflict("The mission was deleted");
      }
      const entries = await Promise.all(
        parsed.map(async (id) => {
          const target = this.#base(id, missionId);
          const pending = this.#base(id);
          const metadata = (await exists(`${target}.json`)) ? target : pending;
          const source = (await exists(target)) ? target : pending;
          const ref = await AttachmentStore.#metadata(metadata).catch(() => {
            throw badRequest("Attachment is missing or unavailable");
          });
          if (ref.id !== id || !(await exists(source))) {
            throw badRequest("Attachment is missing or invalid");
          }
          if (
            source === pending &&
            this.#now().getTime() - Date.parse(ref.createdAt) >= PENDING_TTL
          ) {
            throw badRequest("Attachment expired");
          }
          return { metadata, ref, source, target };
        })
      );
      await Promise.all(
        entries.map(async (entry) => {
          await mkdir(path.dirname(entry.target), {
            mode: 0o700,
            recursive: true,
          });
          if (entry.source !== entry.target) {
            await rename(entry.source, entry.target);
          }
          if (entry.metadata !== entry.target) {
            await rename(`${entry.metadata}.json`, `${entry.target}.json`);
          }
        })
      );
      return entries.map((entry) => entry.ref);
    });
  }

  async read(
    id: string,
    missionId?: string
  ): Promise<{ ref: AttachmentRef; data: Buffer }> {
    return await this.#mutate(async () => {
      const base = this.#base(id, missionId);
      try {
        const ref = await AttachmentStore.#metadata(base);
        if (
          !missionId &&
          this.#now().getTime() - Date.parse(ref.createdAt) >= PENDING_TTL
        ) {
          throw notFound("Attachment");
        }
        const data = await readFile(base);
        if (ref.id !== id || data.length !== ref.size) {
          throw badRequest("Invalid attachment data");
        }
        return { data, ref };
      } catch {
        throw notFound("Attachment");
      }
    });
  }

  async remove(missionId: string) {
    await this.#mutate(async () => {
      this.#removed.add(missionId);
      await removeMissionFolder(this.#dir, missionId);
    });
  }

  async sweepRemoved(deleted: ReadonlySet<string>) {
    await this.#mutate(async () => {
      for (const id of deleted) {
        this.#removed.add(id);
      }
      await sweepMissionFolders(this.#dir, deleted);
    });
  }

  async sweepPending() {
    await this.#mutate(() => this.#sweepPending());
  }

  async #sweepPending() {
    const pending = path.join(this.#dir, "pending");
    const names = await readdir(pending).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          return [];
        }
        throw error;
      }
    );
    const ids = new Set(
      names
        .map((name) => (name.endsWith(".json") ? name.slice(0, -5) : name))
        .filter((name) => UUID.safeParse(name).success)
    );
    await Promise.all(
      [...ids].map(async (id) => {
        const base = path.join(pending, id);
        const file = (await exists(`${base}.json`)) ? `${base}.json` : base;
        const info = await stat(file);
        if (this.#now().getTime() - info.mtimeMs >= PENDING_TTL) {
          await Promise.all([
            rm(base, { force: true }),
            rm(`${base}.json`, { force: true }),
          ]);
        }
      })
    );
  }
}
