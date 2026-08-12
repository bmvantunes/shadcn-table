import type { CompiledColumn } from "./compile-columns";

export const BRUNO_TABLE_MIN_COLUMN_WIDTH = 32;
export const BRUNO_TABLE_MAX_COLUMN_WIDTH = 1_000;
export const BRUNO_TABLE_LIVE_VIEWPORT_FILL_CSS_VARIABLE = "--bruno-table-live-viewport-fill";
export const BRUNO_TABLE_LIVE_LEFT_PADDING_CSS_VARIABLE = "--bruno-table-live-left-padding";
export const BRUNO_TABLE_LIVE_RIGHT_PADDING_CSS_VARIABLE = "--bruno-table-live-right-padding";

export function brunoTableColumnCssVariable(
  kind: "width" | "pinned-start-offset" | "pinned-end-offset" | "transform",
  columnId: string,
): string {
  return `--bruno-table-column-${kind}-${encodeCssVariableSegment(columnId)}`;
}

export function brunoTablePinnedWidthCssVariable(side: "start" | "end"): string {
  return `--bruno-table-pinned-${side}-width`;
}

export const BRUNO_TABLE_LIVE_TOTAL_WIDTH_CSS_VARIABLE = "--bruno-table-live-total-width";

function encodeCssVariableSegment(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return `_${codePoint.toString(16)}`;
  }).join("");
}

export type BrunoTableColumnPin = "start" | "end" | undefined;

/** Private layout commands shared by header gestures and the column menu. */
export type BrunoTableColumnLayoutCommand =
  | Readonly<{
      readonly type: "column.resize.commit";
      readonly columnId: string;
      readonly width: number;
    }>
  | Readonly<{
      readonly type: "column.reorder.commit";
      readonly columnId: string;
      /** Zero-based position in the target visible logical Column order. */
      readonly targetIndex: number;
      /** The target logical pinning region; pointer drops may cross regions atomically. */
      readonly pinned: BrunoTableColumnPin;
    }>
  | Readonly<{
      readonly type: "column.visibility.commit";
      readonly columnId: string;
      readonly visible: boolean;
    }>
  | Readonly<{
      readonly type: "column.pin.commit";
      readonly columnId: string;
      readonly pinned: BrunoTableColumnPin;
    }>
  | Readonly<{ readonly type: "column.reset.order" }>
  | Readonly<{ readonly type: "column.reset.widths" }>
  | Readonly<{ readonly type: "column.reset.visibility" }>
  | Readonly<{ readonly type: "column.reset.pinning" }>
  | Readonly<{ readonly type: "column.reset.layout" }>;

/** The one private command bus used by all grid-owned header interactions. */
export type BrunoTableGridCommand =
  | BrunoTableColumnLayoutCommand
  | Readonly<{
      readonly type: "column.sort.toggle";
      readonly columnId: string;
      readonly multi: boolean;
    }>
  | Readonly<{
      readonly type: "column.filter.clear";
      readonly columnId: string;
    }>
  | Readonly<{
      readonly type: "column.filter.reset";
      readonly columnId: string;
    }>;

export type BrunoTableColumnLayoutSnapshot = Readonly<{
  /**
   * All columns, including hidden columns, in the controlled TanStack input order. The Client
   * Adapter owns the resulting TanStack-derived projection consumed by rendering and navigation.
   */
  readonly allColumns: readonly CompiledColumn[];
  /** The sanitized definition layout used by the individual reset commands. */
  readonly baselineColumns: readonly CompiledColumn[];
  /** Visible columns in the current renderer projection. */
  readonly columns: readonly CompiledColumn[];
  readonly visibleColumnIds: readonly string[];
  readonly version: number;
}>;

export type BrunoTableColumnLayoutState = Readonly<{
  readonly baselineColumns: readonly CompiledColumn[];
  readonly allColumns: readonly CompiledColumn[];
  readonly visibleColumnIds: readonly string[];
  readonly version: number;
}>;

export function createBrunoTableColumnLayout(
  columns: readonly CompiledColumn[],
  version = 0,
): BrunoTableColumnLayoutState {
  const baselineColumns = Object.freeze(Array.from(columns));
  const allColumns = baselineColumns;
  return Object.freeze({
    baselineColumns,
    allColumns,
    visibleColumnIds: Object.freeze(
      getBrunoTableLogicalColumnOrder(allColumns).map((column) => column.columnId),
    ),
    version,
  });
}

/**
 * Reconciles a live column-definition replacement without discarding the
 * instance's already-committed layout for identities that survived.
 */
export function reconcileBrunoTableColumnLayout(
  state: BrunoTableColumnLayoutState,
  columns: readonly CompiledColumn[],
  version: number = state.version + 1,
): BrunoTableColumnLayoutState {
  const baselineColumns = Object.freeze(Array.from(columns));
  const nextById = new Map(baselineColumns.map((column) => [column.columnId, column]));
  const previousById = new Map(state.allColumns.map((column) => [column.columnId, column]));
  const surviving = state.allColumns.flatMap((column) => {
    const next = nextById.get(column.columnId);
    return next === undefined ? [] : [preserveCommittedColumnLayout(column, next)];
  });
  const additions = baselineColumns.filter((column) => !previousById.has(column.columnId));
  const allColumns = Object.freeze([...surviving, ...additions]);
  const previousVisible = new Set(state.visibleColumnIds);
  const visibleColumnIds = Object.freeze(
    getBrunoTableLogicalColumnOrder(allColumns)
      .filter(
        (column) => !previousById.has(column.columnId) || previousVisible.has(column.columnId),
      )
      .map((column) => column.columnId),
  );
  return Object.freeze({
    baselineColumns,
    allColumns,
    visibleColumnIds,
    version,
  });
}

export function getBrunoTableColumnLayoutSnapshot(
  state: BrunoTableColumnLayoutState,
): BrunoTableColumnLayoutSnapshot {
  return Object.freeze({
    allColumns: state.allColumns,
    baselineColumns: state.baselineColumns,
    columns: visibleColumns(state),
    visibleColumnIds: state.visibleColumnIds,
    version: state.version,
  });
}

export function applyBrunoTableGridCommand(
  state: BrunoTableColumnLayoutState,
  command: BrunoTableColumnLayoutCommand,
): BrunoTableColumnLayoutState {
  switch (command.type) {
    case "column.resize.commit":
      return resizeColumn(state, command.columnId, command.width);
    case "column.reorder.commit":
      return reorderColumn(state, command.columnId, command.targetIndex, command.pinned);
    case "column.visibility.commit":
      return setColumnVisibility(state, command.columnId, command.visible);
    case "column.pin.commit":
      return setColumnPinning(state, command.columnId, command.pinned);
    case "column.reset.order":
      return resetOrder(state);
    case "column.reset.widths":
      return resetWidths(state);
    case "column.reset.visibility":
      return resetVisibility(state);
    case "column.reset.pinning":
      return resetPinning(state);
    case "column.reset.layout":
      return resetLayout(state);
  }
}

export type BrunoTableColumnWidthBounds = Readonly<{
  readonly min: number;
  readonly max: number;
}>;

export function clampBrunoTableColumnWidth(
  width: number,
  bounds: BrunoTableColumnWidthBounds = {
    min: BRUNO_TABLE_MIN_COLUMN_WIDTH,
    max: BRUNO_TABLE_MAX_COLUMN_WIDTH,
  },
): number {
  if (!Number.isFinite(width)) return bounds.min;
  return Math.round(Math.min(Math.max(width, bounds.min), bounds.max));
}

export function getBrunoTableColumnWidthBounds(column: CompiledColumn): Readonly<{
  readonly min: number;
  readonly max: number;
}>;
export function getBrunoTableColumnWidthBounds(
  column: CompiledColumn,
  baselineWidth: number,
): BrunoTableColumnWidthBounds;
export function getBrunoTableColumnWidthBounds(
  column: CompiledColumn,
  baselineWidth = column.semantics.width,
): BrunoTableColumnWidthBounds {
  return Object.freeze({
    min: Math.min(BRUNO_TABLE_MIN_COLUMN_WIDTH, baselineWidth),
    max: Math.max(BRUNO_TABLE_MAX_COLUMN_WIDTH, baselineWidth),
  });
}

function resizeColumn(
  state: BrunoTableColumnLayoutState,
  columnId: string,
  requestedWidth: number,
): BrunoTableColumnLayoutState {
  const column = state.allColumns.find((candidate) => candidate.columnId === columnId);
  if (column === undefined) return state;
  const baseline = state.baselineColumns.find((candidate) => candidate.columnId === columnId);
  const width = clampBrunoTableColumnWidth(
    requestedWidth,
    getBrunoTableColumnWidthBounds(column, baseline?.semantics.width ?? column.semantics.width),
  );
  if (column.semantics.width === width) return state;
  const allColumns = Object.freeze(
    state.allColumns.map((candidate) =>
      candidate.columnId === columnId ? withColumnWidth(candidate, width) : candidate,
    ),
  );
  return nextState(state, allColumns, state.visibleColumnIds);
}

function reorderColumn(
  state: BrunoTableColumnLayoutState,
  columnId: string,
  requestedTargetIndex: number,
  targetPinned: BrunoTableColumnPin,
): BrunoTableColumnLayoutState {
  const source = state.allColumns.find((candidate) => candidate.columnId === columnId);
  if (source === undefined) return state;
  const targetColumns =
    source.pinned === targetPinned
      ? state.allColumns
      : state.allColumns.map((candidate) =>
          candidate.columnId === columnId ? withColumnPin(candidate, targetPinned) : candidate,
        );
  const visibleIds = [
    ...getLogicalVisibleColumnIdsFromColumns(targetColumns, state.visibleColumnIds),
  ];
  const visibleColumnById = new Map<string, CompiledColumn>(
    getBrunoTableLogicalColumnOrder(targetColumns)
      .filter((column) => state.visibleColumnIds.includes(column.columnId))
      .map((column) => [column.columnId, column] as const),
  );
  const sourceIndex = visibleIds.indexOf(columnId);
  if (sourceIndex < 0) return state;
  const logicalColumns = getBrunoTableLogicalColumnOrder(targetColumns);
  const column = visibleColumnById.get(columnId);
  if (column === undefined) return state;
  const group = column.pinned;
  const groupIndexes = visibleIds.flatMap((id, index) => {
    const candidate = visibleColumnById.get(id);
    return candidate?.pinned === group ? [index] : [];
  });
  const groupStart = groupIndexes[0] ?? sourceIndex;
  const groupEnd = groupIndexes.at(-1) ?? sourceIndex;
  const targetIndex = Math.max(groupStart, Math.min(groupEnd, requestedTargetIndex));
  if (sourceIndex === targetIndex && source.pinned === targetPinned) return state;
  visibleIds.splice(sourceIndex, 1);
  visibleIds.splice(targetIndex, 0, columnId);
  const allColumns = replaceVisibleOrder(logicalColumns, state.visibleColumnIds, visibleIds);
  return nextState(state, allColumns, visibleIds);
}

function setColumnVisibility(
  state: BrunoTableColumnLayoutState,
  columnId: string,
  visible: boolean,
): BrunoTableColumnLayoutState {
  const isVisible = state.visibleColumnIds.includes(columnId);
  if (visible === isVisible) return state;
  if (!visible && state.visibleColumnIds.length <= 1) return state;
  const visibleColumnIds = visible
    ? insertVisibleColumn(state, columnId)
    : Object.freeze(state.visibleColumnIds.filter((id) => id !== columnId));
  return nextState(state, state.allColumns, visibleColumnIds);
}

function setColumnPinning(
  state: BrunoTableColumnLayoutState,
  columnId: string,
  pinned: BrunoTableColumnPin,
): BrunoTableColumnLayoutState {
  const column = state.allColumns.find((candidate) => candidate.columnId === columnId);
  if (column === undefined || column.pinned === pinned) return state;
  const allColumns = getBrunoTableLogicalColumnOrder(
    getBrunoTableLogicalColumnOrder(state.allColumns).map((candidate) =>
      candidate.columnId === columnId ? withColumnPin(candidate, pinned) : candidate,
    ),
  );
  return nextState(state, allColumns, state.visibleColumnIds);
}

function resetOrder(state: BrunoTableColumnLayoutState): BrunoTableColumnLayoutState {
  const currentById = new Map(state.allColumns.map((column) => [column.columnId, column]));
  const ordered = state.baselineColumns.flatMap((column) => {
    const current = currentById.get(column.columnId);
    return current === undefined ? [] : [current];
  });
  const trailing = state.allColumns.filter(
    (column) => !state.baselineColumns.some((baseline) => baseline.columnId === column.columnId),
  );
  const allColumns = Object.freeze([...ordered, ...trailing]);
  const visibleColumnIds = Object.freeze(
    state.visibleColumnIds.filter((id) => allColumns.some((column) => column.columnId === id)),
  );
  return nextState(state, allColumns, visibleColumnIds);
}

function resetWidths(state: BrunoTableColumnLayoutState): BrunoTableColumnLayoutState {
  const baselineById = new Map(
    state.baselineColumns.map((column) => [column.columnId, column.semantics.width]),
  );
  const allColumns = Object.freeze(
    state.allColumns.map((column) => {
      const width = baselineById.get(column.columnId);
      return width === undefined || width === column.semantics.width
        ? column
        : withColumnWidth(column, width);
    }),
  );
  return nextState(state, allColumns, state.visibleColumnIds);
}

function resetVisibility(state: BrunoTableColumnLayoutState): BrunoTableColumnLayoutState {
  return nextState(
    state,
    state.allColumns,
    Object.freeze(state.baselineColumns.map((column) => column.columnId)),
  );
}

function resetPinning(state: BrunoTableColumnLayoutState): BrunoTableColumnLayoutState {
  const baselineById = new Map(
    state.baselineColumns.map((column) => [column.columnId, column.pinned]),
  );
  const allColumns = Object.freeze(
    state.allColumns.map((column) => {
      const pinned = baselineById.get(column.columnId);
      return pinned === column.pinned ? column : withColumnPin(column, pinned);
    }),
  );
  return nextState(state, allColumns, state.visibleColumnIds);
}

function resetLayout(state: BrunoTableColumnLayoutState): BrunoTableColumnLayoutState {
  return nextState(
    state,
    state.baselineColumns,
    Object.freeze(state.baselineColumns.map((column) => column.columnId)),
  );
}

function nextState(
  state: BrunoTableColumnLayoutState,
  allColumns: readonly CompiledColumn[],
  visibleColumnIds: readonly string[],
): BrunoTableColumnLayoutState {
  const nextAllColumns = Object.freeze(Array.from(allColumns));
  const visibleIds = new Set(visibleColumnIds);
  const nextVisibleColumnIds = Object.freeze(
    getBrunoTableLogicalColumnOrder(nextAllColumns)
      .filter((column) => visibleIds.has(column.columnId))
      .map((column) => column.columnId),
  );
  if (
    sameColumnArray(state.allColumns, nextAllColumns) &&
    sameStringArray(state.visibleColumnIds, nextVisibleColumnIds)
  ) {
    return state;
  }
  return Object.freeze({
    ...state,
    allColumns: nextAllColumns,
    visibleColumnIds: nextVisibleColumnIds,
    version: state.version + 1,
  });
}

function visibleColumns(state: BrunoTableColumnLayoutState): readonly CompiledColumn[] {
  const visible = new Set(state.visibleColumnIds);
  return Object.freeze(
    getBrunoTableLogicalColumnOrder(state.allColumns).filter((column) =>
      visible.has(column.columnId),
    ),
  );
}

/**
 * Mirrors the controlled TanStack pinning projection: start, centre, then end.
 * The Client Adapter remains the authority for the actual Table projection; this helper keeps
 * loading/layout command snapshots in that same logical shape before the adapter runs.
 */
export function getBrunoTableLogicalColumnOrder(
  columns: readonly CompiledColumn[],
): readonly CompiledColumn[] {
  return Object.freeze([
    ...columns.filter((column) => column.pinned === "start"),
    ...columns.filter((column) => column.pinned === undefined),
    ...columns.filter((column) => column.pinned === "end"),
  ]);
}

function getLogicalVisibleColumnIdsFromColumns(
  columns: readonly CompiledColumn[],
  visibleColumnIds: readonly string[],
): readonly string[] {
  const visible = new Set(visibleColumnIds);
  return getBrunoTableLogicalColumnOrder(columns)
    .filter((column) => visible.has(column.columnId))
    .map((column) => column.columnId);
}

function insertVisibleColumn(
  state: BrunoTableColumnLayoutState,
  columnId: string,
): readonly string[] {
  const allIndex = state.allColumns.findIndex((column) => column.columnId === columnId);
  if (allIndex < 0) return state.visibleColumnIds;
  const precedingVisible = state.allColumns
    .slice(0, allIndex)
    .filter((column) => state.visibleColumnIds.includes(column.columnId));
  const visibleColumnIds = [...state.visibleColumnIds];
  visibleColumnIds.splice(precedingVisible.length, 0, columnId);
  return Object.freeze(visibleColumnIds);
}

function replaceVisibleOrder(
  allColumns: readonly CompiledColumn[],
  currentVisibleIds: readonly string[],
  nextVisibleIds: readonly string[],
): readonly CompiledColumn[] {
  const currentVisible = new Set(currentVisibleIds);
  let nextIndex = 0;
  return Object.freeze(
    allColumns.map((column) => {
      if (!currentVisible.has(column.columnId)) return column;
      const nextId = nextVisibleIds[nextIndex++];
      return allColumns.find((candidate) => candidate.columnId === nextId) ?? column;
    }),
  );
}

function withColumnWidth(column: CompiledColumn, width: number): CompiledColumn {
  return Object.freeze({
    ...column,
    semantics: Object.freeze({ ...column.semantics, width }),
  });
}

function withColumnPin(column: CompiledColumn, pinned: BrunoTableColumnPin): CompiledColumn {
  const next = { ...column };
  if (pinned === undefined) {
    delete next.pinned;
  } else {
    next.pinned = pinned;
  }
  return Object.freeze(next);
}

function preserveCommittedColumnLayout(
  current: CompiledColumn,
  next: CompiledColumn,
): CompiledColumn {
  let preserved = next;
  if (current.semantics.width !== next.semantics.width) {
    preserved = withColumnWidth(preserved, current.semantics.width);
  }
  if (current.pinned !== next.pinned) {
    preserved = withColumnPin(preserved, current.pinned);
  }
  return preserved;
}

function sameColumnArray(
  left: readonly CompiledColumn[],
  right: readonly CompiledColumn[],
): boolean {
  return left.length === right.length && left.every((column, index) => column === right[index]);
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
