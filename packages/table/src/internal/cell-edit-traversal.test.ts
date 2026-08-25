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
    const index = new BrunoTableCellEditTraversalIndex(getRow, () => 0, evaluate);

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
      () => 0,
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
    const revisions = new Map<string, number>();
    const evaluate = vi.fn((_rowId: string, row: Row, column: CompiledFieldColumn) =>
      column.columnId === "COL_ID_ENABLED" ? row.enabled : row.alternate,
    );
    const index = new BrunoTableCellEditTraversalIndex(
      (rowId) => rows.get(rowId),
      (rowId, columnId) => revisions.get(`${rowId}:${columnId}`) ?? 0,
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

    const replacement: Row = { ...second, enabled: false, alternate: true };
    rows.set(second.id, replacement);
    index.reconcileRows(new Set(["second"]));
    expect(evaluate).toHaveBeenCalledTimes(8);
    expect(index.find(0, "COL_ID_ENABLED", 1)).toEqual({
      rowIndex: 1,
      rowId: "second",
      columnId: "COL_ID_ALTERNATE",
    });

    revisions.set("second:COL_ID_ALTERNATE", 1);
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
    const index = new BrunoTableCellEditTraversalIndex(
      (rowId) => rows.get(rowId),
      () => 0,
      evaluate,
    );
    index.reconcile(columns, rowSpace([...rows.keys()]));
    evaluate.mockClear();

    rows.set("row-2500", { id: "row-2500", enabled: true, alternate: false });
    index.reconcileRows(new Set(["row-2500"]));

    expect(evaluate).toHaveBeenCalledTimes(150);
    expect(index.find(0, columns[0]!.columnId, 1)?.rowId).toBe("row-2500");
  });
});
