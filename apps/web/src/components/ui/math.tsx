"use client";

import { fromHtmlIsomorphic } from "hast-util-from-html-isomorphic";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import type { ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import temml from "temml";

import { CopyButton } from "@/components/ui/copy-button";
import { ScrollArea } from "@/components/ui/scroll-area";

import "temml/dist/Temml-Local.css";

type MathRoot = ReturnType<typeof fromHtmlIsomorphic>;
type MathElement = Extract<MathRoot["children"][number], { type: "element" }>;
type MathChild = MathElement["children"][number];

const MAX_TEX_LENGTH = 4000;
const MAX_CACHED = 256;
const completed = new Map<string, ReactNode>();
const MATH_ELEMENTS = new Set([
  "math",
  "mrow",
  "mi",
  "mn",
  "mo",
  "mtext",
  "mspace",
  "ms",
  "mfrac",
  "msqrt",
  "mroot",
  "mstyle",
  "merror",
  "mpadded",
  "mphantom",
  "msub",
  "msup",
  "msubsup",
  "munder",
  "mover",
  "munderover",
  "mmultiscripts",
  "mprescripts",
  "none",
  "mtable",
  "mtr",
  "mtd",
  "semantics",
  "annotation",
]);
const MATH_ATTRIBUTES = new Set([
  "accent",
  "accentunder",
  "columnalign",
  "columnspan",
  "depth",
  "display",
  "displaystyle",
  "encoding",
  "fence",
  "form",
  "height",
  "linethickness",
  "lspace",
  "mathsize",
  "mathvariant",
  "maxsize",
  "minsize",
  "movablelimits",
  "rowalign",
  "rowspan",
  "rspace",
  "scriptlevel",
  "separator",
  "stretchy",
  "symmetric",
  "voffset",
  "width",
  "xmlns",
]);
const MATH_STYLES = new Set([
  "display",
  "font-style",
  "font-weight",
  "height",
  "justify-content",
  "margin-left",
  "margin-right",
  "math-depth",
  "math-style",
  "max-width",
  "min-width",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "text-align",
  "vertical-align",
  "width",
]);
const UNSAFE_STYLE = /url\s*\(|expression\s*\(|var\s*\(|@import|[<>{}\\]/iu;
const VENDOR_CLASS = /^(?:tml-[a-z-]+|mathcal|mathscr|menclose|ff-[a-z-]+)$/u;

const mathStyle = (value: string) =>
  value
    .split(";")
    .filter((declaration) => {
      const separator = declaration.indexOf(":");
      const name = declaration.slice(0, separator).trim().toLowerCase();
      return MATH_STYLES.has(name) && !UNSAFE_STYLE.test(declaration);
    })
    .join(";");

const sanitizeProperties = (element: MathElement) => {
  const properties: MathElement["properties"] = {};
  for (const [name, value] of Object.entries(element.properties)) {
    if (name === "style" && typeof value === "string") {
      const style = mathStyle(value);
      if (style) {
        properties.style = style;
      }
    } else if (name === "className" && Array.isArray(value)) {
      const classes = value.filter(
        (item): item is string =>
          typeof item === "string" && VENDOR_CLASS.test(item)
      );
      if (classes.length > 0) {
        properties.className = classes;
      }
    } else if (MATH_ATTRIBUTES.has(name)) {
      properties[name] = value;
    }
  }
  return properties;
};

/** Only inert MathML and the vendor's layout styles cross into React. */
const sanitizeChildren = (children: MathChild[]): MathChild[] => {
  const safe: MathChild[] = [];
  for (const child of children) {
    if (child.type === "text") {
      safe.push(child);
    } else if (child.type === "element" && MATH_ELEMENTS.has(child.tagName)) {
      child.properties = sanitizeProperties(child);
      child.children = sanitizeChildren(child.children);
      safe.push(child);
    }
  }
  return safe;
};

export const renderMath = (tex: string, display: boolean): ReactNode => {
  if (tex.length > MAX_TEX_LENGTH) {
    return null;
  }
  const key = JSON.stringify([tex, display]);
  if (completed.has(key)) {
    const cached = completed.get(key);
    completed.delete(key);
    completed.set(key, cached);
    return cached;
  }
  let result: ReactNode = null;
  try {
    const source = temml.renderToString(tex, {
      annotate: true,
      displayMode: display,
      macros: {},
      maxExpand: 1000,
      maxSize: [10, 10],
      throwOnError: true,
      trust: false,
    });
    const root = fromHtmlIsomorphic(source, { fragment: true });
    root.children = sanitizeChildren(
      root.children.filter((child) => child.type !== "doctype")
    );
    result = toJsxRuntime(root, { Fragment, jsx, jsxs });
  } catch {
    // Invalid and incomplete TeX remain literal source, never partial markup.
  }
  completed.set(key, result);
  if (completed.size > MAX_CACHED) {
    const oldest = completed.keys().next().value;
    if (oldest !== undefined) {
      completed.delete(oldest);
    }
  }
  return result;
};

export const MathFormula = ({
  tex,
  display,
  streaming = false,
}: {
  tex: string;
  display: boolean;
  streaming?: boolean;
}) => {
  const node = renderMath(tex, display);
  const content = node ?? (
    <span className="text-text-tertiary">
      <code className="font-mono whitespace-pre-wrap">{tex}</code>
      {streaming ? null : <span> Formula unavailable</span>}
    </span>
  );
  if (!display) {
    return content;
  }
  return (
    <div className="group relative min-w-0 py-xs" data-slot="math">
      <ScrollArea axis="x">{content}</ScrollArea>
      <div className="absolute top-xs right-xs opacity-0 transition-opacity duration-fast group-focus-within:opacity-100 group-hover:opacity-100">
        <CopyButton label="Copy TeX" value={tex} />
      </div>
    </div>
  );
};
