// @vitest-environment jsdom

import type { RendererProps } from "@openuidev/react-lang";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GeneratedUi } from "./generated-ui";

const action = vi.hoisted(() => ({ url: "" }));

vi.mock(import("@openuidev/react-lang"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    Renderer: Object.assign(
      ({ onAction }: RendererProps) => (
        <button
          onClick={() => {
            void onAction?.({
              humanFriendlyMessage: "Open link",
              params: { url: action.url },
              type: "open_url",
            });
          }}
          type="button"
        >
          Emit Renderer action
        </button>
      ),
      original.Renderer
    ),
  };
});

describe("generated Renderer navigation guard", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it.each([
    { allowed: false, streaming: true, url: "https://example.com/docs" },
    { allowed: false, streaming: true, url: "http://example.com/docs" },
    {
      allowed: false,
      streaming: false,
      url: ["javascript", "alert(1)"].join(":"),
    },
    { allowed: false, streaming: false, url: "data:text/html,unsafe" },
    { allowed: false, streaming: false, url: "file:///tmp/secret" },
    { allowed: false, streaming: false, url: "/relative" },
    { allowed: false, streaming: false, url: "//example.com/docs" },
    { allowed: true, streaming: false, url: "https://example.com/docs" },
    { allowed: true, streaming: false, url: "http://example.com/docs" },
  ])(
    "guards $url with streaming=$streaming",
    async ({ allowed, streaming, url }) => {
      action.url = url;
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      await act(() =>
        root.render(
          <GeneratedUi
            blockId="link"
            source="root = Text()"
            streaming={streaming}
          />
        )
      );
      await act(() => host.querySelector("button")?.click());
      expect(open.mock.calls).toStrictEqual(
        allowed ? [[url, "_blank", "noopener,noreferrer"]] : []
      );
    }
  );
});
