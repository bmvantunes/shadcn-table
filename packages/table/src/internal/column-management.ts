import type { CompiledColumn } from "./compile-columns";
import type { BrunoTableSortingCommand } from "./sorting";

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
  | BrunoTableSortingCommand
  | Readonly<{
      readonly type: "column.filter.clear";
      readonly columnId: string;
    }>
  | Readonly<{
      readonly type: "column.filter.reset";
      readonly columnId: string;
    }>;

function assertNeverBrunoTableGridCommand(value: never): never {
  throw new TypeError(`Unsupported BrunoTable grid command: ${String(value)}`);
}

export function isBrunoTableColumnLayoutCommand(
  command: BrunoTableGridCommand,
): command is BrunoTableColumnLayoutCommand {
  switch (command.type) {
    case "column.resize.commit":
    case "column.reorder.commit":
    case "column.visibility.commit":
    case "column.pin.commit":
    case "column.reset.order":
    case "column.reset.widths":
    case "column.reset.visibility":
    case "column.reset.pinning":
    case "column.reset.layout":
      return true;
    case "column.sort.toggle":
    case "sorting.add":
    case "sorting.remove":
    case "sorting.move":
    case "sorting.reset":
    case "column.filter.clear":
    case "column.filter.reset":
      return false;
    default:
      return assertNeverBrunoTableGridCommand(command);
  }
}

export type BrunoTableColumnLayoutSnapshot = Readonly<{
  /**
   * All columns, including hidden columns, in BrunoTable's committed logical layout order. The
   * private Client Adapter may bridge this projection into TanStack inputs, but the runtime owns
   * the committed order, visibility, pinning, and widths consumed by rendering and navigation.
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
  readonly committedOverrides: ReadonlyMap<string, BrunoTableCommittedColumnOverride>;
  readonly orderOverride: readonly CompiledColumn["columnId"][] | undefined;
  readonly version: number;
}>;

type BrunoTableCommittedColumnOverride = Readonly<{
  readonly width?: number;
  readonly pinned?: BrunoTableColumnPin;
  readonly pinningCommitted?: boolean;
}>;

const EMPTY_COMMITTED_OVERRIDES: ReadonlyMap<string, BrunoTableCommittedColumnOverride> = new Map();

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
    committedOverrides: EMPTY_COMMITTED_OVERRIDES,
    orderOverride: undefined,
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
  const committedOverrides = filterCommittedOverrides(state.committedOverrides, nextById);
  const orderOverride =
    state.orderOverride === undefined
      ? undefined
      : Object.freeze(state.orderOverride.filter((columnId) => nextById.has(columnId)));
  const baselineOrder = baselineColumns.map((column) => column.columnId);
  const orderedIds =
    orderOverride === undefined
      ? baselineOrder
      : [
          ...orderOverride,
          ...baselineOrder.filter((columnId) => !orderOverride.includes(columnId)),
        ];
  const reconciledColumns = orderedIds.flatMap((columnId) => {
    const next = nextById.get(columnId);
    return next === undefined
      ? []
      : [preserveCommittedColumnLayout(committedOverrides.get(columnId), next)];
  });
  const allColumns = Object.freeze(reconciledColumns);
  const logicalColumns = getBrunoTableLogicalColumnOrder(allColumns);
  const allColumnsById = new Map<string, CompiledColumn>(
    allColumns.map((column) => [column.columnId, column]),
  );
  const retainedVisible = state.visibleColumnIds.filter((columnId) => allColumnsById.has(columnId));
  const additions = logicalColumns
    .filter((column) => !previousById.has(column.columnId))
    .map((column) => column.columnId);
  const visibleByPin = (pinned: BrunoTableColumnPin): readonly string[] => [
    ...retainedVisible.filter((columnId) => allColumnsById.get(columnId)?.pinned === pinned),
    ...additions.filter((columnId) => allColumnsById.get(columnId)?.pinned === pinned),
  ];
  const reconciledVisible = [
    ...visibleByPin("start"),
    ...visibleByPin(undefined),
    ...visibleByPin("end"),
  ];
  const visibleColumnIds = Object.freeze(
    reconciledVisible.length > 0 || logicalColumns.length === 0
      ? reconciledVisible
      : [logicalColumns[0]!.columnId],
  );
  return Object.freeze({
    baselineColumns,
    allColumns,
    visibleColumnIds,
    committedOverrides,
    orderOverride,
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
  if (Number.isNaN(width) || width === Number.NEGATIVE_INFINITY) return bounds.min;
  if (width === Number.POSITIVE_INFINITY) return bounds.max;
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
  return nextState(
    state,
    allColumns,
    state.visibleColumnIds,
    setWidthOverride(state.committedOverrides, columnId, width),
  );
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
  // The committed visible-id tuple is the authority for order within a pinning
  // region. Rebuilding it from `allColumns` would lose a prior reorder because
  // `allColumns` is also kept as the controlled TanStack input projection.
  const visibleIds = [
    ...(source.pinned === targetPinned
      ? state.visibleColumnIds
      : getLogicalVisibleColumnIdsFromColumns(targetColumns, state.visibleColumnIds)),
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
  const committedOverrides =
    source.pinned === targetPinned
      ? state.committedOverrides
      : setPinningOverride(state.committedOverrides, columnId, targetPinned);
  return nextState(
    state,
    allColumns,
    visibleIds,
    committedOverrides,
    Object.freeze(allColumns.map((candidate) => candidate.columnId)),
  );
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
  const allColumns = Object.freeze(
    state.allColumns.map((candidate) =>
      candidate.columnId === columnId ? withColumnPin(candidate, pinned) : candidate,
    ),
  );
  const visibleColumnIds =
    pinned === undefined && column.pinned !== undefined
      ? getLogicalVisibleColumnIdsFromColumns(allColumns, state.visibleColumnIds)
      : groupVisibleColumnIdsByPin(allColumns, state.visibleColumnIds);
  return nextState(
    state,
    allColumns,
    visibleColumnIds,
    setPinningOverride(state.committedOverrides, columnId, pinned),
  );
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
  const visible = new Set(state.visibleColumnIds);
  const visibleColumnIds = Object.freeze(
    getBrunoTableLogicalColumnOrder(allColumns)
      .filter((column) => visible.has(column.columnId))
      .map((column) => column.columnId),
  );
  return nextState(state, allColumns, visibleColumnIds, state.committedOverrides, undefined);
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
  return nextState(
    state,
    allColumns,
    state.visibleColumnIds,
    clearWidthOverrides(state.committedOverrides),
  );
}

function resetVisibility(state: BrunoTableColumnLayoutState): BrunoTableColumnLayoutState {
  return nextState(
    state,
    state.allColumns,
    Object.freeze(
      getBrunoTableLogicalColumnOrder(state.allColumns).map((column) => column.columnId),
    ),
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
  return nextState(
    state,
    allColumns,
    getLogicalVisibleColumnIdsFromColumns(allColumns, state.visibleColumnIds),
    clearPinningOverrides(state.committedOverrides),
  );
}

function resetLayout(state: BrunoTableColumnLayoutState): BrunoTableColumnLayoutState {
  return nextState(
    state,
    state.baselineColumns,
    Object.freeze(
      getBrunoTableLogicalColumnOrder(state.baselineColumns).map((column) => column.columnId),
    ),
    EMPTY_COMMITTED_OVERRIDES,
    undefined,
  );
}

function nextState(
  state: BrunoTableColumnLayoutState,
  allColumns: readonly CompiledColumn[],
  visibleColumnIds: readonly string[],
  committedOverrides: ReadonlyMap<
    string,
    BrunoTableCommittedColumnOverride
  > = state.committedOverrides,
  orderOverride: readonly CompiledColumn["columnId"][] | undefined = state.orderOverride,
): BrunoTableColumnLayoutState {
  const nextAllColumns = Object.freeze(Array.from(allColumns));
  const availableIds = new Set<string>(nextAllColumns.map((column) => column.columnId));
  const seenVisibleIds = new Set<string>();
  const nextVisibleColumnIds = Object.freeze(
    visibleColumnIds.filter((columnId) => {
      if (seenVisibleIds.has(columnId)) return false;
      seenVisibleIds.add(columnId);
      return availableIds.has(columnId);
    }),
  );
  if (
    sameColumnArray(state.allColumns, nextAllColumns) &&
    sameStringArray(state.visibleColumnIds, nextVisibleColumnIds) &&
    sameCommittedOverrides(state.committedOverrides, committedOverrides) &&
    sameOptionalStringArray(state.orderOverride, orderOverride)
  ) {
    return state;
  }
  return Object.freeze({
    ...state,
    allColumns: nextAllColumns,
    visibleColumnIds: nextVisibleColumnIds,
    committedOverrides,
    orderOverride,
    version: state.version + 1,
  });
}

function visibleColumns(state: BrunoTableColumnLayoutState): readonly CompiledColumn[] {
  const columnsById = new Map<string, CompiledColumn>(
    state.allColumns.map((column) => [column.columnId, column]),
  );
  return Object.freeze(
    state.visibleColumnIds.flatMap((columnId) => {
      const column = columnsById.get(columnId);
      return column === undefined ? [] : [column];
    }),
  );
}

/**
 * Mirrors the controlled TanStack pinning projection: start, centre, then end.
 * BrunoTable's layout runtime owns the committed logical order; the private Client Adapter
 * consumes this projection as controlled TanStack input. This helper keeps loading/layout command
 * snapshots in that same logical shape before the adapter runs.
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

function groupVisibleColumnIdsByPin(
  columns: readonly CompiledColumn[],
  visibleColumnIds: readonly string[],
): readonly string[] {
  const columnsById = new Map<string, CompiledColumn>(
    columns.map((column) => [column.columnId, column]),
  );
  return Object.freeze([
    ...visibleColumnIds.filter((columnId) => columnsById.get(columnId)?.pinned === "start"),
    ...visibleColumnIds.filter((columnId) => columnsById.get(columnId)?.pinned === undefined),
    ...visibleColumnIds.filter((columnId) => columnsById.get(columnId)?.pinned === "end"),
  ]);
}

function insertVisibleColumn(
  state: BrunoTableColumnLayoutState,
  columnId: string,
): readonly string[] {
  const logicalColumns = getBrunoTableLogicalColumnOrder(state.allColumns);
  const allIndex = logicalColumns.findIndex((column) => column.columnId === columnId);
  if (allIndex < 0) return state.visibleColumnIds;
  const precedingVisible = logicalColumns
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
  const columnsById = new Map<string, CompiledColumn>(
    allColumns.map((column) => [column.columnId, column]),
  );
  let nextIndex = 0;
  return Object.freeze(
    allColumns.map((column) => {
      if (!currentVisible.has(column.columnId)) return column;
      const nextId = nextVisibleIds[nextIndex++];
      return nextId === undefined ? column : (columnsById.get(nextId) ?? column);
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
  override: BrunoTableCommittedColumnOverride | undefined,
  next: CompiledColumn,
): CompiledColumn {
  let preserved = next;
  if (override?.width !== undefined && override.width !== next.semantics.width) {
    preserved = withColumnWidth(preserved, override.width);
  }
  if (override?.pinningCommitted === true && override.pinned !== next.pinned) {
    preserved = withColumnPin(preserved, override.pinned);
  }
  return preserved;
}

function filterCommittedOverrides(
  overrides: ReadonlyMap<string, BrunoTableCommittedColumnOverride>,
  columnsById: ReadonlyMap<string, CompiledColumn>,
): ReadonlyMap<string, BrunoTableCommittedColumnOverride> {
  const filtered = new Map<string, BrunoTableCommittedColumnOverride>();
  for (const [columnId, override] of overrides) {
    if (columnsById.has(columnId)) filtered.set(columnId, override);
  }
  return filtered.size === overrides.size ? overrides : filtered;
}

function setWidthOverride(
  overrides: ReadonlyMap<string, BrunoTableCommittedColumnOverride>,
  columnId: string,
  width: number,
): ReadonlyMap<string, BrunoTableCommittedColumnOverride> {
  const next = new Map(overrides);
  next.set(columnId, Object.freeze({ ...next.get(columnId), width }));
  return next;
}

function setPinningOverride(
  overrides: ReadonlyMap<string, BrunoTableCommittedColumnOverride>,
  columnId: string,
  pinned: BrunoTableColumnPin,
): ReadonlyMap<string, BrunoTableCommittedColumnOverride> {
  const next = new Map(overrides);
  next.set(columnId, Object.freeze({ ...next.get(columnId), pinned, pinningCommitted: true }));
  return next;
}

function clearWidthOverrides(
  overrides: ReadonlyMap<string, BrunoTableCommittedColumnOverride>,
): ReadonlyMap<string, BrunoTableCommittedColumnOverride> {
  const next = new Map<string, BrunoTableCommittedColumnOverride>();
  for (const [columnId, override] of overrides) {
    if (override.pinningCommitted === true) {
      next.set(columnId, Object.freeze({ pinned: override.pinned, pinningCommitted: true }));
    }
  }
  return next;
}

function clearPinningOverrides(
  overrides: ReadonlyMap<string, BrunoTableCommittedColumnOverride>,
): ReadonlyMap<string, BrunoTableCommittedColumnOverride> {
  const next = new Map<string, BrunoTableCommittedColumnOverride>();
  for (const [columnId, override] of overrides) {
    if (override.width !== undefined) next.set(columnId, Object.freeze({ width: override.width }));
  }
  return next;
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

function sameOptionalStringArray(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return sameStringArray(left, right);
}

function sameCommittedOverrides(
  left: ReadonlyMap<string, BrunoTableCommittedColumnOverride>,
  right: ReadonlyMap<string, BrunoTableCommittedColumnOverride>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [columnId, override] of left) {
    const candidate = right.get(columnId);
    if (
      candidate?.width !== override.width ||
      candidate?.pinned !== override.pinned ||
      candidate?.pinningCommitted !== override.pinningCommitted
    ) {
      return false;
    }
  }
  return true;
}
