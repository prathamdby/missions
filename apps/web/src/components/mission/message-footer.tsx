"use client";

import type { TranscriptItem } from "@missions/protocol/missions";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { CopyIcon, LinkIcon } from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import { IconButton } from "@/components/ui/button";
import { EditIcon } from "@/components/ui/icons";
import { Hint } from "@/components/ui/tooltip";
import { shortAge } from "@/lib/format";
import { messageLink } from "@/lib/mission/message-actions";
import { toast } from "@/lib/toast-store";
import { cn } from "@/lib/utils";

const writeClipboard = async (value: string, success: string) => {
  try {
    await navigator.clipboard.writeText(value);
    toast({ title: success, tone: "success" });
  } catch {
    toast({
      description: "The browser did not allow access to the clipboard.",
      title: "Could not copy",
      tone: "danger",
    });
  }
};

const FooterButton = ({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) => (
  <Hint label={label}>
    <IconButton icon={icon} label={label} onClick={onClick} size="sm" />
  </Hint>
);

const useAge = (createdAt: string) => {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setNow(Date.now()));
    return () => cancelAnimationFrame(frame);
  }, []);
  return now === null ? null : shortAge(createdAt, now);
};

const FooterRow = ({ item }: { item: TranscriptItem }) => {
  const { forkFrom, missionId, rewindFrom } = useMission();
  const age = useAge(item.createdAt);
  const copyText = () => writeClipboard(item.text, "Copied");
  const copyLink = () =>
    writeClipboard(
      messageLink(window.location.origin, missionId, item.id),
      "Link copied"
    );
  return (
    <div
      className={cn(
        "flex items-center gap-xs text-text-tertiary",
        "md:opacity-0 md:group-focus-within/message:opacity-100 md:group-hover/message:opacity-100"
      )}
    >
      {age === null ? null : (
        <span className="px-xs text-xs leading-sm font-book tracking-tight">
          {age}
        </span>
      )}
      {item.kind === "user" ? (
        <FooterButton
          icon={<EditIcon />}
          label="Edit from here"
          onClick={() => rewindFrom(item)}
        />
      ) : null}
      <FooterButton
        icon={<CopyIcon />}
        label="Copy message"
        onClick={copyText}
      />
      {item.kind === "user" ? (
        <FooterButton icon={<LinkIcon />} label="Copy link" onClick={copyLink} />
      ) : (
        <FooterButton
          icon={<LinkIcon />}
          label="Fork from here"
          onClick={() => forkFrom(item)}
        />
      )}
    </div>
  );
};

/**
 * Quiet actions under a settled message. Hidden until hover or keyboard focus
 * on a pointer device; always available on a touch screen, where there is no
 * hover. Assistant replies, thinking and tool cards get no footer.
 */
export const MessageFooter = ({
  children,
  item,
}: {
  children: ReactNode;
  item: TranscriptItem;
}) => {
  if (item.kind !== "user" && item.kind !== "agent_message") {
    return children;
  }
  return (
    <div
      className={cn(
        "group/message flex min-w-0 flex-col gap-xs",
        item.kind === "user" && "items-end"
      )}
      id={`m-${item.id}`}
    >
      {children}
      <FooterRow item={item} />
    </div>
  );
};
