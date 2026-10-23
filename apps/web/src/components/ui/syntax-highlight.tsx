"use client";

import { createCodePlugin } from "@streamdown/code";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type {
  CodeHighlighterPlugin,
  HighlightResult,
  HighlightToken,
} from "streamdown";

/*
 * Shiki writes each token's theme color into an inline style. The theme below
 * uses design-token references as its colors, and the renderer turns those
 * references back into token utility classes, so highlighted code never
 * carries inline styles or raw colors.
 */
const SYNTAX = {
  comment: "var(--color-syntax-comment)",
  deleted: "var(--color-terminal-red)",
  function: "var(--color-syntax-function)",
  inserted: "var(--color-terminal-green)",
  keyword: "var(--color-syntax-keyword)",
  string: "var(--color-syntax-string)",
  text: "var(--color-syntax-text)",
  type: "var(--color-syntax-type)",
} as const;

const SYNTAX_CLASSES: Readonly<Record<string, string>> = {
  [SYNTAX.comment]: "text-syntax-comment",
  [SYNTAX.deleted]: "text-terminal-red",
  [SYNTAX.function]: "text-syntax-function",
  [SYNTAX.inserted]: "text-terminal-green",
  [SYNTAX.keyword]: "text-syntax-keyword",
  [SYNTAX.string]: "text-syntax-string",
  [SYNTAX.text]: "text-syntax-text",
  [SYNTAX.type]: "text-syntax-type",
};

const rule = (foreground: string, scope: string[]) => ({
  scope,
  settings: { foreground },
});

/** TextMate scopes grouped onto the six Paper syntax colors. */
const SYNTAX_THEME = {
  bg: "var(--color-bg)",
  fg: SYNTAX.text,
  name: "missions-syntax",
  settings: [
    { settings: { background: "var(--color-bg)", foreground: SYNTAX.text } },
    rule(SYNTAX.comment, [
      "comment",
      "punctuation.definition.comment",
      "punctuation",
      "meta.brace",
    ]),
    rule(SYNTAX.text, ["keyword.operator", "variable", "meta.embedded"]),
    rule(SYNTAX.keyword, [
      "keyword",
      "storage",
      "storage.type",
      "storage.modifier",
      "keyword.operator.new",
      "keyword.operator.expression",
      "constant.language",
      "variable.language",
      "entity.name.tag",
      "markup.heading",
      "punctuation.definition.template-expression",
    ]),
    rule(SYNTAX.string, [
      "string",
      "punctuation.definition.string",
      "string.regexp",
      "constant.numeric",
      "constant.character",
      "constant.other.symbol",
      "markup.inline.raw",
    ]),
    rule(SYNTAX.function, [
      "entity.name.function",
      "support.function",
      "meta.function-call entity.name.function",
      "markup.underline.link",
    ]),
    rule(SYNTAX.type, [
      "entity.name.type",
      "entity.name.class",
      "entity.other.inherited-class",
      "support.type",
      "support.class",
      "entity.other.attribute-name",
      "meta.object-literal.key",
      "support.type.property-name",
      "variable.other.property",
      "variable.other.object.property",
    ]),
    rule(SYNTAX.inserted, ["markup.inserted"]),
    rule(SYNTAX.deleted, ["markup.deleted"]),
  ],
  type: "dark" as const,
};

/** The Shiki highlighter plugin Streamdown is configured with. */
export const codePlugin: CodeHighlighterPlugin = createCodePlugin({
  themes: [SYNTAX_THEME, SYNTAX_THEME],
});

const tokenClass = (token: HighlightToken) => {
  const color = token.htmlStyle?.color ?? token.color;
  return color === undefined ? undefined : SYNTAX_CLASSES[color];
};

/** Renders Shiki tokens as token-colored spans for a `<code>` element. */
export const HighlightedCode = ({
  result,
  rest = "",
}: {
  result: HighlightResult;
  /** Unhighlighted text after the highlighted prefix, while a new pass runs. */
  rest?: string;
}) => {
  const nodes: ReactNode[] = [];
  let offset = 0;
  for (const [index, line] of result.tokens.entries()) {
    if (index > 0) {
      nodes.push("\n");
      offset += 1;
    }
    for (const token of line) {
      nodes.push(
        <span className={tokenClass(token)} key={offset}>
          {token.content}
        </span>
      );
      offset += token.content.length;
    }
  }
  if (rest) {
    nodes.push(rest);
  }
  return nodes;
};

interface Highlighted {
  code: string;
  result: HighlightResult;
}

const MAX_CACHED = 256;
const completed = new Map<string, HighlightResult>();
const pending = new Map<string, Promise<HighlightResult>>();

const cacheKey = (code: string, language: string) => `${language}\n${code}`;

const supportsLanguage = (language: string) =>
  language !== "" && codePlugin.supportsLanguage(language);

/**
 * Highlights code with the token theme. Finished blocks are cached so a
 * remount or server render shows colors on first paint; streaming blocks are
 * superseded by the next delta and are not cached.
 */
export const highlightCode = (
  code: string,
  language: string,
  incomplete = false
): Promise<HighlightResult> => {
  const key = cacheKey(code, language);
  const cached = completed.get(key);
  if (cached) {
    return Promise.resolve(cached);
  }
  const inFlight = pending.get(key);
  if (inFlight) {
    return inFlight;
  }
  const { promise: highlighted, resolve } =
    Promise.withResolvers<HighlightResult>();
  const ready = codePlugin.highlight(
    {
      code,
      isIncomplete: incomplete,
      language,
      themes: codePlugin.getThemes(),
    },
    resolve
  );
  if (ready) {
    resolve(ready);
  }
  const promise = highlighted.then((result) => {
    pending.delete(key);
    if (!incomplete) {
      completed.set(key, result);
      if (completed.size > MAX_CACHED) {
        const oldest = completed.keys().next().value;
        if (oldest !== undefined) {
          completed.delete(oldest);
        }
      }
    }
    return result;
  });
  pending.set(key, promise);
  return promise;
};

/**
 * Tokens for a code block, or null until highlighting finishes. While a
 * streaming block grows, the last result keeps coloring the prefix it covers.
 */
export const useHighlightedCode = (
  code: string,
  language: string,
  incomplete: boolean
): { rest: string; result: HighlightResult } | null => {
  const supported = supportsLanguage(language);
  const cached = supported
    ? completed.get(cacheKey(code, language))
    : undefined;
  const [latest, setLatest] = useState<Highlighted | null>(null);

  useEffect(() => {
    if (!supported || cached) {
      return;
    }
    let live = true;
    const run = async () => {
      const result = await highlightCode(code, language, incomplete);
      if (live) {
        setLatest({ code, result });
      }
    };
    void run();
    return () => {
      live = false;
    };
  }, [cached, code, incomplete, language, supported]);

  if (cached) {
    return { rest: "", result: cached };
  }
  if (supported && latest && code.startsWith(latest.code)) {
    return { rest: code.slice(latest.code.length), result: latest.result };
  }
  return null;
};
