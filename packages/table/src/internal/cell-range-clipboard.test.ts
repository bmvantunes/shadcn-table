import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  BrunoTableCellRangeRuntime,
  captureBrunoTableClipboardSnapshot,
  createBrunoTableCellRangeStructure,
  createBrunoTableCellRangeStructureFromRowSpace,
  installBrunoTableCellRangeInstrumentationListener,
  serializeBrunoTableClipboardSnapshot,
  type BrunoTableClipboardSnapshot,
  type BrunoTableClipboardTarget,
} from "./cell-range-clipboard";

const structure = createBrunoTableCellRangeStructure(
  ["ROW_A", "ROW_B", "ROW_C", "ROW_D"],
  ["COL_ID_A", "COL_ID_B", "COL_ID_C", "COL_ID_D"],
);

function gestureGrid(view: Window): HTMLElement {
  return {
    ownerDocument: { defaultView: view },
    focus: vi.fn(),
    setPointerCapture: vi.fn(),
    getBoundingClientRect: vi.fn(() => ({ top: 0 }) as DOMRect),
    querySelector: vi.fn(() => null),
    clientTop: 0,
    clientHeight: 100,
  } as unknown as HTMLElement;
}

describe("BrunoTable one-axis Cell Range and Clipboard Snapshot", () => {
  it("reuses a source-owned exact Row Identity snapshot", () => {
    const rowIds = Object.freeze(["ROW_A", "ROW_B"]);
    const rowIndexById = new Map(rowIds.map((rowId, index) => [rowId, index]));
    const reused = createBrunoTableCellRangeStructure(rowIds, ["COL_ID_A"], rowIndexById);
    expect(reused.rowIds).toBe(rowIds);
    expect(reused.rowIndexById).toBe(rowIndexById);
  });

  it("derives a range structure from source-owned identities without traversing rows", () => {
    const rowIds = Object.freeze(["ROW_A", "ROW_B"]);
    const rowIndexById = new Map(rowIds.map((rowId, index) => [rowId, index]));
    const getRowId = vi.fn(() => {
      throw new Error("range derivation must not traverse the logical row space");
    });
    const derived = createBrunoTableCellRangeStructureFromRowSpace(
      {
        totalRows: 100_000,
        getRowId,
        identitySnapshot: { rowIds, rowIndexById },
      },
      ["COL_ID_A"],
    );

    expect(getRowId).not.toHaveBeenCalled();
    expect(derived.rowIds).toBe(rowIds);
    expect(derived.rowIndexById).toBe(rowIndexById);
  });

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

  it("keeps valid active gestures across unrelated structure changes and invalidates changed spans", () => {
    const range = new BrunoTableCellRangeRuntime();
    range.replace({ rowId: "ROW_B", columnId: "COL_ID_B" }, structure);
    const activated: Array<Readonly<{ rowId: string; columnId: string }>> = [];
    let restored = 0;
    const view = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
    } as unknown as Window;
    const grid = gestureGrid(view);
    const event = {
      button: 0,
      clientX: 0,
      clientY: 0,
      pointerId: 42,
      shiftKey: true,
      target: null,
      preventDefault: vi.fn(),
    } as unknown as PointerEvent;

    range.startPointerGesture(
      event,
      { rowId: "ROW_B", columnId: "COL_ID_D", rowIndex: 1 },
      grid,
      (hit) => activated.push(hit),
      () => {
        restored += 1;
      },
      () => false,
    );
    expect(range.isPointerGestureActive()).toBe(true);
    expect(activated.at(-1)).toMatchObject({ rowId: "ROW_B", columnId: "COL_ID_D" });

    const unrelated = createBrunoTableCellRangeStructure(
      ["ROW_X", ...structure.rowIds],
      [...structure.columnIds, "COL_ID_X"],
    );
    range.reconcile(unrelated);
    expect(range.isPointerGestureActive()).toBe(true);
    expect(restored).toBe(0);

    const changedInterior = createBrunoTableCellRangeStructure(unrelated.rowIds, [
      "COL_ID_A",
      "COL_ID_B",
      "COL_ID_INSERTED",
      "COL_ID_C",
      "COL_ID_D",
      "COL_ID_X",
    ]);
    range.reconcile(changedInterior);
    expect(range.isPointerGestureActive()).toBe(false);
    expect(range.getPointerGestureSnapshot()).toEqual({
      value: "idle",
      pointerId: undefined,
      before: {},
      axis: undefined,
    });
    expect(range.getSnapshot()).toEqual({});
    expect(range.consumeStructuralInvalidation()).toBe(true);
    expect(restored).toBe(0);
  });

  it("projects a tied diagonal Shift pointer start back to the visible anchor", () => {
    const range = new BrunoTableCellRangeRuntime();
    range.replace({ rowId: "ROW_B", columnId: "COL_ID_B" }, structure);
    const activated = vi.fn();
    const view = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;
    const grid = gestureGrid(view);

    range.startPointerGesture(
      {
        button: 0,
        clientX: 0,
        clientY: 0,
        pointerId: 43,
        shiftKey: true,
        target: null,
        preventDefault: vi.fn(),
      } as unknown as PointerEvent,
      { rowId: "ROW_D", columnId: "COL_ID_D", rowIndex: 3 },
      grid,
      activated,
      vi.fn(),
      () => false,
    );

    expect(range.getSnapshot()).toEqual({ anchor: { rowId: "ROW_B", columnId: "COL_ID_B" } });
    expect(activated).toHaveBeenCalledWith({
      rowId: "ROW_B",
      columnId: "COL_ID_B",
      rowIndex: 1,
    });
    range.cancelPointerGesture();
    expect(range.getPointerGestureSnapshot()).toEqual({
      value: "idle",
      pointerId: undefined,
      before: {},
      axis: undefined,
    });
  });

  it("clears XState gesture evidence after commit", () => {
    const range = new BrunoTableCellRangeRuntime();
    range.replace({ rowId: "ROW_A", columnId: "COL_ID_A" }, structure);
    let pointerUp: ((event: PointerEvent) => void) | undefined;
    const view = {
      addEventListener: vi.fn((type: string, listener: (event: PointerEvent) => void) => {
        if (type === "pointerup") pointerUp = listener;
      }),
      removeEventListener: vi.fn(),
    } as unknown as Window;
    const grid = gestureGrid(view);
    range.startPointerGesture(
      {
        button: 0,
        clientX: 0,
        clientY: 0,
        pointerId: 44,
        shiftKey: false,
        target: null,
        preventDefault: vi.fn(),
      } as unknown as PointerEvent,
      { rowId: "ROW_A", columnId: "COL_ID_A", rowIndex: 0 },
      grid,
      vi.fn(),
      vi.fn(),
      () => false,
    );
    pointerUp?.({
      clientX: 0,
      clientY: 0,
      pointerId: 44,
      target: null,
    } as unknown as PointerEvent);
    expect(range.getPointerGestureSnapshot()).toEqual({
      value: "idle",
      pointerId: undefined,
      before: {},
      axis: undefined,
    });
  });

  it("lazily creates a fresh idle gesture actor after disposal", () => {
    const range = new BrunoTableCellRangeRuntime();
    range.replace({ rowId: "ROW_A", columnId: "COL_ID_A" }, structure);
    const view = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;
    const grid = gestureGrid(view);
    const start = (pointerId: number) =>
      range.startPointerGesture(
        {
          button: 0,
          clientX: 0,
          clientY: 0,
          pointerId,
          shiftKey: false,
          target: null,
          preventDefault: vi.fn(),
        } as unknown as PointerEvent,
        { rowId: "ROW_A", columnId: "COL_ID_A", rowIndex: 0 },
        grid,
        vi.fn(),
        vi.fn(),
        () => false,
      );

    expect(start(44)).toBe(true);
    expect(range.getPointerGestureSnapshot()).toMatchObject({ value: "armed", pointerId: 44 });
    range.dispose();
    expect(range.getPointerGestureSnapshot()).toEqual({
      value: "idle",
      pointerId: undefined,
      before: {},
      axis: undefined,
    });
    expect(start(45)).toBe(true);
    expect(range.getPointerGestureSnapshot()).toMatchObject({ value: "armed", pointerId: 45 });
    range.dispose();
  });

  it("does not poison Active Cell Copy when only a single anchor disappears", () => {
    const range = new BrunoTableCellRangeRuntime();
    range.replace({ rowId: "ROW_B", columnId: "COL_ID_B" }, structure);
    range.reconcile(
      createBrunoTableCellRangeStructure(["ROW_A", "ROW_C", "ROW_D"], structure.columnIds),
    );
    expect(range.getSnapshot()).toEqual({});
    expect(range.consumeStructuralInvalidation()).toBe(false);
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
