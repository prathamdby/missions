import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { cn } from "../../lib/utils";
import { Input, Textarea } from "./input";

vi.mock(import("@/lib/utils"), async () => await import("../../lib/utils"));

// The original finish-flow field appearance, before it composed the primitive.
const publishClasses =
  "w-full rounded-sm bg-surface px-lg py-control text-sm leading-chat font-book tracking-tight text-text outline-none ring-1 ring-border placeholder:text-text-tertiary focus-visible:ring-border-strong";
const classSet = (classes: string) => new Set(classes.split(" "));
const renderedClasses = (markup: string) =>
  classSet(
    /<(?:input|textarea)\b[^>]*class="(?<classes>[^"]*)"/u.exec(markup)?.groups
      ?.classes ?? ""
  );

describe("publish fields", () => {
  it("preserves the title appearance and native input props", () => {
    const props = {
      "aria-label": "Title",
      "data-testid": "pr-title",
      disabled: true,
      onChange: vi.fn<() => void>(),
      value: "Publish changes",
      variant: "publish",
    } as const;
    const markup = renderToStaticMarkup(createElement(Input, props));
    expect(renderedClasses(markup)).toStrictEqual(classSet(publishClasses));
    expect(markup).toContain('value="Publish changes"');
    expect(markup).toContain('aria-label="Title"');
    expect(markup).toContain('data-testid="pr-title"');
    expect(markup).toContain('disabled=""');
  });

  it("preserves description geometry, rows, value and vertical resizing", () => {
    const props = {
      "aria-label": "Description",
      "data-testid": "pr-body",
      onChange: vi.fn<() => void>(),
      rows: 4,
      value: "First line\nSecond line",
      variant: "publish",
    } as const;
    const markup = renderToStaticMarkup(createElement(Textarea, props));
    expect(renderedClasses(markup)).toStrictEqual(
      classSet(`${publishClasses} resize-y min-h-24`)
    );
    expect(markup).toContain('rows="4"');
    expect(markup).toContain(">First line\nSecond line</textarea>");
    expect(markup).toContain('aria-label="Description"');
    expect(markup).not.toContain("variant=");
  });

  it("preserves commit geometry, small monospace typography and native sizing", () => {
    const onChange = vi.fn<() => void>();
    const props = {
      "data-testid": "commit-message",
      mono: true,
      onChange,
      rows: 3,
      size: "sm",
      value: "Commit message",
      variant: "publish",
    } as const;
    const markup = renderToStaticMarkup(createElement(Textarea, props));
    expect(renderedClasses(markup)).toStrictEqual(
      classSet(
        cn(publishClasses, "min-h-20 resize-y font-mono text-xs leading-md")
      )
    );
    expect(markup).toContain('rows="3"');
    expect(markup).toContain(">Commit message</textarea>");
    expect(markup).toContain('data-testid="commit-message"');
    expect(markup).not.toMatch(/field-sizing-content|resize-none|shadow-/u);
  });
});

describe("existing field defaults", () => {
  it("retains the standard input height, padding and shadow chrome", () => {
    const markup = renderToStaticMarkup(createElement(Input));
    expect(renderedClasses(markup)).toStrictEqual(
      classSet(
        cn(
          "rounded-sm bg-surface-raised text-sm leading-sm font-book tracking-tight text-text shadow-[inset_0_0_0_1px_var(--color-border-strong)] transition-shadow duration-fast",
          "disabled:bg-surface disabled:text-text-disabled disabled:shadow-[inset_0_0_0_1px_var(--color-border)] aria-invalid:shadow-[0_0_0_1px_var(--color-danger),0_0_0_4px_var(--color-danger-muted)]",
          "focus-visible:shadow-[0_0_0_1px_var(--color-focus),0_0_0_4px_var(--color-accent-muted)]",
          "h-8 px-control",
          "w-full min-w-0 outline-none placeholder:text-text-tertiary"
        )
      )
    );
    expect(markup).toContain('type="text"');
  });

  it("mirrors a leading skill token on the bare composer only", () => {
    const highlighted = renderToStaticMarkup(
      createElement(Textarea, {
        highlightLength: 7,
        onChange: vi.fn<() => void>(),
        value: "/review these files",
        variant: "bare",
      })
    );
    expect(highlighted).toContain("<mark");
    expect(highlighted).toContain("/review</mark>");
    expect(renderedClasses(highlighted).has("text-transparent")).toBeTruthy();
    for (const props of [
      { highlightLength: 0, variant: "bare" as const },
      { highlightLength: 7, variant: "field" as const },
    ]) {
      const markup = renderToStaticMarkup(
        createElement(Textarea, {
          ...props,
          onChange: vi.fn<() => void>(),
          value: "/review these files",
        })
      );
      expect(markup).not.toContain("<mark");
      expect(renderedClasses(markup).has("text-transparent")).toBeFalsy();
    }
  });

  it.each(["bare", "field"] as const)(
    "keeps %s textareas content-sized and non-resizable",
    (variant) => {
      const classes = renderedClasses(
        renderToStaticMarkup(createElement(Textarea, { variant }))
      );
      expect(classes.has("field-sizing-content")).toBeTruthy();
      expect(classes.has("resize-none")).toBeTruthy();
      expect(
        classes.has(variant === "bare" ? "min-h-6" : "min-h-24")
      ).toBeTruthy();
      expect(
        classes.has(variant === "bare" ? "bg-transparent" : "bg-surface-raised")
      ).toBeTruthy();
    }
  );
});
