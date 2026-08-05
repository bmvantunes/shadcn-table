export interface SparseWindow {
  readonly firstRow: number;
  readonly lastRow: number;
}

export interface SparseSlot<Row> {
  readonly index: number;
  readonly row?: Row;
  readonly rowKey?: string;
}

export interface SparseSnapshot<Row> {
  readonly generation: number;
  readonly identityFailures: number;
  readonly reusedRows: number;
  readonly rowWrites: number;
  readonly slots: ReadonlyArray<SparseSlot<Row>>;
  readonly totalRows: number;
  readonly window: SparseWindow;
  readonly windowMoves: number;
}

function shallowEqualRecord(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  if (keys.length !== Object.keys(rightRecord).length) return false;
  return keys.every((key) => Object.is(leftRecord[key], rightRecord[key]));
}

export class SparseViewportStore<Row> {
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): SparseSnapshot<Row> => this.snapshot;

  private readonly listeners = new Set<() => void>();
  private rows = new Map<number, Row>();
  private rowKeys = new Map<number, string>();
  private snapshot: SparseSnapshot<Row> = {
    generation: 0,
    identityFailures: 0,
    reusedRows: 0,
    rowWrites: 0,
    slots: [],
    totalRows: 0,
    window: { firstRow: 0, lastRow: 0 },
    windowMoves: 0,
  };

  beginGeneration(window: SparseWindow): number {
    const generation = this.snapshot.generation + 1;
    this.rows = new Map();
    this.rowKeys = new Map();
    this.publish({
      ...this.snapshot,
      generation,
      identityFailures: 0,
      reusedRows: 0,
      rowWrites: 0,
      totalRows: 0,
      window,
      windowMoves: 0,
    });
    return generation;
  }

  setWindow(generation: number, window: SparseWindow): void {
    if (generation !== this.snapshot.generation) return;
    if (
      window.firstRow === this.snapshot.window.firstRow &&
      window.lastRow === this.snapshot.window.lastRow
    ) {
      return;
    }

    this.rows = new Map(
      [...this.rows].filter(([index]) => index >= window.firstRow && index <= window.lastRow),
    );
    this.rowKeys = new Map(
      [...this.rowKeys].filter(([index]) => index >= window.firstRow && index <= window.lastRow),
    );
    this.publish({
      ...this.snapshot,
      window,
      windowMoves: this.snapshot.windowMoves + 1,
    });
  }

  setRowCount(generation: number, totalRows: number): void {
    if (generation !== this.snapshot.generation) return;
    if (totalRows === this.snapshot.totalRows) return;
    this.publish({ ...this.snapshot, totalRows });
  }

  setRowData<ExactRow extends Row>(
    generation: number,
    rowsByIndex: { readonly [index: number]: ExactRow },
    rowKeysByIndex: { readonly [index: number]: string },
  ): void {
    if (generation !== this.snapshot.generation) return;
    let identityFailures = this.snapshot.identityFailures;
    let reusedRows = this.snapshot.reusedRows;
    let rowWrites = this.snapshot.rowWrites;

    for (const [rawIndex, incoming] of Object.entries(rowsByIndex)) {
      const index = Number(rawIndex);
      const rowKey = rowKeysByIndex[index];
      if (rowKey === undefined) {
        identityFailures += 1;
        continue;
      }

      const existing = this.rows.get(index);
      const existingKey = this.rowKeys.get(index);
      if (existingKey === rowKey && shallowEqualRecord(existing, incoming)) {
        reusedRows += 1;
      } else {
        this.rows.set(index, incoming);
        this.rowKeys.set(index, rowKey);
        rowWrites += 1;
      }
    }

    this.publish({
      ...this.snapshot,
      identityFailures,
      reusedRows,
      rowWrites,
    });
  }

  private publish(next: SparseSnapshot<Row>): void {
    const slots: Array<SparseSlot<Row>> = [];
    const lastAvailableRow = Math.min(next.window.lastRow, next.totalRows - 1);
    for (let index = next.window.firstRow; index <= lastAvailableRow; index += 1) {
      const row = this.rows.get(index);
      const rowKey = this.rowKeys.get(index);
      slots.push({
        index,
        ...(row === undefined ? {} : { row }),
        ...(rowKey === undefined ? {} : { rowKey }),
      });
    }
    this.snapshot = { ...next, slots };
    for (const listener of this.listeners) listener();
  }
}
