"use client";

import type { ComponentProps } from "react";
import {
  defaultRehypePlugins,
  Streamdown,
  useIsCodeFenceIncomplete,
} from "streamdown";
import type { Components, StreamdownProps } from "streamdown";

import { CodeBlock, InlineCode } from "@/components/ui/code-block";
import {
  codePlugin,
  HighlightedCode,
  useHighlightedCode,
} from "@/components/ui/syntax-highlight";
import { cn } from "@/lib/utils";

const LANGUAGE = /language-(?<lang>[\w-]+)/u;
const TRAILING_NEWLINE = /\n$/u;

type Props<T extends keyof React.JSX.IntrinsicElements> = ComponentProps<T> & {
  node?: unknown;
};

const Paragraph = ({ node: _node, ...props }: Props<"p">) => (
  <p className="type-body text-text" {...props} />
);
const Heading1 = ({ children, node: _node, ...props }: Props<"h1">) => (
  <h3 className="mt-md type-heading text-text" {...props}>
    {children}
  </h3>
);
const Heading2 = ({ children, node: _node, ...props }: Props<"h2">) => (
  <h4 className="mt-md type-label font-semibold text-text" {...props}>
    {children}
  </h4>
);
const Heading3 = ({ children, node: _node, ...props }: Props<"h3">) => (
  <h5 className="mt-sm type-label text-text" {...props}>
    {children}
  </h5>
);
const List = ({ node: _node, ...props }: Props<"ul">) => (
  <ul
    className="flex list-disc flex-col gap-xs pl-xl marker:text-text-tertiary"
    {...props}
  />
);
const OrderedList = ({ node: _node, ...props }: Props<"ol">) => (
  <ol
    className="flex list-decimal flex-col gap-xs pl-xl marker:text-text-tertiary"
    {...props}
  />
);
const ListItem = ({ node: _node, ...props }: Props<"li">) => (
  <li className="type-body text-text" {...props} />
);

type LinkProps = Props<"a">;

/**
 * Same-page anchors (footnotes) stay in the tab; everything else opens a new
 * one. The sanitizer's own rel/target are replaced, not merged.
 */
const linkProps = ({
  href,
  node: _node,
  rel: _rel,
  target: _target,
  ...props
}: Omit<LinkProps, "children">) =>
  href?.startsWith("#")
    ? { ...props, href }
    : { ...props, href, rel: "noopener noreferrer", target: "_blank" };

const Link = ({ children, ...props }: LinkProps) => (
  <a
    className="text-info underline decoration-info/40 underline-offset-2 hover:decoration-info"
    {...linkProps(props)}
  >
    {children}
  </a>
);
const Quote = ({ node: _node, ...props }: Props<"blockquote">) => (
  <blockquote
    className="border-l-2 border-border-strong pl-lg text-text-secondary"
    {...props}
  />
);
const Table = ({ node: _node, ...props }: Props<"table">) => (
  <div className="overflow-x-auto">
    <table className="w-full border-collapse type-caption" {...props} />
  </div>
);
const TableHead = ({ node: _node, ...props }: Props<"th">) => (
  <th
    className="border-b border-border-subtle px-md py-xs text-left font-medium text-text-secondary"
    {...props}
  />
);
const TableCell = ({ node: _node, ...props }: Props<"td">) => (
  <td
    className="border-b border-border-subtle px-md py-xs text-text"
    {...props}
  />
);
const Rule = () => <hr className="border-border-subtle" />;

// Streamdown's defaults for these carry its own typography; plain elements keep ours.
const TableSection = ({ node: _node, ...props }: Props<"tbody">) => (
  <tbody {...props} />
);
const TableHeader = ({ node: _node, ...props }: Props<"thead">) => (
  <thead {...props} />
);
const TableRow = ({ node: _node, ...props }: Props<"tr">) => <tr {...props} />;
const Strong = ({ node: _node, ...props }: Props<"strong">) => (
  <strong className="font-semibold" {...props} />
);
const Superscript = ({ node: _node, ...props }: Props<"sup">) => (
  <sup {...props} />
);
const Subscript = ({ node: _node, ...props }: Props<"sub">) => (
  <sub {...props} />
);
const Section = ({ node: _node, ...props }: Props<"section">) => (
  <section className="flex flex-col gap-sm" {...props} />
);
/** Agent images open in a new tab rather than loading remote content inline. */
const Image = ({ alt, node: _node, src }: Props<"img">) =>
  typeof src === "string" ? (
    <a
      className="text-info underline decoration-info/40 underline-offset-2 hover:decoration-info"
      href={src}
      rel="noopener noreferrer"
      target="_blank"
    >
      {alt || src}
    </a>
  ) : null;

const Inline = ({ node: _node, ...props }: Props<"code">) => (
  <InlineCode {...props} />
);

/** A fenced block: app code chrome around Shiki tokens colored by design tokens. */
const Fence = ({ children, className }: Props<"code">) => {
  const incomplete = useIsCodeFenceIncomplete();
  const lang = LANGUAGE.exec(className ?? "")?.groups?.lang ?? "";
  const code = String(children ?? "").replace(TRAILING_NEWLINE, "");
  const highlighted = useHighlightedCode(code, lang, incomplete);
  return (
    <CodeBlock
      code={code}
      highlighted={
        highlighted ? (
          <HighlightedCode
            rest={highlighted.rest}
            result={highlighted.result}
          />
        ) : undefined
      }
      meta={
        lang ? (
          <span className="type-micro text-text-tertiary">{lang}</span>
        ) : undefined
      }
      title={lang ? " " : undefined}
    />
  );
};

const COMPONENTS: Components = {
  a: Link,
  blockquote: Quote,
  code: Fence,
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  h4: Heading3,
  h5: Heading3,
  h6: Heading3,
  hr: Rule,
  img: Image,
  inlineCode: Inline,
  li: ListItem,
  ol: OrderedList,
  p: Paragraph,
  section: Section,
  strong: Strong,
  sub: Subscript,
  sup: Superscript,
  table: Table,
  tbody: TableSection,
  td: TableCell,
  th: TableHead,
  thead: TableHeader,
  tr: TableRow,
  ul: List,
};

const PanelHeading = ({ children, node: _node, ...props }: Props<"h3">) => (
  <h3
    className="mt-sm text-sm leading-md font-medium tracking-tight text-text"
    {...props}
  >
    {children}
  </h3>
);
const PanelParagraph = ({ node: _node, ...props }: Props<"p">) => (
  <p className="type-body text-text-secondary" {...props} />
);
const PanelListItem = ({ node: _node, ...props }: Props<"li">) => (
  <li className="type-body text-text-secondary" {...props} />
);
const PanelLink = ({ children, ...props }: LinkProps) => (
  <a
    className="text-xs leading-sm font-book tracking-tight text-accent-text hover:underline"
    {...linkProps(props)}
  >
    {children}
  </a>
);
const PANEL_COMPONENTS: Components = {
  ...COMPONENTS,
  a: PanelLink,
  h1: PanelHeading,
  h2: PanelHeading,
  h3: PanelHeading,
  h4: PanelHeading,
  h5: PanelHeading,
  h6: PanelHeading,
  li: PanelListItem,
  p: PanelParagraph,
};

const { harden: hardenEntry, sanitize } = defaultRehypePlugins;
if (!(sanitize && Array.isArray(hardenEntry))) {
  throw new TypeError(
    "Streamdown no longer exposes its sanitize and harden plugins"
  );
}
const [harden] = hardenEntry;

/*
 * Streamdown's defaults minus `rehype-raw`, so HTML in agent output stays
 * literal text. Harden drops javascript:, data:, file: and vbscript: URLs and
 * any protocol outside its safe list, keeping the link text.
 */
const REHYPE_PLUGINS: StreamdownProps["rehypePlugins"] = [
  sanitize,
  [
    harden,
    {
      allowDataImages: false,
      allowedImagePrefixes: ["*"],
      allowedLinkPrefixes: ["*"],
      allowedProtocols: [],
      imageBlockPolicy: "text-only",
      linkBlockPolicy: "text-only",
    },
  ],
];

const PLUGINS: StreamdownProps["plugins"] = { code: codePlugin };
const LINK_SAFETY: StreamdownProps["linkSafety"] = { enabled: false };

/**
 * Agent-authored Markdown. Raw HTML is never rendered. `streaming` renders a
 * growing preview: blocks are memoized and unfinished syntax (open fences,
 * emphasis, links) is closed before parsing. Finished text renders statically.
 */
export const Markdown = ({
  children,
  className,
  appearance = "default",
  streaming = false,
}: {
  children: string;
  className?: string;
  appearance?: "default" | "panel";
  streaming?: boolean;
}) => (
  <Streamdown
    className={cn(
      // space-y-0 replaces Streamdown's root spacing; blocks use our gap instead.
      "flex min-w-0 flex-col space-y-0 break-words",
      appearance === "panel" ? "gap-sm" : "gap-md",
      className
    )}
    components={appearance === "panel" ? PANEL_COMPONENTS : COMPONENTS}
    controls={false}
    isAnimating={streaming}
    lineNumbers={false}
    linkSafety={LINK_SAFETY}
    mode={streaming ? "streaming" : "static"}
    parseIncompleteMarkdown={streaming}
    plugins={PLUGINS}
    rehypePlugins={REHYPE_PLUGINS}
  >
    {children}
  </Streamdown>
);
