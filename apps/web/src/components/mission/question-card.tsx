"use client";

import type { Question, QuestionItem } from "@missions/protocol/missions";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import { ChatCard } from "@/components/mission/chat-cards";
import { CloseIcon } from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import { reportMutationError } from "@/components/mission/report-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import {
  Checkbox,
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/selection";
import { api } from "@/lib/api/endpoints";
import { answerLabel, parseOption } from "@/lib/mission/questions";
import { cn } from "@/lib/utils";

const OTHER = "__other__";

interface Draft {
  other: string;
  otherOn: boolean;
  selected: readonly string[];
}

const EMPTY_DRAFT: Draft = { other: "", otherOn: false, selected: [] };

/** A single-choice question starts on the agent's recommended option, as in Paper QXJ. */
const initialDraft = (item: QuestionItem): Draft => {
  const recommended = item.multiSelect
    ? undefined
    : item.options.find((option) => parseOption(option).recommended);
  return recommended
    ? { ...EMPTY_DRAFT, selected: [recommended] }
    : EMPTY_DRAFT;
};

const answerOf = (item: QuestionItem, draft: Draft) => {
  const picked = item.options.filter((option) =>
    draft.selected.includes(option)
  );
  const other =
    draft.otherOn || item.options.length === 0 ? draft.other.trim() : "";
  return [...picked, ...(other ? [other] : [])].join(", ");
};

export const optionRow =
  "flex cursor-pointer gap-control rounded-sm px-lg py-control transition-colors duration-fast hover:bg-surface-overlay";
export const selectedRow =
  "bg-surface-active ring-1 ring-border hover:bg-surface-active";

/** Option label, Recommended tag, and detail line, as in Paper QXJ and VTC. */
export const OptionText = ({ option }: { option: string }) => {
  const { detail, label, recommended } = parseOption(option);
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-2xs">
      <span className="flex items-center gap-md">
        <span className="text-sm leading-sm font-medium tracking-tight text-text">
          {label}
        </span>
        {recommended ? (
          <Badge size="tag" tone="muted">
            Recommended
          </Badge>
        ) : null}
      </span>
      {detail ? (
        <span className="text-xs leading-sm font-book tracking-tight text-text-tertiary">
          {detail}
        </span>
      ) : null}
    </span>
  );
};

const OtherRow = ({
  control,
  draft,
  id,
  onChange,
}: {
  control: ReactNode;
  draft: Draft;
  id: string;
  onChange: (draft: Draft) => void;
}) => (
  <div
    className={cn(optionRow, "flex-col gap-sm", draft.otherOn && selectedRow)}
  >
    <label
      className="flex cursor-pointer items-center gap-control"
      htmlFor={id}
    >
      {control}
      <span className="text-sm leading-sm font-book tracking-tight text-text-tertiary">
        Something else…
      </span>
    </label>
    {draft.otherOn ? (
      <Input
        aria-label="Your answer"
        autoFocus
        onChange={(event) => onChange({ ...draft, other: event.target.value })}
        placeholder="Type your answer"
        value={draft.other}
      />
    ) : null}
  </div>
);

const SingleChoice = ({
  draft,
  item,
  onChange,
}: {
  draft: Draft;
  item: QuestionItem;
  onChange: (draft: Draft) => void;
}) => (
  <RadioGroup
    aria-label={item.question}
    onValueChange={(value) =>
      onChange(
        value === OTHER
          ? { ...draft, otherOn: true, selected: [] }
          : { ...draft, otherOn: false, selected: [value] }
      )
    }
    value={draft.otherOn ? OTHER : (draft.selected[0] ?? "")}
  >
    {item.options.map((option, index) => (
      <label
        className={cn(
          optionRow,
          "items-start",
          draft.selected.includes(option) && selectedRow
        )}
        htmlFor={`q${item.index}-${index}`}
        key={option}
      >
        <RadioGroupItem id={`q${item.index}-${index}`} value={option} />
        <OptionText option={option} />
      </label>
    ))}
    <OtherRow
      control={<RadioGroupItem id={`q${item.index}-other`} value={OTHER} />}
      draft={draft}
      id={`q${item.index}-other`}
      onChange={onChange}
    />
  </RadioGroup>
);

const MultiChoice = ({
  draft,
  item,
  onChange,
}: {
  draft: Draft;
  item: QuestionItem;
  onChange: (draft: Draft) => void;
}) => (
  <fieldset className="flex flex-col gap-2xs">
    <legend className="sr-only">{item.question}</legend>
    {item.options.map((option, index) => (
      <label
        className={cn(
          optionRow,
          "items-start",
          draft.selected.includes(option) && selectedRow
        )}
        htmlFor={`q${item.index}-${index}`}
        key={option}
      >
        <Checkbox
          checked={draft.selected.includes(option)}
          id={`q${item.index}-${index}`}
          onCheckedChange={(checked) =>
            onChange({
              ...draft,
              selected:
                checked === true
                  ? [...draft.selected, option]
                  : draft.selected.filter((entry) => entry !== option),
            })
          }
        />
        <OptionText option={option} />
      </label>
    ))}
    <OtherRow
      control={
        <Checkbox
          checked={draft.otherOn}
          id={`q${item.index}-other`}
          onCheckedChange={(checked) =>
            onChange({ ...draft, otherOn: checked === true })
          }
        />
      }
      draft={draft}
      id={`q${item.index}-other`}
      onChange={onChange}
    />
  </fieldset>
);

const QuestionStep = ({
  draft,
  item,
  onChange,
}: {
  draft: Draft;
  item: QuestionItem;
  onChange: (draft: Draft) => void;
}) => {
  if (item.options.length === 0) {
    return (
      <div className="px-md pb-sm">
        <Textarea
          aria-label={item.question}
          onChange={(event) =>
            onChange({ ...draft, other: event.target.value })
          }
          placeholder="Answer in your own words"
          value={draft.other}
        />
      </div>
    );
  }
  return item.multiSelect ? (
    <MultiChoice draft={draft} item={item} onChange={onChange} />
  ) : (
    <SingleChoice draft={draft} item={item} onChange={onChange} />
  );
};

/** Paper RHI: the answered questions, as a compact bubble on the user's side. */
const AnsweredQuestions = ({ question }: { question: Question }) => {
  if (question.status === "cancelled") {
    return (
      <p className="flex items-center gap-sm self-end text-xs leading-sm font-book tracking-tight text-text-tertiary">
        <CloseIcon aria-hidden="true" className="size-3.5" />
        Questions skipped
      </p>
    );
  }
  const answers = question.answers ?? [];
  const count = question.questions.length;
  return (
    <section
      aria-label="Your answers"
      className="flex w-full max-w-120 flex-col self-end rounded-md bg-surface-overlay px-card pt-lg pb-xs"
    >
      <h3 className="pb-md text-xs leading-sm font-medium tracking-tight text-text-secondary">
        Answered {count} {count === 1 ? "question" : "questions"}
      </h3>
      <dl className="flex flex-col">
        {question.questions.map((item) => {
          const answer = answers.find((entry) => entry.index === item.index);
          return (
            <div
              className="flex gap-lg border-t border-border-subtle py-md text-xs leading-sm tracking-tight"
              key={item.index}
            >
              <dt className="w-50 shrink-0 font-book text-text-tertiary">
                {item.question}
              </dt>
              <dd className="min-w-0 flex-1 font-medium text-text">
                {answer ? answerLabel(item.options, answer.answer) : "—"}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
};

const Tabs = ({
  items,
  onSelect,
  step,
}: {
  items: readonly QuestionItem[];
  onSelect: (step: number) => void;
  step: number;
}) => (
  <div className="flex items-center gap-2xs px-md pt-md">
    {items.map((entry, index) => (
      <button
        aria-current={index === step ? "step" : undefined}
        className={cn(
          "flex h-6.5 cursor-pointer items-center gap-sm rounded-sm px-md transition-colors duration-fast focus-visible:shadow-focus",
          index === step
            ? "bg-surface-active text-text"
            : "text-text-tertiary hover:text-text-secondary"
        )}
        key={entry.index}
        onClick={() => onSelect(index)}
        type="button"
      >
        <span className="font-mono text-2xs leading-xs font-book">
          {index + 1}
        </span>
        <span className="text-xs leading-sm font-medium tracking-tight">
          {entry.topic}
        </span>
      </button>
    ))}
    <span className="flex-1" />
    <span className="pr-sm font-mono text-2xs leading-xs font-book text-text-tertiary">
      {step + 1} of {items.length}
    </span>
  </div>
);

const PendingQuestions = ({ question }: { question: Question }) => {
  const { applyLocal, missionId, refresh } = useMission();
  const [step, setStep] = useState(0);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const items = question.questions;
  const item = items[step];

  const answer = useMutation({
    mutationFn: () =>
      api.answerQuestion(missionId, question.id, {
        answers: items.map((entry) => ({
          answer: answerOf(entry, drafts[entry.index] ?? initialDraft(entry)),
          index: entry.index,
        })),
        cancelled: false,
        epoch: question.epoch,
      }),
    onError: (error) =>
      reportMutationError(error, refresh, "Could not send your answers"),
    onSuccess: (value) => applyLocal({ kind: "question", value }),
  });

  if (!item) {
    return null;
  }
  const draft = drafts[item.index] ?? initialDraft(item);
  const answered = (entry: QuestionItem) =>
    answerOf(entry, drafts[entry.index] ?? initialDraft(entry)) !== "";
  const last = step === items.length - 1;
  let hint = item.multiSelect ? "Select all that apply" : "Pick one";
  if (item.options.length === 0) {
    hint = "Answer in your own words";
  }

  return (
    <ChatCard label="Questions from the agent" testId="question-card">
      {items.length > 1 ? (
        <Tabs items={items} onSelect={setStep} step={step} />
      ) : null}
      <div className="flex flex-col gap-xs px-card pt-card pb-control">
        <h3 className="text-lg leading-lg font-medium tracking-tight text-text">
          {item.question}
        </h3>
        <p className="text-xs leading-sm font-book tracking-tight text-text-tertiary">
          {hint}
        </p>
      </div>
      <div className="flex flex-col px-sm pb-sm">
        <QuestionStep
          draft={draft}
          item={item}
          onChange={(next) =>
            setDrafts((current) => ({ ...current, [item.index]: next }))
          }
        />
      </div>
      <div className="flex items-center gap-md border-t border-border-subtle px-card py-control">
        <span className="flex-1" />
        {step > 0 ? (
          <Button onClick={() => setStep(step - 1)} variant="ghost">
            Back
          </Button>
        ) : null}
        {last ? (
          <Button
            data-testid="question-submit"
            disabled={!items.every(answered) || answer.isPending}
            onClick={() => answer.mutate()}
            variant="primary"
          >
            {answer.isPending ? "Sending…" : "Send answers"}
          </Button>
        ) : (
          <Button
            data-testid="question-next"
            disabled={!answered(item)}
            onClick={() => setStep(step + 1)}
            variant="primary"
          >
            Next
          </Button>
        )}
      </div>
    </ChatCard>
  );
};

/** Paper QXJ clarifying questions: one tab per question, then a compact answer summary. */
export const QuestionCard = ({ question }: { question: Question }) =>
  question.status === "pending" ? (
    <PendingQuestions question={question} />
  ) : (
    <AnsweredQuestions question={question} />
  );
