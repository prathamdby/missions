import { describe, expect, it } from "vitest";

import { MessageDraft } from "./message-draft";

const draft = () => {
  let next = 0;
  return new MessageDraft(() => {
    next += 1;
    return `message-${next}`;
  });
};

describe(MessageDraft, () => {
  it("admits distinct identical messages but ignores an immediate duplicate submit", () => {
    const controller = draft();
    controller.change("  Hello  ");
    const first = controller.take("steer");
    expect(controller.take("steer")).toBeNull();
    controller.change("Hello");
    const second = controller.take("steer");
    expect(first?.input).toStrictEqual(second?.input);
    expect(first?.occurrence).not.toBe(second?.occurrence);
  });

  it("restores the same logical occurrence on retry without erasing a newer draft", () => {
    const controller = draft();
    controller.change("first");
    const first = controller.take("queue");
    if (!first) {
      throw new Error("Missing test delivery");
    }
    controller.change("new draft");
    controller.restore(first);
    expect(controller.snapshot()).toBe("new draft");
    expect(controller.take("steer")?.input.text).toBe("new draft");
    expect(controller.snapshot()).toBe("first");
    expect(controller.take("queue")).toStrictEqual(first);
  });

  it("keeps every failed concurrent delivery and gives changed payloads a new occurrence", () => {
    const controller = draft();
    controller.change("one");
    const one = controller.take("steer");
    controller.change("two");
    const two = controller.take("steer");
    if (!one || !two) {
      throw new Error("Missing test deliveries");
    }
    controller.restore(two);
    controller.restore(one);
    controller.change("edited two");
    expect(controller.take("steer")?.occurrence).not.toBe(two.occurrence);
    expect(controller.take("steer")).toStrictEqual(one);
  });
});
