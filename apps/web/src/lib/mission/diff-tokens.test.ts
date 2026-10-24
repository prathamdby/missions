import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  HighlightedLine,
  highlightCode,
} from "@/components/ui/syntax-highlight";

import {
  MAX_HIGHLIGHT_LINE,
  highlightStreams,
  hunkStreams,
  mapHunkTokens,
  resultsFor,
  streamsKey,
} from "./diff-tokens";
import type { StreamLine } from "./diff-tokens";

const TAG = /<[^>]+>/gu;
const ENTITIES = new Map([
  ["&#x27;", "'"],
  ["&amp;", "&"],
  ["&gt;", ">"],
  ["&lt;", "<"],
  ["&quot;", '"'],
]);
const ENTITY = /&(?:amp|lt|gt|quot|#x27);/gu;

const textOf = (markup: string) =>
  markup
    .replaceAll(TAG, "")
    .replaceAll(ENTITY, (entity) => ENTITIES.get(entity) ?? entity);

const render = (
  text: string,
  tokens: Parameters<typeof HighlightedLine>[0]["tokens"]
) => renderToStaticMarkup(createElement(HighlightedLine, { text, tokens }));

const classesOf = (markup: string, content: string) =>
  [
    ...markup.matchAll(
      /<span class="(?<classes>[^"]*)">(?<text>[^<]*)<\/span>/gu
    ),
  ]
    .filter((match) => match.groups?.text === content)
    .map((match) => match.groups?.classes);

const tokenize = async (lines: readonly StreamLine[]) => {
  const { after, before } = hunkStreams(lines);
  const [old, next] = await Promise.all([
    before ? highlightCode(before, "typescript") : null,
    after ? highlightCode(after, "typescript") : null,
  ]);
  return mapHunkTokens(lines, old?.tokens ?? null, next?.tokens ?? null);
};

const line = (kind: StreamLine["kind"], text: string): StreamLine => ({
  kind,
  text,
});

describe("hunk streams", () => {
  it("splits a hunk into old and new text in diff order", () => {
    expect(
      hunkStreams([
        line("context", "a"),
        line("del", "b"),
        line("add", "c"),
        line("context", ""),
        line("add", "d"),
      ])
    ).toStrictEqual({ after: "a\nc\n\nd", before: "a\nb\n" });
  });

  it("blanks overlong lines so they cannot stall the tokenizer", () => {
    const long = "x".repeat(MAX_HIGHLIGHT_LINE + 1);
    expect(hunkStreams([line("add", long), line("add", "y")])).toStrictEqual({
      after: "\ny",
      before: "",
    });
    expect(
      mapHunkTokens([line("add", long)], null, [[{ content: long }]])
    ).toStrictEqual([null]);
  });
});

describe("diff token mapping", () => {
  it("highlights deletions against old text and additions against new text inside a multiline string", async () => {
    const lines = [
      line("context", "const message = `start"),
      line("del", "old middle"),
      line("add", "new middle"),
      line("context", "end`;"),
      line("context", "const after = 1;"),
    ];
    const rows = await tokenize(lines);
    expect(rows.every(Boolean)).toBeTruthy();
    expect(
      classesOf(render("old middle", rows[1]), "old middle")
    ).toStrictEqual(["text-syntax-string"]);
    expect(
      classesOf(render("new middle", rows[2]), "new middle")
    ).toStrictEqual(["text-syntax-string"]);
    expect(
      classesOf(render("const after = 1;", rows[4]), "const")
    ).toStrictEqual(["text-syntax-keyword"]);
  });

  it("resets syntax state between hunks separated by omitted lines", async () => {
    const first = [line("context", "/* opened in an earlier hunk")];
    const second = [line("add", "const value = 1;")];
    const [, separate] = await Promise.all([tokenize(first), tokenize(second)]);
    expect(
      classesOf(render("const value = 1;", separate[0]), "const")
    ).toStrictEqual(["text-syntax-keyword"]);
    const leaked = await tokenize([...first, ...second]);
    expect(leaked[1]?.map((token) => token.content).join("")).toBe(
      "const value = 1;"
    );
    expect(
      classesOf(render("const value = 1;", leaked[1]), "const value = 1;")
    ).toStrictEqual(["text-syntax-comment"]);
  });

  it("keeps empty lines aligned and plain", async () => {
    const lines = [
      line("add", "const a = 1;"),
      line("add", ""),
      line("del", ""),
      line("add", "\tconst b = 'two';"),
    ];
    const rows = await tokenize(lines);
    expect(rows[1]).toBeNull();
    expect(rows[2]).toBeNull();
    const tabbed = render("\tconst b = 'two';", rows[3]);
    expect(classesOf(tabbed, "const")).toStrictEqual(["text-syntax-keyword"]);
    expect(textOf(tabbed)).toBe("\tconst b = 'two';");
  });

  it("renders exactly each row's source text, including CRLF endings and markup characters", async () => {
    const lines = [
      line("context", "if (a < b && c) {\r"),
      line("del", '  return "<b>";\r'),
      line("add", "  return `<i>`;"),
      line("context", "}"),
    ];
    const rows = await tokenize(lines);
    for (const [index, { text }] of lines.entries()) {
      expect(rows[index]).not.toBeNull();
      expect(textOf(render(text, rows[index]))).toBe(text);
    }
  });

  it("leaves rows plain when tokens do not spell their text", () => {
    expect(
      mapHunkTokens([line("context", "abc"), line("add", "def")], null, [
        [{ content: "abX" }],
        [{ content: "def" }],
      ])
    ).toStrictEqual([null, [{ content: "def" }]]);
  });

  it("keeps every row plain for unsupported languages", () => {
    const lines = [line("context", "a < b"), line("add", "c")];
    const rows = mapHunkTokens(lines, null, null);
    expect(rows).toStrictEqual([null, null]);
    expect(render("a < b", rows[0])).toBe("a &lt; b");
  });
});

const pause = async () => {
  await Promise.resolve();
};

describe("highlight batches", () => {
  it("skips empty streams and turns a failed stream into plain text", async () => {
    const highlight = vi.fn<(code: string) => Promise<string>>(async (code) => {
      if (code === "bad") {
        throw new Error("grammar failed");
      }
      return await Promise.resolve(code.toUpperCase());
    });
    await expect(
      highlightStreams(["a", "", "bad", "b"], highlight, () => true, pause)
    ).resolves.toStrictEqual(["A", null, null, "B"]);
    expect(highlight).toHaveBeenCalledTimes(3);
  });

  it("stops highlighting once the batch is obsolete", async () => {
    let current = true;
    const highlight = vi.fn<(code: string) => Promise<string>>(async (code) => {
      current = false;
      return await Promise.resolve(code);
    });
    await highlightStreams(["a", "b", "c"], highlight, () => current, pause);
    expect(highlight).toHaveBeenCalledOnce();
  });

  it("ignores results computed for other content or another language", () => {
    const key = streamsKey("typescript", ["const a = 1;", ""]);
    const settled = { key, results: ["tokens", null] };
    expect(resultsFor(settled, key)).toStrictEqual(["tokens", null]);
    expect(
      resultsFor(settled, streamsKey("typescript", ["const a = 2;", ""]))
    ).toBeNull();
    expect(
      resultsFor(settled, streamsKey("javascript", ["const a = 1;", ""]))
    ).toBeNull();
    expect(resultsFor(null, key)).toBeNull();
    expect(streamsKey("ts", ["ab", ""])).not.toBe(streamsKey("ts", ["a", "b"]));
  });
});
