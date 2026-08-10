import { describe, expect, it, vi } from "vitest";

import { ClientRowOrderStore } from "./client-row-pipeline";

describe("ClientRowOrderStore", () => {
  it("indexes row identities, reuses unchanged row spaces, and notifies past failures", () => {
    const store = new ClientRowOrderStore(["first", "second", "third"], 0);
    const initialRowSpace = store.getSnapshot().rowSpace;
    expect(initialRowSpace.findRowIndex("third")).toBe(2);
    expect(initialRowSpace.findRowIndex("missing")).toBeUndefined();

    store.publish(["first", "second", "third"], 1);
    expect(store.getSnapshot().rowSpace).toBe(initialRowSpace);

    const failure = new Error("listener failed");
    const laterListener = vi.fn();
    store.subscribe(() => {
      throw failure;
    });
    store.subscribe(laterListener);

    expect(() => store.publish(["third", "first", "second"], 1)).toThrow(failure);
    expect(laterListener).toHaveBeenCalledOnce();
    expect(store.getSnapshot().rowSpace.findRowIndex("first")).toBe(1);
  });
});
