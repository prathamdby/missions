/**
 * Shiki's tokenizer slows down quadratically on long lines (a 4,000-character
 * string literal takes most of a second), so longer lines stay plain and
 * leave an empty line in their stream.
 */
export const MAX_HIGHLIGHT_LINE = 1000;

export interface StreamLine {
  kind: "add" | "context" | "del";
  text: string;
}

interface TokenLike {
  content: string;
}

type TokenRows<T> = readonly (readonly T[])[];

const streamText = (text: string) =>
  text.length > MAX_HIGHLIGHT_LINE || text.includes("\n") ? "" : text;

/**
 * The two texts one hunk is highlighted as: `before` holds context and
 * deleted lines, `after` holds context and added lines, each in diff order.
 */
export const hunkStreams = (
  lines: readonly StreamLine[]
): { after: string; before: string } => {
  const before: string[] = [];
  const after: string[] = [];
  for (const line of lines) {
    const text = streamText(line.text);
    if (line.kind !== "add") {
      before.push(text);
    }
    if (line.kind !== "del") {
      after.push(text);
    }
  }
  return { after: after.join("\n"), before: before.join("\n") };
};

/*
 * Shiki splits lines on "\r\n", so a CRLF line's tokens lack its trailing
 * "\r"; the renderer appends whatever the tokens do not cover.
 */
const covers = (tokens: readonly TokenLike[], text: string) => {
  const joined = tokens.map((token) => token.content).join("");
  return joined === text || `${joined}\r` === text;
};

/**
 * Tokens for each diff row, in the unchanged row order: deleted rows read
 * from the `before` stream, added and context rows from the `after` stream.
 * A row whose tokens do not spell its exact text stays plain (null).
 */
export const mapHunkTokens = <T extends TokenLike>(
  lines: readonly StreamLine[],
  before: TokenRows<T> | null,
  after: TokenRows<T> | null
): (readonly T[] | null)[] => {
  let beforeIndex = 0;
  let afterIndex = 0;
  return lines.map((line) => {
    let tokens: readonly T[] | undefined;
    if (line.kind === "del") {
      tokens = before?.[beforeIndex];
      beforeIndex += 1;
    } else {
      tokens = after?.[afterIndex];
      afterIndex += 1;
      if (line.kind === "context") {
        beforeIndex += 1;
      }
    }
    if (!tokens || streamText(line.text) === "") {
      return null;
    }
    return covers(tokens, line.text) ? tokens : null;
  });
};

/** An identity for one batch of streams, so results stay tied to their input. */
export const streamsKey = (language: string, streams: readonly string[]) =>
  `${language}\n${streams.map((stream) => `${String(stream.length)}:${stream}`).join("")}`;

export interface SettledStreams<T> {
  key: string;
  results: readonly (T | null)[];
}

/** Results only for the exact batch they were computed from; stale ones read as null. */
export const resultsFor = <T>(
  settled: SettledStreams<T> | null,
  key: string
): readonly (T | null)[] | null =>
  settled?.key === key ? settled.results : null;

const nextTask = async () => {
  const { promise, resolve } = Promise.withResolvers<undefined>();
  setTimeout(resolve, 0);
  await promise;
};

/**
 * Highlights streams one at a time, yielding to the browser between them so a
 * long diff never blocks input for the whole batch. A failed or empty stream
 * reads as null, and the batch stops early once `isCurrent` turns false.
 */
export const highlightStreams = async <T>(
  streams: readonly string[],
  highlight: (code: string) => Promise<T>,
  isCurrent: () => boolean = () => true,
  pause: () => Promise<void> = nextTask
): Promise<(T | null)[]> => {
  const results: (T | null)[] = [];
  const from = async (index: number): Promise<void> => {
    const code = streams[index];
    if (code === undefined || !isCurrent()) {
      return;
    }
    if (code === "") {
      results.push(null);
    } else {
      try {
        results.push(await highlight(code));
      } catch {
        results.push(null);
      }
      await pause();
    }
    await from(index + 1);
  };
  await from(0);
  return results;
};
