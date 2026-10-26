"use client";

import { Renderer } from "@openuidev/react-lang";
import type { ActionEvent } from "@openuidev/react-lang";
import { Component, use, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import {
  GeneratedUiActionsContext,
  GeneratedUiBlockContext,
  mapGeneratedUiAction,
} from "@/components/ui/generated-ui-actions";
import { missionsLibrary } from "@/components/ui/generated-ui-library";
import { Spinner } from "@/components/ui/spinner";
import { EMPTY_GENERATED_UI_SUBMISSION } from "@/lib/mission/generated-ui";

const subscribeToNothing = () => () => {
  // Read-only Markdown has no submission store to unsubscribe from.
};
const STATUS_REASONS = {
  failed: "Retry the original message below",
  ready: null,
  sending: "Sending…",
  sent: "Message sent",
};

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
  blockId,
  source,
  streaming = false,
}: {
  blockId: string;
  source: string;
  streaming?: boolean;
}) => {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const actions = use(GeneratedUiActionsContext);
  const submission = useSyncExternalStore(
    actions?.subscribe ?? subscribeToNothing,
    () => actions?.snapshot(blockId) ?? EMPTY_GENERATED_UI_SUBMISSION,
    () => EMPTY_GENERATED_UI_SUBMISSION
  );
  const { status } = submission;
  const [review, setReview] = useState<string | null>(null);
  const reviewText =
    review ?? (status === "failed" ? submission.delivery?.input.text : null);
  const canContinue =
    actions !== null && actions.disabledReason === null && !streaming;
  const disabledReason = streaming
    ? "Wait for this interface to finish"
    : (STATUS_REASONS[status] ??
      (actions ? actions.disabledReason : "This interface is read-only"));
  const onAction = (event: ActionEvent) => {
    const action = mapGeneratedUiAction(event);
    if (!action || streaming) {
      return;
    }
    if (action.kind === "open_url") {
      window.open(action.url, "_blank", "noopener,noreferrer");
      return;
    }
    if (!canContinue || status !== "ready") {
      return;
    }
    setReview(action.text);
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
              Delivery not confirmed. Retry will reuse the original message.
            </p>
          ) : null}
          {reviewText ? (
            <section
              aria-label="Message to send"
              className="mt-md flex min-w-0 flex-col gap-sm"
            >
              <p className="type-caption text-text-secondary">
                Review the message before sending.
              </p>
              <CodeBlock code={reviewText} />
              <div className="flex gap-sm">
                <Button
                  disabled={
                    !canContinue || status === "sending" || status === "sent"
                  }
                  onClick={() => {
                    if (actions && canContinue) {
                      setReview(null);
                      void actions.onContinue(blockId, reviewText);
                    }
                  }}
                  variant="primary"
                >
                  {status === "failed" ? "Retry message" : "Send message"}
                </Button>
                {status === "ready" ? (
                  <Button onClick={() => setReview(null)}>Cancel</Button>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      </GeneratedUiBlockContext>
    </RenderBoundary>
  );
};
