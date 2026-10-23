export interface ParsedOption {
  detail: string;
  label: string;
  recommended: boolean;
}

const RECOMMENDED = /\s*\((?:recommended)\)\s*$/iu;
const DETAIL_SPLIT = /\s[—–]\s/u;

/**
 * Agents can write an option as "Label (Recommended) — detail"; Paper shows
 * the label, a Recommended tag, and the detail on its own line.
 */
export const parseOption = (option: string): ParsedOption => {
  const [head = "", ...rest] = option.split(DETAIL_SPLIT);
  const recommended = RECOMMENDED.test(head);
  return {
    detail: rest.join(" — ").trim(),
    label: head.replace(RECOMMENDED, "").trim(),
    recommended,
  };
};

/** An answer with each chosen option shortened to its label. */
export const answerLabel = (options: readonly string[], answer: string) => {
  let text = answer;
  for (const option of options.toSorted((a, b) => b.length - a.length)) {
    text = text.replaceAll(option, parseOption(option).label);
  }
  return text;
};
