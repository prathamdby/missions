import { Tooltip as TooltipPrimitive } from "radix-ui";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "./select";

vi.mock(import("@/lib/utils"), async () => await import("../../lib/utils"));
vi.mock(import("@/components/ui/icons"), async () => await import("./icons"));

describe("additive Paper select appearances", () => {
  it.each([
    { appearance: "model" as const, typography: "font-mono", width: "w-29" },
    { appearance: "thinking" as const, typography: "text-xs", width: "w-36" },
  ])("binds $appearance to GCL trigger geometry", (variant) => {
    const onClick = vi.fn<() => void>();
    const element = SelectTrigger({
      appearance: variant.appearance,
      "aria-label": "Mission setting",
      disabled: true,
      onClick,
    });
    expect(element.props.className.split(" ")).toStrictEqual(
      expect.arrayContaining([
        "h-7",
        variant.width,
        variant.typography,
        "shrink-0",
        "gap-sm",
        "px-control",
        "rounded-sm",
        "bg-surface-raised",
        "shadow-button",
        "data-[state=open]:bg-surface-active",
        "data-[state=open]:shadow-button-active",
      ])
    );
    expect(element.props.onClick).toBe(onClick);
    expect(element.props.disabled).toBeTruthy();
    expect(element.props["aria-label"]).toBe("Mission setting");
    expect(element.props).not.toHaveProperty("appearance");
  });

  it.each(["model", "thinking"] as const)(
    "replaces the %s open shadow rather than adding a second border ring",
    (appearance) => {
      const classes: string[] = SelectTrigger({
        appearance,
      }).props.className.split(" ");
      expect(classes.filter((name) => name.includes("shadow"))).toStrictEqual([
        "shadow-button",
        "focus-visible:shadow-focus",
        "data-[state=open]:shadow-button-active",
      ]);
      expect(classes).toContain("data-[state=open]:bg-surface-active");
    }
  );

  it.each([
    { appearance: "model" as const, open: true },
    { appearance: "model" as const, open: false },
    { appearance: "thinking" as const, open: true },
    { appearance: "thinking" as const, open: false },
  ])(
    "keeps Select state authoritative under a tooltip: %j",
    ({ appearance, open }) => {
      const markup = renderToStaticMarkup(
        createElement(
          Select,
          { open, value: "selected" },
          createElement(
            TooltipPrimitive.Provider,
            null,
            createElement(
              TooltipPrimitive.Root,
              { open: !open },
              createElement(
                TooltipPrimitive.Trigger,
                { asChild: true },
                createElement(
                  SelectTrigger,
                  { appearance, "aria-label": "Mission setting" },
                  "Selected"
                )
              )
            )
          )
        )
      );
      expect(markup).toContain(`data-state="${open ? "open" : "closed"}"`);
      expect(markup).toContain(`aria-expanded="${String(open)}"`);
    }
  );

  it.each([
    {
      appearance: "model" as const,
      gap: "gap-control",
      row: "h-8",
      width: "w-50",
    },
    {
      appearance: "thinking" as const,
      gap: "gap-md",
      row: "h-7",
      width: "w-36",
    },
  ])("binds $appearance to Paper menu sizing and stable rows", (variant) => {
    const item = SelectItem({
      appearance: variant.appearance,
      children: "Catalog value",
      value: "catalog-value",
    });
    expect(item.props.className.split(" ")).toStrictEqual(
      expect.arrayContaining([
        variant.row,
        variant.gap,
        "shrink-0",
        "rounded-xs",
        "px-md",
        "data-[state=checked]:bg-surface-active",
        "data-[state=checked]:text-text",
      ])
    );
    expect(item.props.children[1].props.className).toContain("shrink-0");
    const content = SelectContent({ appearance: variant.appearance });
    const menu = content.props.children;
    expect(menu.props.className.split(" ")).toStrictEqual(
      expect.arrayContaining([variant.width, "shadow-lg"])
    );
    expect(menu.props).toMatchObject({
      children: { props: { className: "p-xs flex flex-col gap-hairline" } },
      collisionPadding: 8,
      sideOffset: 6,
    });
    expect(menu.props).not.toHaveProperty("appearance");
  });

  it.each([
    { appearance: "model" as const, fontSize: "text-sm", row: "h-8" },
    { appearance: "thinking" as const, fontSize: "text-xs", row: "h-7" },
  ])(
    "retains the Paper line-height after merging $appearance row classes",
    (variant) => {
      const classes: string[] = SelectItem({
        appearance: variant.appearance,
        value: "catalog-value",
      }).props.className.split(" ");
      expect(classes).toContain("leading-sm");
      expect(classes).toContain(variant.fontSize);
      expect(classes).toContain(variant.row);
      expect(classes.indexOf("leading-sm")).toBeGreaterThan(
        classes.indexOf(variant.fontSize)
      );
    }
  );

  it("uses the KXE role heading and one-pixel group gaps", () => {
    expect(SelectGroup({ appearance: "model" }).props.className).toBe(
      "flex flex-col gap-hairline"
    );
    expect(SelectLabel({ children: "Workers" }).props.className).toContain(
      "px-md pt-sm pb-xs"
    );
  });

  it("retains the existing default trigger, item and viewport appearance", () => {
    const trigger = SelectTrigger({});
    expect(trigger.props.className).toContain(
      "bg-surface-overlay px-md text-sm"
    );
    expect(trigger.props.className).not.toContain("shadow-button");
    expect(SelectItem({ value: "existing" }).props.className).toContain(
      "py-sm pr-3xl pl-md"
    );
    expect(
      SelectContent({}).props.children.props.children.props.className
    ).toBe("p-xs");
    const markup = renderToStaticMarkup(
      createElement(
        Select,
        { value: "existing" },
        createElement(
          SelectTrigger,
          { "aria-label": "Existing select" },
          "Existing value"
        )
      )
    );
    expect(
      ['role="combobox"', 'aria-expanded="false"', "Existing value"].every(
        (value) => markup.includes(value)
      )
    ).toBeTruthy();
  });
});
