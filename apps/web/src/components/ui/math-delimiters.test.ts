import { describe, expect, it } from "vitest";

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

  it.each([
    ...inlineCases.map(([input]) => input),
    ...displayCases.map(([input]) => input),
    ...codeCases,
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
