export interface PlanStep {
  detail: string;
  title: string;
}

export interface ParsedPlan {
  steps: PlanStep[];
  summary: string;
}

const STEP = /^\d+[.)]\s+(?<rest>.+)$/u;
const HEADING = /^#{1,6}\s/u;
const BOLD_LEAD = /^\*\*(?<title>.+?)\*\*\s*[—–:-]?\s*(?<detail>.*)$/u;
const DASH_SPLIT = /\s[—–]\s/u;
const INLINE_MARKS = /\*\*|__|`/gu;

const plain = (text: string) => text.replaceAll(INLINE_MARKS, "").trim();

const stepOf = (rest: string): PlanStep => {
  const bold = BOLD_LEAD.exec(rest)?.groups;
  if (bold) {
    return { detail: plain(bold.detail ?? ""), title: plain(bold.title ?? "") };
  }
  const [title = "", ...detail] = rest.split(DASH_SPLIT);
  return { detail: plain(detail.join(" — ")), title: plain(title) };
};

/**
 * Reads the Paper plan shape (a summary paragraph, then a numbered list of
 * "Title — detail" steps). Anything else returns null and renders as Markdown.
 */
export const parsePlan = (markdown: string): ParsedPlan | null => {
  const summary: string[] = [];
  const steps: PlanStep[] = [];
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!line || HEADING.test(line)) {
      continue;
    }
    const rest = STEP.exec(line)?.groups?.rest;
    if (rest) {
      steps.push(stepOf(rest));
      continue;
    }
    const last = steps.at(-1);
    if (last && raw.startsWith(" ")) {
      last.detail = [last.detail, plain(line)].filter(Boolean).join(" ");
      continue;
    }
    if (steps.length > 0 || line.startsWith("-") || line.startsWith("*")) {
      return null;
    }
    summary.push(plain(line));
  }
  return steps.length > 0 ? { steps, summary: summary.join(" ") } : null;
};
