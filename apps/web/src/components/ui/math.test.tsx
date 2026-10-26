import { renderToStaticMarkup } from "react-dom/server";
import temml from "temml";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MathFormula, renderMath } from "./math";

describe("native math", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses the rendered node for a TeX and display pair", () => {
    const node = renderMath("x^2+1", false);
    expect(renderToStaticMarkup(node)).toContain("<math");
    expect(renderMath("x^2+1", false)).toBe(node);
    expect(renderMath("x^2+1", true)).not.toBe(node);
  });

  it("keeps recently used nodes and evicts the oldest of 256 entries", () => {
    const oldest = renderMath("oldest", false);
    const recent = renderMath("recent", false);
    for (let index = 0; index < 254; index += 1) {
      renderMath(`x+${index}`, false);
    }
    expect(renderMath("recent", false)).toBe(recent);
    renderMath("newest", false);
    expect(renderMath("oldest", false)).not.toBe(oldest);
    expect(renderMath("recent", false)).toBe(recent);
  });

  it("does not leak macros between formulas", () => {
    expect(
      renderMath(String.raw`\gdef\isolated{x}\isolated`, false)
    ).not.toBeNull();
    expect(renderMath(String.raw`\isolated`, false)).toBeNull();
  });

  it("caps formula length and recursive macro expansion", () => {
    const renderer = vi.spyOn(temml, "renderToString");
    expect(renderMath("x".repeat(4001), false)).toBeNull();
    expect(renderer).not.toHaveBeenCalled();
    expect(renderMath(String.raw`\def\loop{\loop}\loop`, false)).toBeNull();
  });

  it("drops active markup, unsafe attributes, and agent colors at the MathML boundary", () => {
    vi.spyOn(temml, "renderToString").mockReturnValue(
      '<math onload="alert(1)" href="javascript:alert(1)" src="x" mathcolor="red" mathbackground="blue" style="color:red;background:url(javascript:evil);display:inline math"><mrow><mi onclick="evil()" style="color:red;padding-left:1em">x</mi><annotation-xml encoding="text/html"><script>evil()</script><img src="x"/></annotation-xml><a href="javascript:evil()">link</a></mrow></math>'
    );
    const markup = renderToStaticMarkup(renderMath("boundary fixture", false));
    expect(markup).toContain("<math");
    expect(markup).toContain(">x</mi>");
    expect(markup).toContain("padding-left:1em");
    expect(markup).not.toMatch(
      /onload|onclick|href|javascript:|src=|mathcolor|mathbackground|color:red|background|<script|<img|<a /iu
    );
  });

  it("bounds large TeX dimensions", () => {
    const markup = renderToStaticMarkup(
      renderMath(String.raw`\rule{1000em}{1000em}`, true)
    );
    expect(markup).toContain('height="10em"');
    expect(markup).not.toContain('height="1000em"');
    expect(markup).not.toContain("mathbackground");
  });

  it("renders an overlong formula as inert source with the finished caption", () => {
    const markup = renderToStaticMarkup(
      <MathFormula display={false} tex={"x".repeat(4001)} />
    );
    expect(markup).toContain("Formula unavailable");
    expect(markup).not.toContain("<math");
  });
});
