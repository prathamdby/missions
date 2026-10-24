import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Thinking } from "./thinking";

describe("thinking disclosure", () => {
  it("renders streamed thought text as markdown", () => {
    const markup = renderToStaticMarkup(
      createElement(Thinking, { streaming: true, text: "**x**" })
    );
    expect(markup).toContain('<strong class="font-semibold">x</strong>');
    expect(markup).toContain("text-xs leading-sm text-text-secondary");
  });

  it("streams reasoning inside the open disclosure", () => {
    const markup = renderToStaticMarkup(
      createElement(Thinking, { streaming: true, text: "Checking the tests" })
    );
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("Thinking…");
    expect(markup).toContain('aria-label="Thinking"');
    const button = markup.indexOf("</button>");
    expect(markup.indexOf("Checking the tests")).toBeGreaterThan(button);
  });

  it("shows only the open disclosure before the first reasoning chunk", () => {
    const markup = renderToStaticMarkup(
      createElement(Thinking, { streaming: true, text: "" })
    );
    expect(markup).toContain("Thinking…");
    expect(markup).not.toContain("</p>");
  });

  it("collapses finished reasoning behind the Thought row", () => {
    const markup = renderToStaticMarkup(
      createElement(Thinking, { text: "Checking the tests" })
    );
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Thought");
    expect(markup).not.toContain("Checking the tests");
  });
});
