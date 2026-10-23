"use client";

import type { MessageParty, TranscriptItem } from "@missions/protocol/missions";

import {
  ChevronDownIcon,
  ChevronRightIcon,
  SwapIcon,
} from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleHeader,
} from "@/components/ui/collapsible";
import { Markdown } from "@/components/ui/markdown";
import { deliveryOf } from "@/lib/mission/queue";
import type { DeliveryState } from "@/lib/mission/queue";
import { cn } from "@/lib/utils";

const PURPOSE_LABEL: Partial<
  Record<NonNullable<TranscriptItem["purpose"]>, string>
> = {
  assignment: "Assignment",
  handoff: "Handoff",
};

/** Delivery is reported, never read receipts: "sent" only means admitted. */
const DELIVERY_NOTE: Record<Exclude<DeliveryState, "sent">, string> = {
  failed: "Not delivered. Retry it from the message queue.",
  pending: "Waiting to be delivered",
  removed: "Removed from the queue before delivery.",
  unknown:
    "Delivery uncertain. It may have arrived; retrying may send it twice.",
};

const usePartyName = () => {
  const { agentLabels } = useMission();
  return (party: MessageParty | null, fallbackId: string) => {
    if (!party) {
      return agentLabels[fallbackId] ?? "Agent";
    }
    return party.role === "orchestrator"
      ? party.title
      : (agentLabels[party.agentId] ?? party.title);
  };
};

const DeliveryNote = ({ item }: { item: TranscriptItem }) => {
  const { live } = useMission();
  const state = deliveryOf(live.queue, item.requestId);
  if (state === null || state === "sent") {
    return null;
  }
  return (
    <p
      className={cn(
        "text-xs leading-sm font-book tracking-tight",
        state === "pending" ? "text-text-tertiary" : "text-warning"
      )}
    >
      {DELIVERY_NOTE[state]}
    </p>
  );
};

const titleClass =
  "min-w-0 truncate text-sm leading-sm font-medium tracking-tight text-text-secondary";

/**
 * Paper IP0-0 (one directed message) and IPD-0 (an exchange between the same
 * two agents): direction icon, From › To header that folds the body, and a
 * left rule under the icon. The rule sits on the right edge of an 8px column
 * so it lands where Paper's 7px offset puts it without an off-scale margin.
 */
export const AgentMessages = ({
  items,
}: {
  items: readonly TranscriptItem[];
}) => {
  const nameOf = usePartyName();
  const [first] = items;
  if (!first) {
    return null;
  }
  const from = nameOf(first.sender, first.agentId);
  const to = nameOf(first.recipient, first.recipient?.agentId ?? "");
  const purposes = [
    ...new Set(
      items.flatMap((item) => {
        const label = item.purpose ? PURPOSE_LABEL[item.purpose] : undefined;
        return label ? [label] : [];
      })
    ),
  ];
  const exchange = items.length > 1;
  return (
    <Collapsible
      data-testid={exchange ? "agent-exchange" : "agent-message"}
      defaultOpen
    >
      <div className="flex min-w-0 flex-col gap-md wrap-anywhere">
        <CollapsibleHeader>
          <SwapIcon className="text-text-tertiary" />
          <span className="sr-only">
            {exchange ? `${items.length} messages from` : "Message from"}
          </span>
          <span className={titleClass}>{from}</span>
          <ChevronRightIcon className="size-3 text-text-disabled" />
          <span className="sr-only">to</span>
          <span className={titleClass}>{to}</span>
          {purposes.length > 0 ? (
            <span className="shrink-0 text-xs leading-sm font-book tracking-tight text-text-tertiary">
              {purposes.join(" · ")}
            </span>
          ) : null}
          <ChevronDownIcon className="size-3 text-text-tertiary transition-transform duration-fast group-data-[state=closed]/disclosure:-rotate-90" />
        </CollapsibleHeader>
        <CollapsibleContent className="flex min-w-0">
          <span
            aria-hidden="true"
            className="w-2 shrink-0 border-r border-border"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-md pl-xl">
            {exchange ? (
              <ol className="flex flex-col gap-control">
                {items.map((item) => (
                  <li className="flex gap-control" key={item.id}>
                    <span className="w-18 shrink-0 truncate text-xs leading-chat font-book tracking-tight text-text-tertiary">
                      {nameOf(item.sender, item.agentId)}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-xs">
                      <Markdown>{item.text}</Markdown>
                      <DeliveryNote item={item} />
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="flex max-w-prose flex-col gap-xs">
                <Markdown appearance="panel">{first.text}</Markdown>
                <DeliveryNote item={first} />
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};
