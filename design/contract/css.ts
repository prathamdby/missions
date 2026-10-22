import { parse } from "postcss";
import type { Declaration } from "postcss";

import { definedVariables, isAuthorizedVariable } from "../manifest.ts";
import type { Manifest } from "../manifest.ts";

export type CssRule =
  | "css/no-theme-block"
  | "css/no-custom-property"
  | "css/no-unauthorized-variable"
  | "css/no-var-fallback"
  | "css/no-raw-color"
  | "css/no-raw-value";

export interface CssViolation {
  rule: CssRule;
  message: string;
  line: number;
  column: number;
}

/** Properties whose values must come from tokens rather than literals. */
const TOKENIZED_PROPERTY =
  /^(?:padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left|font-size|font-weight|font-family|line-height|letter-spacing|border-radius|box-shadow|text-shadow|z-index|opacity|transition-duration|animation-duration|transition-timing-function|animation-timing-function|scale)(?:-|$)/u;

const KEYWORDS = new Set([
  "auto",
  "currentcolor",
  "inherit",
  "initial",
  "none",
  "normal",
  "revert",
  "revert-layer",
  "transparent",
  "unset",
]);

const NAMED_COLORS = new Set(
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen".split(
    " "
  )
);

const HEX_COLOR = /#[\da-f]{3,8}\b/iu;
const COLOR_FUNCTION =
  /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/iu;
const VAR_REFERENCE = /var\(\s*(?<name>--[\w-]+)\s*(?<fallback>,)?/gu;
const PLAIN_VAR = /var\(\s*--[\w-]+\s*\)/gu;
const IMPORTANT = /!important\s*$/iu;
const WORD = /[a-z][\w-]*/giu;
const ZERO = /^-?0(?:\.0+)?(?:px|rem|em|s|ms|%)?$/u;
const NEGATE = /^-1$/u;
const LITERAL_TOKEN = /[\w.#%-]+/gu;

const position = (decl: Declaration) => ({
  column: decl.source?.start?.column ?? 1,
  line: decl.source?.start?.line ?? 1,
});

const rawColorIn = (value: string) => {
  const stripped = value.replaceAll(PLAIN_VAR, " ");
  if (HEX_COLOR.test(stripped) || COLOR_FUNCTION.test(stripped)) {
    return true;
  }
  return (stripped.match(WORD) ?? []).some((word) =>
    NAMED_COLORS.has(word.toLowerCase())
  );
};

const rawLiteralIn = (value: string) => {
  const stripped = value
    .replace(IMPORTANT, "")
    .replaceAll(PLAIN_VAR, " ")
    .replaceAll("calc(", " ")
    .replaceAll(/[(),*/+]/gu, " ");
  return (stripped.match(LITERAL_TOKEN) ?? []).find((token) => {
    const lower = token.toLowerCase();
    if (KEYWORDS.has(lower) || ZERO.test(token) || NEGATE.test(token)) {
      return false;
    }
    // A lone `-` is a calc operator, not a literal.
    return token !== "-";
  });
};

export const checkCss = (
  source: string,
  manifest: Manifest,
  from = "input.css"
): CssViolation[] => {
  const defined = definedVariables(manifest);
  const violations: CssViolation[] = [];
  const root = parse(source, { from });

  root.walkAtRules("theme", (rule) => {
    violations.push({
      column: rule.source?.start?.column ?? 1,
      line: rule.source?.start?.line ?? 1,
      message:
        "@theme blocks belong in the generated tokens.css. Add the token to design/tokens.json and run `pnpm design:tokens`.",
      rule: "css/no-theme-block",
    });
  });

  root.walkDecls((decl) => {
    const at = position(decl);
    const report = (rule: CssRule, message: string) =>
      violations.push({ ...at, message, rule });

    const inTheme =
      decl.parent?.type === "atrule" &&
      (decl.parent as { name?: string }).name === "theme";
    if (
      !inTheme &&
      decl.prop.startsWith("--") &&
      !decl.prop.startsWith("--tw-")
    ) {
      report(
        "css/no-custom-property",
        `"${decl.prop}" declares a new custom property. Add tokens to design/tokens.json instead.`
      );
    }

    for (const match of decl.value.matchAll(VAR_REFERENCE)) {
      const { name, fallback } = match.groups ?? {};
      if (name && !isAuthorizedVariable(manifest, defined, name)) {
        report(
          "css/no-unauthorized-variable",
          `"${name}" is not a token in design/tokens.json.`
        );
      }
      if (fallback) {
        report(
          "css/no-var-fallback",
          `var(${name}, …) has a fallback. Tokens are always defined, so fallbacks only hide raw values.`
        );
      }
    }

    if (rawColorIn(decl.value)) {
      report(
        "css/no-raw-color",
        `"${decl.prop}: ${decl.value}" uses a raw color. Use a --color-* token.`
      );
    }

    if (TOKENIZED_PROPERTY.test(decl.prop)) {
      const literal = rawLiteralIn(decl.value);
      if (literal !== undefined) {
        report(
          "css/no-raw-value",
          `"${decl.prop}" uses the raw value "${literal}". Use a token from design/tokens.json.`
        );
      }
    }
  });

  return violations.toSorted((a, b) => a.line - b.line || a.column - b.column);
};
