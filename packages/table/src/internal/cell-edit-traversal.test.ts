import { describe, expect, it, vi } from "vitest";

import { compileColumns, type CompiledFieldColumn } from "./compile-columns";
import { BrunoTableCellEditTraversalIndex } from "./cell-edit-traversal";

type Row = Readonly<{
  readonly id: string;
  readonly enabled: boolean;
  readonly alternate: boolean;
}>;

const makeColumns = () =>
  compileColumns([
    {
      columnId: "COL_ID_ENABLED",
      field: "enabled",
      headerName: "Enabled",
      valueType: "boolean",
      isEditable: ({ row }: { readonly row: Row }) => row.enabled,
    },
    {
      columnId: "COL_ID_ALTERNATE",
      field: "alternate",
      headerName: "Alternate",
      valueType: "boolean",
      isEditable: ({ row }: { readonly row: Row }) => row.alternate,
    },
  ]);

function rowSpace(rowIds: readonly string[]) {
  return Object.freeze({
    totalRows: rowIds.length,
    getRowId: (rowIndex: number) => rowIds[rowIndex],
  });
}

describe("BrunoTable editable traversal index", () => {
  it("keeps literal editable columns analytical without reading or evaluating rows", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_STATIC",
        field: "id",
        headerName: "Static",
        valueType: "text",
        isEditable: true,
      },
    ]);
    const getRow = vi.fn();
    const evaluate = vi.fn();
    const index = new BrunoTableCellEditTraversalIndex(getRow, evaluate);

    index.reconcile(columns, rowSpace(["first", "second"]));

    expect(index.find(0, "COL_ID_STATIC", 1)).toEqual({
      rowIndex: 1,
      rowId: "second",
      columnId: "COL_ID_STATIC",
    });
    expect(getRow).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("finds exact far-later, reverse, and terminal destinations without a cell scan", () => {
    const rows = new Map<string, Row>(
      Array.from({ length: 5_000 }, (_unused, index) => {
        const id = `row-${String(index)}`;
        return [id, { id, enabled: index === 4_999, alternate: false }];
      }),
    );
    const columns = makeColumns();
    const evaluate = vi.fn((_rowId: string, row: Row, column: CompiledFieldColumn) =>
      column.columnId === "COL_ID_ENABLED" ? row.enabled : row.alternate,
    );
    const index = new BrunoTableCellEditTraversalIndex(
      (rowId) => rows.get(rowId),
      evaluate as never,
    );
    const projection = rowSpace([...rows.keys()]);

    index.reconcile(columns, projection);

    expect(index.find(0, "COL_ID_ENABLED", 1)).toEqual({
      rowIndex: 4_999,
      rowId: "row-4999",
      columnId: "COL_ID_ENABLED",
    });
    expect(index.find(4_999, "COL_ID_ALTERNATE", -1)).toEqual({
      rowIndex: 4_999,
      rowId: "row-4999",
      columnId: "COL_ID_ENABLED",
    });
    expect(index.find(0, "COL_ID_ENABLED", -1)).toBeUndefined();
    expect(index.find(4_999, "COL_ID_ENABLED", 1)).toBeUndefined();
    expect(evaluate).toHaveBeenCalledTimes(10_000);
  });

  it("reuses predicate evidence across sort and filter, then reevaluates bounded causes", () => {
    const first: Row = { id: "first", enabled: false, alternate: false };
    const second: Row = { id: "second", enabled: true, alternate: false };
    const third: Row = { id: "third", enabled: false, alternate: true };
    const rows = new Map<string, Row>([
      [first.id, first],
      [second.id, second],
      [third.id, third],
    ]);
    const evaluate = vi.fn((_rowId: string, row: Row, column: CompiledFieldColumn) =>
      column.columnId === "COL_ID_ENABLED" ? row.enabled : row.alternate,
    );
    const index = new BrunoTableCellEditTraversalIndex(
      (rowId) => rows.get(rowId),
      evaluate as never,
    );
    const columns = makeColumns();

    index.reconcile(columns, rowSpace(["first", "second", "third"]));
    expect(evaluate).toHaveBeenCalledTimes(6);
    index.reconcile(columns, rowSpace(["third", "second", "first"]));
    index.reconcile(columns, rowSpace(["third", "first"]));
    index.reconcile(columns, rowSpace(["first", "second", "third"]));
    expect(evaluate).toHaveBeenCalledTimes(6);
    expect(index.find(0, "COL_ID_ENABLED", 1)).toEqual({
      rowIndex: 1,
      rowId: "second",
      columnId: "COL_ID_ENABLED",
    });

    index.reconcile(columns.toReversed(), rowSpace(["third", "second", "first"]));
    expect(evaluate).toHaveBeenCalledTimes(6);
    expect(index.find(0, "COL_ID_ENABLED", -1)).toEqual({
      rowIndex: 0,
      rowId: "third",
      columnId: "COL_ID_ALTERNATE",
    });
    index.reconcile(columns, rowSpace(["first", "second", "third"]));

    const replacement: Row = { ...second, enabled: false, alternate: true };
    rows.set(second.id, replacement);
    index.reconcileRows(new Set(["second"]));
    expect(evaluate).toHaveBeenCalledTimes(8);
    expect(index.find(0, "COL_ID_ENABLED", 1)).toEqual({
      rowIndex: 1,
      rowId: "second",
      columnId: "COL_ID_ALTERNATE",
    });

    index.invalidateCell("second", "COL_ID_ALTERNATE");
    expect(index.find(0, "COL_ID_ENABLED", 1)).toEqual({
      rowIndex: 1,
      rowId: "second",
      columnId: "COL_ID_ALTERNATE",
    });
    expect(evaluate).toHaveBeenCalledTimes(9);

    const nextColumns = makeColumns();
    index.reconcile(nextColumns, rowSpace(["first", "second", "third"]));
    expect(evaluate).toHaveBeenCalledTimes(15);

    index.reconcile(nextColumns, rowSpace(["first", "third"]));
    expect(index.getCachedRowCount()).toBe(3);
    rows.delete("second");
    index.reconcileRows(new Set(["second"]));
    expect(index.getCachedRowCount()).toBe(2);
  });

  it("cycles exact horizontal and vertical range eligibility from indexed evidence", () => {
    const rangeRows = new Map<string, Row>([
      ["first", { id: "first", enabled: true, alternate: false }],
      ["middle", { id: "middle", enabled: false, alternate: false }],
      ["last", { id: "last", enabled: true, alternate: true }],
    ]);
    const columns = makeColumns();
    const index = new BrunoTableCellEditTraversalIndex(
      (rowId) => rangeRows.get(rowId),
      (_rowId, row, column) =>
        column.columnId === "COL_ID_ENABLED" ? (row as Row).enabled : (row as Row).alternate,
    );
    index.reconcile(columns, rowSpace([...rangeRows.keys()]));
    const vertical = Object.freeze({
      axis: "vertical" as const,
      columnId: "COL_ID_ENABLED",
      rowIds: Object.freeze(["first", "middle", "last"]),
    });
    const horizontal = Object.freeze({
      axis: "horizontal" as const,
      rowId: "last",
      columnIds: Object.freeze(["COL_ID_ENABLED", "COL_ID_ALTERNATE"]),
    });

    expect(index.findRange(vertical, "first", "COL_ID_ENABLED", 1)?.rowId).toBe("last");
    expect(index.findRange(vertical, "last", "COL_ID_ENABLED", 1)?.rowId).toBe("first");
    expect(index.findRange(vertical, "first", "COL_ID_ENABLED", -1)?.rowId).toBe("last");
    expect(index.getCachedVerticalRangeDestinationCount()).toBe(2);
    expect(index.findRange(horizontal, "last", "COL_ID_ENABLED", 1)?.columnId).toBe(
      "COL_ID_ALTERNATE",
    );
    expect(index.findRange(horizontal, "last", "COL_ID_ALTERNATE", 1)?.columnId).toBe(
      "COL_ID_ENABLED",
    );

    rangeRows.set("middle", { id: "middle", enabled: true, alternate: false });
    index.reconcileRows(new Set(["middle"]));
    expect(index.findRange(vertical, "first", "COL_ID_ENABLED", 1)?.rowId).toBe("middle");

    index.reconcileRange(horizontal);
    expect(index.getCachedVerticalRangeDestinationCount()).toBe(0);
    rangeRows.set("middle", { id: "middle", enabled: false, alternate: false });
    index.reconcileRows(new Set(["middle"]));
    expect(index.getCachedVerticalRangeDestinationCount()).toBe(0);

    index.findRange(vertical, "first", "COL_ID_ENABLED", 1);
    expect(index.getCachedVerticalRangeDestinationCount()).toBe(2);
    index.reconcileRange(undefined);
    expect(index.getCachedVerticalRangeDestinationCount()).toBe(0);
  });

  it("reevaluates only 150 predicate cells for one changed row in a 5,000 by 150 index", () => {
    const rows = new Map<string, Row>(
      Array.from({ length: 5_000 }, (_unused, rowIndex) => {
        const id = `row-${String(rowIndex)}`;
        return [id, { id, enabled: false, alternate: false }];
      }),
    );
    const columns = compileColumns(
      Array.from({ length: 150 }, (_unused, columnIndex) => ({
        columnId: `COL_ID_${String(columnIndex)}`,
        field: "enabled" as const,
        headerName: `Column ${String(columnIndex)}`,
        valueType: "boolean" as const,
        isEditable: ({ row }: { readonly row: Row }) => row.enabled,
      })),
    );
    const evaluate = vi.fn((_rowId: string, row: object) => (row as Row).enabled);
    const index = new BrunoTableCellEditTraversalIndex((rowId) => rows.get(rowId), evaluate);
    index.reconcile(columns, rowSpace([...rows.keys()]));
    evaluate.mockClear();

    rows.set("row-2500", { id: "row-2500", enabled: true, alternate: false });
    index.reconcileRows(new Set(["row-2500"]));

    expect(evaluate).toHaveBeenCalledTimes(150);
    expect(index.find(0, columns[0]!.columnId, 1)?.rowId).toBe("row-2500");
  });

  it("validates row references after an unknown publication without rebuilding unchanged rows", () => {
    const rows = new Map<string, Row>([
      ["first", { id: "first", enabled: false, alternate: false }],
      ["second", { id: "second", enabled: true, alternate: false }],
    ]);
    const evaluate = vi.fn((_rowId: string, row: object, column: CompiledFieldColumn) =>
      column.columnId === "COL_ID_ENABLED" ? (row as Row).enabled : (row as Row).alternate,
    );
    const columns = makeColumns();
    const index = new BrunoTableCellEditTraversalIndex((rowId) => rows.get(rowId), evaluate);
    const projection = rowSpace(["first", "second"]);
    index.reconcile(columns, projection);
    expect(evaluate).toHaveBeenCalledTimes(4);

    index.reconcileRows(undefined);
    expect(evaluate).toHaveBeenCalledTimes(4);
    index.reconcile(columns, rowSpace(["second", "first"]));
    expect(evaluate).toHaveBeenCalledTimes(4);

    rows.set("first", { id: "first", enabled: true, alternate: false });
    index.reconcileRows(undefined);
    index.reconcile(columns, rowSpace(["second"]));
    expect(evaluate).toHaveBeenCalledTimes(4);
    index.reconcile(columns, rowSpace(["first", "second"]));
    expect(evaluate).toHaveBeenCalledTimes(6);
    expect(index.find(0, "COL_ID_ENABLED", 1)?.rowId).toBe("second");
  });
});
