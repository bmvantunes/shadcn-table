import type { CompiledColumn } from "./compile-columns";

export function orderBrunoTableLogicalColumns(
  columns: readonly CompiledColumn[],
): readonly CompiledColumn[] {
  return Object.freeze([
    ...columns.filter((column) => column.pinned === "start"),
    ...columns.filter((column) => column.pinned === undefined),
    ...columns.filter((column) => column.pinned === "end"),
  ]);
}

export type BrunoTableActiveCell = Readonly<{
  readonly region: "header" | "body";
  readonly rowIndex: number;
  readonly rowId?: string;
  readonly columnId: string;
}>;

type Listener = () => void;

export type BrunoTableNavigationRowSpace = Readonly<{
  readonly totalRows: number;
  readonly getRowId: (index: number) => string | undefined;
  readonly findRowIndex: (rowId: string) => number | undefined;
}>;

const EMPTY_ROW_SPACE: BrunoTableNavigationRowSpace = Object.freeze({
  totalRows: 0,
  getRowId: () => undefined,
  findRowIndex: () => undefined,
});

export class BrunoTableNavigationRuntime {
  private readonly listeners = new Set<Listener>();
  private rowSpace = EMPTY_ROW_SPACE;
  private columns: readonly CompiledColumn[] = [];
  private activeCell: BrunoTableActiveCell | undefined;
  private bodyInitializationBlocked = false;

  public readonly getSnapshot = (): BrunoTableActiveCell | undefined => this.activeCell;

  public readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public readonly reset = (): void => {
    this.bodyInitializationBlocked = false;
    this.setActive(undefined);
  };

  public readonly clearForQuery = (): void => {
    this.bodyInitializationBlocked = true;
    this.setActive(undefined);
  };

  public readonly activateForFocus = (): void => {
    if (this.activeCell !== undefined) return;
    const firstColumn = this.columns[0];
    if (firstColumn === undefined) return;
    this.bodyInitializationBlocked = false;
    if (this.rowSpace.totalRows === 0) {
      this.setActive({ region: "header", rowIndex: 0, columnId: firstColumn.columnId });
      return;
    }
    this.setActive({
      region: "body",
      rowIndex: 0,
      ...rowIdentity(this.rowSpace, 0),
      columnId: firstColumn.columnId,
    });
  };

  public readonly activateHeader = (columnId: string): void => {
    if (!this.columns.some((column) => column.columnId === columnId)) return;
    this.bodyInitializationBlocked = false;
    this.setActive({ region: "header", rowIndex: 0, columnId });
  };

  public readonly setShape = (
    rows: BrunoTableNavigationRowSpace | readonly (string | undefined)[],
    columns: readonly CompiledColumn[],
  ): void => {
    const rowSpace = isRowIdArray(rows) ? rowSpaceFromArray(rows) : rows;
    this.rowSpace = rowSpace;
    this.columns = orderBrunoTableLogicalColumns(columns);
    const firstColumn = this.columns[0];
    if (firstColumn === undefined) {
      this.setActive(undefined);
      return;
    }
    const previousColumnIndex = this.columns.findIndex(
      (column) => column.columnId === this.activeCell?.columnId,
    );
    const column = this.columns[previousColumnIndex >= 0 ? previousColumnIndex : 0]!;
    const matchingRowIndex =
      this.activeCell?.rowId === undefined
        ? undefined
        : rowSpace.findRowIndex(this.activeCell.rowId);
    const preferredRowIndex = Math.max(
      0,
      Math.min(rowSpace.totalRows - 1, matchingRowIndex ?? this.activeCell?.rowIndex ?? 0),
    );
    if (this.activeCell?.region === "header") {
      this.setActive({ region: "header", rowIndex: 0, columnId: column.columnId });
      return;
    }
    if (this.bodyInitializationBlocked) return;
    if (rowSpace.totalRows === 0) {
      if (this.activeCell?.region === "body") this.bodyInitializationBlocked = true;
      this.setActive(undefined);
      return;
    }
    this.setActive({
      region: "body",
      rowIndex: preferredRowIndex,
      ...rowIdentity(rowSpace, preferredRowIndex),
      columnId: column.columnId,
    });
  };

  public readonly move = (rowDelta: number, columnDelta: number): void => {
    if (this.activeCell === undefined || this.columns.length === 0) return;
    const currentColumn = Math.max(
      this.columns.findIndex((column) => column.columnId === this.activeCell?.columnId),
      0,
    );
    const nextColumn = Math.max(0, Math.min(this.columns.length - 1, currentColumn + columnDelta));
    if (this.activeCell.region === "header") {
      if (rowDelta > 0 && this.rowSpace.totalRows > 0) {
        this.setActive({
          region: "body",
          rowIndex: 0,
          ...rowIdentity(this.rowSpace, 0),
          columnId: this.columns[nextColumn]!.columnId,
        });
        return;
      }
      if (rowDelta === 0 && columnDelta !== 0) {
        this.setActive({
          region: "header",
          rowIndex: 0,
          columnId: this.columns[nextColumn]!.columnId,
        });
      }
      return;
    }
    if (this.rowSpace.totalRows === 0) {
      this.setActive(undefined);
      return;
    }
    const nextBodyRow = this.activeCell.rowIndex + rowDelta;
    if (rowDelta < 0 && nextBodyRow < 0) {
      this.setActive({
        region: "header",
        rowIndex: 0,
        columnId: this.columns[nextColumn]!.columnId,
      });
      return;
    }
    const rowIndex = Math.max(0, Math.min(this.rowSpace.totalRows - 1, nextBodyRow));
    this.setActive({
      region: "body",
      rowIndex,
      ...rowIdentity(this.rowSpace, rowIndex),
      columnId: this.columns[nextColumn]!.columnId,
    });
  };

  public readonly movePage = (rowDelta: number): void => {
    if (
      this.activeCell === undefined ||
      this.activeCell.region !== "body" ||
      this.rowSpace.totalRows === 0
    ) {
      return;
    }
    const target = Math.max(
      0,
      Math.min(this.rowSpace.totalRows - 1, this.activeCell.rowIndex + rowDelta),
    );
    this.setActive({
      region: "body",
      rowIndex: target,
      ...rowIdentity(this.rowSpace, target),
      columnId: this.activeCell.columnId,
    });
  };

  private readonly setActive = (next: BrunoTableActiveCell | undefined): void => {
    if (
      this.activeCell?.region === next?.region &&
      this.activeCell?.rowIndex === next?.rowIndex &&
      this.activeCell?.rowId === next?.rowId &&
      this.activeCell?.columnId === next?.columnId
    )
      return;
    this.activeCell = next === undefined ? undefined : Object.freeze(next);
    for (const listener of this.listeners) listener();
  };
}

function rowIdentity(rowSpace: BrunoTableNavigationRowSpace, index: number) {
  const rowId = rowSpace.getRowId(index);
  return rowId === undefined ? {} : { rowId };
}

function rowSpaceFromArray(rowIds: readonly (string | undefined)[]): BrunoTableNavigationRowSpace {
  return Object.freeze({
    totalRows: rowIds.length,
    getRowId: (index: number) => rowIds[index],
    findRowIndex: (rowId: string) => {
      const index = rowIds.indexOf(rowId);
      return index < 0 ? undefined : index;
    },
  });
}

function isRowIdArray(
  rows: BrunoTableNavigationRowSpace | readonly (string | undefined)[],
): rows is readonly (string | undefined)[] {
  return Array.isArray(rows);
}
