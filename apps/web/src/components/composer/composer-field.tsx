"use client";

import type { DeliveryMode } from "@missions/protocol/common";
import type { KeyboardEvent, ReactNode } from "react";
import { useId, useRef, useState, useSyncExternalStore } from "react";

import { ComposerSuggestions } from "@/components/composer/composer-suggestions";
import type { ComposerSuggestion } from "@/components/composer/composer-suggestions";
import { IconButton } from "@/components/ui/button";
import { ComposerBox, ComposerToolbar } from "@/components/ui/composer-box";
import { AtIcon, AttachIcon } from "@/components/ui/icons";
import { FileInput, Textarea } from "@/components/ui/input";
import { Popover, PopoverAnchor } from "@/components/ui/popover";
import { Hint } from "@/components/ui/tooltip";
import { composerTrigger, insertSuggestion } from "@/lib/composer/trigger";
import { useAttachments } from "@/lib/composer/use-attachments";
import { useComposerSuggestions } from "@/lib/composer/use-suggestions";
import type { ComposerScope } from "@/lib/composer/use-suggestions";
import type { MessageDraft } from "@/lib/mission/message-draft";

import { AttachmentChips } from "./attachment-chips";

export const ComposerField = ({
  action,
  children,
  disabled = false,
  draft,
  id,
  label,
  onSubmit,
  placeholder,
  scope,
  size = "responsive",
  testId,
}: {
  action: ReactNode;
  children?: ReactNode;
  disabled?: boolean;
  draft: MessageDraft;
  id?: string;
  label: string;
  onSubmit: (mode: DeliveryMode) => void;
  placeholder: string;
  scope: ComposerScope | null;
  size?: "responsive" | "touch";
  testId?: string;
}) => {
  const text = useSyncExternalStore(
    draft.subscribe,
    draft.snapshot,
    draft.snapshot
  );
  const attachments = useSyncExternalStore(
    draft.subscribe,
    draft.attachmentSnapshot,
    draft.attachmentSnapshot
  );
  const upload = useAttachments(draft, disabled);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [cursor, setCursor] = useState(text.length);
  const [dismissed, setDismissed] = useState("");
  const [selection, setSelection] = useState({ index: 0, key: "" });
  const trigger = composerTrigger(text, cursor);
  const key = trigger
    ? `${scope?.id}:${trigger.kind}:${trigger.range.start}:${trigger.query}`
    : "";
  const open =
    !disabled && scope !== null && trigger !== null && key !== dismissed;
  const { items, loading, unavailable } = useComposerSuggestions(
    scope,
    trigger,
    open
  );
  const activeIndex =
    selection.key === key ? Math.min(selection.index, items.length - 1) : 0;

  const choose = (item: ComposerSuggestion) => {
    if (!trigger) {
      return;
    }
    const next = insertSuggestion(text, trigger, item.value);
    draft.change(next.text);
    setCursor(next.cursor);
    setDismissed(key);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(next.cursor, next.cursor);
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (open) {
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(key);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setSelection({
          index: items.length
            ? (activeIndex + delta + items.length) % items.length
            : 0,
          key,
        });
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const item = items[activeIndex];
        if (item) {
          choose(item);
        }
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit(event.altKey ? "queue" : "steer");
    }
  };
  const mention = () => {
    const at = input.current?.selectionStart ?? text.length;
    const prefix = at > 0 && !/\s/u.test(text[at - 1] ?? "") ? " @" : "@";
    const next = `${text.slice(0, at)}${prefix}${text.slice(at)}`;
    draft.change(next);
    setCursor(at + prefix.length);
    setDismissed("");
    input.current?.focus();
    requestAnimationFrame(() =>
      input.current?.setSelectionRange(at + prefix.length, at + prefix.length)
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setDismissed(key);
        }
      }}
    >
      <PopoverAnchor asChild>
        <ComposerBox
          inert={disabled}
          onDragOver={(event) => event.preventDefault()}
          onDrop={upload.handleDrop}
          size={size}
        >
          <AttachmentChips
            draft={draft}
            files={attachments}
            missionId={scope?.kind === "mission" ? scope.id : undefined}
          />
          {upload.error ? (
            <p role="alert" className="text-xs text-danger">
              {upload.error}
            </p>
          ) : null}
          <FileInput
            aria-label="Choose attachments"
            multiple
            onChange={upload.handleSelect}
            ref={fileInput}
          />
          <Textarea
            aria-activedescendant={
              open && items[activeIndex]
                ? `${listId}-${activeIndex}`
                : undefined
            }
            aria-controls={open ? listId : undefined}
            aria-label={label}
            data-composer-input=""
            data-testid={testId}
            disabled={disabled}
            id={id}
            onChange={(event) => {
              draft.change(event.target.value);
              setCursor(event.target.selectionStart);
              setDismissed("");
            }}
            onKeyDown={onKeyDown}
            onPaste={upload.handlePaste}
            onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
            placeholder={placeholder}
            ref={input}
            rows={1}
            value={text}
            variant="bare"
          />
          <ComposerToolbar>
            <Hint label="Attach files">
              <IconButton
                onClick={() => fileInput.current?.click()}
                icon={<AttachIcon tone="secondary" />}
                label="Attach files"
                size="responsive"
              />
            </Hint>
            <Hint label="Mention a file">
              <IconButton
                disabled={!scope}
                icon={<AtIcon tone="secondary" />}
                label="Mention a file"
                onClick={mention}
                size="responsive"
              />
            </Hint>
            {children}
            <span className="flex-1" />
            {action}
          </ComposerToolbar>
        </ComposerBox>
      </PopoverAnchor>
      {open ? (
        <ComposerSuggestions
          activeIndex={activeIndex}
          id={listId}
          items={items}
          loading={loading}
          onChoose={choose}
          unavailable={unavailable}
        />
      ) : null}
    </Popover>
  );
};
