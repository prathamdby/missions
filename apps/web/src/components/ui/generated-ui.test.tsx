// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Markdown } from "./markdown";

describe("generated Markdown interfaces", () => {
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
  });

  const render = async (
    source: string,
    { streaming = false, thought = false } = {}
  ) => {
    await act(() =>
      root.render(
        <Markdown
          appearance={thought ? "thought" : "default"}
          streaming={streaming}
        >
          {source}
        </Markdown>
      )
    );
  };

  it("renders a complete OpenUI fence with Missions primitives", async () => {
    await render(
      '```openui-lang\nroot = Stack([Text("Checks passed"), Badge("Ready", "success"), Progress("Checks", 100)])\n```'
    );
    expect(host.querySelector('[data-slot="generated-ui"]')).not.toBeNull();
    expect(host.textContent).toContain("Checks passed");
    expect(host.querySelector('[data-slot="badge"]')?.textContent).toBe(
      "Ready"
    );
    expect(host.querySelector("progress")?.value).toBe(100);
  });

  it("renders incomplete programs while streaming and recovers on replacement", async () => {
    await render('```openui-lang\nroot = Stack([Text("Arriving', {
      streaming: true,
    });
    expect(host.querySelector('[data-slot="generated-ui"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Interface unavailable");
    await render('```openui-lang\nroot = Stack([Text("Arrived")])\n```');
    expect(host.textContent).toBe("Arrived");
  });

  it("falls back to a code block for invalid programs", async () => {
    await render("```openui-lang\nroot = MissingComponent()\n```");
    expect(host.querySelector("pre")?.textContent).toBe(
      "root = MissingComponent()"
    );
    expect(host.textContent).toContain("Interface unavailable");
  });

  it("does not render generated interfaces inside reasoning", async () => {
    await render('```openui-lang\nroot = Stack([Text("Reasoning")])\n```', {
      thought: true,
    });
    expect(host.querySelector('[data-slot="generated-ui"]')).toBeNull();
    expect(host.querySelector("pre")).not.toBeNull();
  });

  it("renders HTML as text and never loads agent-supplied content", async () => {
    await render(
      '```openui-lang\nroot = Stack([Text("<img src=https://example.com/image>")])\n```'
    );
    expect(host.querySelector("img, script, iframe")).toBeNull();
    expect(host.textContent).toBe("<img src=https://example.com/image>");
  });

  it("ignores parser warnings when a usable root can render", async () => {
    await render('```openui-lang\ncontent = Stack([Text("Recovered")])\n```');
    expect(host.textContent).toBe("Recovered");
  });
});
