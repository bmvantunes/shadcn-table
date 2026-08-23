export type BrunoTableCellRangeAxis = "horizontal" | "vertical";

export type BrunoTableCellCoordinate = Readonly<{
  readonly rowId: string;
  readonly columnId: string;
}>;

export type BrunoTableCellRangeStructure = Readonly<{
  readonly rowIds: readonly string[];
  readonly columnIds: readonly string[];
  readonly rowIndexById: ReadonlyMap<string, number>;
  readonly columnIndexById: ReadonlyMap<string, number>;
}>;

type BrunoTableHorizontalCellRange = Readonly<{
  readonly axis: "horizontal";
  readonly rowId: string;
  readonly rowIds: readonly [string];
  readonly columnIds: readonly [string, string, ...string[]];
  readonly anchor: BrunoTableCellCoordinate;
  readonly focus: BrunoTableCellCoordinate;
}>;

type BrunoTableVerticalCellRange = Readonly<{
  readonly axis: "vertical";
  readonly columnId: string;
  readonly rowIds: readonly [string, string, ...string[]];
  readonly columnIds: readonly [string];
  readonly anchor: BrunoTableCellCoordinate;
  readonly focus: BrunoTableCellCoordinate;
}>;

export type BrunoTableCellRange = BrunoTableHorizontalCellRange | BrunoTableVerticalCellRange;

export type BrunoTableCellRangeSnapshot = Readonly<{
  readonly anchor?: BrunoTableCellCoordinate;
  readonly range?: BrunoTableCellRange;
}>;

type BrunoTableNonEmptyIdentitySpan = readonly [string, ...string[]];

export type BrunoTableClipboardTarget =
  | Readonly<{
      readonly axis: "horizontal";
      readonly rowIds: readonly [string];
      readonly columnIds: BrunoTableNonEmptyIdentitySpan;
    }>
  | Readonly<{
      readonly axis: "vertical";
      readonly rowIds: BrunoTableNonEmptyIdentitySpan;
      readonly columnIds: readonly [string];
    }>;

type BrunoTableClipboardCellEvidence = Readonly<{
  readonly rowId: string;
  readonly columnId: string;
  readonly value: unknown;
  readonly formatCanonicalText: (value: unknown) => string;
}>;

export type BrunoTableClipboardSnapshot =
  | Readonly<{
      readonly axis: "horizontal";
      readonly rowIds: readonly [string];
      readonly columnIds: BrunoTableNonEmptyIdentitySpan;
      readonly canonicalTexts: readonly [string, ...string[]];
    }>
  | Readonly<{
      readonly axis: "vertical";
      readonly rowIds: BrunoTableNonEmptyIdentitySpan;
      readonly columnIds: readonly [string];
      readonly canonicalTexts: readonly [string, ...string[]];
    }>;

export type BrunoTableCellRangeHit = BrunoTableCellCoordinate &
  Readonly<{ readonly rowIndex: number }>;

type BrunoTableCellRangePointerGesture = {
  readonly pointerId: number;
  readonly grid: HTMLElement;
  readonly view: Window;
  readonly startX: number;
  readonly startY: number;
  readonly before: BrunoTableCellRangeSnapshot;
  readonly activate: (hit: BrunoTableCellRangeHit) => void;
  readonly restoreActive: () => void;
  readonly scrollHorizontalByPhysical: (delta: number) => boolean;
  axis: BrunoTableCellRangeAxis | undefined;
  clientX: number;
  clientY: number;
  target: EventTarget | null;
  frame: number | null;
};

export type BrunoTableCellRangeInstrumentationEvent =
  | Readonly<{ readonly kind: "publication"; readonly tableId: string }>
  | Readonly<{ readonly kind: "pointer-frame"; readonly tableId: string }>
  | Readonly<{
      readonly kind: "mounted-decoration";
      readonly tableId: string;
      readonly mountedCellCount: number;
    }>;

type BrunoTableCellRangeInstrumentationListener = (
  event: BrunoTableCellRangeInstrumentationEvent,
) => void;

const instrumentationListenersByTable = new Map<
  string,
  Set<BrunoTableCellRangeInstrumentationListener>
>();

export function installBrunoTableCellRangeInstrumentationListener(
  tableId: string,
  listener: BrunoTableCellRangeInstrumentationListener,
): () => void {
  const listeners =
    instrumentationListenersByTable.get(tableId) ??
    new Set<BrunoTableCellRangeInstrumentationListener>();
  listeners.add(listener);
  instrumentationListenersByTable.set(tableId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) instrumentationListenersByTable.delete(tableId);
  };
}

const BRUNO_TABLE_CELL_RANGE_DRAG_SLOP = 4;
const BRUNO_TABLE_CELL_RANGE_AUTOSCROLL_ZONE = 24;
const BRUNO_TABLE_CELL_RANGE_AUTOSCROLL_STEP = 12;

const EMPTY_RANGE_SNAPSHOT: BrunoTableCellRangeSnapshot = Object.freeze({});

export function createBrunoTableCellRangeStructure(
  rowIds: readonly string[],
  columnIds: readonly string[],
): BrunoTableCellRangeStructure {
  return Object.freeze({
    rowIds: Object.freeze(Array.from(rowIds)),
    columnIds: Object.freeze(Array.from(columnIds)),
    rowIndexById: indexIdentities(rowIds),
    columnIndexById: indexIdentities(columnIds),
  });
}

export class BrunoTableCellRangeRuntime {
  private readonly listeners = new Set<() => void>();
  private structure: BrunoTableCellRangeStructure | undefined;
  private snapshot = EMPTY_RANGE_SNAPSHOT;
  private grid: HTMLElement | null = null;
  private observer: MutationObserver | undefined;
  private decorationFrame: number | null = null;
  private pointerGesture: BrunoTableCellRangePointerGesture | undefined;
  private structuralInvalidationPendingCopy = false;

  public constructor(private readonly tableId = "TABLE_ID_UNBOUND_CELL_RANGE") {}

  public readonly getSnapshot = (): BrunoTableCellRangeSnapshot => this.snapshot;

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public readonly getStructure = (): BrunoTableCellRangeStructure | undefined => this.structure;

  public readonly attachGrid = (grid: HTMLElement | null): void => {
    if (this.grid === grid) return;
    this.observer?.disconnect();
    this.observer = undefined;
    this.grid = grid;
    if (grid === null) return;
    this.observer = new MutationObserver(() => this.scheduleDecoration());
    this.observer.observe(grid, { childList: true, subtree: true });
    this.scheduleDecoration();
  };

  public readonly dispose = (): void => {
    this.cancelPointerGesture();
    this.observer?.disconnect();
    this.observer = undefined;
    this.grid = null;
    if (this.decorationFrame !== null) cancelAnimationFrame(this.decorationFrame);
    this.decorationFrame = null;
    this.listeners.clear();
  };

  public readonly isPointerGestureActive = (): boolean => this.pointerGesture !== undefined;

  public readonly startPointerGesture = (
    event: PointerEvent,
    hit: BrunoTableCellRangeHit,
    grid: HTMLElement,
    activate: (hit: BrunoTableCellRangeHit) => void,
    restoreActive: () => void,
    scrollHorizontalByPhysical: (delta: number) => boolean,
  ): boolean => {
    const structure = this.structure;
    if (
      structure === undefined ||
      event.button !== 0 ||
      this.pointerGesture !== undefined ||
      !containsCoordinate(structure, hit)
    ) {
      return false;
    }
    event.preventDefault();
    const before = this.snapshot;
    if (event.shiftKey && this.snapshot.anchor !== undefined) this.extend(hit, structure);
    else this.replace(hit, structure);
    activate(hit);
    grid.focus({ preventScroll: true });
    try {
      grid.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic browser events may not have a native active pointer.
    }
    const view = grid.ownerDocument.defaultView;
    if (view === null) return true;
    this.pointerGesture = {
      pointerId: event.pointerId,
      grid,
      view,
      startX: event.clientX,
      startY: event.clientY,
      before,
      activate,
      restoreActive,
      scrollHorizontalByPhysical,
      axis: this.snapshot.range?.axis,
      clientX: event.clientX,
      clientY: event.clientY,
      target: event.target,
      frame: null,
    };
    view.addEventListener("pointermove", this.onPointerMove, true);
    view.addEventListener("pointerup", this.onPointerUp, true);
    view.addEventListener("pointercancel", this.onPointerCancel, true);
    return true;
  };

  public readonly cancelPointerGesture = (): boolean => {
    const gesture = this.pointerGesture;
    if (gesture === undefined) return false;
    this.detachPointerGesture(gesture);
    this.publish(gesture.before);
    gesture.restoreActive();
    return true;
  };

  public readonly restore = (snapshot: BrunoTableCellRangeSnapshot): BrunoTableCellRangeSnapshot =>
    this.publish(snapshot);

  public readonly replace = (
    coordinate: BrunoTableCellCoordinate,
    structure: BrunoTableCellRangeStructure,
  ): BrunoTableCellRangeSnapshot => {
    this.structuralInvalidationPendingCopy = false;
    this.structure = structure;
    if (!containsCoordinate(structure, coordinate)) return this.publish(EMPTY_RANGE_SNAPSHOT);
    return this.publish(Object.freeze({ anchor: freezeCoordinate(coordinate) }));
  };

  public readonly extend = (
    target: BrunoTableCellCoordinate,
    structure: BrunoTableCellRangeStructure,
    axisHint?: BrunoTableCellRangeAxis,
  ): BrunoTableCellRangeSnapshot => {
    this.reconcile(structure);
    const anchor = this.snapshot.anchor;
    if (anchor === undefined || !containsCoordinate(structure, target)) return this.snapshot;
    const axis = axisHint ?? this.snapshot.range?.axis ?? chooseAxis(anchor, target, structure);
    if (axis === undefined) return this.publish(Object.freeze({ anchor }));
    const range = createRange(axis, anchor, target, structure);
    return this.publish(
      range === undefined ? Object.freeze({ anchor }) : Object.freeze({ anchor, range }),
    );
  };

  public readonly reconcile = (
    structure: BrunoTableCellRangeStructure,
  ): BrunoTableCellRangeSnapshot => {
    if (this.structure === structure) return this.snapshot;
    this.cancelPointerGesture();
    this.structure = structure;
    const anchor = this.snapshot.anchor;
    if (anchor === undefined || !containsCoordinate(structure, anchor)) {
      if (anchor !== undefined) this.structuralInvalidationPendingCopy = true;
      return this.publish(EMPTY_RANGE_SNAPSHOT);
    }
    const range = this.snapshot.range;
    if (range === undefined) return this.snapshot;
    if (!rangeMatchesStructure(range, structure)) {
      this.structuralInvalidationPendingCopy = true;
      return this.publish(EMPTY_RANGE_SNAPSHOT);
    }
    return this.snapshot;
  };

  public readonly clear = (): BrunoTableCellRangeSnapshot => {
    this.cancelPointerGesture();
    this.structuralInvalidationPendingCopy = false;
    return this.publish(EMPTY_RANGE_SNAPSHOT);
  };

  public readonly consumeStructuralInvalidation = (): boolean => {
    const invalidated = this.structuralInvalidationPendingCopy;
    this.structuralInvalidationPendingCopy = false;
    return invalidated;
  };

  public readonly isCellSelected = (rowId: string, columnId: string): boolean => {
    const range = this.snapshot.range;
    const structure = this.structure;
    if (range === undefined || structure === undefined) {
      return this.snapshot.anchor?.rowId === rowId && this.snapshot.anchor.columnId === columnId;
    }
    if (range.axis === "horizontal") {
      if (range.rowId !== rowId) return false;
      return identityFallsWithin(
        structure.columnIndexById,
        columnId,
        range.columnIds[0],
        range.columnIds.at(-1),
      );
    }
    if (range.columnId !== columnId) return false;
    return identityFallsWithin(structure.rowIndexById, rowId, range.rowIds[0], range.rowIds.at(-1));
  };

  private readonly publish = (
    snapshot: BrunoTableCellRangeSnapshot,
  ): BrunoTableCellRangeSnapshot => {
    if (this.snapshot === snapshot) return snapshot;
    if (sameSnapshot(this.snapshot, snapshot)) return this.snapshot;
    this.snapshot = snapshot;
    recordInstrumentation({ kind: "publication", tableId: this.tableId });
    for (const listener of this.listeners) listener();
    this.scheduleDecoration();
    return snapshot;
  };

  private readonly scheduleDecoration = (): void => {
    if (this.grid === null || this.decorationFrame !== null) return;
    this.decorationFrame = requestAnimationFrame(() => {
      this.decorationFrame = null;
      this.decorateMountedCells();
    });
  };

  private readonly decorateMountedCells = (): void => {
    const grid = this.grid;
    if (grid === null) return;
    const mountedCells = grid.querySelectorAll<HTMLElement>(
      '[role="gridcell"][data-bruno-row-id][data-bruno-column-id]',
    );
    for (const cell of mountedCells) {
      const rowId = cell.dataset["brunoRowId"];
      const columnId = cell.dataset["brunoColumnId"];
      const selected =
        rowId !== undefined && columnId !== undefined && this.isCellSelected(rowId, columnId);
      if (selected) {
        cell.setAttribute("aria-selected", "true");
        cell.setAttribute("data-bruno-cell-range-selected", "");
        cell.style.boxShadow = "inset 0 0 0 2px Highlight";
      } else {
        cell.removeAttribute("aria-selected");
        cell.removeAttribute("data-bruno-cell-range-selected");
        cell.style.removeProperty("box-shadow");
      }
    }
    recordInstrumentation({
      kind: "mounted-decoration",
      tableId: this.tableId,
      mountedCellCount: mountedCells.length,
    });
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const gesture = this.pointerGesture;
    if (gesture === undefined || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    gesture.clientX = event.clientX;
    gesture.clientY = event.clientY;
    gesture.target = event.target;
    this.schedulePointerFrame(gesture);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const gesture = this.pointerGesture;
    if (gesture === undefined || event.pointerId !== gesture.pointerId) return;
    gesture.clientX = event.clientX;
    gesture.clientY = event.clientY;
    gesture.target = event.target;
    this.applyPointerFrame(gesture);
    this.detachPointerGesture(gesture);
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerGesture?.pointerId) return;
    this.cancelPointerGesture();
  };

  private readonly schedulePointerFrame = (gesture: BrunoTableCellRangePointerGesture): void => {
    if (gesture.frame !== null) return;
    gesture.frame = gesture.view.requestAnimationFrame(() => {
      gesture.frame = null;
      if (this.pointerGesture !== gesture) return;
      const autoscrolled = this.applyPointerFrame(gesture);
      if (autoscrolled) this.schedulePointerFrame(gesture);
    });
  };

  private readonly applyPointerFrame = (gesture: BrunoTableCellRangePointerGesture): boolean => {
    recordInstrumentation({ kind: "pointer-frame", tableId: this.tableId });
    const structure = this.structure;
    if (structure === undefined) return false;
    if (gesture.axis === undefined) {
      const horizontal = Math.abs(gesture.clientX - gesture.startX);
      const vertical = Math.abs(gesture.clientY - gesture.startY);
      if (
        Math.max(horizontal, vertical) <= BRUNO_TABLE_CELL_RANGE_DRAG_SLOP ||
        horizontal === vertical
      ) {
        return false;
      }
      gesture.axis = horizontal > vertical ? "horizontal" : "vertical";
    }
    const hit = resolvePointerHit(gesture);
    if (hit !== undefined) {
      const next = this.extend(hit, structure, gesture.axis);
      const focus = next.range?.focus ?? next.anchor;
      if (focus !== undefined) {
        const rowIndex = structure.rowIndexById.get(focus.rowId);
        if (rowIndex !== undefined) gesture.activate({ ...focus, rowIndex });
      }
    }
    const bounds = gesture.grid.getBoundingClientRect();
    if (gesture.axis === "horizontal") {
      const delta =
        gesture.clientX < bounds.left + BRUNO_TABLE_CELL_RANGE_AUTOSCROLL_ZONE
          ? -BRUNO_TABLE_CELL_RANGE_AUTOSCROLL_STEP
          : gesture.clientX > bounds.right - BRUNO_TABLE_CELL_RANGE_AUTOSCROLL_ZONE
            ? BRUNO_TABLE_CELL_RANGE_AUTOSCROLL_STEP
            : 0;
      if (delta === 0) return false;
      return gesture.scrollHorizontalByPhysical(delta);
    }
    const delta =
      gesture.clientY < bounds.top + BRUNO_TABLE_CELL_RANGE_AUTOSCROLL_ZONE
        ? -BRUNO_TABLE_CELL_RANGE_AUTOSCROLL_STEP
        : gesture.clientY > bounds.bottom - BRUNO_TABLE_CELL_RANGE_AUTOSCROLL_ZONE
          ? BRUNO_TABLE_CELL_RANGE_AUTOSCROLL_STEP
          : 0;
    if (delta === 0) return false;
    gesture.grid.scrollTop += delta;
    return true;
  };

  private readonly detachPointerGesture = (gesture: BrunoTableCellRangePointerGesture): void => {
    if (gesture.frame !== null) gesture.view.cancelAnimationFrame(gesture.frame);
    gesture.view.removeEventListener("pointermove", this.onPointerMove, true);
    gesture.view.removeEventListener("pointerup", this.onPointerUp, true);
    gesture.view.removeEventListener("pointercancel", this.onPointerCancel, true);
    try {
      if (gesture.grid.hasPointerCapture(gesture.pointerId)) {
        gesture.grid.releasePointerCapture(gesture.pointerId);
      }
    } catch {
      // Synthetic browser events may not have a native active pointer.
    }
    this.pointerGesture = undefined;
  };
}

function recordInstrumentation(event: BrunoTableCellRangeInstrumentationEvent): void {
  const listeners = instrumentationListenersByTable.get(event.tableId);
  if (listeners === undefined) return;
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Diagnostics must never alter the interaction they observe.
    }
  }
}

export function captureBrunoTableClipboardSnapshot(
  target: BrunoTableClipboardTarget,
  read: (cell: BrunoTableCellCoordinate) =>
    | Readonly<{
        readonly value: unknown;
        readonly formatCanonicalText: (value: unknown) => string;
      }>
    | undefined,
): BrunoTableClipboardSnapshot | undefined {
  const coordinates =
    target.axis === "horizontal"
      ? target.columnIds.map((columnId) => ({ rowId: target.rowIds[0], columnId }))
      : target.rowIds.map((rowId) => ({ rowId, columnId: target.columnIds[0] }));
  const evidence: BrunoTableClipboardCellEvidence[] = [];
  for (const cell of coordinates) {
    const cellEvidence = read(cell);
    if (cellEvidence === undefined) return undefined;
    evidence.push(
      Object.freeze({
        rowId: cell.rowId,
        columnId: cell.columnId,
        value: cellEvidence.value,
        formatCanonicalText: cellEvidence.formatCanonicalText,
      }),
    );
  }
  const canonicalTexts = evidence.map((cell) =>
    cell.value === null || cell.value === undefined ? "" : cell.formatCanonicalText(cell.value),
  );
  if (!hasNonEmptyIdentitySpan(canonicalTexts)) return undefined;
  return target.axis === "horizontal"
    ? Object.freeze({
        axis: target.axis,
        rowIds: target.rowIds,
        columnIds: target.columnIds,
        canonicalTexts: Object.freeze(canonicalTexts),
      })
    : Object.freeze({
        axis: target.axis,
        rowIds: target.rowIds,
        columnIds: target.columnIds,
        canonicalTexts: Object.freeze(canonicalTexts),
      });
}

export function serializeBrunoTableClipboardSnapshot(
  snapshot: BrunoTableClipboardSnapshot,
): string {
  const separator = snapshot.axis === "horizontal" ? "\t" : "\n";
  return snapshot.canonicalTexts.map(escapeTsvCell).join(separator);
}

export function clipboardTargetFromRange(range: BrunoTableCellRange): BrunoTableClipboardTarget {
  return range.axis === "horizontal"
    ? Object.freeze({ axis: range.axis, rowIds: range.rowIds, columnIds: range.columnIds })
    : Object.freeze({ axis: range.axis, rowIds: range.rowIds, columnIds: range.columnIds });
}

export function clipboardTargetFromSelection(
  snapshot: BrunoTableCellRangeSnapshot,
  activeCell: BrunoTableCellCoordinate | undefined,
): BrunoTableClipboardTarget | undefined {
  if (snapshot.range !== undefined) return clipboardTargetFromRange(snapshot.range);
  const cell = activeCell ?? snapshot.anchor;
  if (cell === undefined) return undefined;
  const rowIds: readonly [string] = Object.freeze([cell.rowId]);
  const columnIds: BrunoTableNonEmptyIdentitySpan = Object.freeze([cell.columnId]);
  return Object.freeze({ axis: "horizontal", rowIds, columnIds });
}

function freezeCoordinate(coordinate: BrunoTableCellCoordinate): BrunoTableCellCoordinate {
  return Object.freeze({ rowId: coordinate.rowId, columnId: coordinate.columnId });
}

function containsCoordinate(
  structure: BrunoTableCellRangeStructure,
  coordinate: BrunoTableCellCoordinate,
): boolean {
  return (
    structure.rowIndexById.has(coordinate.rowId) &&
    structure.columnIndexById.has(coordinate.columnId)
  );
}

function chooseAxis(
  anchor: BrunoTableCellCoordinate,
  target: BrunoTableCellCoordinate,
  structure: BrunoTableCellRangeStructure,
): BrunoTableCellRangeAxis | undefined {
  const anchorRow = structure.rowIndexById.get(anchor.rowId);
  const targetRow = structure.rowIndexById.get(target.rowId);
  const anchorColumn = structure.columnIndexById.get(anchor.columnId);
  const targetColumn = structure.columnIndexById.get(target.columnId);
  if (
    anchorRow === undefined ||
    targetRow === undefined ||
    anchorColumn === undefined ||
    targetColumn === undefined
  ) {
    return undefined;
  }
  const rowDistance = Math.abs(targetRow - anchorRow);
  const columnDistance = Math.abs(targetColumn - anchorColumn);
  if (rowDistance === 0 && columnDistance === 0) return undefined;
  if (rowDistance === columnDistance) return undefined;
  return columnDistance > rowDistance ? "horizontal" : "vertical";
}

function createRange(
  axis: BrunoTableCellRangeAxis,
  anchor: BrunoTableCellCoordinate,
  target: BrunoTableCellCoordinate,
  structure: BrunoTableCellRangeStructure,
): BrunoTableCellRange | undefined {
  if (axis === "horizontal") {
    const columnIds = identitySpan(
      structure.columnIds,
      structure.columnIndexById,
      anchor.columnId,
      target.columnId,
    );
    if (!hasIdentitySpan(columnIds)) return undefined;
    const rowIds: readonly [string] = Object.freeze([anchor.rowId]);
    return Object.freeze({
      axis,
      rowId: anchor.rowId,
      rowIds,
      columnIds: Object.freeze(columnIds),
      anchor,
      focus: Object.freeze({ rowId: anchor.rowId, columnId: target.columnId }),
    });
  }
  const rowIds = identitySpan(structure.rowIds, structure.rowIndexById, anchor.rowId, target.rowId);
  if (!hasIdentitySpan(rowIds)) return undefined;
  const columnIds: readonly [string] = Object.freeze([anchor.columnId]);
  return Object.freeze({
    axis,
    columnId: anchor.columnId,
    rowIds: Object.freeze(rowIds),
    columnIds,
    anchor,
    focus: Object.freeze({ rowId: target.rowId, columnId: anchor.columnId }),
  });
}

function identitySpan(
  identities: readonly string[],
  indexById: ReadonlyMap<string, number>,
  firstIdentity: string,
  secondIdentity: string,
): readonly string[] {
  const first = indexById.get(firstIdentity);
  const second = indexById.get(secondIdentity);
  if (first === undefined || second === undefined || first === second) return [];
  const start = Math.min(first, second);
  const end = Math.max(first, second);
  const span = identities.slice(start, end + 1);
  const firstValue = span[0];
  const secondValue = span[1];
  if (firstValue === undefined || secondValue === undefined) return [];
  return [firstValue, secondValue, ...span.slice(2)];
}

function hasIdentitySpan(
  identities: readonly string[],
): identities is readonly [string, string, ...string[]] {
  return identities.length >= 2;
}

function hasNonEmptyIdentitySpan(
  identities: readonly string[],
): identities is BrunoTableNonEmptyIdentitySpan {
  return identities.length >= 1;
}

function rangeMatchesStructure(
  range: BrunoTableCellRange,
  structure: BrunoTableCellRangeStructure,
): boolean {
  if (range.axis === "horizontal") {
    if (!structure.rowIndexById.has(range.rowId)) return false;
    const lastColumnId = range.columnIds.at(-1);
    if (lastColumnId === undefined) return false;
    return sameIdentities(
      identitySpan(
        structure.columnIds,
        structure.columnIndexById,
        range.columnIds[0],
        lastColumnId,
      ),
      range.columnIds,
    );
  }
  if (!structure.columnIndexById.has(range.columnId)) return false;
  const lastRowId = range.rowIds.at(-1);
  if (lastRowId === undefined) return false;
  return sameIdentities(
    identitySpan(structure.rowIds, structure.rowIndexById, range.rowIds[0], lastRowId),
    range.rowIds,
  );
}

function indexIdentities(identities: readonly string[]): ReadonlyMap<string, number> {
  return new Map(identities.map((identity, index) => [identity, index]));
}

function identityFallsWithin(
  indexById: ReadonlyMap<string, number>,
  candidateIdentity: string,
  firstIdentity: string,
  lastIdentity: string | undefined,
): boolean {
  if (lastIdentity === undefined) return false;
  const candidate = indexById.get(candidateIdentity);
  const first = indexById.get(firstIdentity);
  const last = indexById.get(lastIdentity);
  return (
    candidate !== undefined &&
    first !== undefined &&
    last !== undefined &&
    candidate >= Math.min(first, last) &&
    candidate <= Math.max(first, last)
  );
}

function sameIdentities(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((identity, index) => identity === right[index]);
}

function sameSnapshot(
  left: BrunoTableCellRangeSnapshot,
  right: BrunoTableCellRangeSnapshot,
): boolean {
  if (
    left.anchor?.rowId !== right.anchor?.rowId ||
    left.anchor?.columnId !== right.anchor?.columnId ||
    left.range?.axis !== right.range?.axis
  ) {
    return false;
  }
  if (left.range === undefined || right.range === undefined) {
    return left.range === right.range;
  }
  return (
    left.range.focus.rowId === right.range.focus.rowId &&
    left.range.focus.columnId === right.range.focus.columnId &&
    sameIdentities(left.range.rowIds, right.range.rowIds) &&
    sameIdentities(left.range.columnIds, right.range.columnIds)
  );
}

function escapeTsvCell(value: string): string {
  return /[\t\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function resolvePointerHit(
  gesture: BrunoTableCellRangePointerGesture,
): BrunoTableCellRangeHit | undefined {
  const direct = closestCellHit(gesture.target, gesture.grid);
  if (direct !== undefined) return direct;
  return closestCellHit(
    gesture.grid.ownerDocument.elementFromPoint(gesture.clientX, gesture.clientY),
    gesture.grid,
  );
}

export function closestBrunoTableCellRangeHit(
  target: EventTarget | null,
  grid: HTMLElement,
): BrunoTableCellRangeHit | undefined {
  return closestCellHit(target, grid);
}

function closestCellHit(
  target: EventTarget | null,
  grid: HTMLElement,
): BrunoTableCellRangeHit | undefined {
  const ElementConstructor = grid.ownerDocument.defaultView?.Element;
  if (ElementConstructor === undefined || !(target instanceof ElementConstructor)) return undefined;
  const cell = target.closest<HTMLElement>(
    '[role="gridcell"][data-bruno-row-id][data-bruno-row-index][data-bruno-column-id]',
  );
  if (cell === null || cell.closest('[role="grid"]') !== grid) return undefined;
  const rowId = cell.dataset["brunoRowId"];
  const columnId = cell.dataset["brunoColumnId"];
  const rowIndexText = cell.dataset["brunoRowIndex"];
  if (rowId === undefined || columnId === undefined || rowIndexText === undefined) return undefined;
  const rowIndex = Number(rowIndexText);
  if (!Number.isSafeInteger(rowIndex) || rowIndex < 0) return undefined;
  return Object.freeze({ rowId, columnId, rowIndex });
}
