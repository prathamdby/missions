export interface ComposerTrigger {
  kind: "command" | "file";
  query: string;
  range: { start: number; end: number };
}

const FILE_TRIGGER = /(?:^|\s)@(?<query>[^\s@]*)$/u;
const COMMAND_TRIGGER = /^\/(?<query>[^\s/]*)$/u;
const TOKEN_END = /\s/u;

/** Only a leading slash or an at-sign at a word boundary opens a picker. */
export const composerTrigger = (
  text: string,
  cursor: number
): ComposerTrigger | null => {
  if (cursor < 0 || cursor > text.length) {
    return null;
  }
  const before = text.slice(0, cursor);
  const command = COMMAND_TRIGGER.exec(before);
  const file = FILE_TRIGGER.exec(before);
  const match = command ?? file;
  if (!match) {
    return null;
  }
  const query = match.groups?.query ?? "";
  const start = cursor - query.length - 1;
  const remaining = text.slice(cursor).search(TOKEN_END);
  return {
    kind: command ? "command" : "file",
    query,
    range: { end: remaining < 0 ? text.length : cursor + remaining, start },
  };
};

export const insertSuggestion = (
  text: string,
  trigger: ComposerTrigger,
  value: string
) => {
  const prefix = trigger.kind === "file" ? "@" : "/";
  const insertion = `${prefix}${value} `;
  return {
    cursor: trigger.range.start + insertion.length,
    text: `${text.slice(0, trigger.range.start)}${insertion}${text.slice(trigger.range.end)}`,
  };
};
