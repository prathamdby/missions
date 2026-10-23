import type { DiffHunk } from "@missions/protocol/files";

const HUNK_HEADER =
  /^@@ -(?<old>\d+)(?:,\d+)? \+(?<new>\d+)(?:,(?<count>\d+))? @@/u;

/** "src/agent/" and "assemble.ts". */
export const splitPath = (path: string) => {
  const cut = path.lastIndexOf("/") + 1;
  return { dir: path.slice(0, cut), name: path.slice(cut) };
};

const firstNewLine = (hunk: DiffHunk) => {
  const match = HUNK_HEADER.exec(hunk.header);
  if (match?.groups?.new) {
    return Number(match.groups.new);
  }
  return hunk.lines.find((line) => line.newNumber !== null)?.newNumber ?? null;
};

const lastNewLine = (hunk: DiffHunk) => {
  for (let index = hunk.lines.length - 1; index >= 0; index -= 1) {
    const value = hunk.lines[index]?.newNumber;
    if (value !== null && value !== undefined) {
      return value;
    }
  }
  return null;
};

/**
 * Unchanged lines hidden before each hunk, from hunk start lines. Zero when
 * the hunks touch or the numbers are unknown.
 */
export const hunkGaps = (hunks: readonly DiffHunk[]): number[] => {
  let previousEnd = 0;
  return hunks.map((hunk) => {
    const start = firstNewLine(hunk);
    const end = lastNewLine(hunk);
    const gap = start === null ? 0 : Math.max(0, start - previousEnd - 1);
    if (end !== null) {
      previousEnd = end;
    }
    return gap;
  });
};
