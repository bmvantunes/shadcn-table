import { describe, expect, it, vi } from "vitest";

import { ClientRowOrderStore } from "./client-row-pipeline";

describe("ClientRowOrderStore", () => {
  it("indexes row identities, reuses unchanged row spaces, and notifies past failures", () => {
    const store = new ClientRowOrderStore(["first", "second", "third"], 0);
    const initialRowSpace = store.getSnapshot().rowSpace;
    expect(initialRowSpace.identitySnapshot?.rowIds).toEqual(["first", "second", "third"]);
    expect(initialRowSpace.identitySnapshot?.rowIndexById.get("third")).toBe(2);
    expect(initialRowSpace.findRowIndex("third")).toBe(2);
    expect(initialRowSpace.findRowIndex("missing")).toBeUndefined();

    store.publish(["first", "second", "third"], 1);
    expect(store.getSnapshot().rowSpace).toBe(initialRowSpace);
    expect(store.getSnapshot().rowSpace.identitySnapshot).toBe(initialRowSpace.identitySnapshot);

    const failure = new Error("listener failed");
    const laterListener = vi.fn();
    store.subscribe(() => {
      throw failure;
    });
    store.subscribe(laterListener);

    expect(() => store.publish(["third", "first", "second"], 1)).toThrow(failure);
    expect(laterListener).toHaveBeenCalledOnce();
    const replacedRowSpace = store.getSnapshot().rowSpace;
    expect(replacedRowSpace.findRowIndex("first")).toBe(1);
    expect(replacedRowSpace.identitySnapshot).not.toBe(initialRowSpace.identitySnapshot);
    expect(replacedRowSpace.identitySnapshot?.rowIds).toEqual(["third", "first", "second"]);
    expect(replacedRowSpace.identitySnapshot?.rowIndexById.get("first")).toBe(1);
  });
});
