import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Button, UnavailableButton } from "./button";
import { Hint, TooltipProvider } from "./tooltip";

vi.mock(import("@/lib/utils"), async () => await import("../../lib/utils"));
vi.mock(
  import("@/components/ui/tooltip"),
  async () => await import("./tooltip")
);

describe("unavailable buttons", () => {
  it("keeps unavailable buttons inert and wraps the trigger in a hint", () => {
    const element = UnavailableButton({
      children: "Restart",
      reason: "Restart from terminal",
    });
    expect(element.type).toBe(Hint);

    expect(element.props.children.type).toBe(Button);
    const markup = renderToStaticMarkup(
      createElement(TooltipProvider, null, element)
    );
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain('data-state="closed"');
    expect(markup).not.toContain(" disabled=");
  });
});
