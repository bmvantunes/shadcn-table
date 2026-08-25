import type { CompiledColumn, CompiledFieldColumn } from "./compile-columns";

export type BrunoTableCellEditTraversalRowSpace = Readonly<{
  readonly totalRows: number;
  readonly getRowId: (rowIndex: number) => string | undefined;
}>;

export type BrunoTableCellEditTraversalDestination = Readonly<{
  readonly rowIndex: number;
  readonly rowId: string;
  readonly columnId: string;
}>;

type PredicateCellCache = Readonly<{
  readonly column: CompiledFieldColumn;
  readonly draftRevision: number;
  readonly eligible: boolean;
}>;

type RowCache = {
  row: object;
  readonly predicates: Map<string, PredicateCellCache>;
};

export class BrunoTableCellEditTraversalIndex {
  private columns: readonly CompiledColumn[] | undefined;
  private rowSpace: BrunoTableCellEditTraversalRowSpace | undefined;
  private rowIds: readonly (string | undefined)[] = [];
  private readonly rowIndexById = new Map<string, number>();
  private readonly columnIndexById = new Map<string, number>();
  private readonly rowCacheById = new Map<string, RowCache>();
  private readonly eligiblePredicateColumnsByRow = new Map<number, readonly number[]>();
  private staticColumnIndexes: readonly number[] = [];
  private predicateColumns: readonly Readonly<{
    readonly column: CompiledFieldColumn;
    readonly columnIndex: number;
  }>[] = [];
  private validRowIndexes: number[] = [];
  private eligiblePredicateRowIndexes: number[] = [];
  private readonly dirtyRowIds = new Set<string>();

  public constructor(
    private readonly getRow: (rowId: string) => unknown,
    private readonly getDraftRevision: (rowId: string, columnId: string) => number,
    private readonly evaluatePredicate: (
      rowId: string,
      row: object,
      column: CompiledFieldColumn,
    ) => boolean,
  ) {}

  public readonly reconcile = (
    columns: readonly CompiledColumn[],
    rowSpace: BrunoTableCellEditTraversalRowSpace,
  ): void => {
    const columnsChanged = this.columns !== columns;
    const projectionChanged = this.rowSpace !== rowSpace;
    if (!columnsChanged && !projectionChanged && this.dirtyRowIds.size === 0) return;
    this.columns = columns;
    this.rowSpace = rowSpace;
    if (columnsChanged) {
      this.rowCacheById.clear();
      this.columnIndexById.clear();
      for (const [columnIndex, column] of columns.entries()) {
        this.columnIndexById.set(column.columnId, columnIndex);
      }
      this.staticColumnIndexes = columns.flatMap((column, columnIndex) =>
        column.kind === "field" && column.isEditable === true ? [columnIndex] : [],
      );
      this.predicateColumns = columns.flatMap((column, columnIndex) =>
        column.kind === "field" && typeof column.isEditable === "function"
          ? [{ column, columnIndex }]
          : [],
      );
    }

    if (!columnsChanged && !projectionChanged) {
      this.reconcileRows(this.dirtyRowIds);
      this.dirtyRowIds.clear();
      return;
    }

    const rowIds = Array.from({ length: rowSpace.totalRows }, (_, rowIndex) =>
      rowSpace.getRowId(rowIndex),
    );
    this.rowIndexById.clear();
    const validRowIndexes: number[] = [];
    const eligiblePredicateRowIndexes: number[] = [];
    this.eligiblePredicateColumnsByRow.clear();
    for (const [rowIndex, rowId] of rowIds.entries()) {
      if (rowId === undefined) continue;
      this.rowIndexById.set(rowId, rowIndex);
      if (this.predicateColumns.length === 0) {
        validRowIndexes.push(rowIndex);
        continue;
      }
      let rowCache = this.rowCacheById.get(rowId);
      if (rowCache === undefined) {
        const row = this.getRow(rowId);
        if (typeof row !== "object" || row === null) continue;
        rowCache = { row, predicates: new Map() };
        this.rowCacheById.set(rowId, rowCache);
      }
      validRowIndexes.push(rowIndex);
      const eligibleColumnIndexes: number[] = [];
      for (const { column, columnIndex } of this.predicateColumns) {
        const draftRevision = this.getDraftRevision(rowId, column.columnId);
        const cached = rowCache.predicates.get(column.columnId);
        const eligible =
          cached?.column === column && cached.draftRevision === draftRevision
            ? cached.eligible
            : this.evaluatePredicate(rowId, rowCache.row, column);
        if (
          cached?.column !== column ||
          cached.draftRevision !== draftRevision ||
          cached.eligible !== eligible
        ) {
          rowCache.predicates.set(column.columnId, { column, draftRevision, eligible });
        }
        if (eligible) eligibleColumnIndexes.push(columnIndex);
      }
      if (eligibleColumnIndexes.length > 0) {
        this.eligiblePredicateColumnsByRow.set(rowIndex, eligibleColumnIndexes);
        eligiblePredicateRowIndexes.push(rowIndex);
      }
    }
    this.rowIds = rowIds;
    this.validRowIndexes = validRowIndexes;
    this.eligiblePredicateRowIndexes = eligiblePredicateRowIndexes;
    this.dirtyRowIds.clear();
  };

  public readonly reconcileRows = (changedRowIds: ReadonlySet<string> | undefined): void => {
    if (changedRowIds === undefined) {
      this.rowCacheById.clear();
      const columns = this.columns;
      const rowSpace = this.rowSpace;
      if (columns !== undefined && rowSpace !== undefined) {
        this.rowSpace = undefined;
        this.reconcile(columns, rowSpace);
      }
      return;
    }
    for (const rowId of changedRowIds) this.refreshRow(rowId);
  };

  public readonly invalidateCell = (rowId: string, _columnId: string): void => {
    this.dirtyRowIds.add(rowId);
  };

  public readonly find = (
    rowIndex: number,
    columnId: string,
    direction: -1 | 1,
  ): BrunoTableCellEditTraversalDestination | undefined => {
    const columns = this.columns;
    const rowSpace = this.rowSpace;
    if (columns === undefined || rowSpace === undefined) return undefined;
    if (this.dirtyRowIds.size > 0) this.reconcile(columns, rowSpace);
    const columnIndex = this.columnIndexById.get(columnId);
    if (columnIndex === undefined || this.rowIds[rowIndex] === undefined) return undefined;
    const staticCandidate = this.findStaticCandidate(rowIndex, columnIndex, direction);
    const predicateCandidate = this.findPredicateCandidate(rowIndex, columnIndex, direction);
    const destination = nearerCandidate(
      staticCandidate,
      predicateCandidate,
      columns.length,
      direction,
    );
    if (destination === undefined) return undefined;
    const rowId = this.rowIds[destination.rowIndex];
    const column = columns[destination.columnIndex];
    return rowId === undefined || column === undefined
      ? undefined
      : Object.freeze({ rowIndex: destination.rowIndex, rowId, columnId: column.columnId });
  };

  public readonly getCachedRowCount = (): number => this.rowCacheById.size;

  private readonly refreshRow = (rowId: string): void => {
    const rowIndex = this.rowIndexById.get(rowId);
    if (rowIndex === undefined) {
      this.rowCacheById.delete(rowId);
      return;
    }
    if (this.predicateColumns.length === 0) return;
    const row = this.getRow(rowId);
    if (typeof row !== "object" || row === null) {
      this.rowCacheById.delete(rowId);
      removeSorted(this.validRowIndexes, rowIndex);
      removeSorted(this.eligiblePredicateRowIndexes, rowIndex);
      this.eligiblePredicateColumnsByRow.delete(rowIndex);
      return;
    }
    let rowCache = this.rowCacheById.get(rowId);
    if (rowCache === undefined || rowCache.row !== row) {
      rowCache = { row, predicates: new Map() };
      this.rowCacheById.set(rowId, rowCache);
    }
    insertSorted(this.validRowIndexes, rowIndex);
    const eligibleColumnIndexes: number[] = [];
    for (const { column, columnIndex } of this.predicateColumns) {
      const draftRevision = this.getDraftRevision(rowId, column.columnId);
      const cached = rowCache.predicates.get(column.columnId);
      const eligible =
        cached?.column === column && cached.draftRevision === draftRevision
          ? cached.eligible
          : this.evaluatePredicate(rowId, row, column);
      rowCache.predicates.set(column.columnId, { column, draftRevision, eligible });
      if (eligible) eligibleColumnIndexes.push(columnIndex);
    }
    if (eligibleColumnIndexes.length === 0) {
      this.eligiblePredicateColumnsByRow.delete(rowIndex);
      removeSorted(this.eligiblePredicateRowIndexes, rowIndex);
      return;
    }
    this.eligiblePredicateColumnsByRow.set(rowIndex, eligibleColumnIndexes);
    insertSorted(this.eligiblePredicateRowIndexes, rowIndex);
  };

  private readonly findStaticCandidate = (
    rowIndex: number,
    columnIndex: number,
    direction: -1 | 1,
  ): TraversalCoordinate | undefined => {
    if (this.staticColumnIndexes.length === 0) return undefined;
    const sameRowColumn = adjacentValue(this.staticColumnIndexes, columnIndex, direction);
    if (sameRowColumn !== undefined && binaryIncludes(this.validRowIndexes, rowIndex)) {
      return { rowIndex, columnIndex: sameRowColumn };
    }
    const destinationRow = adjacentValue(this.validRowIndexes, rowIndex, direction);
    const destinationColumn =
      direction > 0 ? this.staticColumnIndexes[0] : this.staticColumnIndexes.at(-1);
    return destinationRow === undefined || destinationColumn === undefined
      ? undefined
      : { rowIndex: destinationRow, columnIndex: destinationColumn };
  };

  private readonly findPredicateCandidate = (
    rowIndex: number,
    columnIndex: number,
    direction: -1 | 1,
  ): TraversalCoordinate | undefined => {
    const sameRowColumn = adjacentValue(
      this.eligiblePredicateColumnsByRow.get(rowIndex) ?? [],
      columnIndex,
      direction,
    );
    if (sameRowColumn !== undefined) return { rowIndex, columnIndex: sameRowColumn };
    const destinationRow = adjacentValue(this.eligiblePredicateRowIndexes, rowIndex, direction);
    if (destinationRow === undefined) return undefined;
    const columns = this.eligiblePredicateColumnsByRow.get(destinationRow) ?? [];
    const destinationColumn = direction > 0 ? columns[0] : columns.at(-1);
    return destinationColumn === undefined
      ? undefined
      : { rowIndex: destinationRow, columnIndex: destinationColumn };
  };
}

type TraversalCoordinate = Readonly<{ readonly rowIndex: number; readonly columnIndex: number }>;

function nearerCandidate(
  left: TraversalCoordinate | undefined,
  right: TraversalCoordinate | undefined,
  columnCount: number,
  direction: -1 | 1,
): TraversalCoordinate | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  const leftOffset = left.rowIndex * columnCount + left.columnIndex;
  const rightOffset = right.rowIndex * columnCount + right.columnIndex;
  return direction > 0
    ? leftOffset <= rightOffset
      ? left
      : right
    : leftOffset >= rightOffset
      ? left
      : right;
}

function adjacentValue(
  values: readonly number[],
  current: number,
  direction: -1 | 1,
): number | undefined {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (
      (values[middle] ?? Number.POSITIVE_INFINITY) < current ||
      (direction > 0 && values[middle] === current)
    ) {
      low = middle + 1;
    } else high = middle;
  }
  return direction > 0 ? values[low] : values[low - 1];
}

function binaryIncludes(values: readonly number[], candidate: number): boolean {
  let low = 0;
  let high = values.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const value = values[middle];
    if (value === candidate) return true;
    if ((value ?? Number.POSITIVE_INFINITY) < candidate) low = middle + 1;
    else high = middle - 1;
  }
  return false;
}

function insertSorted(values: number[], candidate: number): void {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((values[middle] ?? Number.POSITIVE_INFINITY) < candidate) low = middle + 1;
    else high = middle;
  }
  if (values[low] !== candidate) values.splice(low, 0, candidate);
}

function removeSorted(values: number[], candidate: number): void {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((values[middle] ?? Number.POSITIVE_INFINITY) < candidate) low = middle + 1;
    else high = middle;
  }
  if (values[low] === candidate) values.splice(low, 1);
}
