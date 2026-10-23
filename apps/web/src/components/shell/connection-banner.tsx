"use client";

import { RotateCwIcon, UnplugIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InlineCode } from "@/components/ui/code-block";
import { CopyButton } from "@/components/ui/copy-button";
import { Spinner } from "@/components/ui/spinner";
import { formatAgo, secondsUntil } from "@/lib/format";
import { useConnection } from "@/lib/live/hooks";
import { useNow } from "@/lib/use-now";

const START_COMMAND = "pnpm dev:daemon";

/** X16: shown at the top of the page while any live stream is retrying. */
export const ConnectionBanner = () => {
  const connection = useConnection();
  const now = useNow();
  if (connection.phase !== "offline") {
    return null;
  }
  const seconds = secondsUntil(connection.retryAt, now);
  const since =
    connection.offlineSince === null
      ? ""
      : `, ${formatAgo(now - connection.offlineSince)}`;
  return (
    <div className="flex shrink-0 justify-center px-lg pt-md">
      <div
        className="w-full max-w-chat overflow-hidden rounded-md bg-surface-raised shadow-lg"
        role="alert"
      >
        <div className="flex flex-wrap items-start gap-lg bg-danger-muted p-lg">
          <UnplugIcon
            aria-hidden="true"
            className="mt-2xs size-4 shrink-0 text-danger"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-xs">
            <p className="type-label text-text">
              Lost connection to the Missions daemon
            </p>
            <p className="type-caption text-text-secondary">
              If the daemon is still running, agents keep working and nothing is
              lost. This page shows the last state it received{since}.
            </p>
          </div>
          <Button onClick={() => connection.retryNow()} variant="secondary">
            <RotateCwIcon aria-hidden="true" />
            Retry now
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-md px-lg py-sm type-caption text-text-secondary">
          <Spinner label="Reconnecting" pattern="wave" size="sm" />
          <span>
            {seconds > 0 ? `Reconnecting in ${seconds}s` : "Reconnecting"} ·
            attempt {connection.attempt}
          </span>
          <span className="ml-auto text-text-tertiary">Not running?</span>
          <span className="flex items-center gap-xs">
            <InlineCode>{START_COMMAND}</InlineCode>
            <CopyButton label="Copy start command" value={START_COMMAND} />
          </span>
        </div>
      </div>
    </div>
  );
};
