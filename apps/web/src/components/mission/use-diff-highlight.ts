"use client";

import { useEffect, useMemo, useState } from "react";
import type { HighlightResult, HighlightToken } from "streamdown";

import {
  cachedHighlight,
  highlightCode,
  supportsLanguage,
} from "@/components/ui/syntax-highlight";
import {
  highlightStreams,
  hunkStreams,
  mapHunkTokens,
  resultsFor,
  streamsKey,
} from "@/lib/mission/diff-tokens";
import type { SettledStreams, StreamLine } from "@/lib/mission/diff-tokens";

export type RowTokens = readonly (readonly HighlightToken[] | null)[];

interface StreamHunk {
  lines: readonly StreamLine[];
}

const cachedResults = (streams: readonly string[], language: string) => {
  const results: (HighlightResult | null)[] = [];
  for (const code of streams) {
    if (code === "") {
      results.push(null);
      continue;
    }
    const cached = cachedHighlight(code, language);
    if (!cached) {
      return null;
    }
    results.push(cached);
  }
  return results;
};

/**
 * Syntax tokens for every row of every hunk, or null while highlighting runs,
 * for plain-text files, and after a failure. Each hunk is highlighted on its
 * own, so syntax state never leaks across omitted lines; results apply only to
 * the exact content and language they were computed from.
 */
export const useDiffHighlight = (
  hunks: readonly StreamHunk[],
  language: string | null
): RowTokens[] | null => {
  const lang =
    language !== null && supportsLanguage(language) ? language : null;
  const streams = useMemo(
    () =>
      hunks.flatMap((hunk) => {
        const { after, before } = hunkStreams(hunk.lines);
        return [before, after];
      }),
    [hunks]
  );
  const key = useMemo(() => streamsKey(lang ?? "", streams), [lang, streams]);
  const cached = useMemo(
    () => (lang === null ? null : cachedResults(streams, lang)),
    [lang, streams]
  );
  const [settled, setSettled] =
    useState<SettledStreams<HighlightResult> | null>(null);

  useEffect(() => {
    if (lang === null || cached) {
      return;
    }
    let current = true;
    const run = async () => {
      const results = await highlightStreams(
        streams,
        (code) => highlightCode(code, lang),
        () => current
      );
      if (current) {
        setSettled((previous) =>
          previous?.key === key ? previous : { key, results }
        );
      }
    };
    void run();
    return () => {
      current = false;
    };
  }, [cached, key, lang, streams]);

  const results = lang === null ? null : (cached ?? resultsFor(settled, key));
  return useMemo(
    () =>
      results
        ? hunks.map((hunk, index) =>
            mapHunkTokens(
              hunk.lines,
              results[index * 2]?.tokens ?? null,
              results[index * 2 + 1]?.tokens ?? null
            )
          )
        : null,
    [hunks, results]
  );
};
