import { describe, expect, it, vi } from "vitest";

import { FilePreviewSource } from "./file-preview";

describe("local file previews", () => {
  it("allocates only while mounted and releases the object URL", async () => {
    const preview = new FilePreviewSource(new File(["notes"], "notes.txt"));
    expect(preview.snapshot()).toBeNull();
    const dispose = preview.subscribe(vi.fn());
    const url = preview.snapshot();
    if (!url) {
      throw new Error("Missing local preview");
    }
    const response = await fetch(url);
    await expect(response.text()).resolves.toBe("notes");
    dispose();
    expect(preview.snapshot()).toBeNull();
    await expect(fetch(url)).rejects.toThrow(/fetch failed/u);
  });

  it("creates a fresh URL when Strict Mode subscribes again", () => {
    const preview = new FilePreviewSource(new File(["notes"], "notes.txt"));
    const changed = vi.fn<() => void>();
    const dispose = preview.subscribe(changed);
    const first = preview.snapshot();
    dispose();
    const remount = preview.subscribe(changed);
    expect(preview.snapshot()).not.toBe(first);
    expect(changed).toHaveBeenCalledTimes(2);
    remount();
    expect(preview.snapshot()).toBeNull();
  });
});
