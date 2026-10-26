// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    vi.restoreAllMocks();
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

  it("disables continuation controls without an actions context", async () => {
    await render(
      '```openui-lang\nroot = Stack([Button("continue_conversation", "Continue")])\n```'
    );
    expect(host.querySelector("button")?.disabled).toBeTruthy();
  });

  it("allows safe links in read-only interfaces without loading them", async () => {
    await render(
      '```openui-lang\nroot = Stack([Button("open_url", "Docs", null, "https://example.com/docs")])\n```'
    );
    const link = host.querySelector("a");
    expect(link?.href).toBe("https://example.com/docs");
    expect(link?.rel).toBe("noopener noreferrer");
    expect(link?.target).toBe("_blank");
  });

  it.each([
    { streaming: true, url: "https://example.com/docs" },
    { streaming: false, url: ["javascript", "alert(1)"].join(":") },
    { streaming: false, url: "data:text/html,unsafe" },
    { streaming: false, url: "file:///tmp/secret" },
    { streaming: false, url: "/relative" },
    { streaming: false, url: "//example.com/docs" },
  ])(
    "blocks link clicks for $url with streaming=$streaming",
    async (options) => {
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      await render(
        `\`\`\`openui-lang\nroot = Button("open_url", "Open", null, ${JSON.stringify(options.url)})\n\`\`\``,
        { streaming: options.streaming }
      );
      const control = host.querySelector("button");
      await act(() => control?.click());
      expect(control?.disabled).toBeTruthy();
      expect(host.querySelector("a")).toBeNull();
      expect(open).not.toHaveBeenCalled();
    }
  );

  it.each(["http://example.com/docs", "https://example.com/docs"])(
    "allows an explicit native link click only after streaming completes: %s",
    async (url) => {
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      const source = `\`\`\`openui-lang\nroot = Button("open_url", "Open", null, "${url}")\n\`\`\``;
      await render(source, { streaming: true });
      expect(host.querySelector("a")).toBeNull();
      await render(source);
      const link = host.querySelector("a");
      if (!link) {
        throw new Error("Missing safe link");
      }
      const clicked = vi.fn<(url: string) => void>();
      link.addEventListener("click", (event) => {
        event.preventDefault();
        clicked(link.href);
      });
      await act(() => link.click());
      expect(clicked).toHaveBeenCalledExactlyOnceWith(url);
      expect([link.target, link.rel]).toStrictEqual([
        "_blank",
        "noopener noreferrer",
      ]);
      expect(open).not.toHaveBeenCalled();
    }
  );

  it("renders complete read-only forms using every field primitive", async () => {
    await render(
      '```openui-lang\nroot = Stack([Text("Orchestrator interface"), Badge("Ready", "success"), KeyValue("Checks", "Passed"), Button("continue_conversation", "Use approach", "Use the recommended approach"), Form([Input("Project name", "name"), TextArea("Project notes", "notes"), Select("Approach", "approach", ["Small", "Complete"])], "Use these project details", "project", "Send details")])\n```'
    );
    expect(host.textContent).not.toContain("Interface unavailable");
    expect(host.querySelector("form")).not.toBeNull();
    expect(host.querySelector("input")?.disabled).toBeTruthy();
  });

  it.each(["Query", "Mutation"])(
    "rejects %s programs without a tool provider",
    async (name) => {
      await render(
        `\`\`\`openui-lang\nremote = ${name}("remote_tool", {})\nroot = Stack([Text("No tools")])\n\`\`\``
      );
      expect(host.textContent).toContain("Interface unavailable");
    }
  );
});
