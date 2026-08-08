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

export class BrunoTableNavigationRuntime {
  private readonly listeners = new Set<Listener>();
  private rowIds: readonly string[] = [];
  private columns: readonly CompiledColumn[] = [];
  private activeCell: BrunoTableActiveCell | undefined;

  public readonly getSnapshot = (): BrunoTableActiveCell | undefined => this.activeCell;

  public readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public readonly reset = (): void => this.setActive(undefined);

  public readonly setShape = (
    rowIds: readonly string[],
    columns: readonly CompiledColumn[],
  ): void => {
    this.rowIds = rowIds;
    this.columns = orderBrunoTableLogicalColumns(columns);
    const firstColumn = this.columns[0];
    if (rowIds.length === 0 || firstColumn === undefined) {
      this.setActive(undefined);
      return;
    }
    const previousColumnIndex = this.columns.findIndex(
      (column) => column.columnId === this.activeCell?.columnId,
    );
    const column = this.columns[previousColumnIndex >= 0 ? previousColumnIndex : 0]!;
    const matchingRowIndex =
      this.activeCell?.rowId === undefined ? -1 : rowIds.indexOf(this.activeCell.rowId);
    const rowIndex = Math.max(
      0,
      Math.min(
        rowIds.length - 1,
        matchingRowIndex >= 0 ? matchingRowIndex : (this.activeCell?.rowIndex ?? 0),
      ),
    );
    if (this.activeCell?.region === "header") {
      this.setActive({ region: "header", rowIndex: 0, columnId: column.columnId });
    } else {
      this.setActive({
        region: "body",
        rowIndex,
        rowId: rowIds[rowIndex]!,
        columnId: column.columnId,
      });
    }
  };

  public readonly move = (rowDelta: number, columnDelta: number): void => {
    if (this.activeCell === undefined || this.columns.length === 0 || this.rowIds.length === 0)
      return;
    const currentColumn = Math.max(
      this.columns.findIndex((column) => column.columnId === this.activeCell?.columnId),
      0,
    );
    const nextColumn = Math.max(0, Math.min(this.columns.length - 1, currentColumn + columnDelta));
    if (rowDelta < 0 && this.activeCell.region === "body" && this.activeCell.rowIndex === 0) {
      this.setActive({
        region: "header",
        rowIndex: 0,
        columnId: this.columns[nextColumn]!.columnId,
      });
      return;
    }
    if (rowDelta > 0 && this.activeCell.region === "header") {
      this.setActive({
        region: "body",
        rowIndex: 0,
        rowId: this.rowIds[0]!,
        columnId: this.columns[nextColumn]!.columnId,
      });
      return;
    }
    if (this.activeCell.region === "header") {
      if (rowDelta === 0 && columnDelta !== 0) {
        this.setActive({
          region: "header",
          rowIndex: 0,
          columnId: this.columns[nextColumn]!.columnId,
        });
      }
      return;
    }
    const rowIndex = Math.max(
      0,
      Math.min(this.rowIds.length - 1, this.activeCell.rowIndex + rowDelta),
    );
    this.setActive({
      region: "body",
      rowIndex,
      rowId: this.rowIds[rowIndex]!,
      columnId: this.columns[nextColumn]!.columnId,
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
