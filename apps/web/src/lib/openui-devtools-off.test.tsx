import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OpenUIDevtools } from "./openui-devtools-off";

describe("OpenUI devtools override", () => {
  it("renders no OpenUI inspector or auto-mount content", () => {
    expect(renderToStaticMarkup(<OpenUIDevtools />)).toBe("");
  });
});
