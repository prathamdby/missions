import { fromMarkdown } from "mdast-util-from-markdown";

const WHITESPACE = /\s/u;
const DIGIT = /\d/u;
const HORIZONTAL_SPACE = /[ \t\r]/u;
const TRAILING_SPACE = /[ \t]+$/u;
const LINE_END = /\r?\n|$/gu;
const LIST_MARKER_CHARACTER = /[^\t >]/gu;
const LITERAL_NODES = new Set([
  "code",
  "inlineCode",
  "html",
  "definition",
  "image",
  "imageReference",
]);

type MarkdownNode = ReturnType<typeof fromMarkdown>["children"][number];

interface SourceLine {
  index: number;
  start: number;
  end: number;
  prefixEnd: number;
  continuation: string;
}

interface MathContext {
  mask: Uint8Array;
  lines: SourceLine[];
  failed: Map<string, number>;
}

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

const inheritContinuation = (node: MarkdownNode, lines: SourceLine[]) => {
  if (node.type !== "paragraph" || !node.position) {
    return;
  }
  const first = lines[node.position.start.line - 1];
  for (
    let index = node.position.start.line;
    index < node.position.end.line;
    index += 1
  ) {
    const line = lines[index];
    if (line && !line.continuation) {
      line.continuation = first?.continuation ?? "";
    }
  }
};

// Use the same CommonMark grammar as Streamdown, including nested containers.
const markdownContext = (source: string): MathContext => {
  const lines: SourceLine[] = [];
  let start = 0;
  for (const match of source.matchAll(LINE_END)) {
    lines.push({
      continuation: "",
      end: match.index,
      index: lines.length,
      prefixEnd: start,
      start,
    });
    start = match.index + match[0].length;
  }
  const tree = fromMarkdown(source, {
    mdastExtensions: [
      {
        beforeEnter(token) {
          if (
            token.type === "blockQuotePrefix" ||
            token.type === "listItemPrefix" ||
            token.type === "listItemIndent"
          ) {
            const line = lines[token.start.line - 1];
            if (line) {
              line.prefixEnd = Math.max(line.prefixEnd, token.end.offset);
            }
          }
        },
      },
    ],
  });
  for (const line of lines) {
    line.continuation = source
      .slice(line.start, line.prefixEnd)
      .replaceAll(LIST_MARKER_CHARACTER, " ");
  }
  const mask = new Uint8Array(source.length);
  const nodes = [...tree.children];
  while (nodes.length > 0) {
    const node = nodes.pop();
    if (!node?.position) {
      continue;
    }
    inheritContinuation(node, lines);
    if (LITERAL_NODES.has(node.type)) {
      mask.fill(1, node.position.start.offset, node.position.end.offset);
    } else if (node.type === "link" || node.type === "linkReference") {
      mask.fill(1, node.position.start.offset, node.position.end.offset);
      // Autolink URLs and implicit reference identifiers must remain literal.
      const explicitLabel =
        node.type === "link" || node.referenceType === "full";
      if (explicitLabel && source[node.position.start.offset ?? 0] !== "<") {
        for (const child of node.children) {
          mask.fill(
            0,
            child.position?.start.offset,
            child.position?.end.offset
          );
        }
        nodes.push(...node.children);
      }
    } else if ("children" in node) {
      nodes.push(...node.children);
    }
  }
  return { failed: new Map(), lines, mask };
};

const sourceLine = (lines: SourceLine[], index: number): SourceLine => {
  let low = 0;
  let high = lines.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if ((lines[middle]?.start ?? 0) <= index) {
      low = middle;
    } else {
      high = middle;
    }
  }
  const line = lines[low];
  if (!line) {
    throw new Error("Missing Markdown source line");
  }
  return line;
};

const isParagraphBoundary = (
  source: string,
  index: number,
  context: MathContext
): boolean => {
  if (source[index] !== "\n") {
    return false;
  }
  const line = sourceLine(context.lines, index + 1);
  return (
    line.end < source.length && !source.slice(line.prefixEnd, line.end).trim()
  );
};

const isDelimiterLine = (
  source: string,
  index: number,
  context: MathContext
): boolean => {
  const line = sourceLine(context.lines, index);
  return (
    !source.slice(line.prefixEnd, index).trim() &&
    !source.slice(index + 2, line.end).trim()
  );
};

const displaySpan = (
  source: string,
  context: MathContext,
  start: number,
  bracket: boolean,
  newline: string
): MathSpan | undefined => {
  const closing = bracket ? "\\]" : "$$";
  if (bracket && start < (context.failed.get("\\[") ?? 0)) {
    return;
  }
  let end = source.indexOf(closing, start + 2);
  while (end !== -1) {
    if (
      !isEscaped(source, end) &&
      (bracket || isDelimiterLine(source, end, context))
    ) {
      break;
    }
    end = source.indexOf(closing, end + closing.length);
  }
  // Unlike a dollar flow block, an unfinished bracket expression is literal.
  if (end === -1 && bracket) {
    context.failed.set("\\[", source.length);
    return;
  }
  const first = sourceLine(context.lines, start);
  const limit = end === -1 ? source.length : end;
  const body: string[] = [];
  for (let { index } = first; index < context.lines.length; index += 1) {
    const line = context.lines[index];
    if (!line || line.start > limit) {
      break;
    }
    // Strip only the enclosing container, not Markdown-looking TeX body text.
    const prefixEnd = Math.min(
      line.prefixEnd,
      line.start + first.continuation.length
    );
    const contentStart = Math.max(start + 2, prefixEnd);
    const value = source.slice(contentStart, Math.min(line.end, limit));
    if (value.trim()) {
      body.push(value);
    }
  }
  const lines = ["$$", ...body];
  if (end !== -1) {
    lines.push("$$");
  }
  return {
    display: true,
    end: end === -1 ? source.length : end + 2,
    value: lines.join(newline + first.continuation),
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
  context: MathContext,
  start: number,
  opening: string
): MathSpan | undefined => {
  const single = opening === "$";
  if (start < (context.failed.get(opening) ?? 0)) {
    return;
  }
  if (
    single &&
    (!source[start + 1] || WHITESPACE.test(source[start + 1] ?? ""))
  ) {
    return;
  }
  const closing = opening === "\\(" ? "\\)" : opening;
  let cursor = start + opening.length;
  while (cursor < source.length) {
    if (context.mask[cursor] || isParagraphBoundary(source, cursor, context)) {
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
  context.failed.set(opening, cursor);
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
  context: MathContext,
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
    return displaySpan(source, context, start, true, newline);
  }
  if (source.startsWith("\\(", start)) {
    return inlineSpan(source, context, start, "\\(");
  }
  if (source[start] !== "$" || source[start - 1] === "$") {
    return;
  }
  const length = runLength(source, start);
  if (length === 2 && isDelimiterLine(source, start, context)) {
    return displaySpan(source, context, start, false, newline);
  }
  if (length <= 2) {
    return inlineSpan(source, context, start, "$".repeat(length));
  }
};

const beforeDisplay = (
  output: string,
  newline: string,
  prefix: string
): string => {
  const trimmed = output.replace(TRAILING_SPACE, "");
  if (!trimmed || trimmed.endsWith(`${newline}${newline}`)) {
    return trimmed + prefix;
  }
  if (trimmed.endsWith(`${newline}${prefix}${newline}`)) {
    return trimmed + prefix;
  }
  return `${trimmed}${trimmed.endsWith(newline) ? "" : newline}${prefix}${newline}${prefix}`;
};

const afterDisplay = (
  source: string,
  end: number,
  newline: string,
  prefix: string,
  context: MathContext
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
    source.startsWith(`${newline}${newline}`, cursor) ||
    source.startsWith(`${newline}${prefix}${newline}`, cursor)
  ) {
    return { end: cursor, separator: "" };
  }
  if (prefix && source.startsWith(newline, cursor)) {
    const next = sourceLine(context.lines, cursor + newline.length);
    if (next.prefixEnd === next.start && next.continuation === prefix) {
      return {
        end: next.start,
        separator: newline + prefix + newline + prefix,
      };
    }
  }
  return {
    end: cursor,
    separator: source.startsWith(newline, cursor)
      ? newline + prefix
      : newline + prefix + newline + prefix,
  };
};

/**
 * Canonicalize math for remark-math with singleDollarTextMath disabled.
 * Display bodies must remain one Streamdown block, including while streaming.
 */
export const normalizeMathDelimiters = (markdown: string): string => {
  const context = markdownContext(markdown);
  const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
  let output = "";
  let cursor = 0;
  while (cursor < markdown.length) {
    const span = context.mask[cursor]
      ? undefined
      : mathSpan(markdown, context, cursor, newline);
    if (!span) {
      output += markdown[cursor];
      cursor += 1;
      continue;
    }
    if (span.display) {
      const line = sourceLine(context.lines, cursor);
      const prefix = line.continuation;
      const ownLine = !markdown.slice(line.prefixEnd, cursor).trim();
      const originalPrefix = markdown.slice(line.start, line.prefixEnd);
      if (!(ownLine && originalPrefix && originalPrefix !== prefix)) {
        const content = ownLine
          ? output.slice(0, output.length - (cursor - line.start))
          : output;
        output = beforeDisplay(content, newline, prefix);
      }
      const suffix = afterDisplay(markdown, span.end, newline, prefix, context);
      output = `${output}${span.value}${suffix.separator}`;
      cursor = suffix.end;
    } else {
      output += span.value;
      cursor = span.end;
    }
  }
  return output;
};
