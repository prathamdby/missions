"use client";

import { Renderer } from "@openuidev/react-lang";
import type { ActionEvent } from "@openuidev/react-lang";
import { Component, use, useRef, useState } from "react";
import type { ReactNode } from "react";

import { CodeBlock } from "@/components/ui/code-block";
import {
  GeneratedUiActionsContext,
  GeneratedUiBlockContext,
  mapGeneratedUiAction,
} from "@/components/ui/generated-ui-actions";
import { missionsLibrary } from "@/components/ui/generated-ui-library";
import { Spinner } from "@/components/ui/spinner";

const Unavailable = ({ source }: { source: string }) => (
  <figure className="flex min-w-0 flex-col gap-xs">
    <CodeBlock code={source} />
    <figcaption className="text-xs leading-sm text-text-tertiary">
      Interface unavailable
    </figcaption>
  </figure>
);

class RenderBoundary extends Component<
  { children: ReactNode; source: string },
  { failed: boolean }
> {
  constructor(props: { children: ReactNode; source: string }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? (
      <Unavailable source={this.props.source} />
    ) : (
      this.props.children
    );
  }
}

export const GeneratedUi = ({
  source,
  streaming = false,
}: {
  source: string;
  streaming?: boolean;
}) => {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const actions = use(GeneratedUiActionsContext);
  const [status, setStatus] = useState<"ready" | "sending" | "sent" | "failed">(
    "ready"
  );
  const busy = useRef(false);
  const occurrence = useRef<string | null>(null);
  let disabledReason = actions
    ? actions.disabledReason
    : "This interface is read-only";
  if (streaming) {
    disabledReason = "Wait for this interface to finish";
  } else if (status === "sending" || status === "sent") {
    disabledReason = status === "sending" ? "Sending…" : "Message sent";
  }
  const onAction = async (event: ActionEvent) => {
    const action = mapGeneratedUiAction(event);
    if (!action || streaming) {
      return;
    }
    if (action.kind === "open_url") {
      window.open(action.url, "_blank", "noopener,noreferrer");
      return;
    }
    if (!actions || disabledReason || busy.current) {
      return;
    }
    busy.current = true;
    if (!occurrence.current) {
      occurrence.current = crypto.randomUUID();
    }
    setStatus("sending");
    try {
      const sent = await actions.onContinue(action.text, occurrence.current);
      busy.current = sent;
      setStatus(sent ? "sent" : "failed");
    } catch {
      busy.current = false;
      setStatus("failed");
    }
  };
  if (failedSource === source) {
    return <Unavailable source={source} />;
  }
  return (
    <RenderBoundary key={source} source={source}>
      <GeneratedUiBlockContext value={disabledReason}>
        <div className="w-full min-w-0" data-slot="generated-ui">
          <Renderer
            response={source}
            library={missionsLibrary}
            isStreaming={streaming}
            publishObservability={false}
            queryLoader={<Spinner label="Rendering interface" />}
            onAction={(event) => {
              void onAction(event);
            }}
            onError={(errors) => {
              if (
                !streaming &&
                errors.some((error) => error.severity !== "warning")
              ) {
                setFailedSource(source);
              }
            }}
            onParseResult={(result) => {
              if (
                result &&
                (result.queryStatements.length > 0 ||
                  result.mutationStatements.length > 0 ||
                  (!streaming && !result.root))
              ) {
                setFailedSource(source);
              }
            }}
          />
          {status === "failed" ? (
            <p className="mt-xs type-caption text-danger" role="alert">
              Message not sent. Try again.
            </p>
          ) : null}
        </div>
      </GeneratedUiBlockContext>
    </RenderBoundary>
  );
};
