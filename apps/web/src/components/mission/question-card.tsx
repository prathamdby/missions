"use client";

import type { Question, QuestionItem } from "@missions/protocol/missions";
import { useMutation } from "@tanstack/react-query";
import { CheckIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { useMission } from "@/components/mission/mission-context";
import { reportMutationError } from "@/components/mission/report-error";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import {
  Checkbox,
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/selection";
import { api } from "@/lib/api/endpoints";
import { cn } from "@/lib/utils";

const OTHER = "__other__";

interface Draft {
  other: string;
  otherOn: boolean;
  selected: readonly string[];
}

const EMPTY_DRAFT: Draft = { other: "", otherOn: false, selected: [] };

const answerOf = (item: QuestionItem, draft: Draft) => {
  const picked = item.options.filter((option) =>
    draft.selected.includes(option)
  );
  const other =
    draft.otherOn || item.options.length === 0 ? draft.other.trim() : "";
  return [...picked, ...(other ? [other] : [])].join(", ");
};

const optionRow =
  "flex cursor-pointer items-start gap-md rounded-sm px-md py-sm transition-colors duration-fast hover:bg-surface-overlay has-[[data-state=checked]]:bg-surface-overlay";

const OtherInput = ({
  draft,
  onChange,
}: {
  draft: Draft;
  onChange: (draft: Draft) => void;
}) =>
  draft.otherOn ? (
    <Input
      aria-label="Your answer"
      className="mt-xs"
      onChange={(event) => onChange({ ...draft, other: event.target.value })}
      placeholder="Type your answer"
      value={draft.other}
    />
  ) : null;

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
        className={optionRow}
        htmlFor={`q${item.index}-${index}`}
        key={option}
      >
        <RadioGroupItem
          className="mt-2xs"
          id={`q${item.index}-${index}`}
          value={option}
        />
        <span className="type-body text-text">{option}</span>
      </label>
    ))}
    <div className={cn(optionRow, "flex-col items-stretch")}>
      <label
        className="flex cursor-pointer items-center gap-md"
        htmlFor={`q${item.index}-other`}
      >
        <RadioGroupItem id={`q${item.index}-other`} value={OTHER} />
        <span className="type-body text-text-secondary">Something else…</span>
      </label>
      <OtherInput draft={draft} onChange={onChange} />
    </div>
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
  <fieldset className="flex flex-col gap-xs">
    <legend className="sr-only">{item.question}</legend>
    {item.options.map((option, index) => (
      <label
        className={optionRow}
        htmlFor={`q${item.index}-${index}`}
        key={option}
      >
        <Checkbox
          checked={draft.selected.includes(option)}
          className="mt-2xs"
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
        <span className="type-body text-text">{option}</span>
      </label>
    ))}
    <div className={cn(optionRow, "flex-col items-stretch")}>
      <label
        className="flex cursor-pointer items-center gap-md"
        htmlFor={`q${item.index}-other`}
      >
        <Checkbox
          checked={draft.otherOn}
          id={`q${item.index}-other`}
          onCheckedChange={(checked) =>
            onChange({ ...draft, otherOn: checked === true })
          }
        />
        <span className="type-body text-text-secondary">Something else…</span>
      </label>
      <OtherInput draft={draft} onChange={onChange} />
    </div>
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
      <Textarea
        aria-label={item.question}
        onChange={(event) => onChange({ ...draft, other: event.target.value })}
        placeholder="Answer in your own words"
        value={draft.other}
      />
    );
  }
  return item.multiSelect ? (
    <MultiChoice draft={draft} item={item} onChange={onChange} />
  ) : (
    <SingleChoice draft={draft} item={item} onChange={onChange} />
  );
};

const AnsweredQuestions = ({ question }: { question: Question }) => {
  if (question.status === "cancelled") {
    return (
      <p className="flex items-center gap-sm type-caption text-text-tertiary">
        <XIcon aria-hidden="true" className="size-3.5" />
        Questions skipped
      </p>
    );
  }
  const answers = question.answers ?? [];
  return (
    <div className="ml-auto flex w-full max-w-prose flex-col rounded-md bg-surface-raised px-lg py-md">
      <p className="flex items-center gap-sm pb-sm type-caption text-text-secondary">
        <CheckIcon aria-hidden="true" className="size-3.5" />
        Answered {question.questions.length}{" "}
        {question.questions.length === 1 ? "question" : "questions"}
      </p>
      <dl className="flex flex-col">
        {question.questions.map((item) => (
          <div
            className="flex gap-lg border-t border-border-subtle py-sm type-caption"
            key={item.index}
          >
            <dt className="w-1/2 text-text-tertiary">{item.question}</dt>
            <dd className="w-1/2 font-medium text-text">
              {answers.find((answer) => answer.index === item.index)?.answer ??
                "—"}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
};

const PendingQuestions = ({ question }: { question: Question }) => {
  const { applyLocal, missionId, refresh } = useMission();
  const [step, setStep] = useState(0);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const items = question.questions;
  const item = items[step];

  const answer = useMutation({
    mutationFn: (cancelled: boolean) =>
      api.answerQuestion(missionId, question.id, {
        answers: cancelled
          ? []
          : items.map((entry) => ({
              answer: answerOf(entry, drafts[entry.index] ?? EMPTY_DRAFT),
              index: entry.index,
            })),
        cancelled,
        epoch: question.epoch,
      }),
    onError: (error) =>
      reportMutationError(error, refresh, "Could not send your answers"),
    onSuccess: (value) => applyLocal({ kind: "question", value }),
  });

  if (!item) {
    return null;
  }
  const draft = drafts[item.index] ?? EMPTY_DRAFT;
  const answered = (entry: QuestionItem) =>
    answerOf(entry, drafts[entry.index] ?? EMPTY_DRAFT) !== "";
  const last = step === items.length - 1;
  const hint = item.multiSelect ? "Select all that apply" : "Pick one";

  return (
    <Card aria-label="Questions from the agent">
      {items.length > 1 ? (
        <CardHeader>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-xs">
            {items.map((entry, index) => (
              <Button
                aria-current={index === step ? "step" : undefined}
                key={entry.index}
                onClick={() => setStep(index)}
                size="sm"
                variant={index === step ? "secondary" : "ghost"}
              >
                {answered(entry) && index !== step ? (
                  <CheckIcon aria-hidden="true" />
                ) : (
                  <span className="font-mono">{index + 1}</span>
                )}
                {entry.topic}
              </Button>
            ))}
          </div>
          <span className="font-mono text-xs text-text-tertiary">
            {step + 1} of {items.length}
          </span>
        </CardHeader>
      ) : null}
      <CardContent>
        <div className="flex flex-col gap-2xs">
          <h3 className="type-heading text-text">{item.question}</h3>
          <p className="type-caption text-text-tertiary">
            {item.options.length === 0 ? "Answer in your own words" : hint}
          </p>
        </div>
        <QuestionStep
          draft={draft}
          item={item}
          onChange={(next) =>
            setDrafts((current) => ({ ...current, [item.index]: next }))
          }
        />
      </CardContent>
      <CardFooter>
        <Button
          disabled={answer.isPending}
          onClick={() => answer.mutate(true)}
          variant="ghost"
        >
          Skip
        </Button>
        <span className="flex-1" />
        {step > 0 ? (
          <Button onClick={() => setStep(step - 1)} variant="ghost">
            Back
          </Button>
        ) : null}
        {last ? (
          <Button
            disabled={!items.every(answered) || answer.isPending}
            onClick={() => answer.mutate(false)}
            variant="primary"
          >
            {answer.isPending ? "Sending…" : "Send answers"}
          </Button>
        ) : (
          <Button
            disabled={!answered(item)}
            onClick={() => setStep(step + 1)}
            variant="primary"
          >
            Next
          </Button>
        )}
      </CardFooter>
    </Card>
  );
};

/** Clarifying questions: one step per question, then a compact answer summary. */
export const QuestionCard = ({ question }: { question: Question }) =>
  question.status === "pending" ? (
    <PendingQuestions question={question} />
  ) : (
    <AnsweredQuestions question={question} />
  );
