import { describe, expect, it } from "vitest";

import { SparseViewportStore } from "./sparse-store";

describe("SparseViewportStore", () => {
  it("retains overlaps on window movement and ignores old generations", () => {
    const store = new SparseViewportStore<{ readonly id: string; readonly price: number }>();
    const first = store.beginGeneration({ firstRow: 0, lastRow: 2 });
    const stable = { id: "b", price: 20 };
    store.setRowCount(first, 100);
    store.setRowData(
      first,
      { 0: { id: "a", price: 10 }, 1: stable, 2: { id: "c", price: 30 } },
      { 0: "key-a", 1: "key-b", 2: "key-c" },
    );
    store.setWindow(first, { firstRow: 1, lastRow: 3 });
    store.setRowData(
      first,
      { 1: { id: "b", price: 20 }, 2: { id: "c", price: 30 }, 3: { id: "d", price: 40 } },
      { 1: "key-b", 2: "key-c", 3: "key-d" },
    );

    expect(store.getSnapshot().slots[0]?.row).toBe(stable);
    expect(store.getSnapshot().reusedRows).toBe(2);

    const second = store.beginGeneration({ firstRow: 0, lastRow: 1 });
    store.setRowData(first, { 0: { id: "late", price: 0 } }, { 0: "late" });
    expect(store.getSnapshot().generation).toBe(second);
    expect(store.getSnapshot().slots[0]?.row).toBeUndefined();
  });

  it("rejects row payloads without authoritative keys", () => {
    const store = new SparseViewportStore<{ readonly id: string }>();
    const generation = store.beginGeneration({ firstRow: 0, lastRow: 0 });
    store.setRowData(generation, { 0: { id: "a" } }, {});
    expect(store.getSnapshot().identityFailures).toBe(1);
    expect(store.getSnapshot().slots[0]?.row).toBeUndefined();
  });
});
