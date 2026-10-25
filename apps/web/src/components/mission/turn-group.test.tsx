import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TurnGroup } from "./turn-group";

const AT = Date.parse("2026-01-01T00:00:00.000Z");
const keepClosed = () => {
  // This render only checks the header label.
};

describe(TurnGroup, () => {
  it("names failed tool calls on the work header", () => {
    const markup = renderToStaticMarkup(
      <TurnGroup
        end="2026-01-01T00:00:02.000Z"
        failures={1}
        now={AT}
        onOpenChange={keepClosed}
        open={false}
        running={false}
        start="2026-01-01T00:00:00.000Z"
      >
        hidden work
      </TurnGroup>
    );
    expect(markup).toContain("Worked");
    expect(markup).toContain("Failed");
    const clear = renderToStaticMarkup(
      <TurnGroup
        end={null}
        failures={0}
        now={AT}
        onOpenChange={keepClosed}
        open={false}
        running={false}
        start={null}
      >
        hidden work
      </TurnGroup>
    );
    expect(clear).toContain("Worked");
    expect(clear).not.toContain("Failed");
  });
});
