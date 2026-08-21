import type { BrunoTableRowSpaceSnapshot } from "./grid-runtime";

export type BrunoTableServerViewportWindow = Readonly<{
  readonly firstRow: number;
  readonly lastRow: number;
}>;

export type BrunoTableServerViewportStoreSnapshot<TRow> = Readonly<{
  readonly generation: number;
  readonly authoritativeTotalRows: boolean;
  readonly requiredWindow: BrunoTableServerViewportWindow;
  readonly rowSpace: BrunoTableRowSpaceSnapshot<TRow>;
}>;

type Listener = () => void;

const EMPTY_ROW_SPACE: BrunoTableRowSpaceSnapshot<never> = Object.freeze({
  totalRows: 0,
  loadedRows: 0,
  getRowId: () => undefined,
  getRow: () => undefined,
  getCellValue: () => undefined,
});

export class BrunoTableServerViewportStore<TRow> {
  private generation = 0;
  private authoritativeTotalRows = false;
  private requiredWindow: BrunoTableServerViewportWindow = Object.freeze({
    firstRow: 0,
    lastRow: 0,
  });
  private indexToRowId = new Map<number, string>();
  private rowIndexById = new Map<string, number>();
  private rowsById = new Map<string, TRow>();
  private readonly listeners = new Set<Listener>();
  private snapshot: BrunoTableServerViewportStoreSnapshot<TRow> = Object.freeze({
    generation: 0,
    authoritativeTotalRows: false,
    requiredWindow: this.requiredWindow,
    rowSpace: EMPTY_ROW_SPACE,
  });

  public constructor(
    private readonly readCell: (row: TRow, columnId: string) => unknown = () => undefined,
    private readonly rowsEquivalent: (previous: TRow, next: TRow) => boolean = rowsShallowlyEqual,
  ) {}

  public readonly getSnapshot = (): BrunoTableServerViewportStoreSnapshot<TRow> => this.snapshot;

  public readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public readonly findRowIndex = (rowId: string): number | undefined =>
    this.rowIndexById.get(rowId);

  public beginGeneration(window: BrunoTableServerViewportWindow): number {
    const requiredWindow = snapshotWindow(window);
    this.generation += 1;
    this.authoritativeTotalRows = false;
    this.requiredWindow = requiredWindow;
    this.indexToRowId = new Map();
    this.rowIndexById = new Map();
    this.rowsById = new Map();
    this.publish(Math.max(requiredWindow.lastRow + 1, 0));
    return this.generation;
  }

  public setRequiredRange(generation: number, window: BrunoTableServerViewportWindow): boolean {
    if (generation !== this.generation) return false;
    const requiredWindow = snapshotWindow(window);
    if (
      requiredWindow.firstRow === this.requiredWindow.firstRow &&
      requiredWindow.lastRow === this.requiredWindow.lastRow
    ) {
      return false;
    }
    this.requiredWindow = requiredWindow;
    if (this.indexToRowId.size > 0) {
      const indexToRowId = new Map<number, string>();
      const rowIndexById = new Map<string, number>();
      const rowsById = new Map<string, TRow>();
      for (const [index, rowId] of this.indexToRowId) {
        if (index < requiredWindow.firstRow || index > requiredWindow.lastRow) continue;
        const row = this.rowsById.get(rowId);
        if (row === undefined) continue;
        indexToRowId.set(index, rowId);
        rowIndexById.set(rowId, index);
        rowsById.set(rowId, row);
      }
      if (indexToRowId.size !== this.indexToRowId.size) {
        this.indexToRowId = indexToRowId;
        this.rowIndexById = rowIndexById;
        this.rowsById = rowsById;
        this.publish(this.snapshot.rowSpace.totalRows);
      }
    }
    return true;
  }

  public invalidateGeneration(generation: number): boolean {
    if (generation !== this.generation) return false;
    this.generation += 1;
    return true;
  }

  public setRowCount(generation: number, totalRows: number, keepRenderedRows?: boolean): boolean {
    if (generation !== this.generation || !isValidRowCount(totalRows)) return false;
    // effect-view-server uses this activation/deactivation callback as lifecycle chrome. It is not
    // authoritative query data and must not collapse provisional loading geometry or bridge rows.
    if (keepRenderedRows === false) return true;
    if (this.authoritativeTotalRows && totalRows === this.snapshot.rowSpace.totalRows) {
      return true;
    }
    this.authoritativeTotalRows = true;
    if (this.indexToRowId.size > 0) {
      const indexToRowId = new Map(this.indexToRowId);
      const rowIndexById = new Map(this.rowIndexById);
      const rowsById = new Map(this.rowsById);
      for (const [index, rowId] of indexToRowId) {
        if (index < totalRows) continue;
        indexToRowId.delete(index);
        if (rowIndexById.get(rowId) === index) {
          rowIndexById.delete(rowId);
          rowsById.delete(rowId);
        }
      }
      this.indexToRowId = indexToRowId;
      this.rowIndexById = rowIndexById;
      this.rowsById = rowsById;
    }
    this.publish(totalRows);
    return true;
  }

  public setRowData(
    generation: number,
    rowsByIndex: Readonly<Record<number, TRow>>,
    rowKeysByIndex: Readonly<Record<number, string>>,
  ): boolean {
    if (generation !== this.generation) return false;
    const rowEntries = Object.entries(rowsByIndex);
    const keyEntries = Object.entries(rowKeysByIndex);
    if (rowEntries.length !== keyEntries.length) return false;

    const admitted: Array<
      Readonly<{ readonly index: number; readonly row: TRow; readonly rowId: string }>
    > = [];
    const indexes = new Set<number>();
    const rowIds = new Set<string>();
    for (const [rawIndex, row] of rowEntries) {
      const index = parseAbsoluteIndex(rawIndex);
      if (index === undefined || indexes.has(index)) return false;
      if (this.authoritativeTotalRows && index >= this.snapshot.rowSpace.totalRows) return false;
      if (!Object.prototype.hasOwnProperty.call(rowKeysByIndex, rawIndex)) return false;
      const rowId = rowKeysByIndex[index];
      if (typeof rowId !== "string" || rowId.length === 0 || rowIds.has(rowId)) return false;
      indexes.add(index);
      rowIds.add(rowId);
      if (index >= this.requiredWindow.firstRow && index <= this.requiredWindow.lastRow) {
        admitted.push(Object.freeze({ index, row, rowId }));
      }
    }
    for (const [rawIndex] of keyEntries) {
      const index = parseAbsoluteIndex(rawIndex);
      if (index === undefined || !indexes.has(index)) return false;
    }
    if (admitted.length === 0) return true;

    const previousRowsById = this.rowsById;
    const indexToRowId = new Map(this.indexToRowId);
    const rowIndexById = new Map(this.rowIndexById);
    for (const entry of admitted) {
      const replacedRowId = indexToRowId.get(entry.index);
      if (replacedRowId !== undefined) rowIndexById.delete(replacedRowId);
      indexToRowId.delete(entry.index);
      const previousIndex = rowIndexById.get(entry.rowId);
      if (previousIndex !== undefined) indexToRowId.delete(previousIndex);
      rowIndexById.delete(entry.rowId);
    }
    for (const entry of admitted) {
      indexToRowId.set(entry.index, entry.rowId);
      rowIndexById.set(entry.rowId, entry.index);
    }
    const deliveredById = new Map(admitted.map((entry) => [entry.rowId, entry.row]));
    const rowsById = new Map<string, TRow>();
    for (const rowId of rowIndexById.keys()) {
      const delivered = deliveredById.get(rowId);
      const previous = previousRowsById.get(rowId);
      const row =
        delivered === undefined
          ? previous
          : previous !== undefined && this.rowsEquivalent(previous, delivered)
            ? previous
            : delivered;
      if (row !== undefined) rowsById.set(rowId, row);
    }
    this.indexToRowId = indexToRowId;
    this.rowIndexById = rowIndexById;
    this.rowsById = rowsById;
    const totalRows = this.authoritativeTotalRows
      ? this.snapshot.rowSpace.totalRows
      : Math.max(this.snapshot.rowSpace.totalRows, ...admitted.map((entry) => entry.index + 1));
    this.publish(totalRows);
    return true;
  }

  private publish(totalRows: number): void {
    const indexToRowId = this.indexToRowId;
    const rowsById = this.rowsById;
    const readCell = this.readCell;
    const rowSpace: BrunoTableRowSpaceSnapshot<TRow> = Object.freeze({
      totalRows,
      loadedRows: rowsById.size,
      getRowId: (index) => indexToRowId.get(index),
      getRow: (rowId) => rowsById.get(rowId),
      getCellValue: (rowId, columnId) => {
        const row = rowsById.get(rowId);
        return row === undefined ? undefined : readCell(row, columnId);
      },
    });
    this.snapshot = Object.freeze({
      generation: this.generation,
      authoritativeTotalRows: this.authoritativeTotalRows,
      requiredWindow: this.requiredWindow,
      rowSpace,
    });
    notify(this.listeners);
  }
}

function snapshotWindow(window: BrunoTableServerViewportWindow): BrunoTableServerViewportWindow {
  if (
    !Number.isSafeInteger(window.firstRow) ||
    !Number.isSafeInteger(window.lastRow) ||
    window.firstRow < 0 ||
    window.lastRow < window.firstRow
  ) {
    return Object.freeze({ firstRow: 0, lastRow: 0 });
  }
  return Object.freeze({ firstRow: window.firstRow, lastRow: window.lastRow });
}

function parseAbsoluteIndex(rawIndex: string): number | undefined {
  const index = Number(rawIndex);
  return Number.isSafeInteger(index) && index >= 0 && String(index) === rawIndex
    ? index
    : undefined;
}

function isValidRowCount(totalRows: number): boolean {
  return Number.isSafeInteger(totalRows) && totalRows >= 0;
}

function rowsShallowlyEqual<TRow>(previous: TRow, next: TRow): boolean {
  if (Object.is(previous, next)) return true;
  if (
    typeof previous !== "object" ||
    previous === null ||
    typeof next !== "object" ||
    next === null
  ) {
    return false;
  }
  const previousKeys = Reflect.ownKeys(previous);
  const nextKeys = Reflect.ownKeys(next);
  if (previousKeys.length !== nextKeys.length) return false;
  return previousKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(next, key) &&
      Object.is(Reflect.get(previous, key), Reflect.get(next, key)),
  );
}

function notify(listeners: ReadonlySet<Listener>): void {
  let firstError: unknown;
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError !== undefined) throw firstError;
}
