"use client";

import {
  createLibrary,
  defineComponent,
  FormNameContext,
  useFormName,
  useGetFieldValue,
  useIsStreaming,
  useSetFieldValue,
  useTriggerAction,
} from "@openuidev/react-lang";
import type { ComponentRenderProps } from "@openuidev/react-lang";
import { use, useId } from "react";
import { z } from "zod/v4";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { CodeBlock } from "@/components/ui/code-block";
import {
  GeneratedUiBlockContext,
  generatedUiUrl,
} from "@/components/ui/generated-ui-actions";
import { FieldLabel, Input, Textarea } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

const buttonProps = z.object({
  action: z.enum(["continue_conversation", "open_url"]),
  label: z.string(),
  message: z.string().optional(),
  url: z.string().optional(),
});
const GeneratedButton = ({
  props,
}: ComponentRenderProps<z.infer<typeof buttonProps>>) => {
  const reason = use(GeneratedUiBlockContext);
  const streaming = useIsStreaming();
  const trigger = useTriggerAction();
  const formName = useFormName();
  if (props.action === "open_url") {
    const url = generatedUiUrl(props.url);
    return url && !streaming ? (
      <Button asChild>
        <a href={url} rel="noopener noreferrer" target="_blank">
          {props.label}
        </a>
      </Button>
    ) : (
      <Button disabled title="Only complete http(s) links can open">
        {props.label}
      </Button>
    );
  }
  return (
    <Button
      disabled={reason !== null}
      title={reason ?? undefined}
      onClick={() => {
        if (reason === null) {
          void trigger(props.message ?? props.label, formName);
        }
      }}
    >
      {props.label}
    </Button>
  );
};
const UiButton = defineComponent({
  component: GeneratedButton,
  description:
    "Explicit user action. continue_conversation sends message (or label); open_url opens an absolute http(s) URL. Message controls work only in the latest main-agent reply.",
  name: "Button",
  props: buttonProps,
});

const Buttons = defineComponent({
  component: ({ props, renderNode }) => (
    <div className="flex min-w-0 flex-wrap gap-sm">
      {renderNode(props.children)}
    </div>
  ),
  description: "A wrapping row of Button components.",
  name: "Buttons",
  props: z.object({ children: z.array(z.any()) }),
});

const formProps = z.object({
  children: z.array(z.any()),
  message: z.string(),
  name: z.string(),
  submitLabel: z.string().optional(),
});
const GeneratedForm = ({
  props,
  renderNode,
}: ComponentRenderProps<z.infer<typeof formProps>>) => {
  const reason = use(GeneratedUiBlockContext);
  const trigger = useTriggerAction();
  return (
    <FormNameContext value={props.name}>
      <form
        className="flex min-w-0 flex-col gap-md"
        onSubmit={(event) => {
          event.preventDefault();
          if (reason === null) {
            void trigger(props.message, props.name);
          }
        }}
      >
        {renderNode(props.children)}
        <div>
          <Button
            disabled={reason !== null}
            title={reason ?? undefined}
            type="submit"
            variant="primary"
          >
            {props.submitLabel ?? "Send"}
          </Button>
        </div>
      </form>
    </FormNameContext>
  );
};
const Form = defineComponent({
  component: GeneratedForm,
  description:
    "Named form with an explicit submit button. Sends message plus current field values. Do not nest Forms.",
  name: "Form",
  props: formProps,
});

const useGeneratedField = (name: string, componentType: string) => {
  const id = useId();
  const formName = useFormName();
  const get = useGetFieldValue();
  const set = useSetFieldValue();
  const reason = use(GeneratedUiBlockContext);
  const value: unknown = get(formName, name);
  return {
    disabled: reason !== null,
    id,
    set: (next: string) => set(formName, componentType, name, next),
    value: typeof value === "string" ? value : "",
  };
};

const fieldProps = z.object({
  label: z.string(),
  name: z.string(),
  placeholder: z.string().optional(),
});

const GeneratedInput = ({
  props,
}: ComponentRenderProps<z.infer<typeof fieldProps>>) => {
  const field = useGeneratedField(props.name, "Input");
  return (
    <div className="flex min-w-0 flex-col gap-xs">
      <FieldLabel htmlFor={field.id}>{props.label}</FieldLabel>
      <Input
        disabled={field.disabled}
        id={field.id}
        maxLength={100_000}
        onChange={(event) => field.set(event.target.value)}
        placeholder={props.placeholder}
        value={field.value}
      />
    </div>
  );
};
const UiInput = defineComponent({
  component: GeneratedInput,
  description: "Labeled single-line text field inside a Form.",
  name: "Input",
  props: fieldProps,
});

const GeneratedTextArea = ({
  props,
}: ComponentRenderProps<z.infer<typeof fieldProps>>) => {
  const field = useGeneratedField(props.name, "TextArea");
  return (
    <div className="flex min-w-0 flex-col gap-xs">
      <FieldLabel htmlFor={field.id}>{props.label}</FieldLabel>
      <Textarea
        disabled={field.disabled}
        id={field.id}
        maxLength={100_000}
        onChange={(event) => field.set(event.target.value)}
        placeholder={props.placeholder}
        value={field.value}
      />
    </div>
  );
};
const UiTextArea = defineComponent({
  component: GeneratedTextArea,
  description: "Labeled multiline text field inside a Form.",
  name: "TextArea",
  // OpenUI tags each schema object with its component name.
  props: z.object(fieldProps.shape),
});

const selectProps = z.object({
  label: z.string(),
  name: z.string(),
  options: z.array(z.string()),
});
const GeneratedSelect = ({
  props,
}: ComponentRenderProps<z.infer<typeof selectProps>>) => {
  const field = useGeneratedField(props.name, "Select");
  return (
    <div className="flex min-w-0 flex-col gap-xs">
      <FieldLabel htmlFor={field.id}>{props.label}</FieldLabel>
      <Select
        disabled={field.disabled}
        onValueChange={(value) => field.set(value)}
        value={field.value}
      >
        <SelectTrigger id={field.id}>
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {props.options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
const UiSelect = defineComponent({
  component: GeneratedSelect,
  description: "Labeled choice from plain-text options inside a Form.",
  name: "Select",
  props: selectProps,
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
    UiButton,
    Buttons,
    Form,
    UiInput,
    UiTextArea,
    UiSelect,
  ],
  root: "Stack",
});
