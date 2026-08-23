import { describe, expect, expectTypeOf, it } from "vitest";

import {
  BrunoTableCellRangeRuntime,
  captureBrunoTableClipboardSnapshot,
  createBrunoTableCellRangeStructure,
  installBrunoTableCellRangeInstrumentationListener,
  serializeBrunoTableClipboardSnapshot,
  type BrunoTableClipboardSnapshot,
  type BrunoTableClipboardTarget,
} from "./cell-range-clipboard";

const structure = createBrunoTableCellRangeStructure(
  ["ROW_A", "ROW_B", "ROW_C", "ROW_D"],
  ["COL_ID_A", "COL_ID_B", "COL_ID_C", "COL_ID_D"],
);

describe("BrunoTable one-axis Cell Range and Clipboard Snapshot", () => {
  it("makes rectangular targets and snapshots unrepresentable", () => {
    type RectangularTarget = Readonly<{
      readonly axis: "horizontal";
      readonly rowIds: readonly ["ROW_A", "ROW_B"];
      readonly columnIds: readonly ["COL_ID_A", "COL_ID_B"];
    }>;
    type RectangularSnapshot = RectangularTarget &
      Readonly<{ readonly canonicalTexts: readonly ["a", "b", "c", "d"] }>;

    expectTypeOf<
      RectangularTarget extends BrunoTableClipboardTarget ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      RectangularSnapshot extends BrunoTableClipboardSnapshot ? true : false
    >().toEqualTypeOf<false>();
  });

  it("keeps one stable anchor and can represent only horizontal or vertical spans", () => {
    const range = new BrunoTableCellRangeRuntime();

    range.replace({ rowId: "ROW_B", columnId: "COL_ID_B" }, structure);
    range.extend({ rowId: "ROW_B", columnId: "COL_ID_D" }, structure);
    expect(range.getSnapshot()).toMatchObject({
      anchor: { rowId: "ROW_B", columnId: "COL_ID_B" },
      range: {
        axis: "horizontal",
        rowId: "ROW_B",
        rowIds: ["ROW_B"],
        columnIds: ["COL_ID_B", "COL_ID_C", "COL_ID_D"],
      },
    });

    range.extend({ rowId: "ROW_D", columnId: "COL_ID_A" }, structure);
    expect(range.getSnapshot().range).toMatchObject({
      axis: "horizontal",
      rowId: "ROW_B",
      rowIds: ["ROW_B"],
      columnIds: ["COL_ID_A", "COL_ID_B"],
    });

    range.replace({ rowId: "ROW_A", columnId: "COL_ID_C" }, structure);
    range.extend({ rowId: "ROW_D", columnId: "COL_ID_C" }, structure);
    expect(range.getSnapshot().range).toMatchObject({
      axis: "vertical",
      columnId: "COL_ID_C",
      rowIds: ["ROW_A", "ROW_B", "ROW_C", "ROW_D"],
      columnIds: ["COL_ID_C"],
    });
  });

  it("locks a pointer extension to its acquired dominant axis and projects diagonal hits", () => {
    const range = new BrunoTableCellRangeRuntime();
    range.replace({ rowId: "ROW_B", columnId: "COL_ID_B" }, structure);

    expect(
      range.extend({ rowId: "ROW_D", columnId: "COL_ID_D" }, structure, "horizontal").range,
    ).toMatchObject({
      axis: "horizontal",
      rowId: "ROW_B",
      rowIds: ["ROW_B"],
      columnIds: ["COL_ID_B", "COL_ID_C", "COL_ID_D"],
    });
    expect(
      range.extend({ rowId: "ROW_A", columnId: "COL_ID_A" }, structure, "horizontal").range,
    ).toMatchObject({
      axis: "horizontal",
      rowId: "ROW_B",
      columnIds: ["COL_ID_A", "COL_ID_B"],
    });
  });

  it("preserves value-only publications and rejects changed intervening identity spans", () => {
    const range = new BrunoTableCellRangeRuntime();
    range.replace({ rowId: "ROW_B", columnId: "COL_ID_B" }, structure);
    const selected = range.extend({ rowId: "ROW_D", columnId: "COL_ID_B" }, structure);

    expect(range.reconcile(structure)).toBe(selected);
    expect(
      range.reconcile(
        createBrunoTableCellRangeStructure(
          ["ROW_X", "ROW_B", "ROW_C", "ROW_D"],
          structure.columnIds,
        ),
      ).range,
    ).toEqual(selected.range);
    const changedStructure = createBrunoTableCellRangeStructure(
      ["ROW_X", "ROW_B", "ROW_INSERTED", "ROW_C", "ROW_D"],
      structure.columnIds,
    );
    expect(range.reconcile(changedStructure)).toEqual({});
    expect(range.consumeStructuralInvalidation()).toBe(true);
    expect(range.extend({ rowId: "ROW_C", columnId: "COL_ID_B" }, changedStructure)).toEqual({});
  });

  it("isolates optional diagnostics by table and ignores listener failures", () => {
    let observedOtherTable = 0;
    const removeThrowing = installBrunoTableCellRangeInstrumentationListener(
      "TABLE_ID_RANGE_A",
      () => {
        throw new Error("diagnostic failed");
      },
    );
    const removeOther = installBrunoTableCellRangeInstrumentationListener(
      "TABLE_ID_RANGE_B",
      () => {
        observedOtherTable += 1;
      },
    );
    try {
      const rangeA = new BrunoTableCellRangeRuntime("TABLE_ID_RANGE_A");
      expect(() =>
        rangeA.replace({ rowId: "ROW_A", columnId: "COL_ID_A" }, structure),
      ).not.toThrow();
      expect(observedOtherTable).toBe(0);

      const rangeB = new BrunoTableCellRangeRuntime("TABLE_ID_RANGE_B");
      rangeB.replace({ rowId: "ROW_A", columnId: "COL_ID_A" }, structure);
      expect(observedOtherTable).toBe(1);
    } finally {
      removeThrowing();
      removeOther();
    }
  });

  it("keeps a replacement instrumentation listener after an older disposer repeats", () => {
    const removeFirst = installBrunoTableCellRangeInstrumentationListener(
      "TABLE_ID_RANGE_DISPOSER",
      () => undefined,
    );
    removeFirst();
    let publications = 0;
    const removeReplacement = installBrunoTableCellRangeInstrumentationListener(
      "TABLE_ID_RANGE_DISPOSER",
      () => {
        publications += 1;
      },
    );
    try {
      removeFirst();
      const range = new BrunoTableCellRangeRuntime("TABLE_ID_RANGE_DISPOSER");
      range.replace({ rowId: "ROW_A", columnId: "COL_ID_A" }, structure);
      expect(publications).toBe(1);
    } finally {
      removeReplacement();
    }
  });

  it("captures every exact value before serialization so live changes cannot mix versions", () => {
    const values = new Map([
      ["ROW_A:COL_ID_A", 9_007_199_254_740_993n],
      ["ROW_A:COL_ID_B", 9_007_199_254_740_995n],
    ]);
    const snapshot = captureBrunoTableClipboardSnapshot(
      {
        axis: "horizontal",
        rowIds: ["ROW_A"],
        columnIds: ["COL_ID_A", "COL_ID_B"],
      },
      (cell) => {
        const key = `${cell.rowId}:${cell.columnId}`;
        const value = values.get(key);
        return value === undefined
          ? undefined
          : {
              value,
              formatCanonicalText: (captured) => {
                values.set("ROW_A:COL_ID_B", 1n);
                return String(captured);
              },
            };
      },
    );

    expect(snapshot).toBeDefined();
    expect(serializeBrunoTableClipboardSnapshot(snapshot!)).toBe(
      "9007199254740993\t9007199254740995",
    );
    expect(values.get("ROW_A:COL_ID_B")).toBe(1n);
  });

  it("rejects the complete Copy when one cell is unavailable", () => {
    const snapshot = captureBrunoTableClipboardSnapshot(
      {
        axis: "vertical",
        rowIds: ["ROW_A", "ROW_B"],
        columnIds: ["COL_ID_A"],
      },
      (cell) =>
        cell.rowId === "ROW_A" ? { value: "available", formatCanonicalText: String } : undefined,
    );

    expect(snapshot).toBeUndefined();
  });
});
