import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DiffRow } from "./diff-row";

vi.mock(import("@/lib/utils"), async () => await import("../../lib/utils"));

const classSet = (classes: string) =>
  new Set(classes.split(" ").filter(Boolean));
const spansOf = (markup: string) =>
  [
    ...markup.matchAll(
      /<span class="(?<classes>[^"]*)">(?<text>[^<]*)<\/span>/gu
    ),
  ].map((match) => ({
    classes: classSet(match.groups?.classes ?? ""),
    text: match.groups?.text ?? "",
  }));
const rowClasses = (markup: string) =>
  classSet(
    /<div class="(?<classes>[^"]*)"/u.exec(markup)?.groups?.classes ?? ""
  );
const gutterClasses =
  "flex h-5 w-9.5 shrink-0 items-center justify-end pr-md font-mono text-2xs leading-lg select-none";
const textClasses =
  "pl-lg font-mono text-2xs leading-lg whitespace-pre text-syntax-text";

describe("numbered file diff rows", () => {
  it.each([
    {
      gutter: "border-l-2 border-success bg-diff-add-gutter text-success",
      kind: "add",
      label: "Added: ",
      lineNumber: 14,
      row: "bg-diff-add",
    },
    {
      gutter: "border-l-2 border-danger bg-diff-del-gutter text-danger",
      kind: "del",
      label: "Removed: ",
      lineNumber: 7,
      row: "bg-diff-del",
    },
    {
      gutter: "text-diff-line-number",
      kind: "context",
      label: "",
      lineNumber: null,
      row: "",
    },
  ] as const)("preserves $kind chrome and number semantics", (line) => {
    const markup = renderToStaticMarkup(
      createElement(
        DiffRow,
        {
          kind: line.kind,
          lineNumber: line.lineNumber,
          variant: "file",
        },
        "  const answer = 42;"
      )
    );
    const spans = spansOf(markup);
    expect(rowClasses(markup)).toStrictEqual(
      classSet(`flex h-5 min-w-max shrink-0 items-center ${line.row}`)
    );
    expect(spans[0]).toStrictEqual({
      classes: classSet(`${gutterClasses} ${line.gutter}`),
      text: line.lineNumber === null ? "" : String(line.lineNumber),
    });
    expect(spans[1]).toStrictEqual({
      classes: classSet("sr-only"),
      text: line.label,
    });
    expect(spans[2]).toStrictEqual({
      classes: classSet(`${textClasses} pr-lg`),
      text: "  const answer = 42;",
    });
  });

  it("keeps zero line numbers and escapes source text without interpreting it as markup", () => {
    const markup = renderToStaticMarkup(
      createElement(
        DiffRow,
        {
          kind: "context",
          lineNumber: 0,
          variant: "file",
        },
        "<script> & text"
      )
    );
    expect(spansOf(markup)[0]?.text).toBe("0");
    expect(markup).toContain("&lt;script&gt; &amp; text");
  });
});

describe("signed tool diff rows", () => {
  it.each([
    {
      gutter: "border-l-2 border-success bg-diff-add-gutter text-success",
      kind: "add",
      row: "bg-diff-add",
      sign: "+",
    },
    {
      gutter: "border-l-2 border-danger bg-diff-del-gutter text-danger",
      kind: "del",
      row: "bg-diff-del",
      sign: "−",
    },
  ] as const)(
    "preserves $kind signs without file-only layout or screen-reader labels",
    (line) => {
      const markup = renderToStaticMarkup(
        createElement(
          DiffRow,
          {
            kind: line.kind,
            variant: "tool",
          },
          ""
        )
      );
      const spans = spansOf(markup);
      expect(rowClasses(markup)).toStrictEqual(
        classSet(`flex h-5 shrink-0 items-center ${line.row}`)
      );
      expect(spans).toStrictEqual([
        {
          classes: classSet(`${gutterClasses} ${line.gutter}`),
          text: line.sign,
        },
        { classes: classSet(textClasses), text: "" },
      ]);
      expect(markup).not.toContain("sr-only");
    }
  );
});
