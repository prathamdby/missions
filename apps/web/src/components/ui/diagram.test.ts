// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { sanitizeDiagram } from "./diagram";

describe("diagram sanitization", () => {
  it("removes handlers, references, unsafe styles, and foreign elements", () => {
    const node = sanitizeDiagram(`
      <svg xmlns="http://www.w3.org/2000/svg"
           xmlns:xlink="http://www.w3.org/1999/xlink" onload="run()">
        <g onclick="run()" href="https://example.com" xlink:href="javascript:run()"
           xml:base="https://example.com" style="fill:url(https://example.com/image)">
          <rect id="safe" width="10" height="10" fill="currentColor"/>
          <path style="fill:javascript:run()" d="M0 0L1 1"/>
          <circle onmouseover="run()" src="https://example.com" r="2"/>
          <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">unsafe</div></foreignObject>
          <script>run()</script><image href="https://example.com"/>
        </g>
      </svg>`);
    const host = document.createElement("div");
    host.append(node);
    const svg = host.querySelector("svg");
    expect(svg?.ownerDocument).toBe(document);
    expect(host.querySelectorAll("rect, path, circle")).toHaveLength(3);
    expect(
      host.querySelectorAll("foreignObject, div, script, image")
    ).toHaveLength(0);
    expect(
      [...host.querySelectorAll("*")].flatMap((element) =>
        [...element.attributes]
          .map((attribute) => attribute.name)
          .filter(
            (name) =>
              name.startsWith("on") ||
              ["href", "xlink:href", "src", "xml:base", "style"].includes(name)
          )
      )
    ).toStrictEqual([]);
    expect(host.querySelector("#safe")?.getAttribute("fill")).toBe(
      "currentColor"
    );
  });

  it.each([
    "<svg/>",
    '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>',
    '<html xmlns="http://www.w3.org/1999/xhtml"/>',
  ])("rejects invalid SVG: %s", (source) => {
    expect(() => sanitizeDiagram(source)).toThrow("Invalid diagram SVG");
  });

  it("retains safe diagram geometry and local marker references", () => {
    const host = document.createElement("div");
    host.append(
      sanitizeDiagram(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
        <defs><marker id="arrow"><path d="M0 0L1 1"/></marker></defs>
        <path d="M0 0L10 10" marker-end="url(#arrow)" style="stroke:currentColor"/>
        <text x="1" y="2">Safe label</text>
      </svg>`)
    );
    expect(host.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "0 0 10 10"
    );
    expect(host.querySelector("[marker-end]")?.getAttribute("marker-end")).toBe(
      "url(#arrow)"
    );
    expect(host.querySelector("[style]")?.getAttribute("style")).toBe(
      "stroke:currentColor"
    );
    expect(host.textContent).toContain("Safe label");
  });
});
