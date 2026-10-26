"use client";

import { createLibrary, defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";

import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { CodeBlock } from "@/components/ui/code-block";
import { ProgressBar } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Step, StepList } from "@/components/ui/step-list";

const tone = z.enum(["info", "success", "warning", "danger"]);

const Stack = defineComponent({
  component: ({ props, renderNode }) => (
    <div className="flex w-full min-w-0 flex-col gap-md">
      {renderNode(props.children)}
    </div>
  ),
  description:
    "Full-width vertical layout. Use as the root of every interface.",
  name: "Stack",
  props: z.object({ children: z.array(z.any()) }),
});

const Text = defineComponent({
  component: ({ props }) => <p className="type-body text-text">{props.text}</p>,
  description: "Plain text, not Markdown or HTML.",
  name: "Text",
  props: z.object({ text: z.string() }),
});

const UiCallout = defineComponent({
  component: ({ props }) => (
    <Callout title={props.title} tone={props.tone}>
      {props.text}
    </Callout>
  ),
  description: "A titled notice with optional plain-text detail.",
  name: "Callout",
  props: z.object({
    text: z.string().optional(),
    title: z.string(),
    tone: tone.optional(),
  }),
});

const UiBadge = defineComponent({
  component: ({ props }) => (
    <div>
      <Badge tone={props.tone}>{props.text}</Badge>
    </div>
  ),
  description: "A short status label.",
  name: "Badge",
  props: z.object({ text: z.string(), tone: tone.optional() }),
});

const KeyValue = defineComponent({
  component: ({ props }) => (
    <dl className="flex min-w-0 flex-wrap gap-sm type-caption">
      <dt className="text-text-secondary">{props.label}</dt>
      <dd className="min-w-0 break-words text-text">{props.value}</dd>
    </dl>
  ),
  description: "A labeled plain-text value.",
  name: "KeyValue",
  props: z.object({ label: z.string(), value: z.string() }),
});

const Table = defineComponent({
  component: ({ props }) => (
    <ScrollArea axis="x">
      <table className="w-full border-collapse type-caption">
        <thead>
          <tr>
            {props.columns.map((column, index) => (
              <th
                className="border-b border-border-subtle px-md py-xs text-left font-medium text-text-secondary"
                key={`${index}:${column}`}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, index) => (
            <tr key={`${index}:${JSON.stringify(row)}`}>
              {row.map((cell, column) => (
                <td
                  className="border-b border-border-subtle px-md py-xs text-text"
                  key={`${column}:${cell}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  ),
  description:
    "Plain-text column headers and rows. Scrolls inside narrow containers.",
  name: "Table",
  props: z.object({
    columns: z.array(z.string()),
    rows: z.array(z.array(z.string())),
  }),
});

const Steps = defineComponent({
  component: ({ props }) => (
    <StepList>
      {props.items.map((item, index) => (
        <Step
          key={`${index}:${item.label}`}
          label={item.label}
          state={item.state}
        />
      ))}
    </StepList>
  ),
  description:
    "A progress checklist. Each item has a label and pending, active, or done state.",
  name: "Steps",
  props: z.object({
    items: z.array(
      z.object({
        label: z.string(),
        state: z.enum(["pending", "active", "done"]),
      })
    ),
  }),
});

const Progress = defineComponent({
  component: ({ props }) => (
    <ProgressBar label={props.label} value={props.value} />
  ),
  description: "Labeled progress from 0 to 100.",
  name: "Progress",
  props: z.object({ label: z.string(), value: z.number() }),
});

const Code = defineComponent({
  component: ({ props }) => <CodeBlock code={props.code} />,
  description: "An inert code block with a copy control.",
  name: "Code",
  props: z.object({ code: z.string() }),
});

export const missionsLibrary = createLibrary({
  components: [
    Stack,
    Text,
    UiCallout,
    UiBadge,
    KeyValue,
    Table,
    Steps,
    Progress,
    Code,
  ],
  root: "Stack",
});
