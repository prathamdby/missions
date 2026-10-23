import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Switch } from "./selection";

// Resolve the web aliases without changing the application or test configuration.
vi.mock(import("@/lib/utils"), async () => await import("../../lib/utils"));
vi.mock(import("@/components/ui/icons"), () => ({
  CheckIcon: () => createElement("svg"),
}));

const renderSwitch = (
  props: Parameters<typeof Switch>[0] & { "data-testid"?: string }
) => renderToStaticMarkup(createElement(Switch, props));

const classesFor = (markup: string, tag: "button" | "span") => {
  const opening = markup.slice(markup.indexOf(`<${tag}`));
  return (
    /class="(?<classes>[^"]*)"/u.exec(opening)?.groups?.classes?.split(" ") ??
    []
  );
};

const buttonAttributes = (markup: string) =>
  Object.fromEntries(
    [
      ...markup
        .slice(0, markup.indexOf(">"))
        .matchAll(/(?<name>[\w-]+)="(?<value>[^"]*)"/gu),
    ].map((match) => [match.groups?.name, match.groups?.value])
  );

describe("Switch appearance contract", () => {
  it.each([
    { checked: false, disabled: false },
    { checked: true, disabled: false },
    { checked: false, disabled: true },
    { checked: true, disabled: true },
  ])("preserves settings chrome for %j", ({ checked, disabled }) => {
    const markup = renderSwitch({
      appearance: "settings",
      "aria-label": "Delete worktree when merged",
      checked,
      disabled,
      title: "Keep this preference",
    });
    const track = classesFor(markup, "button");
    const thumb = classesFor(markup, "span");
    expect(track).toStrictEqual([
      "flex",
      "h-4.5",
      "w-3xl",
      "shrink-0",
      "cursor-pointer",
      "items-center",
      "rounded-full",
      "p-2xs",
      "transition-colors",
      "duration-fast",
      "aria-disabled:cursor-not-allowed",
      "data-[state=checked]:justify-end",
      "data-[state=checked]:bg-accent",
      "data-[state=unchecked]:bg-surface-active",
      "data-[state=unchecked]:ring-1",
      "data-[state=unchecked]:ring-border",
      "data-[state=unchecked]:ring-inset",
    ]);
    expect(thumb).toStrictEqual([
      "size-3.5",
      "rounded-full",
      "data-[state=checked]:bg-text",
      "data-[state=unchecked]:bg-text-secondary",
    ]);
    const attributes = buttonAttributes(markup);
    expect(attributes).toMatchObject({
      "aria-checked": String(checked),
      "aria-disabled": String(disabled),
      "aria-label": "Delete worktree when merged",
      "data-state": checked ? "checked" : "unchecked",
      role: "switch",
      title: "Keep this preference",
      type: "button",
    });
    expect(Object.hasOwn(attributes, "disabled")).toBe(disabled);
  });

  it("forwards standard switch props without leaking appearance to the DOM", () => {
    const onCheckedChange = vi.fn<(checked: boolean) => void>();
    const markup = renderSwitch({
      appearance: "settings",
      "aria-label": "Copy .env files",
      "data-testid": "settings-copy-env",
      defaultChecked: true,
      id: "copy-env",
      name: "copyEnv",
      onCheckedChange,
      value: "yes",
    });
    expect(markup).toContain('id="copy-env"');
    expect(markup).toContain('data-testid="settings-copy-env"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).not.toContain("appearance=");
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("keeps the default appearance unchanged", () => {
    const markup = renderSwitch({ checked: false, disabled: true });
    expect(markup).toBe(
      renderSwitch({
        appearance: "default",
        checked: false,
        disabled: true,
      })
    );
    expect(classesFor(markup, "button")).toStrictEqual(
      expect.arrayContaining(["duration-base", "disabled:bg-surface"])
    );
    expect(classesFor(markup, "span")).toStrictEqual(
      expect.arrayContaining([
        "shadow-[0_1px_2px_var(--color-shadow)]",
        "group-disabled/switch:bg-text-disabled",
        "transition-transform",
      ])
    );
  });
});
