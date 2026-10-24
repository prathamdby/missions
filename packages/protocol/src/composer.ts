import { z } from "zod";

export const FileMatchSchema = z.object({
  kind: z.enum(["file", "folder"]),
  path: z.string(),
});
export type FileMatch = z.infer<typeof FileMatchSchema>;
export const FileMatchListSchema = z.object({
  matches: z.array(FileMatchSchema).max(50),
});
export type FileMatchList = z.infer<typeof FileMatchListSchema>;

export const ComposerCommandSchema = z.object({
  argumentHint: z.string().optional(),
  description: z.string(),
  kind: z.enum(["skill", "command"]),
  name: z.string(),
});
export type ComposerCommand = z.infer<typeof ComposerCommandSchema>;
export const ComposerCatalogSchema = z.object({
  commands: z.array(ComposerCommandSchema),
  source: z.enum(["droid", "unavailable"]),
});
export type ComposerCatalog = z.infer<typeof ComposerCatalogSchema>;
