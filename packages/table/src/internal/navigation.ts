import type { CompiledColumn } from "./compile-columns";

export type BrunoTableActiveCell = Readonly<{
  readonly region: "header" | "body";
  readonly rowIndex: number;
  readonly rowId?: string;
  readonly columnId: string;
}>;

export type BrunoTableNavigationDirection = "up" | "down" | "left" | "right";

export type BrunoTableNavigationCommand =
  | Readonly<{
      readonly type: "step";
      readonly direction: BrunoTableNavigationDirection;
    }>
  | Readonly<{ readonly type: "page"; readonly rowDelta: number }>
  | Readonly<{ readonly type: "row-edge"; readonly edge: "start" | "end" }>
  | Readonly<{ readonly type: "column-edge"; readonly edge: "start" | "end" }>
  | Readonly<{ readonly type: "grid-edge"; readonly edge: "start" | "end" }>;

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
  private readonly columnListeners = new Map<string, Set<Listener>>();
  private rowSpace = EMPTY_ROW_SPACE;
  private columns: readonly CompiledColumn[] = [];
  private activeCell: BrunoTableActiveCell | undefined;
  private bodyInitializationBlocked = false;

  public readonly getSnapshot = (): BrunoTableActiveCell | undefined => this.activeCell;

  public readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public readonly getColumnSnapshot = (columnId: string): boolean =>
    this.activeCell?.region === "header" && this.activeCell.columnId === columnId;

  public readonly subscribeColumn = (columnId: string, listener: Listener): (() => void) => {
    const listeners = this.columnListeners.get(columnId) ?? new Set<Listener>();
    listeners.add(listener);
    this.columnListeners.set(columnId, listeners);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.columnListeners.get(columnId) !== listeners) return;
      listeners.delete(listener);
      if (listeners.size === 0) this.columnListeners.delete(columnId);
    };
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

  public readonly setLayout = (
    rows: BrunoTableNavigationRowSpace | readonly (string | undefined)[],
    columns: readonly CompiledColumn[],
  ): void => {
    const rowSpace = isRowIdArray(rows) ? rowSpaceFromArray(rows) : rows;
    const previousColumns = this.columns;
    const previousColumnIndex = previousColumns.findIndex(
      (column) => column.columnId === this.activeCell?.columnId,
    );
    this.rowSpace = rowSpace;
    this.columns = columns;
    const firstColumn = this.columns[0];
    if (firstColumn === undefined) {
      this.setActive(undefined);
      return;
    }
    const activeColumnIndex = this.columns.findIndex(
      (column) => column.columnId === this.activeCell?.columnId,
    );
    const fallbackColumnIndex =
      activeColumnIndex >= 0
        ? activeColumnIndex
        : previousColumnIndex >= 0
          ? Math.min(previousColumnIndex, this.columns.length - 1)
          : 0;
    const column = this.columns[fallbackColumnIndex]!;
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

  public readonly navigate = (command: BrunoTableNavigationCommand): boolean => {
    if (this.activeCell === undefined || this.columns.length === 0) return false;
    if (command.type === "step") {
      return this.resolveStep(command.direction);
    }
    if (command.type === "page") return this.resolvePage(command.rowDelta);
    if (command.type === "row-edge") return this.resolveRowEdge(command.edge);
    if (command.type === "column-edge") return this.resolveColumnEdge(command.edge);
    return this.resolveGridEdge(command.edge);
  };

  public readonly move = (direction: BrunoTableNavigationDirection): boolean =>
    this.navigate({ type: "step", direction });

  public readonly movePage = (rowDelta: number): boolean =>
    this.navigate({ type: "page", rowDelta });

  public readonly moveToRowEdge = (edge: "start" | "end"): boolean =>
    this.navigate({ type: "row-edge", edge });

  public readonly moveToColumnEdge = (edge: "start" | "end"): boolean =>
    this.navigate({ type: "column-edge", edge });

  public readonly moveToGridEdge = (edge: "start" | "end"): boolean =>
    this.navigate({ type: "grid-edge", edge });

  private readonly resolveStep = (direction: BrunoTableNavigationDirection): boolean => {
    if (this.activeCell === undefined || this.columns.length === 0) return false;
    const rowDelta = direction === "up" ? -1 : direction === "down" ? 1 : 0;
    const columnDelta = direction === "left" ? -1 : direction === "right" ? 1 : 0;
    const currentColumn = Math.max(
      this.columns.findIndex((column) => column.columnId === this.activeCell?.columnId),
      0,
    );
    const nextColumn = Math.max(0, Math.min(this.columns.length - 1, currentColumn + columnDelta));
    if (this.activeCell.region === "header") {
      if (rowDelta > 0 && this.rowSpace.totalRows > 0) {
        return this.setActive({
          region: "body",
          rowIndex: 0,
          ...rowIdentity(this.rowSpace, 0),
          columnId: this.columns[nextColumn]!.columnId,
        });
      }
      if (rowDelta === 0 && columnDelta !== 0) {
        return this.setActive({
          region: "header",
          rowIndex: 0,
          columnId: this.columns[nextColumn]!.columnId,
        });
      }
      return false;
    }
    if (this.rowSpace.totalRows === 0) {
      return this.setActive(undefined);
    }
    const nextBodyRow = this.activeCell.rowIndex + rowDelta;
    if (rowDelta < 0 && nextBodyRow < 0) {
      return this.setActive({
        region: "header",
        rowIndex: 0,
        columnId: this.columns[nextColumn]!.columnId,
      });
    }
    const rowIndex = Math.max(0, Math.min(this.rowSpace.totalRows - 1, nextBodyRow));
    return this.setActive({
      region: "body",
      rowIndex,
      ...rowIdentity(this.rowSpace, rowIndex),
      columnId: this.columns[nextColumn]!.columnId,
    });
  };

  private readonly resolvePage = (rowDelta: number): boolean => {
    if (this.activeCell === undefined || this.rowSpace.totalRows === 0) return false;
    const target =
      this.activeCell.region === "header"
        ? Math.max(0, Math.min(this.rowSpace.totalRows - 1, rowDelta > 0 ? rowDelta - 1 : 0))
        : Math.max(0, Math.min(this.rowSpace.totalRows - 1, this.activeCell.rowIndex + rowDelta));
    return this.setActive({
      region: "body",
      rowIndex: target,
      ...rowIdentity(this.rowSpace, target),
      columnId: this.activeCell.columnId,
    });
  };

  private readonly resolveRowEdge = (edge: "start" | "end"): boolean => {
    if (this.activeCell === undefined || this.columns.length === 0) return false;
    return this.setActive({
      ...this.activeCell,
      columnId: this.columns[edge === "start" ? 0 : this.columns.length - 1]!.columnId,
    });
  };

  private readonly resolveColumnEdge = (edge: "start" | "end"): boolean => {
    if (this.activeCell === undefined || this.columns.length === 0) return false;
    if (edge === "start" || this.rowSpace.totalRows === 0) {
      return this.setActive({
        region: "header",
        rowIndex: 0,
        columnId: this.activeCell.columnId,
      });
    }
    const rowIndex = this.rowSpace.totalRows - 1;
    return this.setActive({
      region: "body",
      rowIndex,
      ...rowIdentity(this.rowSpace, rowIndex),
      columnId: this.activeCell.columnId,
    });
  };

  private readonly resolveGridEdge = (edge: "start" | "end"): boolean => {
    if (this.columns.length === 0) return false;
    if (edge === "start" || this.rowSpace.totalRows === 0) {
      return this.setActive({
        region: "header",
        rowIndex: 0,
        columnId: this.columns[edge === "start" ? 0 : this.columns.length - 1]!.columnId,
      });
    }
    const rowIndex = this.rowSpace.totalRows - 1;
    return this.setActive({
      region: "body",
      rowIndex,
      ...rowIdentity(this.rowSpace, rowIndex),
      columnId: this.columns[this.columns.length - 1]!.columnId,
    });
  };

  private readonly setActive = (next: BrunoTableActiveCell | undefined): boolean => {
    if (
      this.activeCell?.region === next?.region &&
      this.activeCell?.rowIndex === next?.rowIndex &&
      this.activeCell?.rowId === next?.rowId &&
      this.activeCell?.columnId === next?.columnId
    ) {
      return false;
    }
    const previousHeaderColumnId =
      this.activeCell?.region === "header" ? this.activeCell.columnId : undefined;
    const nextHeaderColumnId = next?.region === "header" ? next.columnId : undefined;
    this.activeCell = next === undefined ? undefined : Object.freeze(next);
    for (const listener of this.listeners) listener();
    const changedColumnIds = new Set(
      [previousHeaderColumnId, nextHeaderColumnId].filter(
        (columnId): columnId is string => columnId !== undefined,
      ),
    );
    for (const columnId of changedColumnIds) {
      const listeners = this.columnListeners.get(columnId);
      if (listeners !== undefined) {
        for (const listener of listeners) listener();
      }
    }
    return true;
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
