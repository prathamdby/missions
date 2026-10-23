import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { CodeBlock, InlineCode } from "@/components/ui/code-block";
import { cn } from "@/lib/utils";

const LANGUAGE = /language-(?<lang>[\w-]+)/u;

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
const Link = ({ children, node: _node, ...props }: Props<"a">) => (
  <a
    className="text-info underline decoration-info/40 underline-offset-2 hover:decoration-info"
    rel="noopener noreferrer"
    target="_blank"
    {...props}
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

const Pre = ({ children }: Props<"pre">) => children;

const Code = ({
  children,
  className,
  node: _node,
  ...props
}: Props<"code">) => {
  const text = String(children ?? "");
  const lang = LANGUAGE.exec(className ?? "")?.groups?.lang;
  if (lang || text.includes("\n")) {
    return (
      <CodeBlock
        code={text.replace(/\n$/u, "")}
        meta={
          lang ? (
            <span className="type-micro text-text-tertiary">{lang}</span>
          ) : undefined
        }
        title={lang ? " " : undefined}
      />
    );
  }
  return <InlineCode {...props}>{children}</InlineCode>;
};

const COMPONENTS: Components = {
  a: Link,
  blockquote: Quote,
  code: Code,
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  hr: Rule,
  li: ListItem,
  ol: OrderedList,
  p: Paragraph,
  pre: Pre,
  table: Table,
  td: TableCell,
  th: TableHead,
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
const PanelLink = ({ children, node: _node, ...props }: Props<"a">) => (
  <a
    className="text-xs leading-sm font-book tracking-tight text-accent-text hover:underline"
    rel="noopener noreferrer"
    target="_blank"
    {...props}
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
  li: PanelListItem,
  p: PanelParagraph,
};

/** Agent-authored Markdown. Raw HTML is never rendered. */
export const Markdown = ({
  children,
  className,
  appearance = "default",
}: {
  children: string;
  className?: string;
  appearance?: "default" | "panel";
}) => (
  <div
    className={cn(
      "flex min-w-0 flex-col break-words",
      appearance === "panel" ? "gap-sm" : "gap-md",
      className
    )}
  >
    <ReactMarkdown
      components={appearance === "panel" ? PANEL_COMPONENTS : COMPONENTS}
      remarkPlugins={[remarkGfm]}
    >
      {children}
    </ReactMarkdown>
  </div>
);
