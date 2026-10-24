"use client";

import { mountAsync } from "pele/lazy";
import type { Mounted } from "pele/lazy";
import { useEffect, useRef, useState } from "react";

import { CodeBlock } from "@/components/ui/code-block";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SVG_ELEMENTS = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "defs",
  "marker",
  "clipPath",
  "title",
  "desc",
]);
const UNSAFE_STYLE =
  /url\s*\(\s*(?!#[\w-]+\s*\))|javascript:|expression\s*\(|@import/iu;

/** Import only inert SVG. Pele's links, images, and icons are also disabled. */
export const sanitizeDiagram = (source: string): Node => {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = parsed.documentElement;
  if (
    root.localName !== "svg" ||
    root.namespaceURI !== SVG_NAMESPACE ||
    parsed.querySelector("parsererror")
  ) {
    throw new Error("Invalid diagram SVG");
  }
  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (
      !SVG_ELEMENTS.has(element.localName) ||
      element.namespaceURI !== SVG_NAMESPACE
    ) {
      element.remove();
      continue;
    }
    const attributes = [...element.attributes];
    for (const attribute of attributes) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on") ||
        name.includes("href") ||
        name === "src" ||
        name === "xml:base" ||
        UNSAFE_STYLE.test(attribute.value)
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return document.importNode(root, true);
};

export const Diagram = ({ text }: { text: string }) => {
  const host = useRef<HTMLDivElement>(null);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const failed = failedSource === text;

  useEffect(() => {
    const element = host.current;
    if (!element || failed) {
      return;
    }
    let active = true;
    let mounted: Mounted | undefined;
    const fail = () => {
      if (active) {
        setFailedSource(text);
      }
    };
    const mount = async () => {
      try {
        const result = await mountAsync(element, text, {
          images: false,
          links: false,
          onError: fail,
          sanitize: sanitizeDiagram,
          zoom: false,
        });
        if (active) {
          mounted = result;
        } else {
          result.destroy();
        }
      } catch {
        fail();
      }
    };
    void mount();
    return () => {
      active = false;
      mounted?.destroy();
    };
  }, [failed, text]);

  if (failed) {
    return (
      <div className="flex min-w-0 flex-col gap-xs">
        <CodeBlock code={text} />
        <p className="text-xs leading-sm text-text-tertiary">
          Diagram unavailable
        </p>
      </div>
    );
  }
  return (
    <div
      aria-label="Mermaid diagram"
      className="pele min-w-0 overflow-x-auto rounded-sm bg-surface-raised p-md font-sans text-sm [&_svg]:max-w-full"
      data-slot="diagram"
      ref={host}
    />
  );
};
