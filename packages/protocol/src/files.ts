import { z } from "zod";

export const FileNodeSchema = z.object({
  /** Git status code relative to the mission start revision, if changed. */
  change: z
    .enum(["added", "modified", "deleted", "renamed", "untracked"])
    .nullable(),
  path: z.string(),
  type: z.enum(["file", "directory"]),
});
export type FileNode = z.infer<typeof FileNodeSchema>;

export const FileTreeSchema = z.object({
  directory: z.string(),
  entries: z.array(FileNodeSchema),
  truncated: z.boolean(),
});
export type FileTree = z.infer<typeof FileTreeSchema>;

export const FileContentSchema = z.discriminatedUnion("kind", [
  z.object({
    content: z.string(),
    kind: z.literal("text"),
    path: z.string(),
    size: z.int().nonnegative(),
    truncated: z.boolean(),
  }),
  z.object({
    kind: z.literal("binary"),
    mediaType: z.string(),
    path: z.string(),
    size: z.int().nonnegative(),
  }),
  z.object({ kind: z.literal("missing"), path: z.string() }),
]);
export type FileContent = z.infer<typeof FileContentSchema>;

export const DiffLineSchema = z.object({
  kind: z.enum(["context", "add", "del"]),
  newNumber: z.int().nullable(),
  oldNumber: z.int().nullable(),
  text: z.string(),
});
export const DiffHunkSchema = z.object({
  header: z.string(),
  lines: z.array(DiffLineSchema),
});
export const FileDiffSchema = z.object({
  additions: z.int().nonnegative(),
  binary: z.boolean(),
  deletions: z.int().nonnegative(),
  hunks: z.array(DiffHunkSchema),
  oldPath: z.string().nullable(),
  path: z.string(),
  /** Changed before the mission started (baseline dirty state). */
  preExisting: z.boolean(),
  status: z.enum(["added", "modified", "deleted", "renamed", "untracked"]),
  /** Hunks were cut at the line budget; fetch the file diff for the rest. */
  truncated: z.boolean(),
});
export type FileDiff = z.infer<typeof FileDiffSchema>;
export type DiffHunk = z.infer<typeof DiffHunkSchema>;
export type DiffLine = z.infer<typeof DiffLineSchema>;

export const ChangesSchema = z.object({
  baseRevision: z.string().nullable(),
  files: z.array(FileDiffSchema),
  /** Digest of the reviewed change set; commit approvals must echo it. */
  hash: z.string(),
  head: z.string().nullable(),
  totals: z.object({
    additions: z.int().nonnegative(),
    deletions: z.int().nonnegative(),
    files: z.int().nonnegative(),
  }),
});
export type Changes = z.infer<typeof ChangesSchema>;
