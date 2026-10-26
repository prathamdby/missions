import { describe, expect, it, vi } from "vitest";

import { normalizeMathDelimiters } from "./math-delimiters";

const inlineCases = [
  ["$a$", "$$a$$"],
  ["Answer: $a+b$.", "Answer: $$a+b$$."],
  [String.raw`Use \(a+b\).`, "Use $$a+b$$."],
  ["$$E=mc^2$$", "$$E=mc^2$$"],
  ["Use $$a + b$$ here.", "Use $$a + b$$ here."],
  ["$a\n+b$", "$$a\n+b$$"],
  ["$ a$ and $a $", "$ a$ and $a $"],
  ["$a$2", "$a$2"],
  ["$a$$", "$a$$"],
  ["$$$$", "$$$$"],
  [String.raw`$$\[d\]`, String.raw`$$\[d\]`],
  ["$a$ and $b$", "$$a$$ and $$b$$"],
  ["Costs $5 and $10.", "Costs $5 and $10."],
  ["Prices: $5 and $10. Formula: $x$.", "Prices: $5 and $10. Formula: $$x$$."],
  ["$5.00", "$5.00"],
  [String.raw`\$a$`, String.raw`\$a$`],
  [String.raw`\\$a$`, String.raw`\\$$a$$`],
  [String.raw`\\\(a\)`, String.raw`\\$$a$$`],
  [String.raw`\\(a\)`, String.raw`\\(a\)`],
  [String.raw`$a\$b$`, String.raw`$$a\$b$$`],
  [String.raw`$a\\$`, String.raw`$$a\\$$`],
  ["$a\n\nb$", "$a\n\nb$"],
  ["$$a\n\nb$$", "$$a\n\nb$$"],
  ["$a\n \t\nb$", "$a\n \t\nb$"],
  ["$a\n    code\nb$", "$$a\n    code\nb$$"],
  [
    `${String.raw`\(a`}\n\n${String.raw`b\)`}`,
    `${String.raw`\(a`}\n\n${String.raw`b\)`}`,
  ],
  ["$a `code` b$", "$a `code` b$"],
  [
    `${String.raw`\(a `}\`code\`${String.raw` b\)`}`,
    `${String.raw`\(a `}\`code\`${String.raw` b\)`}`,
  ],
] as const;

const displayCases = [
  ["$$\nx+y\n$$", "$$\nx+y\n$$"],
  ["before\n$$\nx+y\n$$\nafter", "before\n\n$$\nx+y\n$$\n\nafter"],
  [String.raw`\[x+y\]`, "$$\nx+y\n$$"],
  [String.raw`before \[x+y\] after`, "before\n\n$$\nx+y\n$$\n\nafter"],
  ["$$\n\nx\n\n- y\n \n$$", "$$\nx\n- y\n$$"],
  [`${String.raw`\[`}\n\nx\n\n- y\n\n${String.raw`\]`}`, "$$\nx\n- y\n$$"],
  [String.raw`\[x+y`, String.raw`\[x+y`],
  [`${String.raw`\[`}\n\nx\n\n- y`, `${String.raw`\[`}\n\nx\n\n- y`],
  ["$$\n\\int_0^1", "$$\n\\int_0^1"],
  ["before\n$$\n\n\\int_0^1\n\n- x", "before\n\n$$\n\\int_0^1\n- x"],
  ["$$\n  x\n    + y\n$$", "$$\n  x\n    + y\n$$"],
  [
    "before\r\n$$\r\n\r\nx\r\n\r\n$$\r\nafter",
    "before\r\n\r\n$$\r\nx\r\n$$\r\n\r\nafter",
  ],
  ["$$\n\n$$", "$$\n$$"],
  [String.raw`\[a\\]`, String.raw`\[a\\]`],
] as const;

const codeCases = [
  "`$a$` and $b$",
  "``$a$ ` \\(x\\)`` and $b$",
  "````$a$ `` \\[x\\]```` and $b$",
  "```md\n$a$ \\(x\\) \\[y\\]\n```\n$b$",
  "````md\n```\n$a$\n`````\n$b$",
  "~~~md\n$a$\n~~~~\n$b$",
  "  ```md\n$a$\n  ```\n$b$",
  "> ```md\n> $a$\n> ```\n$b$",
  "- ```md\n  $a$\n  ```\n$b$",
  "> - ~~~~md\n>   $a$\n>   ~~~~~\n$b$",
  "- item\n  ```\n  $a$\n  ```\n\n$b$",
  "> ```\n> $a$\n\n$b$",
  "- ```\n  $a$\n\n$b$",
  "-     $a$ \\(x\\)\n\n$b$",
  "> > ~~~\n> > $a$\n> > ~~~\n$b$",
  "~~~\n```\n$a$\n~~~\n$b$",
  "```\n$a$\n``` still code\n$a$\n```\n$b$",
  "``a\\`$a$`` and $b$",
  "    $a$ \\(x\\)\n\n$b$",
  "\t$a$ \\(x\\)\n\n$b$",
  ">     $a$\n\n$b$",
  "````\n$a$\n```\n$a$",
  "$a\n```\ncode\n```\nb$",
] as const;

const literalCases = [
  '<b title="$a$">label</b>',
  "<div>\n$a$ and \\(b\\)\n</div>",
  "<!-- $a$ and \\[b\\] -->",
  "[label](https://example.com/$a$)",
  '[label](https://example.com/ "$a$")',
  "![alt $a$](https://example.com/$b$)",
  "<https://example.com/$a$>",
  "[id$a$]: https://example.com/$b$",
  "[label][id$a$]\n\n[id$a$]: https://example.com/$b$",
  "[$a$][]\n\n[$a$]: https://example.com/$b$",
  "[$a$]\n\n[$a$]: https://example.com/$b$",
] as const;

const containerCases = [
  [String.raw`- \[x\]`, "- $$\n  x\n  $$"],
  [String.raw`> \[x\]`, "> $$\n> x\n> $$"],
  [String.raw`> - \[x\]`, "> - $$\n>   x\n>   $$"],
  [String.raw`12. \[x\]`, "12. $$\n    x\n    $$"],
  ["- \\[\n  x\n  \\]", "- $$\n  x\n  $$"],
  ["> \\[\n>x\n>\\]", "> $$\n> x\n> $$"],
  ["> - \\[\n>   x\n>   \\]", "> - $$\n>   x\n>   $$"],
  ["- $$\n  x\n  $$", "- $$\n  x\n  $$"],
  ["> $$\n> x\n> $$", "> $$\n> x\n> $$"],
  [
    String.raw`- before \[x\] after`,
    "- before\n  \n  $$\n  x\n  $$\n  \n  after",
  ],
  [
    String.raw`> before \[x\] after`,
    "> before\n> \n> $$\n> x\n> $$\n> \n> after",
  ],
  ["> \\[\r\n> x\r\n> \\]", "> $$\r\n> x\r\n> $$"],
  ["- \\[\n  - x\n  \\]", "- $$\n  - x\n  $$"],
  ["- item\n  - \\[x\\]", "- item\n  - $$\n    x\n    $$"],
  ["> before\n\\[x\\]\nafter", "> before\n> \n> $$\n> x\n> $$\n> \n> after"],
  ["- before\n\\[x\\]\nafter", "- before\n  \n  $$\n  x\n  $$\n  \n  after"],
] as const;

describe(normalizeMathDelimiters, () => {
  it.each(inlineCases)("normalizes inline math: %s", (input, expected) => {
    expect(normalizeMathDelimiters(input)).toBe(expected);
  });

  it.each(displayCases)("normalizes display math: %s", (input, expected) => {
    expect(normalizeMathDelimiters(input)).toBe(expected);
  });

  it.each(codeCases)("preserves code: %s", (input) => {
    const expected =
      input.endsWith("\n$b$") || input.endsWith(" and $b$")
        ? input.replace("$b$", () => "$$b$$")
        : input;
    expect(normalizeMathDelimiters(input)).toBe(expected);
  });

  it.each(literalCases)("preserves non-math Markdown spans: %s", (input) => {
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("normalizes visible link labels and text between inline HTML tags", () => {
    expect(
      normalizeMathDelimiters("<b>$x$</b> [label $y$](https://example.com/$a$)")
    ).toBe("<b>$$x$$</b> [label $$y$$](https://example.com/$a$)");
  });

  it.each(containerCases)(
    "keeps display math in its Markdown container: %s",
    (input, expected) => {
      expect(normalizeMathDelimiters(input)).toBe(expected);
    }
  );

  it("does not rescan a paragraph for every unmatched inline opener", () => {
    const input = String.raw`\( `.repeat(200);
    const original = String.prototype.startsWith;
    let searches = 0;
    const startsWith = vi
      .spyOn(String.prototype, "startsWith")
      .mockImplementation(function startsWith(
        this: string,
        search: string,
        position?: number
      ) {
        if (this === input && search === String.raw`\)`) {
          searches += 1;
        }
        return original.call(this, search, position);
      });
    try {
      expect(normalizeMathDelimiters(input)).toBe(input);
      expect(searches).toBeLessThanOrEqual(input.length);
    } finally {
      startsWith.mockRestore();
    }
  });

  it("can find closers after a failed search in an earlier paragraph", () => {
    const input = `${String.raw`\( missing`}\n\n${String.raw`\(x\)`}`;
    expect(normalizeMathDelimiters(input)).toBe(
      `${String.raw`\( missing`}\n\n$$x$$`
    );
  });

  it("does not repeat failed display-closer searches", () => {
    const input = String.raw`\[ `.repeat(200);
    const original = String.prototype.indexOf;
    let searches = 0;
    const indexOf = vi
      .spyOn(String.prototype, "indexOf")
      .mockImplementation(function indexOf(
        this: string,
        search: string,
        position?: number
      ) {
        if (this === input && search === String.raw`\]`) {
          searches += 1;
        }
        return original.call(this, search, position);
      });
    try {
      expect(normalizeMathDelimiters(input)).toBe(input);
      expect(searches).toBe(1);
    } finally {
      indexOf.mockRestore();
    }
  });

  it.each([
    ...inlineCases.map(([input]) => input),
    ...displayCases.map(([input]) => input),
    ...codeCases,
    ...literalCases,
    ...containerCases.map(([input]) => input),
  ])("is idempotent: %s", (input) => {
    const normalized = normalizeMathDelimiters(input);
    expect(normalizeMathDelimiters(normalized)).toBe(normalized);
  });

  it("preserves unrelated Markdown and escaped display delimiters", () => {
    const input = String.raw`# Heading

An [ordinary](https://example.com) paragraph.

\\[not display\\] and \$not math.
`;
    expect(normalizeMathDelimiters(input)).toBe(input);
  });
});
