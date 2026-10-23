import { describe, expect, it, vi } from "vitest";

import { TabsList, TabsTrigger } from "./tabs";

vi.mock(import("@/lib/utils"), async () => await import("../../lib/utils"));

describe("Paper conversation tabs", () => {
  it("keeps the approved tab spacing without conflicting default padding", () => {
    const classes = TabsTrigger({
      value: "worker",
      variant: "conversation",
    }).props.className.split(" ");
    expect(classes).toStrictEqual(
      expect.arrayContaining(["h-7", "px-control", "gap-md", "shrink-0"])
    );
    expect(classes).not.toContain("px-md");
    expect(TabsList({ variant: "conversation" }).props.className).toContain(
      "gap-2xs"
    );
  });

  it("preserves the existing inspector tab geometry", () => {
    const classes = TabsTrigger({ value: "overview" }).props.className.split(
      " "
    );
    expect(classes).toStrictEqual(expect.arrayContaining(["px-md", "gap-sm"]));
    expect(TabsList({}).props.className).toContain("gap-xs");
  });
});
