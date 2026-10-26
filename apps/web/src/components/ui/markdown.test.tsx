import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Markdown } from "./markdown";
import { HighlightedCode, highlightCode } from "./syntax-highlight";

const render = (text: string, streaming = false) =>
  renderToStaticMarkup(<Markdown streaming={streaming}>{text}</Markdown>);

const HEX = /#[\da-f]{3,8}\b/iu;
const INLINE_STYLE = /style="/u;
const TOKEN_SPAN = /<span class="text-syntax-(?<token>[a-z]+)">/gu;

describe("streaming markdown", () => {
  it("keeps incomplete Mermaid as code and mounts only complete fences", () => {
    const incomplete = render("```mermaid\nflowchart LR\nA --> B", true);
    expect(incomplete).toContain("<pre");
    expect(incomplete).not.toContain('data-slot="diagram"');
    const complete = render("```mermaid\nflowchart LR\nA --> B\n```", true);
    expect(complete).toContain('data-slot="diagram"');
    expect(complete).not.toContain("<pre");
  });

  it("renders an unclosed fence as a code block with app chrome", () => {
    const markup = render("Here:\n\n```ts\nconst answer = 4", true);
    expect(markup).toContain("<pre");
    expect(markup).toContain("const answer = 4");
    expect(markup).not.toContain("```");
    expect(markup).toContain('aria-label="Copy"');
  });

  it("closes dangling emphasis and keeps incomplete list items", () => {
    expect(render("Some **bold", true)).toContain(
      '<strong class="font-semibold">bold</strong>'
    );
    const list = render("1. one\n2. tw", true);
    expect(list).toContain("<ol");
    expect(list.match(/<li /gu)).toHaveLength(2);
    expect(list).toContain(">tw</li>");
  });

  it("shows an unfinished link as text, never as a broken anchor", () => {
    const markup = render("See [the docs](https://exa", true);
    expect(markup).toContain("the docs");
    expect(markup).not.toContain("<a ");
    expect(markup).not.toContain("streamdown:");
  });

  it("renders a table whose last row is still arriving", () => {
    const markup = render("| a | b |\n| - | - |\n| 1 | 2", true);
    expect(markup).toContain("<table");
    expect(markup).toContain("<th");
    expect(markup).toContain(">2</td>");
  });

  it("does not repair unfinished syntax in completed content", () => {
    expect(render("Some **bold")).toContain("Some **bold");
  });
});

describe("syntax highlighting", () => {
  it("colors fenced code with design-token classes, not raw colors", async () => {
    const code = 'const greet = (name: string) => "hi " + name;\n// done';
    await highlightCode(code, "ts");
    const markup = render(`\`\`\`ts\n${code}\n\`\`\``);
    const tokens = new Set(
      [...markup.matchAll(TOKEN_SPAN)].map((match) => match.groups?.token)
    );
    expect(tokens).toStrictEqual(
      new Set(["comment", "function", "keyword", "string", "text", "type"])
    );
    expect(markup).not.toMatch(HEX);
    expect(markup).not.toMatch(INLINE_STYLE);
    expect(markup).not.toContain("--shiki");
  });

  it("colors the highlighted prefix of a growing block and appends the rest plainly", async () => {
    const result = await highlightCode("const a = 1", "ts", true);
    const markup = renderToStaticMarkup(
      <HighlightedCode rest={";\nconst b"} result={result} />
    );
    expect(markup).toContain('<span class="text-syntax-keyword">const</span>');
    expect(markup.endsWith(";\nconst b")).toBeTruthy();
  });

  it("keeps plain text for unknown languages and copies the raw code", () => {
    const markup = render("```nosuchlang\na < b\n```");
    expect(markup).toContain("<code>a &lt; b</code>");
    expect(markup).not.toMatch(TOKEN_SPAN);
  });
});

describe("markdown safety", () => {
  it("leaves stray json-render tags as literal text", () => {
    const markup = render('<json-render>{"type":"Table"}</json-render>');
    expect(markup).toContain("&lt;json-render&gt;");
    expect(markup).toContain("&lt;/json-render&gt;");
    expect(markup).not.toContain("<json-render>");
    expect(markup).not.toContain("<table");
  });

  it("shows raw HTML as text instead of rendering it", () => {
    const markup = render(
      'Hi <b>bold</b> <script>alert(1)</script> <img src=x onerror="alert(1)">\n\n<div onclick="steal()">block</div>'
    );
    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("<b>");
    expect(markup).not.toContain("<div onclick");
    expect(markup).not.toContain("<img");
    expect(markup).toContain("&lt;script&gt;");
  });

  it("drops unsafe URLs but keeps their text", () => {
    const markup = render(
      "[a](javascript:alert(1)) [b](JAVASCRIPT:alert(1)) [c](data:text/html,hi) [d](vbscript:x) ![e](data:image/png;base64,AAAA)"
    );
    expect(markup).not.toMatch(/javascript:|vbscript:|data:/iu);
    expect(markup).not.toContain("<a ");
    expect(markup).not.toContain("<img");
    for (const label of ["a", "b", "c", "d", "e"]) {
      expect(markup).toContain(`<span>${label}</span>`);
    }
  });

  it("opens external links in a new tab without an opener", () => {
    const markup = render("[docs](https://example.com/x) and <me@example.com>");
    const anchors = markup.match(/<a [^>]*>/gu) ?? [];
    expect(anchors).toHaveLength(2);
    expect(anchors[0]).toContain('href="https://example.com/x"');
    expect(anchors[1]).toContain('href="mailto:me@example.com"');
    for (const anchor of anchors) {
      expect(anchor).toContain('rel="noopener noreferrer"');
      expect(anchor).toContain('target="_blank"');
    }
  });

  it("keeps footnote anchors in the same tab", () => {
    const markup = render("Claim[^1]\n\n[^1]: Source");
    expect(markup).toContain('href="#user-content-fn-1"');
    const anchors = markup.match(/<a [^>]*href="#[^>]*>/gu) ?? [];
    expect(anchors).toHaveLength(2);
    for (const anchor of anchors) {
      expect(anchor).not.toContain("target=");
    }
  });
});

describe("long transcripts", () => {
  it("renders 200 assistant messages with code blocks quickly", async () => {
    const code = "export const add = (a: number, b: number) => a + b;";
    await highlightCode(code, "ts");
    const messages = Array.from(
      { length: 200 },
      (_, index) =>
        `### Step ${index}\n\nUpdated **file-${index}.ts** with a [link](https://example.com/${index}):\n\n- one\n- two\n\n\`\`\`ts\n${code}\n\`\`\``
    );
    const started = performance.now();
    const markup = messages.map((message) => render(message)).join("");
    const elapsed = performance.now() - started;
    console.info(`Rendered 200 messages in ${elapsed.toFixed(0)}ms`);
    expect(markup.match(/<pre/gu)).toHaveLength(200);
    expect(elapsed).toBeLessThan(10_000);
  });
});

describe("math", () => {
  it.each(["Energy $$E=mc^2$$.", "$$E=mc^2$$", "$a+b$", String.raw`\(a\)`])(
    "renders inline math without a block: %s",
    (source) => {
      const markup = render(source);
      expect(markup).toContain("<math");
      expect(markup).not.toContain('display="block"');
      expect(markup).not.toContain('data-slot="math"');
    }
  );

  it.each(["$$\nb\n$$", String.raw`\[b\]`])(
    "renders display math with scrolling and a TeX copy control: %s",
    (source) => {
      const markup = render(source);
      expect(markup).toContain('data-slot="math"');
      expect(markup).toContain('display="block"');
      expect(markup).toContain("overflow-x-auto");
      expect(markup).toContain('aria-label="Copy TeX"');
    }
  );

  it.each([
    "$5 and $10",
    String.raw`Cost \$5; \$x\$`,
    "`$a$ $$b$$ \\(c\\) \\[d\\]`",
    "```text\n$a$ $$b$$ \\(c\\) \\[d\\]\n```",
    "~~~text\n$a$ $$b$$ \\(c\\) \\[d\\]\n~~~",
    String.raw`\[unfinished`,
  ])("leaves currency, escaped delimiters and code literal: %s", (source) => {
    expect(render(source)).not.toContain("<math");
  });

  it("keeps currency literal next to real math", () => {
    const markup = render("Prices: $5 and $10. Formula: $x$.");
    expect(markup).toContain("$5 and $10");
    expect(markup.match(/<math[ >]/gu)).toHaveLength(1);
    expect(markup).not.toContain("Formula unavailable");
  });

  it.each([false, true])(
    "keeps blank lines and Markdown-looking formula content in one display block (streaming=%s)",
    (streaming) => {
      const markup = render("Before\n\n$$\na\n\n- x\n$$\n\nAfter", streaming);
      expect(markup.match(/<math[ >]/gu)).toHaveLength(1);
      expect(markup).toContain('display="block"');
      expect(markup).not.toContain("<li");
      expect(markup).toContain("Before");
      expect(markup).toContain("After");
    }
  );

  it("does not expose display delimiters while a formula streams", () => {
    const markup = render("$$\n\\int_0^1", true);
    expect(markup).not.toContain("$$");
    expect(markup).toContain("<math");
  });

  it("strips agent math colors", () => {
    const markup = render(String.raw`$$\color{red}{x}$$`);
    expect(markup).toContain("<math");
    expect(markup).not.toMatch(/href=|javascript:|mathcolor=|style="color/iu);
  });

  it.each([
    String.raw`\href{javascript:alert(1)}{x}`,
    String.raw`\class{injected}{x}`,
  ])("shows untrusted commands only as inert source: %s", (tex) => {
    const markup = render(`$$${tex}$$`);
    expect(markup).toContain("Formula unavailable");
    expect(markup).not.toMatch(/<a |href=|mathcolor=|style="color/iu);
    expect(markup).not.toContain('class="injected"');
  });

  it("shows invalid source and a caption only after streaming finishes", () => {
    const source = "$$\\frac{a}{$$";
    const finished = render(source);
    expect(finished).toContain("Formula unavailable");
    expect(finished).toContain("\\frac{a}{");
    const streaming = render(source, true);
    expect(streaming).toContain("\\frac{a}{");
    expect(streaming).toContain("text-text-tertiary");
    expect(streaming).not.toContain("Formula unavailable");
  });

  it.each(["default", "panel", "thought"] as const)(
    "renders math in the %s appearance",
    (appearance) => {
      const markup = renderToStaticMarkup(
        <Markdown appearance={appearance}>$$E=mc^2$$</Markdown>
      );
      expect(markup).toContain("<math");
    }
  );

  it("renders five formulas across 200 messages within the transcript budget", () => {
    const message = String.raw`A $a+b$, B \(x^2\), C $$E=mc^2$$.

\[
\frac{1}{2}
\]

$$
\int_0^1 x\,dx
$$`;
    const started = performance.now();
    const markup = Array.from({ length: 200 }, () => render(message)).join("");
    expect(markup.match(/<math[ >]/gu)).toHaveLength(1000);
    expect(performance.now() - started).toBeLessThan(10_000);
  });
});
