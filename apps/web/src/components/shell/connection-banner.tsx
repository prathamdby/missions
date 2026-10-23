"use client";

import { Button } from "@/components/ui/button";
import { CopyChip } from "@/components/ui/copy-button";
import { PlugIcon, RepeatIcon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { secondsUntil } from "@/lib/format";
import { useConnection } from "@/lib/live/hooks";
import { useNow } from "@/lib/use-now";

const START_COMMAND = "pnpm dev:daemon";
const SECOND = 1000;
const MINUTE = 60 * SECOND;

const plural = (count: number, unit: string) =>
  `${count} ${unit}${count === 1 ? "" : "s"} ago`;

const longAgo = (ms: number) => {
  if (ms < MINUTE) {
    return plural(Math.max(1, Math.floor(ms / SECOND)), "second");
  }
  return plural(Math.floor(ms / MINUTE), "minute");
};

/** X16: floats over the chat column, under the 52px header, while live streams retry. */
export const ConnectionBanner = () => {
  const connection = useConnection();
  const now = useNow();
  if (connection.phase !== "offline") {
    return null;
  }
  const seconds = secondsUntil(connection.retryAt, now);
  const since =
    connection.offlineSince === null
      ? "."
      : `, ${longAgo(now - connection.offlineSince)}.`;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-18 z-sticky flex justify-center px-lg">
      <div
        className="pointer-events-auto flex w-full max-w-chat flex-col overflow-hidden rounded-md bg-surface-overlay shadow-lg"
        role="alert"
      >
        <div className="flex items-start gap-lg bg-danger-muted p-card">
          <span className="pt-2xs">
            <PlugIcon tone="danger" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-xs">
            <p className="text-sm leading-sm font-medium tracking-tight text-text">
              Lost connection to the Missions daemon
            </p>
            <p className="text-xs leading-md tracking-tight text-text-secondary">
              Agents keep running on the daemon, so nothing is lost. This page
              shows the last state it received{since}
            </p>
          </div>
          <Button onClick={() => connection.retryNow()} variant="secondary">
            <RepeatIcon />
            Retry now
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-control px-card py-control">
          <Spinner label="Reconnecting" pattern="wave" />
          <span
            aria-live="polite"
            className="min-w-0 flex-1 text-xs leading-sm tracking-tight text-text-secondary"
          >
            {seconds > 0 ? `Reconnecting in ${seconds}s` : "Reconnecting"} ·
            attempt {connection.attempt}
          </span>
          <span className="text-xs leading-sm tracking-tight text-text-tertiary">
            Not running?
          </span>
          <CopyChip value={START_COMMAND} />
        </div>
      </div>
    </div>
  );
};
