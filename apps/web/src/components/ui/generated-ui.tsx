"use client";

import { Renderer } from "@openuidev/react-lang";
import { Component, useState } from "react";
import type { ReactNode } from "react";

import { CodeBlock } from "@/components/ui/code-block";
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
  if (failedSource === source) {
    return <Unavailable source={source} />;
  }
  return (
    <RenderBoundary key={source} source={source}>
      <div className="w-full min-w-0" data-slot="generated-ui">
        <Renderer
          response={source}
          library={missionsLibrary}
          isStreaming={streaming}
          publishObservability={false}
          queryLoader={<Spinner label="Rendering interface" />}
          onError={(errors) => {
            if (
              !streaming &&
              errors.some((error) => error.severity !== "warning")
            ) {
              setFailedSource(source);
            }
          }}
          onParseResult={(result) => {
            if (!streaming && result && !result.root) {
              setFailedSource(source);
            }
          }}
        />
      </div>
    </RenderBoundary>
  );
};
