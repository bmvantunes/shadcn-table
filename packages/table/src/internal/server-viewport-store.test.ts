import { describe, expect, it, vi } from "vitest";

import { BrunoTableServerViewportStore } from "./server-viewport-store";

type Row = Readonly<{ readonly symbol: string; readonly price: number }>;

describe("BrunoTableServerViewportStore", () => {
  it("writes authoritative row keys into out-of-order absolute slots in one publication", () => {
    const store = new BrunoTableServerViewportStore<Row>();
    const listener = vi.fn();
    store.subscribe(listener);
    const generation = store.beginGeneration({ firstRow: 20, lastRow: 24 });
    listener.mockClear();

    store.setRowCount(generation, 1_000, true);
    listener.mockClear();
    const row22 = { symbol: "NVDA", price: 130 } as const;
    const row20 = { symbol: "AAPL", price: 240 } as const;
    expect(
      store.setRowData(generation, { 22: row22, 20: row20 }, { 20: "key-a", 22: "key-n" }),
    ).toBe(true);

    const snapshot = store.getSnapshot();
    expect(snapshot.rowSpace.getRowId(20)).toBe("key-a");
    expect(snapshot.rowSpace.getRowId(21)).toBeUndefined();
    expect(snapshot.rowSpace.getRowId(22)).toBe("key-n");
    expect(snapshot.rowSpace.getRow("key-n")).toBe(row22);
    expect(snapshot.rowSpace.loadedRows).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("retains same-generation overlap and row references while rejecting late generations", () => {
    const store = new BrunoTableServerViewportStore<Row>();
    const first = store.beginGeneration({ firstRow: 0, lastRow: 2 });
    store.setRowCount(first, 100);
    const stable = { symbol: "MSFT", price: 410 } as const;
    store.setRowData(
      first,
      { 0: { symbol: "AAPL", price: 240 }, 1: stable, 2: { symbol: "NVDA", price: 130 } },
      { 0: "a", 1: "m", 2: "n" },
    );

    store.setRequiredRange(first, { firstRow: 1, lastRow: 3 });
    store.setRowData(
      first,
      { 1: { symbol: "MSFT", price: 410 }, 3: { symbol: "SAP", price: 250 } },
      { 1: "m", 3: "s" },
    );
    expect(store.getSnapshot().rowSpace.getRow("m")).toBe(stable);

    const second = store.beginGeneration({ firstRow: 0, lastRow: 1 });
    expect(store.getSnapshot().rowSpace.getRowId(1)).toBeUndefined();
    expect(store.getSnapshot().authoritativeTotalRows).toBe(false);
    expect(store.setRowCount(first, 999, true)).toBe(false);
    expect(store.setRowData(first, { 0: { symbol: "LATE", price: 0 } }, { 0: "late" })).toBe(false);
    expect(store.getSnapshot().generation).toBe(second);
    expect(store.getSnapshot().rowSpace.getRowId(0)).toBeUndefined();
  });

  it("rejects misaligned row and key maps atomically", () => {
    const store = new BrunoTableServerViewportStore<Row>();
    const generation = store.beginGeneration({ firstRow: 0, lastRow: 4 });
    store.setRowCount(generation, 5);

    expect(
      store.setRowData(
        generation,
        { 0: { symbol: "AAPL", price: 240 }, 2: { symbol: "NVDA", price: 130 } },
        { 0: "a" },
      ),
    ).toBe(false);
    expect(store.getSnapshot().rowSpace.loadedRows).toBe(0);

    expect(
      store.setRowData(generation, { 0: { symbol: "AAPL", price: 240 } }, { 0: "a", 1: "extra" }),
    ).toBe(false);
    expect(store.getSnapshot().rowSpace.loadedRows).toBe(0);
  });

  it("does not let setRowCount retention hints bridge semantic generations", () => {
    const store = new BrunoTableServerViewportStore<Row>();
    const first = store.beginGeneration({ firstRow: 0, lastRow: 9 });
    store.setRowCount(first, 100, true);
    store.setRowData(first, { 0: { symbol: "AAPL", price: 240 } }, { 0: "a" });

    const second = store.beginGeneration({ firstRow: 0, lastRow: 9 });
    expect(store.setRowCount(first, 100, true)).toBe(false);
    expect(store.getSnapshot().generation).toBe(second);
    expect(store.getSnapshot().rowSpace.totalRows).toBe(10);
    expect(store.getSnapshot().rowSpace.getRowId(0)).toBeUndefined();
  });

  it("ignores lifecycle count hints until an authoritative count arrives", () => {
    const store = new BrunoTableServerViewportStore<Row>();
    const generation = store.beginGeneration({ firstRow: 0, lastRow: 17 });

    expect(store.setRowCount(generation, 0, false)).toBe(true);
    expect(store.getSnapshot().authoritativeTotalRows).toBe(false);
    expect(store.getSnapshot().rowSpace.totalRows).toBe(18);

    expect(store.setRowCount(generation, 0, true)).toBe(true);
    expect(store.getSnapshot().authoritativeTotalRows).toBe(true);
    expect(store.getSnapshot().rowSpace.totalRows).toBe(0);
  });

  it("keeps only the active sparse window while retaining overlap", () => {
    const store = new BrunoTableServerViewportStore<Row>();
    const generation = store.beginGeneration({ firstRow: 0, lastRow: 2 });
    store.setRowCount(generation, 1_000_000, true);
    const overlap = { symbol: "NVDA", price: 130 } as const;
    store.setRowData(
      generation,
      { 0: { symbol: "AAPL", price: 240 }, 1: overlap, 2: { symbol: "MSFT", price: 410 } },
      { 0: "a", 1: "n", 2: "m" },
    );

    store.setRequiredRange(generation, { firstRow: 1, lastRow: 3 });
    expect(store.getSnapshot().rowSpace.loadedRows).toBe(2);
    expect(store.getSnapshot().rowSpace.getRow("n")).toBe(overlap);
    store.setRowData(
      generation,
      {
        0: { symbol: "LATE", price: 0 },
        1: { symbol: "NVDA", price: 130 },
        3: { symbol: "SAP", price: 250 },
      },
      { 0: "late", 1: "n", 3: "s" },
    );
    expect(store.getSnapshot().rowSpace.loadedRows).toBe(3);
    expect(store.getSnapshot().rowSpace.getRowId(0)).toBeUndefined();
    expect(store.getSnapshot().rowSpace.getRow("n")).toBe(overlap);
  });

  it("reconciles row moves atomically with exact semantic equality", () => {
    type ExactRow = Readonly<{
      readonly symbol: string;
      readonly exact: { readonly value: string };
    }>;
    const store = new BrunoTableServerViewportStore<ExactRow>(
      () => undefined,
      (left, right) => left.symbol === right.symbol && left.exact.value === right.exact.value,
    );
    const generation = store.beginGeneration({ firstRow: 0, lastRow: 1 });
    const first = { symbol: "A", exact: { value: "1.50" } } as const;
    const second = { symbol: "B", exact: { value: "2.00" } } as const;
    store.setRowData(generation, { 0: first, 1: second }, { 0: "a", 1: "b" });

    store.setRowData(
      generation,
      {
        0: { symbol: "B", exact: { value: "2.00" } },
        1: { symbol: "A", exact: { value: "1.50" } },
      },
      { 0: "b", 1: "a" },
    );
    expect(store.getSnapshot().rowSpace.getRow("a")).toBe(first);
    expect(store.getSnapshot().rowSpace.getRow("b")).toBe(second);
    expect(store.getSnapshot().rowSpace.getRowId(0)).toBe("b");
    expect(store.getSnapshot().rowSpace.getRowId(1)).toBe("a");
  });
});
