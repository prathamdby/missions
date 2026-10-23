/**
 * Design-contract rules that @shadcn/lint does not cover:
 * - no-off-scale-spacing: numeric spacing (`p-2`, `p-3.25`) bypasses the named Paper scale.
 * - no-unauthorized-variables: `var(--x)` / `bg-(--x)` must name a manifest token.
 */
import {
  definedVariables,
  isAuthorizedVariable,
  loadManifest,
} from "../manifest.ts";

interface Node {
  type: string;
  [key: string]: unknown;
}

interface Context {
  report: (diagnostic: { node: Node; message: string }) => void;
}

const PX_SUFFIX = /px$/u;

const manifest = loadManifest();
const defined = definedVariables(manifest);
const spacingTokens = new Map<string, string>(
  Object.entries(manifest.tokens.spacing)
    .filter(([key]) => !key.startsWith("$"))
    .map(([key, entry]) => [entry.value, key])
);
const spacingNames = new Set(spacingTokens.values());
const spacingBasePx = Number(manifest.spacingBase.value.replace(PX_SUFFIX, ""));

const CLASS_FUNCTIONS = new Set([
  "classNames",
  "clsx",
  "cn",
  "cva",
  "cx",
  "tv",
  "twJoin",
  "twMerge",
]);
const CLASS_ATTRIBUTES = new Set(["class", "className"]);

const SPACING_UTILITY =
  /^(?<utility>(?:scroll-)?(?<kind>[pm])[xytrblse]?|gap(?:-[xy])?|space-[xy])-(?<value>.+)$/u;
const SIZING_UTILITY =
  /^(?<utility>w|h|size|min-w|min-h|max-w|max-h|basis|inset(?:-[xy])?|top|right|bottom|left|start|end|translate-[xy])-(?<value>\d+\.\d+)$/u;
const NUMERIC = /^\d+(?:\.\d+)?$/u;
const HALF_STEP = /^\d+(?:\.5)?$/u;
const ARBITRARY = /^[[(]/u;
const SAFE_AREA_PADDING =
  /^\[max\(env\(safe-area-inset-(?<edge>top|right|bottom|left)\),var\(--spacing-(?<token>[a-z0-9-]+)\)\)\]$/u;
const EDGE_PADDING: Record<string, string> = {
  bottom: "pb",
  left: "pl",
  right: "pr",
  top: "pt",
};
const VARIABLE_REFERENCE = /(?:var\(\s*|\()(?<name>--[\w-]+)/gu;
const WHITESPACE = /\s+/u;

/** Strips variants (`md:hover:`), importance, and negation from a class. */
const baseUtility = (cls: string) => {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < cls.length; i += 1) {
    const char = cls[i];
    if (char === "[" || char === "(") {
      depth += 1;
    } else if (char === "]" || char === ")") {
      depth -= 1;
    } else if (char === ":" && depth === 0) {
      start = i + 1;
    }
  }
  let base = cls.slice(start);
  if (base.startsWith("!")) {
    base = base.slice(1);
  }
  if (base.endsWith("!")) {
    base = base.slice(0, -1);
  }
  return base.startsWith("-") ? base.slice(1) : base;
};

const scaleList = () =>
  [...spacingNames]
    .map((name) => `${name} (${manifest.tokens.spacing[name]?.value})`)
    .join(", ");

const spacingProblem = (cls: string): string | null => {
  const match = SPACING_UTILITY.exec(baseUtility(cls));
  if (!match?.groups) {
    return null;
  }
  const { utility, kind, value } = match.groups as {
    utility: string;
    kind?: string;
    value: string;
  };
  if (spacingNames.has(value) || value === "0") {
    return null;
  }
  if (value === "auto" && kind === "m") {
    return null;
  }
  // Device insets may raise a named padding floor, never introduce raw values.
  const safeArea = SAFE_AREA_PADDING.exec(value)?.groups;
  if (
    safeArea &&
    utility === EDGE_PADDING[safeArea.edge ?? ""] &&
    spacingNames.has(safeArea.token ?? "")
  ) {
    return null;
  }
  if (NUMERIC.test(value) || value === "px") {
    const px = value === "px" ? 1 : Number(value) * spacingBasePx;
    const named = spacingTokens.get(`${px}px`);
    return named
      ? `"${cls}" uses the numeric spacing scale. Use "${utility}-${named}" (${px}px) from the Paper scale.`
      : `"${cls}" is ${px}px, which is off the Paper spacing scale. Use one of: ${scaleList()}.`;
  }
  // Authored primitives allow arbitrary appearance, but spacing still uses names.
  if (ARBITRARY.test(value)) {
    return `"${cls}" uses an arbitrary spacing value. Use one of: ${scaleList()}.`;
  }
  return null;
};

const sizingProblem = (cls: string): string | null => {
  const match = SIZING_UTILITY.exec(baseUtility(cls));
  if (!match?.groups?.value || HALF_STEP.test(match.groups.value)) {
    return null;
  }
  return `"${cls}" uses an off-scale step. Sizing steps must be whole or half multiples of the ${manifest.spacingBase.value} base.`;
};

const stringsIn = (
  node: Node | null | undefined,
  out: { node: Node; text: string }[]
) => {
  if (!node) {
    return out;
  }
  switch (node.type) {
    case "Literal": {
      if (typeof node.value === "string") {
        out.push({ node, text: node.value });
      }
      break;
    }
    case "TemplateLiteral": {
      for (const quasi of node.quasis as Node[]) {
        const value = quasi.value as { cooked?: string | null; raw: string };
        out.push({ node: quasi, text: value.cooked ?? value.raw });
      }
      for (const expression of node.expressions as Node[]) {
        stringsIn(expression, out);
      }
      break;
    }
    case "JSXExpressionContainer": {
      stringsIn(node.expression as Node, out);
      break;
    }
    case "ConditionalExpression": {
      stringsIn(node.consequent as Node, out);
      stringsIn(node.alternate as Node, out);
      break;
    }
    case "LogicalExpression": {
      stringsIn(node.left as Node, out);
      stringsIn(node.right as Node, out);
      break;
    }
    case "ArrayExpression": {
      for (const element of node.elements as (Node | null)[]) {
        stringsIn(element, out);
      }
      break;
    }
    case "ObjectExpression": {
      for (const property of node.properties as Node[]) {
        if (property.type === "Property") {
          stringsIn(property.key as Node, out);
          stringsIn(property.value as Node, out);
        }
      }
      break;
    }
    default: {
      // Nested class-function calls are visited by their own CallExpression handler.
      break;
    }
  }
  return out;
};

const checkClassStrings = (context: Context, root: Node) => {
  for (const { node, text } of stringsIn(root, [])) {
    for (const cls of text.split(WHITESPACE)) {
      if (!cls) {
        continue;
      }
      const message = spacingProblem(cls) ?? sizingProblem(cls);
      if (message) {
        context.report({ message, node });
      }
    }
  }
};

const noOffScaleSpacing = {
  create(context: Context) {
    return {
      CallExpression(node: Node) {
        const callee = node.callee as Node;
        if (
          callee.type === "Identifier" &&
          CLASS_FUNCTIONS.has(callee.name as string)
        ) {
          for (const arg of node.arguments as Node[]) {
            checkClassStrings(context, arg);
          }
        }
      },
      JSXAttribute(node: Node) {
        const name = node.name as Node;
        if (
          name.type === "JSXIdentifier" &&
          CLASS_ATTRIBUTES.has(name.name as string)
        ) {
          checkClassStrings(context, node.value as Node);
        }
      },
    };
  },
  meta: {
    docs: { description: "Spacing must use the named Paper scale." },
    type: "problem",
  },
};

const checkVariables = (context: Context, node: Node, text: string) => {
  for (const match of text.matchAll(VARIABLE_REFERENCE)) {
    const name = match.groups?.name;
    if (name && !isAuthorizedVariable(manifest, defined, name)) {
      context.report({
        message: `"${name}" is not a token in design/tokens.json. Use a manifest token or add one there.`,
        node,
      });
    }
  }
};

const noUnauthorizedVariables = {
  create(context: Context) {
    return {
      Literal(node: Node) {
        if (typeof node.value === "string" && node.value.includes("--")) {
          checkVariables(context, node, node.value);
        }
      },
      TemplateElement(node: Node) {
        const value = node.value as { cooked?: string | null; raw: string };
        checkVariables(context, node, value.cooked ?? value.raw);
      },
    };
  },
  meta: {
    docs: { description: "CSS variables must be design-manifest tokens." },
    type: "problem",
  },
};

export default {
  meta: { name: "missions-design" },
  rules: {
    "no-off-scale-spacing": noOffScaleSpacing,
    "no-unauthorized-variables": noUnauthorizedVariables,
  },
};
