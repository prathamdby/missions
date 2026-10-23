import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import {
  ChangesSchema,
  ComparisonModeSchema,
  FileContentSchema,
  FileTreeSchema,
} from "@missions/protocol/files";
import { routes } from "@missions/protocol/routes";
import type { Context, Hono } from "hono";

import type { ArtifactStore } from "../files/artifact-store";
import type { SharedFiles } from "../files/shared-files";
import {
  listWorkspaceDir,
  comparisonChanges,
  readWorkspaceFile,
  workspaceChanges,
} from "../files/workspace-files";
import { badRequest, notFound } from "../lib/app-error";
import type { MissionService } from "../missions/mission-service";
import { param, reply } from "./json";

const M = ":missionId";
const INLINE =
  /^(?:image\/(?:png|jpeg|gif|webp)|video\/(?:mp4|webm|quicktime))$/u;

const contentDisposition = (name: string, inline: boolean) => {
  const ascii = name.replaceAll(/[^\w.-]/gu, "_");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};

export const registerFileRoutes = (
  app: Hono,
  missions: MissionService,
  artifacts: ArtifactStore,
  sharedFiles: SharedFiles
) => {
  const binding = (c: Context) => {
    const mission = missions.get(param(c, "missionId"));
    if (!mission.workspace) {
      throw notFound("Mission folder");
    }
    return mission.workspace;
  };

  app.get(routes.changes(M), async (c) => {
    const mode = c.req.query("mode");
    if (mode === undefined) {
      return reply(c, ChangesSchema, await workspaceChanges(binding(c)));
    }
    const parsed = ComparisonModeSchema.safeParse(mode);
    if (!parsed.success) {
      throw badRequest("Unknown comparison mode");
    }
    return reply(
      c,
      ChangesSchema,
      await comparisonChanges(binding(c), parsed.data)
    );
  });
  app.get(routes.files(M), async (c) =>
    reply(
      c,
      FileTreeSchema,
      c.req.query("scope") === "shared"
        ? await sharedFiles.list(
            missions.get(param(c, "missionId")).id,
            c.req.query("dir") ?? ""
          )
        : await listWorkspaceDir(binding(c), c.req.query("dir") ?? "")
    )
  );
  app.get(routes.file(M), async (c) =>
    reply(
      c,
      FileContentSchema,
      c.req.query("scope") === "shared"
        ? await sharedFiles.read(
            missions.get(param(c, "missionId")).id,
            c.req.query("path") ?? ""
          )
        : await readWorkspaceFile(binding(c), c.req.query("path") ?? "")
    )
  );
  app.get(routes.artifact(M, ":artifactId"), async (c) => {
    const missionId = param(c, "missionId");
    const artifact = missions.artifact(missionId, param(c, "artifactId"));
    const file = artifacts.filePath(artifact);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      throw notFound("Artifact file");
    }
    // SVG and unknown types download instead of rendering: they can carry script.
    const inline = INLINE.test(artifact.mediaType);
    const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
    return c.body(body, 200, {
      "cache-control": "private, max-age=3600",
      "content-disposition": contentDisposition(artifact.name, inline),
      "content-length": String(info.size),
      "content-security-policy": "default-src 'none'; sandbox",
      "content-type": inline ? artifact.mediaType : "application/octet-stream",
      "x-content-type-options": "nosniff",
    });
  });
};
