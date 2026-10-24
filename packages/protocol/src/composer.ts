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
