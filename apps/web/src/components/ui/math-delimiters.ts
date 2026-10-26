import { fromMarkdown } from "mdast-util-from-markdown";

const BLANK_LINE = /\n[ \t\r]*\n/u;
const WHITESPACE = /\s/u;
const DIGIT = /\d/u;
const HORIZONTAL_SPACE = /[ \t\r]/u;
const TRAILING_SPACE = /[ \t]+$/u;
const LINE_BREAK = /\r?\n/u;

interface MathSpan {
  end: number;
  value: string;
  display: boolean;
}

const isEscaped = (source: string, index: number): boolean => {
  let backslashes = 0;
  for (let cursor = index - 1; source[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
};

const runLength = (source: string, index: number): number => {
  let end = index + 1;
  while (source[end] === source[index]) {
    end += 1;
  }
  return end - index;
};

// Use the same CommonMark grammar as Streamdown, including nested containers.
const codeMask = (source: string): Uint8Array => {
  const mask = new Uint8Array(source.length);
  const nodes = [...fromMarkdown(source).children];
  while (nodes.length > 0) {
    const node = nodes.pop();
    if (node?.type === "code" || node?.type === "inlineCode") {
      mask.fill(1, node.position?.start.offset, node.position?.end.offset);
    } else if (node && "children" in node) {
      nodes.push(...node.children);
    }
  }
  return mask;
};

const isParagraphBoundary = (source: string, index: number): boolean => {
  if (source[index] !== "\n") {
    return false;
  }
  const end = source.indexOf("\n", index + 1);
  return end !== -1 && BLANK_LINE.test(source.slice(index, end + 1));
};

const isDelimiterLine = (source: string, index: number): boolean => {
  const start = source.lastIndexOf("\n", index - 1) + 1;
  const nextLine = source.indexOf("\n", index + 2);
  const end = nextLine === -1 ? source.length : nextLine;
  return (
    !source.slice(start, index).trim() && !source.slice(index + 2, end).trim()
  );
};

const displaySpan = (
  source: string,
  start: number,
  bracket: boolean,
  newline: string
): MathSpan | undefined => {
  const closing = bracket ? "\\]" : "$$";
  let end = source.indexOf(closing, start + 2);
  while (end !== -1) {
    if (!isEscaped(source, end) && (bracket || isDelimiterLine(source, end))) {
      break;
    }
    end = source.indexOf(closing, end + closing.length);
  }
  // Unlike a dollar flow block, an unfinished bracket expression is literal.
  if (end === -1 && bracket) {
    return;
  }
  const body = source
    .slice(start + 2, end === -1 ? source.length : end)
    .split(LINE_BREAK)
    .filter((line) => line.trim().length > 0);
  const lines = ["$$", ...body];
  if (end !== -1) {
    lines.push("$$");
  }
  return {
    display: true,
    end: end === -1 ? source.length : end + 2,
    value: lines.join(newline),
  };
};

const validInlineClose = (source: string, cursor: number, opening: string) => {
  if (opening === "\\(") {
    return true;
  }
  if (
    source[cursor - 1] === "$" ||
    runLength(source, cursor) !== opening.length
  ) {
    return false;
  }
  return (
    opening !== "$" ||
    (!WHITESPACE.test(source[cursor - 1] ?? "") &&
      !DIGIT.test(source[cursor + 1] ?? ""))
  );
};

const inlineSpan = (
  source: string,
  mask: Uint8Array,
  start: number,
  opening: string
): MathSpan | undefined => {
  const single = opening === "$";
  if (
    single &&
    (!source[start + 1] || WHITESPACE.test(source[start + 1] ?? ""))
  ) {
    return;
  }
  const closing = opening === "\\(" ? "\\)" : opening;
  let cursor = start + opening.length;
  while (cursor < source.length) {
    if (mask[cursor] || isParagraphBoundary(source, cursor)) {
      break;
    }
    if (source.startsWith(closing, cursor) && !isEscaped(source, cursor)) {
      if (validInlineClose(source, cursor, opening)) {
        return {
          display: false,
          end: cursor + closing.length,
          value: `$$${source.slice(start + opening.length, cursor)}$$`,
        };
      }
      if (single) {
        return;
      }
    }
    cursor += 1;
  }
  if (opening === "$$") {
    return {
      display: false,
      end: cursor,
      value: source.slice(start, cursor),
    };
  }
};

const mathSpan = (
  source: string,
  mask: Uint8Array,
  start: number,
  newline: string
): MathSpan | undefined => {
  const opening = source.slice(start, start + 2);
  if (source[start] !== "$" && opening !== "\\[" && opening !== "\\(") {
    return;
  }
  if (isEscaped(source, start)) {
    return;
  }
  if (source.startsWith("\\[", start)) {
    return displaySpan(source, start, true, newline);
  }
  if (source.startsWith("\\(", start)) {
    return inlineSpan(source, mask, start, "\\(");
  }
  if (source[start] !== "$" || source[start - 1] === "$") {
    return;
  }
  const length = runLength(source, start);
  if (length === 2 && isDelimiterLine(source, start)) {
    return displaySpan(source, start, false, newline);
  }
  if (length <= 2) {
    return inlineSpan(source, mask, start, "$".repeat(length));
  }
};

const beforeDisplay = (output: string, newline: string): string => {
  const trimmed = output.replace(TRAILING_SPACE, "");
  if (!trimmed || trimmed.endsWith(`${newline}${newline}`)) {
    return trimmed;
  }
  return `${trimmed}${trimmed.endsWith(newline) ? newline : newline + newline}`;
};

const afterDisplay = (
  source: string,
  end: number,
  newline: string
): { end: number; separator: string } => {
  let cursor = end;
  while (
    source[cursor] !== "\r" &&
    HORIZONTAL_SPACE.test(source[cursor] ?? "")
  ) {
    cursor += 1;
  }
  if (
    cursor === source.length ||
    source.startsWith(`${newline}${newline}`, cursor)
  ) {
    return { end: cursor, separator: "" };
  }
  return {
    end: cursor,
    separator: source.startsWith(newline, cursor) ? newline : newline + newline,
  };
};

/**
 * Canonicalize math for remark-math with singleDollarTextMath disabled.
 * Display bodies must remain one Streamdown block, including while streaming.
 */
export const normalizeMathDelimiters = (markdown: string): string => {
  const mask = codeMask(markdown);
  const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
  let output = "";
  let cursor = 0;
  while (cursor < markdown.length) {
    const span = mask[cursor]
      ? undefined
      : mathSpan(markdown, mask, cursor, newline);
    if (!span) {
      output += markdown[cursor];
      cursor += 1;
      continue;
    }
    if (span.display) {
      const suffix = afterDisplay(markdown, span.end, newline);
      output = `${beforeDisplay(output, newline)}${span.value}${suffix.separator}`;
      cursor = suffix.end;
    } else {
      output += span.value;
      cursor = span.end;
    }
  }
  return output;
};
