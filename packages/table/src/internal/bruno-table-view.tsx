import { Alert, AlertDescription, AlertTitle } from "@bruno/shadcn/alert";
import { Button } from "@bruno/shadcn/button";
import { DirectionProvider } from "@bruno/shadcn/direction";
import { NativeSelect, NativeSelectOption } from "@bruno/shadcn/native-select";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@bruno/shadcn/popover";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@bruno/shadcn/empty";
import { Skeleton } from "@bruno/shadcn/skeleton";
import { Spinner } from "@bruno/shadcn/spinner";
import { Checkbox } from "@bruno/shadcn/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@bruno/shadcn/dropdown-menu";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsHorizontalIcon,
  DotsThreeVerticalIcon,
  PushPinIcon,
  PushPinSlashIcon,
} from "@phosphor-icons/react";
import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type {
  ComponentType,
  CSSProperties,
  NamedExoticComponent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode,
  RefCallback,
} from "react";

import type { CompiledColumn } from "./compile-columns";
import { prepareBrunoTableGroupingRemovalFocus } from "./client-grouping-focus";
import {
  type BrunoTableHotkeyGesture,
  isBrunoTableHotkeyWorkflowOwner,
  requestBrunoTableHotkeyWorkflowAction,
  useBrunoTableGridHotkeys,
  useBrunoTableHotkeyWorkflowAction,
  BrunoTableHeldShiftHotkeyAdapter,
  isBrunoTableHotkeyHeld,
} from "./hotkey-adapter";
import {
  BrunoTableCellCommitDiagnosticProbe,
  BrunoTableGridSurfaceCommitDiagnosticProbe,
  BrunoTableHeaderCommitDiagnosticProbe,
  BrunoTableRowCommitDiagnosticProbe,
  BrunoTableRowSelectionCommitDiagnosticProbe,
  BrunoTableSortPanelCommitDiagnosticProbe,
  BrunoTableViewCommitDiagnosticProbe,
} from "./commit-diagnostic-probes";
import {
  createBrunoTableColumnGestureActor,
  type BrunoTableColumnGestureActor,
} from "./column-gesture";
import {
  projectBrunoTableLogicalColumnIndex,
  resolveBrunoTableReorderCenterBounds,
  resolveBrunoTableReorderTargetIndex,
  type BrunoTableReorderMeasurement,
} from "./column-geometry";
import {
  BRUNO_TABLE_LIVE_TOTAL_WIDTH_CSS_VARIABLE,
  BRUNO_TABLE_LIVE_VIEWPORT_FILL_CSS_VARIABLE,
  BRUNO_TABLE_LIVE_LEFT_PADDING_CSS_VARIABLE,
  BRUNO_TABLE_LIVE_RIGHT_PADDING_CSS_VARIABLE,
  brunoTableColumnCssVariable,
  brunoTablePinnedWidthCssVariable,
  clampBrunoTableColumnWidth,
  type BrunoTableColumnLayoutSnapshot,
  type BrunoTableGridCommand,
} from "./column-management";
import {
  BrunoTableNavigationRuntime,
  isBrunoTableCellRangeNavigationCommandAdmitted,
  type BrunoTableActiveCell,
  type BrunoTableNavigationCommand,
} from "./navigation";
import type {
  BrunoTableCellSnapshot,
  BrunoTableChromeSnapshot,
  BrunoTableColumnCommandSnapshot,
  BrunoTableQueryNavigationMode,
  BrunoTableRowCellSnapshot,
  BrunoTableRowSpaceSnapshot,
  BrunoTableRuntimeView,
} from "./grid-runtime";
import {
  BRUNO_TABLE_RAW_CLIENT_PROJECTION_LAYOUT_KEY,
  isBrunoTableInvalidCellValue,
} from "./grid-runtime";
import {
  recordBrunoTableClientColumnPreviewStyleWrite,
  recordBrunoTableClientColumnReorderFrame,
  recordBrunoTableClientColumnResizeFrame,
  recordBrunoTableClientColumnGestureFrame,
  recordBrunoTableClientColumnGestureListener,
  hasBrunoTableClientColumnGestureFrameListener,
} from "./render-instrumentation";
import {
  BrunoTableLoadingViewportAdapterBoundary,
  BrunoTableViewportAdapterBoundary,
} from "./react-compiler-adapters";
import {
  BRUNO_TABLE_DEFAULT_VIEWPORT_HEIGHT,
  BRUNO_TABLE_ROW_HEIGHT,
  BRUNO_TABLE_SCROLLBAR_TRACK_THICKNESS,
  type BrunoTableViewportSnapshot,
} from "./virtual-viewport";
import {
  BRUNO_TABLE_ROW_SELECTION_COLUMN_ID,
  type BrunoTableRowSelectionRuntime,
} from "./row-selection";
import {
  captureBrunoTableClipboardSnapshot,
  clipboardTargetFromRange,
  clipboardTargetFromSelection,
  closestBrunoTableCellRangeHit,
  createBrunoTableCellRangeStructure,
  createBrunoTableCellRangeStructureFromRowSpace,
  serializeBrunoTableClipboardSnapshot,
  type BrunoTableCellRangeRuntime,
} from "./cell-range-clipboard";

const ROW_HEIGHT = BRUNO_TABLE_ROW_HEIGHT;
const ROW_SELECTION_COLUMN_WIDTH = 40;

type BrunoTableColumnWindow = Readonly<
  Pick<
    BrunoTableViewportSnapshot["virtualWindow"],
    | "pinnedStart"
    | "center"
    | "pinnedEnd"
    | "pinningSuspended"
    | "centerStartIndex"
    | "centerCount"
    | "leftPadding"
    | "rightPadding"
    | "totalWidth"
  >
>;
type InteractiveDomElement = HTMLElement | SVGElement;
type BrunoTableColumnGesture = {
  readonly kind: "resize" | "reorder";
  readonly pointerId: number;
  readonly columnId: string;
  readonly sourceIndex: number;
  readonly startX: number;
  readonly initialWidth: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly direction: "ltr" | "rtl";
  readonly sourcePinned: "start" | "end" | undefined;
  readonly pinningSuspended: boolean;
  readonly groupStart: number;
  readonly groupEnd: number;
  readonly target: HTMLElement;
  readonly onPointerMove: (event: globalThis.PointerEvent) => void;
  readonly onPointerUp: (event: globalThis.PointerEvent) => void;
  readonly onPointerCancel: (event: globalThis.PointerEvent) => void;
  reorderGeometry: readonly BrunoTableReorderGeometry[];
  reorderGeometryVersion: number;
  reorderGeometryVersionBeforeScroll: number;
  readonly reorderCenterBounds: Readonly<{ readonly left: number; readonly right: number }>;
  currentX: number;
  previewedX: number | undefined;
  reorderPreviewApplied: boolean;
  targetIndex: number;
  targetPinned: "start" | "end" | undefined;
  frame: number | null;
};
type BrunoTableReorderGeometry = BrunoTableReorderMeasurement &
  Readonly<{ readonly element: HTMLElement }>;
type BrunoTableColumnPointerDownHandler = (
  event: ReactPointerEvent<HTMLElement>,
  column: CompiledColumn,
  kind: "resize" | "reorder",
) => void;
const INTERACTIVE_DESCENDANT_SELECTOR =
  'a[href],area[href],button,input,select,summary,textarea,iframe,object,embed,audio[controls],video[controls],[contenteditable]:not([contenteditable="false"]),[tabindex]';
const INTERACTIVE_ROLE_SELECTOR =
  '[role="button"],[role="link"],[role="checkbox"],[role="textbox"],[role="combobox"],[role="slider"],[role="switch"],[role="radio"],[role="spinbutton"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="option"],[role="tab"],[role="treeitem"]';
const CELL_RANGE_POINTER_EXCLUSION_SELECTOR = `label,${INTERACTIVE_DESCENDANT_SELECTOR},${INTERACTIVE_ROLE_SELECTOR}`;
const EMBEDDED_BROWSING_CONTEXT_SELECTOR = "iframe,object,embed";
const VISUALLY_HIDDEN: CSSProperties = {
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  height: 1,
  overflow: "hidden",
  position: "absolute",
  whiteSpace: "nowrap",
  width: 1,
};

function totalColumnWidth(columns: readonly CompiledColumn[]): number {
  return columns.reduce((total, column) => total + column.semantics.width, 0);
}

function columnHeaderName(columns: readonly CompiledColumn[], columnId: string): string {
  return columns.find((column) => column.columnId === columnId)?.headerName ?? columnId;
}

function commitBrunoTableColumnResize(
  runtime: BrunoTableRuntimeView,
  columnId: string,
  requestedWidth: number,
): number {
  const command = runtime.getColumnCommandSnapshot(columnId);
  const width = clampBrunoTableColumnWidth(requestedWidth, {
    min: command.minWidth,
    max: command.maxWidth,
  });
  if (width !== command.width) {
    runtime.dispatchGridCommand({ type: "column.resize.commit", columnId, width });
  }
  return runtime.getColumnCommandSnapshot(columnId).width;
}

function readBrunoTableMenuDirection(element?: Element | null): "ltr" | "rtl" {
  if (typeof document === "undefined") return "ltr";
  const source = element ?? document.activeElement;
  const grid = source?.closest<HTMLElement>('[role="grid"]') ?? null;
  const ownerDocument = source?.ownerDocument ?? document;
  return getComputedStyle(grid ?? ownerDocument.documentElement).direction === "rtl"
    ? "rtl"
    : "ltr";
}

function yieldGridTabStopForNativeTraversal(grid: HTMLElement): void {
  grid.tabIndex = -1;
  setTimeout(() => {
    if (grid.isConnected) grid.tabIndex = 0;
  }, 0);
}

function isNodeInBrunoTableRealm(owner: HTMLElement, target: EventTarget | null): target is Node {
  const OwnerNode = owner.ownerDocument.defaultView?.Node;
  return OwnerNode !== undefined && target instanceof OwnerNode;
}

function cellDomId(instanceId: string, tableId: string, rowId: string, columnId: string): string {
  return `bruno-table-cell-${encodeDomIdSegment(instanceId)}-${encodeDomIdSegment(tableId)}-${encodeDomIdSegment(rowId)}-${encodeDomIdSegment(columnId)}`;
}

function headerDomId(instanceId: string, tableId: string, columnId: string): string {
  return `bruno-table-header-${encodeDomIdSegment(instanceId)}-${encodeDomIdSegment(tableId)}-${encodeDomIdSegment(columnId)}`;
}

function loadingCellDomId(
  instanceId: string,
  tableId: string,
  rowIndex: number,
  columnId: string,
): string {
  return `bruno-table-loading-cell-${encodeDomIdSegment(instanceId)}-${encodeDomIdSegment(tableId)}-${String(rowIndex)}-${encodeDomIdSegment(columnId)}`;
}

function encodeDomIdSegment(value: string): string {
  let encoded = "";
  for (let index = 0; index < value.length; index += 1) {
    encoded += value.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return encoded;
}

function activeDomId(
  instanceId: string,
  tableId: string,
  activeCell: BrunoTableActiveCell,
): string | undefined {
  return activeCell.region === "header"
    ? headerDomId(instanceId, tableId, activeCell.columnId)
    : activeCell.rowId === undefined
      ? loadingCellDomId(instanceId, tableId, activeCell.rowIndex, activeCell.columnId)
      : cellDomId(instanceId, tableId, activeCell.rowId, activeCell.columnId);
}

function mountedActiveDomId(
  instanceId: string,
  tableId: string,
  activeCell: BrunoTableActiveCell,
  rowSpace: BrunoTableRowSpaceSnapshot<unknown> | undefined,
): string | undefined {
  return activeDomIdForRowIdentity(
    instanceId,
    tableId,
    activeCell,
    rowSpace?.getRowId(activeCell.rowIndex),
  );
}

function activeDomIdForRowIdentity(
  instanceId: string,
  tableId: string,
  activeCell: BrunoTableActiveCell,
  currentRowId: string | undefined,
): string | undefined {
  if (
    activeCell.region === "body" &&
    activeCell.rowId !== undefined &&
    currentRowId === undefined
  ) {
    return loadingCellDomId(instanceId, tableId, activeCell.rowIndex, activeCell.columnId);
  }
  return activeDomId(instanceId, tableId, activeCell);
}

export function BrunoTableToolbar({ children }: { readonly children?: ReactNode }): ReactNode {
  if (!hasRenderableChildren(children)) return null;
  return (
    <div
      aria-label="Table controls"
      className="flex min-w-0 items-center gap-2 overflow-x-auto px-3.5 py-2"
      role="toolbar"
    >
      {children}
    </div>
  );
}

export type BrunoTableViewProps<
  TRuntime extends BrunoTableRuntimeView = BrunoTableRuntimeView,
  TAdapter = unknown,
> = {
  readonly runtime: TRuntime;
  readonly tableId: string;
  readonly compiledColumns: readonly CompiledColumn[];
  readonly toolbar: BrunoTableToolbarStore;
  readonly rowPipeline: ComponentType<BrunoTableRowPipelineProps<TRuntime, TAdapter>>;
  readonly rowPipelineAdapter: TAdapter;
  readonly renderColumnFilter?: BrunoTableColumnFilterRenderer | undefined;
  /** Private read-only capability: copy one loaded Active Cell through canonical semantics. */
  readonly enableActiveCellCopy?: boolean;
  /** Private capability seam for controls that belong to every variant's grid-owned rail. */
  readonly gridOwnedControls?: ReactNode;
  /** Private Client-only Row Selection capability. */
  readonly rowSelection?: BrunoTableRowSelectionRuntime | undefined;
  /** Private Client-only one-axis Cell Range Selection and Copy capability. */
  readonly cellRange?: BrunoTableCellRangeRuntime | undefined;
};

export type BrunoTableColumnFilterRendererProps = {
  readonly column: CompiledColumn;
  readonly command: BrunoTableColumnCommandSnapshot;
  readonly runtime: BrunoTableRuntimeView;
  readonly activateHeaderCommand: (columnId: string) => void;
  readonly restoreColumnFocus: (columnId: string) => void;
  readonly registerColumnFilterOpener: (columnId: string, open: () => void) => () => void;
};

export type BrunoTableColumnFilterRenderer = (
  props: BrunoTableColumnFilterRendererProps,
) => ReactElement;

function supportsBrunoTableCustomColumnFilter(
  column: CompiledColumn,
  renderColumnFilter: BrunoTableColumnFilterRenderer | undefined,
): boolean {
  return (
    renderColumnFilter !== undefined && column.kind === "field" && column.enableFilter !== false
  );
}

export type BrunoTableRowPipelineProps<
  TRuntime extends BrunoTableRuntimeView = BrunoTableRuntimeView,
  TAdapter = unknown,
> = {
  readonly runtime: TRuntime;
  readonly tableId: string;
  readonly columns: readonly CompiledColumn[];
  readonly rowPipelineAdapter: TAdapter;
  readonly rowSelection?: BrunoTableRowSelectionRuntime | undefined;
  readonly cellRange?: BrunoTableCellRangeRuntime | undefined;
  readonly children: (snapshot: BrunoTableRowPipelineSnapshot) => ReactElement;
};

export type BrunoTableRowPipelineSnapshot =
  | Readonly<{
      readonly kind: "rows";
      readonly runtime: BrunoTableRuntimeView;
      readonly columns: readonly CompiledColumn[];
      readonly rowSpace: BrunoTableLogicalRowSpace;
      readonly queryGeneration: number;
      readonly queryNavigationMode: BrunoTableQueryNavigationMode;
      readonly loading: boolean;
    }>
  | Readonly<{
      readonly kind: "invalid";
      readonly columns: readonly CompiledColumn[];
      readonly invalid: Extract<
        BrunoTableChromeSnapshot["invalid"],
        { readonly kind: "invalid-value" | "invalid-group" }
      >;
    }>;

export type BrunoTableLogicalRowSpace = Readonly<{
  readonly totalRows: number;
  readonly getRowId: (index: number) => string | undefined;
  readonly findRowIndex: (rowId: string) => number | undefined;
  readonly setRequiredRange: (start: number, end: number) => void;
  readonly identitySnapshot?:
    | Readonly<{
        readonly rowIds: readonly string[];
        readonly rowIndexById: ReadonlyMap<string, number>;
      }>
    | undefined;
  readonly missingRowIdentityBehavior?: "clear-conflicting-active-cell";
}>;

function BrunoTableViewImplementation<TRuntime extends BrunoTableRuntimeView, TAdapter>({
  runtime,
  tableId,
  compiledColumns,
  toolbar,
  rowPipeline,
  rowPipelineAdapter,
  renderColumnFilter,
  enableActiveCellCopy = false,
  gridOwnedControls,
  rowSelection,
  cellRange,
}: BrunoTableViewProps<TRuntime, TAdapter>): ReactElement {
  const tableElement = useRef<HTMLElement | null>(null);
  const focusFallback = useMemo(
    () => () => tableElement.current?.focus({ preventScroll: true }),
    [],
  );
  return (
    <section
      ref={tableElement}
      aria-label={tableId}
      className="relative data-[bruno-table]:isolate"
      data-bruno-table={tableId}
      tabIndex={-1}
    >
      {__BRUNO_TABLE_TEST_DIAGNOSTICS__ ? (
        <BrunoTableViewCommitDiagnosticProbe commitEvidence={compiledColumns} tableId={tableId} />
      ) : null}
      <BrunoTableSortPanel
        columns={compiledColumns}
        reserveEndSpace={gridOwnedControls !== undefined && gridOwnedControls !== null}
        runtime={runtime}
        tableId={tableId}
      />
      <GridOwnedToolRail controls={gridOwnedControls} />
      <div className="min-w-0">
        <ToolbarOutlet
          reserveEndSpace={gridOwnedControls !== undefined && gridOwnedControls !== null}
          toolbar={toolbar}
        />
        <SourceLifecycle runtime={runtime} focusFallback={focusFallback} />
        <BrunoTableGridBody
          runtime={runtime}
          tableId={tableId}
          compiledColumns={compiledColumns}
          focusFallback={focusFallback}
          rowPipeline={rowPipeline}
          rowPipelineAdapter={rowPipelineAdapter}
          renderColumnFilter={renderColumnFilter}
          enableActiveCellCopy={enableActiveCellCopy}
          rowSelection={rowSelection}
          cellRange={cellRange}
        />
      </div>
    </section>
  );
}

const MemoizedBrunoTableView = memo(
  BrunoTableViewImplementation,
) as typeof BrunoTableViewImplementation;

export function BrunoTableView<TRuntime extends BrunoTableRuntimeView, TAdapter>(
  props: BrunoTableViewProps<TRuntime, TAdapter>,
): ReactElement {
  return <MemoizedBrunoTableView {...props} />;
}

const ToolbarOutlet = memo(function ToolbarOutlet({
  reserveEndSpace,
  toolbar,
}: {
  readonly reserveEndSpace: boolean;
  readonly toolbar: BrunoTableToolbarStore;
}) {
  const snapshot = useSyncExternalStore(
    toolbar.subscribe,
    toolbar.getSnapshot,
    toolbar.getSnapshot,
  );
  return snapshot.hasToolbar ? (
    <div aria-label="Table toolbar" className={reserveEndSpace ? "pe-28" : undefined} role="region">
      {snapshot.children}
    </div>
  ) : null;
});

const GridOwnedToolRail = memo(function GridOwnedToolRail({
  controls,
}: {
  readonly controls: ReactNode;
}): ReactElement | null {
  if (controls === undefined || controls === null) return null;
  return (
    <aside
      aria-label="Grid tools"
      className="pointer-events-none absolute end-0 top-0 z-20 flex w-28 flex-col items-stretch gap-1 border-s bg-background/95 px-2 py-1"
    >
      <div className="pointer-events-auto">{controls}</div>
    </aside>
  );
});

const BrunoTableSortPanel = memo(function BrunoTableSortPanel({
  columns,
  reserveEndSpace,
  runtime,
  tableId,
}: {
  readonly columns: readonly CompiledColumn[];
  readonly reserveEndSpace: boolean;
  readonly runtime: BrunoTableRuntimeView;
  readonly tableId: string;
}) {
  const orderBy = useSyncExternalStore(
    runtime.subscribeSorting,
    runtime.getSortingSnapshot,
    runtime.getSortingSnapshot,
  );
  const groupBy = useSyncExternalStore(
    runtime.subscribeGroupBy,
    runtime.getGroupBySnapshot,
    runtime.getGroupBySnapshot,
  );
  const columnLayout = useSyncExternalStore(
    runtime.subscribeColumnStructure,
    runtime.getColumnStructureSnapshot,
    runtime.getColumnStructureSnapshot,
  );
  const rowsHeaderName = useSyncExternalStore(
    runtime.subscribeInstalledRowsPresentation,
    runtime.getInstalledRowsHeaderNameSnapshot,
    runtime.getInstalledRowsHeaderNameSnapshot,
  );
  const [open, setOpen] = useState(false);
  const sortPanelRootRef = useRef<HTMLDivElement>(null);
  const sortPanelControlRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingSortPanelFocus = useRef<
    | Readonly<{
        readonly focusKey: string;
        readonly initiator: HTMLButtonElement;
      }>
    | undefined
  >(undefined);
  useLayoutEffect(() => {
    const focusRequest = pendingSortPanelFocus.current;
    if (focusRequest === undefined) return;
    let followupFrameId: number | undefined;
    const frameId = requestAnimationFrame(() => {
      followupFrameId = requestAnimationFrame(() => {
        if (pendingSortPanelFocus.current !== focusRequest) return;
        const activeElement = document.activeElement;
        const shouldRecoverFocus =
          !focusRequest.initiator.isConnected &&
          (activeElement === null ||
            activeElement === document.body ||
            activeElement === sortPanelRootRef.current);
        pendingSortPanelFocus.current = undefined;
        if (activeElement === focusRequest.initiator || !shouldRecoverFocus) return;
        const control = sortPanelControlRefs.current.get(focusRequest.focusKey);
        if (control === undefined) return;
        control.focus({ preventScroll: true });
      });
    });
    return () => {
      cancelAnimationFrame(frameId);
      if (followupFrameId !== undefined) cancelAnimationFrame(followupFrameId);
    };
  });
  const visible = new Set(columnLayout.visibleColumnIds);
  const activeGroups = new Set(groupBy);
  const sortableColumns = columns.filter(
    (column) =>
      (groupBy.length === 0 && column.enableSorting !== false) ||
      (groupBy.length > 0 &&
        (activeGroups.has(column.columnId) ||
          (column.kind === "field" &&
            column.aggFunc !== undefined &&
            visible.has(column.columnId)))),
  );
  if (sortableColumns.length === 0) return null;
  const activeIds = new Set(orderBy.map((sort) => sort.columnId));
  const eligibleColumns = [
    ...sortableColumns.filter((column) => !activeIds.has(column.columnId)),
    ...(groupBy.length > 0 && !activeIds.has("COL_ID_BRUNO_TABLE_ROWS")
      ? [{ columnId: "COL_ID_BRUNO_TABLE_ROWS", headerName: rowsHeaderName }]
      : []),
  ];
  const headerName = (columnId: string): string =>
    columnId === "COL_ID_BRUNO_TABLE_ROWS"
      ? rowsHeaderName
      : (sortableColumns.find((column) => column.columnId === columnId)?.headerName ?? columnId);
  const directionLabel = (direction: "asc" | "desc"): "ascending" | "descending" =>
    direction === "asc" ? "ascending" : "descending";

  return (
    <div
      aria-label="Sorting controls"
      className={reserveEndSpace ? "flex items-center py-1 pe-28" : "flex items-center py-1"}
      role="region"
    >
      {__BRUNO_TABLE_TEST_DIAGNOSTICS__ ? (
        <BrunoTableSortPanelCommitDiagnosticProbe commitEvidence={orderBy} tableId={tableId} />
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              aria-label={`Sort rows, ${String(orderBy.length)} active`}
              size="sm"
              type="button"
              variant="outline"
            />
          }
        >
          Sort
          <span aria-hidden="true">{String(orderBy.length)}</span>
        </PopoverTrigger>
        {open ? (
          <PopoverContent ref={sortPanelRootRef} align="start" aria-label="Sort rows" role="dialog">
            <PopoverHeader>
              <PopoverTitle>Sort rows</PopoverTitle>
              <PopoverDescription>
                Change direction and priority. At least one sort always remains active.
              </PopoverDescription>
            </PopoverHeader>
            <ol aria-label="Active sorts" className="flex flex-col gap-2" role="list">
              {orderBy.map((sort, index) => {
                const name = headerName(sort.columnId);
                const direction = directionLabel(sort.direction);
                return (
                  <li
                    key={sort.columnId}
                    aria-label={`Priority ${String(index + 1)}, ${name}, ${direction}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] items-center gap-1 rounded-md border border-border p-1.5"
                  >
                    <span className="min-w-0 truncate">
                      <span aria-hidden="true">{String(index + 1)}. </span>
                      {name}
                    </span>
                    <Button
                      ref={(control) => {
                        const focusKey = `direction:${sort.columnId}`;
                        if (control === null) sortPanelControlRefs.current.delete(focusKey);
                        else sortPanelControlRefs.current.set(focusKey, control);
                      }}
                      aria-label={`Toggle ${name} direction, currently ${direction}`}
                      size="xs"
                      type="button"
                      variant="outline"
                      onClick={() =>
                        runtime.dispatchGridCommand({
                          type: "column.sort.toggle",
                          columnId: sort.columnId,
                          multi: true,
                        })
                      }
                    >
                      {sort.direction === "asc" ? "Ascending" : "Descending"}
                    </Button>
                    <Button
                      ref={(control) => {
                        const focusKey = `earlier:${sort.columnId}`;
                        if (control === null) sortPanelControlRefs.current.delete(focusKey);
                        else sortPanelControlRefs.current.set(focusKey, control);
                      }}
                      aria-label={`Move ${name} earlier`}
                      aria-disabled={index === 0}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                      onClick={(event) => {
                        if (index === 0) return;
                        pendingSortPanelFocus.current = Object.freeze({
                          focusKey: `earlier:${sort.columnId}`,
                          initiator: event.currentTarget,
                        });
                        runtime.dispatchGridCommand({
                          type: "sorting.move",
                          columnId: sort.columnId,
                          targetIndex: index - 1,
                        });
                      }}
                    >
                      <span aria-hidden="true">↑</span>
                    </Button>
                    <Button
                      ref={(control) => {
                        const focusKey = `later:${sort.columnId}`;
                        if (control === null) sortPanelControlRefs.current.delete(focusKey);
                        else sortPanelControlRefs.current.set(focusKey, control);
                      }}
                      aria-label={`Move ${name} later`}
                      aria-disabled={index === orderBy.length - 1}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                      onClick={(event) => {
                        if (index === orderBy.length - 1) return;
                        pendingSortPanelFocus.current = Object.freeze({
                          focusKey: `later:${sort.columnId}`,
                          initiator: event.currentTarget,
                        });
                        runtime.dispatchGridCommand({
                          type: "sorting.move",
                          columnId: sort.columnId,
                          targetIndex: index + 1,
                        });
                      }}
                    >
                      <span aria-hidden="true">↓</span>
                    </Button>
                    <Button
                      aria-label={`Remove ${name}`}
                      disabled={orderBy.length === 1}
                      size="xs"
                      type="button"
                      variant="ghost"
                      onClick={(event) => {
                        const survivor = orderBy[index + 1] ?? orderBy[index - 1];
                        if (survivor !== undefined) {
                          pendingSortPanelFocus.current = Object.freeze({
                            focusKey: `direction:${survivor.columnId}`,
                            initiator: event.currentTarget,
                          });
                        }
                        runtime.dispatchGridCommand({
                          type: "sorting.remove",
                          columnId: sort.columnId,
                        });
                      }}
                    >
                      Remove
                    </Button>
                  </li>
                );
              })}
            </ol>
            <div className="flex items-center justify-between gap-2">
              <NativeSelect
                aria-label="Add sort column"
                disabled={eligibleColumns.length === 0}
                size="sm"
                value=""
                onChange={(event) => {
                  const columnId = event.currentTarget.value;
                  if (columnId.length === 0) return;
                  runtime.dispatchGridCommand({ type: "sorting.add", columnId });
                }}
              >
                <NativeSelectOption value="">Add sort</NativeSelectOption>
                {eligibleColumns.map((column) => (
                  <NativeSelectOption key={column.columnId} value={column.columnId}>
                    {column.headerName}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button
                aria-label="Reset sorting"
                size="sm"
                type="button"
                variant="outline"
                onClick={() => runtime.dispatchGridCommand({ type: "sorting.reset" })}
              >
                Reset
              </Button>
            </div>
          </PopoverContent>
        ) : null}
      </Popover>
    </div>
  );
});

type RuntimeProps = {
  readonly runtime: BrunoTableRuntimeView;
  readonly focusFallback: () => void;
};

function SourceLifecycle({ runtime, focusFallback }: RuntimeProps) {
  const chrome = useSyncExternalStore(
    runtime.subscribeChrome,
    runtime.getChromeSnapshot,
    runtime.getChromeSnapshot,
  );

  if (chrome.invalid?.kind === "row-count-mismatch" && chrome.status !== "stale") {
    return (
      <Alert variant="destructive">
        <AlertTitle>Incomplete source</AlertTitle>
        <AlertDescription>
          Expected {String(chrome.invalid.expectedRows)} rows but received{" "}
          {String(chrome.invalid.receivedRows)}.
        </AlertDescription>
      </Alert>
    );
  }

  if (chrome.status === "stale") {
    return (
      <LifecycleAlert
        title="Live data delayed"
        {...lifecycleDetails(chrome.message, chrome.statusCode, chrome.invalid)}
        focusFallback={focusFallback}
      />
    );
  }
  if (chrome.status === "closed" && chrome.hasCoherentRows) {
    return (
      <LifecycleAlert
        title="Live updates stopped"
        {...lifecycleDetails(chrome.message, chrome.statusCode, chrome.invalid)}
        {...(chrome.retry === undefined ? {} : { retry: chrome.retry })}
        onRetry={runtime.retry}
        focusFallback={focusFallback}
      />
    );
  }
  if (chrome.status === "error" && chrome.hasCoherentRows) {
    return (
      <LifecycleAlert
        title="Live data error"
        destructive
        {...lifecycleDetails(chrome.message, chrome.statusCode, chrome.invalid)}
        {...(chrome.retry === undefined ? {} : { retry: chrome.retry })}
        onRetry={runtime.retry}
        focusFallback={focusFallback}
      />
    );
  }
  if (
    (chrome.invalid?.kind === "invalid-value" || chrome.invalid?.kind === "invalid-group") &&
    chrome.status !== "closed" &&
    chrome.status !== "error"
  ) {
    return (
      <Alert variant="destructive">
        <AlertTitle>
          {chrome.invalid.kind === "invalid-group"
            ? "Invalid grouped result"
            : "Invalid source value"}
        </AlertTitle>
        <AlertDescription>{invalidSourceDetails(chrome.invalid)}</AlertDescription>
      </Alert>
    );
  }
  return null;
}

function lifecycleDetails(
  message: string | undefined,
  statusCode: string | undefined,
  invalid: BrunoTableChromeSnapshot["invalid"],
) {
  const details = [message, statusCode, invalidSourceDetails(invalid)].filter(
    (detail): detail is string => detail !== undefined && detail.length > 0,
  );
  return details.length === 0 ? {} : { message: details.join(" · ") };
}

function LifecycleAlert({
  title,
  message,
  destructive = false,
  retry,
  onRetry,
  focusFallback,
}: {
  readonly title: string;
  readonly message?: string;
  readonly destructive?: boolean;
  readonly retry?: { readonly pending: boolean };
  readonly onRetry?: () => void;
  readonly focusFallback: () => void;
}) {
  return (
    <Alert variant={destructive ? "destructive" : "default"}>
      <AlertTitle>{title}</AlertTitle>
      {message !== undefined ? <AlertDescription>{message}</AlertDescription> : null}
      {retry !== undefined && onRetry !== undefined ? (
        <FocusFallbackOnUnmount focusFallback={focusFallback}>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={retry.pending}
            focusableWhenDisabled
            onClick={onRetry}
          >
            {retry.pending ? <Spinner data-icon="inline-start" /> : null}
            Retry
          </Button>
        </FocusFallbackOnUnmount>
      ) : null}
    </Alert>
  );
}

type BrunoTableGridBodyProps<TRuntime extends BrunoTableRuntimeView, TAdapter> = {
  readonly runtime: TRuntime;
  readonly tableId: string;
  readonly compiledColumns: readonly CompiledColumn[];
  readonly focusFallback: () => void;
  readonly rowPipeline: ComponentType<BrunoTableRowPipelineProps<TRuntime, TAdapter>>;
  readonly rowPipelineAdapter: TAdapter;
  readonly renderColumnFilter?: BrunoTableColumnFilterRenderer | undefined;
  readonly enableActiveCellCopy: boolean;
  readonly rowSelection?: BrunoTableRowSelectionRuntime | undefined;
  readonly cellRange?: BrunoTableCellRangeRuntime | undefined;
};

function BrunoTableGridBody<TRuntime extends BrunoTableRuntimeView, TAdapter>({
  runtime,
  tableId,
  compiledColumns,
  focusFallback,
  rowPipeline: RowPipeline,
  rowPipelineAdapter,
  renderColumnFilter,
  enableActiveCellCopy,
  rowSelection,
  cellRange,
}: BrunoTableGridBodyProps<TRuntime, TAdapter>) {
  const [navigation] = useState(() => new BrunoTableNavigationRuntime());
  const [focusHandoff] = useState(() => new BrunoTableBodyFocusHandoff());
  const body = useSyncExternalStore(
    runtime.subscribeBody,
    runtime.getBodySnapshot,
    runtime.getBodySnapshot,
  );
  const emptyCellRangeStructure = useMemo(
    () =>
      createBrunoTableCellRangeStructure(
        [],
        compiledColumns.map(({ columnId }) => columnId),
      ),
    [compiledColumns],
  );
  useLayoutEffect(() => {
    if (body.kind !== "rows" && body.kind !== "loading") {
      navigation.setShape([], compiledColumns);
      focusHandoff.clear();
    }
  }, [body.kind, compiledColumns, focusHandoff, navigation]);
  useLayoutEffect(() => {
    if (body.kind !== "rows") cellRange?.reconcile(emptyCellRangeStructure);
  }, [body.kind, cellRange, emptyCellRangeStructure]);
  if (body.kind === "loading") {
    return (
      <LoadingRows
        runtime={runtime}
        totalRows={body.totalRows}
        compiledColumns={compiledColumns}
        focusFallback={focusFallback}
        focusHandoff={focusHandoff}
        tableId={tableId}
        rowSelection={rowSelection}
      />
    );
  }
  const rowPipeline = (
    <RowPipeline
      key="row-pipeline"
      runtime={runtime}
      tableId={tableId}
      columns={compiledColumns}
      rowPipelineAdapter={rowPipelineAdapter}
      rowSelection={rowSelection}
      cellRange={cellRange}
    >
      {(snapshot) =>
        body.kind === "empty" || body.kind === "invalid" ? (
          <></>
        ) : snapshot.kind === "invalid" ? (
          <>
            <BrunoTableCellRangeProjectionReset
              cellRange={cellRange}
              structure={emptyCellRangeStructure}
            />
            <Alert variant="destructive">
              <AlertTitle>Invalid source value</AlertTitle>
              <AlertDescription>{invalidSourceDetails(snapshot.invalid)}</AlertDescription>
            </Alert>
          </>
        ) : (
          <BrunoTableViewportAdapter
            tableId={tableId}
            rowSpace={snapshot.rowSpace}
            runtime={snapshot.runtime}
            columns={snapshot.columns}
            focusFallback={focusFallback}
            focusHandoff={focusHandoff}
            navigation={navigation}
            queryGeneration={snapshot.queryGeneration}
            queryNavigationMode={snapshot.queryNavigationMode}
            loading={snapshot.loading}
            renderColumnFilter={renderColumnFilter}
            enableActiveCellCopy={enableActiveCellCopy}
            rowSelection={rowSelection}
            cellRange={cellRange}
          />
        )
      }
    </RowPipeline>
  );
  return (
    <>
      {body.kind === "empty" ? (
        <EmptySourceBody key="empty-source" runtime={runtime} focusFallback={focusFallback} />
      ) : null}
      {rowPipeline}
    </>
  );
}

function BrunoTableCellRangeProjectionReset({
  cellRange,
  structure,
}: {
  readonly cellRange: BrunoTableCellRangeRuntime | undefined;
  readonly structure: ReturnType<typeof createBrunoTableCellRangeStructure>;
}): null {
  useLayoutEffect(() => {
    cellRange?.reconcile(structure);
  }, [cellRange, structure]);
  return null;
}

class BrunoTableBodyFocusHandoff {
  private pending = false;

  public readonly release = (): void => {
    this.pending = true;
  };

  public readonly claim = (): boolean => {
    if (!this.pending) return false;
    this.pending = false;
    return true;
  };

  public readonly clear = (): void => {
    this.pending = false;
  };
}

const EmptySourceBody = memo(function EmptySourceBody({ runtime, focusFallback }: RuntimeProps) {
  const chrome = useSyncExternalStore(
    runtime.subscribeChrome,
    runtime.getChromeSnapshot,
    runtime.getChromeSnapshot,
  );
  const title = emptyTitle(chrome.status);
  const announcement =
    chrome.status === "closed" ? "status" : chrome.status === "error" ? "alert" : "region";
  const retry = chrome.status === "closed" || chrome.status === "error" ? chrome.retry : undefined;
  return (
    <Empty
      aria-label={announcement === "region" ? title : undefined}
      className={announcement === "alert" ? "border-destructive text-destructive" : undefined}
      role={announcement}
    >
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>
          {emptyDescription(chrome) ?? "No rows are available for this table."}
        </EmptyDescription>
      </EmptyHeader>
      {retry !== undefined ? (
        <EmptyContent>
          <FocusFallbackOnUnmount focusFallback={focusFallback}>
            <Button
              type="button"
              variant="outline"
              disabled={retry.pending}
              focusableWhenDisabled
              onClick={runtime.retry}
            >
              {retry.pending ? <Spinner data-icon="inline-start" /> : null}
              Retry
            </Button>
          </FocusFallbackOnUnmount>
        </EmptyContent>
      ) : null}
    </Empty>
  );
});

function emptyTitle(status: BrunoTableChromeSnapshot["status"]): string {
  if (status === "closed") return "Live updates stopped";
  if (status === "error") return "Live data error";
  return "No rows";
}

function emptyDescription(chrome: BrunoTableChromeSnapshot): string | undefined {
  const details = [chrome.message, chrome.statusCode, invalidSourceDetails(chrome.invalid)].filter(
    (detail): detail is string => detail !== undefined && detail.length > 0,
  );
  return details.length === 0 ? undefined : details.join(" · ");
}

function invalidSourceDetails(invalid: BrunoTableChromeSnapshot["invalid"]): string | undefined {
  if (invalid?.kind === "invalid-value") {
    return `Source row ${String(invalid.rowIndex + 1)}, column ${invalid.columnId}: ${invalid.message}`;
  }
  if (invalid?.kind === "invalid-group") {
    return `Grouped result, column ${invalid.columnId}: ${invalid.message}`;
  }
  return invalid?.kind === "invalid-status"
    ? `Unsupported source status: ${invalid.receivedStatus}.`
    : invalid?.kind === "invalid-lifecycle"
      ? `Unreadable Client Source lifecycle field: ${invalid.field}.`
      : invalid?.kind === "invalid-rows"
        ? `Invalid Client Source rows: ${invalid.receivedRows}.`
        : invalid?.kind === "row-count-mismatch"
          ? `Expected ${String(invalid.expectedRows)} rows but received ${String(invalid.receivedRows)}.`
          : undefined;
}

function FocusFallbackOnUnmount({
  children,
  focusFallback,
}: {
  readonly children: ReactNode;
  readonly focusFallback: () => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    return () => {
      const activeElement = root?.ownerDocument.activeElement;
      if (
        root !== null &&
        activeElement !== undefined &&
        activeElement !== null &&
        root.contains(activeElement)
      ) {
        focusFallback();
      }
    };
  }, [focusFallback]);
  return (
    <span ref={ref} style={{ display: "contents" }}>
      {children}
    </span>
  );
}

type BrunoTableViewportAdapterProps = {
  readonly tableId: string;
  readonly rowSpace: BrunoTableLogicalRowSpace;
  readonly runtime: BrunoTableRuntimeView;
  readonly columns: readonly CompiledColumn[];
  readonly focusFallback: () => void;
  readonly focusHandoff: BrunoTableBodyFocusHandoff;
  readonly navigation: BrunoTableNavigationRuntime;
  readonly queryGeneration: number;
  readonly queryNavigationMode: BrunoTableQueryNavigationMode;
  readonly loading: boolean;
  readonly renderColumnFilter?: BrunoTableColumnFilterRenderer | undefined;
  readonly enableActiveCellCopy: boolean;
  readonly rowSelection?: BrunoTableRowSelectionRuntime | undefined;
  readonly cellRange?: BrunoTableCellRangeRuntime | undefined;
};

export const BrunoTableViewportAdapter: NamedExoticComponent<BrunoTableViewportAdapterProps> = memo(
  function BrunoTableViewportAdapter({
    tableId,
    rowSpace,
    runtime,
    columns,
    focusFallback,
    focusHandoff,
    navigation,
    queryGeneration,
    queryNavigationMode,
    loading,
    renderColumnFilter,
    enableActiveCellCopy,
    rowSelection,
    cellRange,
  }: BrunoTableViewportAdapterProps): ReactElement {
    const installedProjection = useSyncExternalStore(
      runtime.subscribeInstalledClientProjection,
      runtime.getInstalledClientProjectionSnapshot,
      runtime.getInstalledClientProjectionSnapshot,
    );
    const installedRowSpace = installedProjection?.rowSpace ?? rowSpace;
    const installedColumns = installedProjection?.columns ?? columns;
    const installedQueryGeneration = installedProjection?.queryGeneration ?? queryGeneration;
    const installedQueryNavigationMode =
      installedProjection?.queryNavigationMode ?? queryNavigationMode;
    const projectionLayoutKey =
      installedProjection?.layoutKey ?? BRUNO_TABLE_RAW_CLIENT_PROJECTION_LAYOUT_KEY;
    const projectedRowSelection =
      installedProjection?.kind === "grouped" ? undefined : rowSelection;
    const viewportLayoutKey = `${projectionLayoutKey}:${
      projectedRowSelection === undefined ? "without-row-selection" : "with-row-selection"
    }`;
    const reconcileRangeAnchorAfterCommittedNavigation = useCallback(
      (activeCell: BrunoTableActiveCell | undefined, logicalColumns: readonly CompiledColumn[]) => {
        if (cellRange === undefined) return;
        const structure = createBrunoTableCellRangeStructureFromRowSpace(
          installedRowSpace,
          logicalColumns.map((column) => column.columnId),
        );
        cellRange.reconcileAfterCommittedNavigation(
          structure,
          activeCell?.region === "body" && activeCell.rowId !== undefined
            ? { rowId: activeCell.rowId, columnId: activeCell.columnId }
            : undefined,
        );
      },
      [cellRange, installedRowSpace],
    );
    return (
      <BrunoTableViewportAdapterBoundary
        key={viewportLayoutKey}
        columns={installedColumns}
        leadingUtilityWidth={projectedRowSelection === undefined ? 0 : ROW_SELECTION_COLUMN_WIDTH}
        navigation={navigation}
        projectionKind={installedProjection?.kind ?? "raw"}
        queryGeneration={installedQueryGeneration}
        queryNavigationMode={installedQueryNavigationMode}
        onCommittedNavigationChange={reconcileRangeAnchorAfterCommittedNavigation}
        rowSpace={installedRowSpace}
        runtime={runtime}
      >
        {(adapter) => (
          <BrunoTableGridSurface
            instanceId={adapter.instanceId}
            tableId={tableId}
            rowSpace={installedRowSpace}
            runtime={runtime}
            columns={adapter.columns}
            allColumns={adapter.columnLayout.allColumns}
            visibleColumnIds={adapter.columnLayout.visibleColumnIds}
            columnLayout={adapter.columnLayout}
            queryGeneration={installedQueryGeneration}
            loading={loading}
            viewportSnapshot={adapter.viewportSnapshot}
            attach={adapter.attach}
            attachBodyLayer={adapter.attachBodyLayer}
            attachRowLayer={adapter.attachRowLayer}
            attachScrollbarOverlay={adapter.attachScrollbarOverlay}
            subscribeViewportEnvironment={adapter.subscribeViewportEnvironment}
            scrollByLogical={adapter.scrollByLogical}
            previewColumnWidth={adapter.previewColumnWidth}
            clearColumnWidthPreview={adapter.clearColumnWidthPreview}
            focusFallback={focusFallback}
            focusHandoff={focusHandoff}
            navigation={navigation}
            revealCell={adapter.revealCell}
            renderColumnFilter={renderColumnFilter}
            enableActiveCellCopy={enableActiveCellCopy}
            rowSelection={projectedRowSelection}
            cellRange={cellRange}
          />
        )}
      </BrunoTableViewportAdapterBoundary>
    );
  },
);

const BrunoTableGridSurface = memo(function BrunoTableGridSurface({
  instanceId,
  tableId,
  rowSpace,
  runtime,
  columns,
  allColumns,
  visibleColumnIds,
  columnLayout,
  queryGeneration,
  loading,
  viewportSnapshot,
  attach,
  attachBodyLayer,
  attachRowLayer,
  attachScrollbarOverlay,
  subscribeViewportEnvironment,
  scrollByLogical,
  previewColumnWidth,
  clearColumnWidthPreview,
  focusFallback,
  focusHandoff,
  navigation,
  revealCell,
  renderColumnFilter,
  enableActiveCellCopy,
  rowSelection,
  cellRange,
}: {
  readonly instanceId: string;
  readonly tableId: string;
  readonly rowSpace: BrunoTableLogicalRowSpace;
  readonly runtime: BrunoTableRuntimeView;
  readonly columns: readonly CompiledColumn[];
  /** BrunoTable layout runtime's complete logical projection, including hidden columns. */
  readonly allColumns: readonly CompiledColumn[];
  readonly visibleColumnIds: readonly string[];
  readonly columnLayout: BrunoTableColumnLayoutSnapshot;
  readonly queryGeneration: number;
  readonly loading: boolean;
  readonly viewportSnapshot: BrunoTableViewportSnapshot;
  readonly attach: (element: HTMLElement | null) => void;
  readonly attachBodyLayer: RefCallback<HTMLElement>;
  readonly attachRowLayer: (element: HTMLElement | null) => void;
  readonly attachScrollbarOverlay: (element: HTMLElement | null) => void;
  readonly subscribeViewportEnvironment: (listener: () => void) => () => void;
  readonly scrollByLogical: (delta: number) => boolean;
  readonly previewColumnWidth: (columnId: string, width: number) => void;
  readonly clearColumnWidthPreview: (publishSnapshot?: boolean) => void;
  readonly focusFallback: () => void;
  readonly focusHandoff: BrunoTableBodyFocusHandoff;
  readonly navigation: BrunoTableNavigationRuntime;
  readonly revealCell: (
    rowIndex: number,
    columnId: string,
    region?: "header" | "body",
    rowId?: string,
  ) => void;
  readonly renderColumnFilter?: BrunoTableColumnFilterRenderer | undefined;
  readonly enableActiveCellCopy: boolean;
  readonly rowSelection?: BrunoTableRowSelectionRuntime | undefined;
  readonly cellRange?: BrunoTableCellRangeRuntime | undefined;
}) {
  const virtualWindow = viewportSnapshot.virtualWindow;
  const columnWindow = useMemo<BrunoTableColumnWindow>(
    () =>
      Object.freeze({
        pinnedStart: virtualWindow.pinnedStart,
        center: virtualWindow.center,
        pinnedEnd: virtualWindow.pinnedEnd,
        pinningSuspended: virtualWindow.pinningSuspended,
        centerStartIndex: virtualWindow.centerStartIndex,
        centerCount: virtualWindow.centerCount,
        leftPadding: virtualWindow.leftPadding,
        rightPadding: virtualWindow.rightPadding,
        totalWidth: virtualWindow.totalWidth,
      }),
    [
      virtualWindow.pinnedStart,
      virtualWindow.center,
      virtualWindow.pinnedEnd,
      virtualWindow.pinningSuspended,
      virtualWindow.centerStartIndex,
      virtualWindow.centerCount,
      virtualWindow.leftPadding,
      virtualWindow.rightPadding,
      virtualWindow.totalWidth,
    ],
  );
  const tableWidth = columnWindow.totalWidth;
  const rowSelectionWidth = rowSelection === undefined ? 0 : ROW_SELECTION_COLUMN_WIDTH;
  const viewportFill =
    columnWindow.pinnedEnd.length === 0 ? 0 : Math.max(0, viewportSnapshot.width - tableWidth);
  const renderedTableWidth = tableWidth + viewportFill;
  const logicalColumns = columns;
  const copyEnabled = enableActiveCellCopy || cellRange !== undefined;
  const cellRangeStructure = useMemo(
    () =>
      cellRange === undefined
        ? undefined
        : createBrunoTableCellRangeStructureFromRowSpace(
            rowSpace,
            logicalColumns.map((column) => column.columnId),
          ),
    [cellRange, logicalColumns, rowSpace],
  );
  const columnIndexOffset = rowSelection === undefined ? 0 : 1;
  const gridElement = useRef<HTMLDivElement | null>(null);
  const interactionFrame = useRef<number | null>(null);
  const focusRestoreFrame = useRef<number | null>(null);
  const filterOpenFrame = useRef<number | null>(null);
  const filterOpenToken = useRef(0);
  const copyCommandToken = useRef(0);
  const filterOpenRetry = useRef<() => void>(() => undefined);
  const columnFilterOpeners = useRef(new Map<string, () => void>());
  const columnGesture = useRef<BrunoTableColumnGesture | undefined>(undefined);
  const gestureCancel = useRef<() => void>(() => undefined);
  const columnPointerDownHandler = useRef<BrunoTableColumnPointerDownHandler>(() => undefined);
  const [columnGestureActor] = useState<BrunoTableColumnGestureActor>(() =>
    createBrunoTableColumnGestureActor(),
  );
  const reorderGeometryVersion = useRef(0);
  const previewProperties = useRef<Set<string>>(new Set());
  const reorderTarget = useRef<HTMLElement | null>(null);
  const announcement = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    reorderGeometryVersion.current += 1;
  }, [
    columnWindow.center,
    columnWindow.centerStartIndex,
    columnWindow.leftPadding,
    columnWindow.rightPadding,
    columnWindow.pinnedEnd,
    columnWindow.pinnedStart,
    columnWindow.totalWidth,
  ]);
  useLayoutEffect(() => {
    if (cellRangeStructure !== undefined) cellRange?.reconcile(cellRangeStructure);
  }, [cellRange, cellRangeStructure]);

  const setAnnouncement = useMemo(
    () =>
      (message: string): void => {
        const liveRegion = announcement.current;
        if (liveRegion === null) return;
        liveRegion.textContent = "";
        liveRegion.textContent = message;
      },
    [],
  );

  const restoreColumnFocus = useMemo(
    () =>
      (columnId: string): void => {
        if (focusRestoreFrame.current !== null) {
          cancelAnimationFrame(focusRestoreFrame.current);
        }
        focusRestoreFrame.current = requestAnimationFrame(() => {
          focusRestoreFrame.current = null;
          const header = [
            ...(gridElement.current?.querySelectorAll<HTMLElement>("th[data-bruno-column-id]") ??
              []),
          ].find((candidate) => candidate.dataset["brunoColumnId"] === columnId);
          const trigger = [...(header?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
            (candidate) => candidate.dataset["brunoColumnMenuTrigger"] === columnId,
          );
          if (trigger !== undefined) {
            trigger.focus({ preventScroll: true });
            return;
          }
          const proxy = [
            ...(gridElement.current?.querySelectorAll<HTMLButtonElement>(
              '[data-bruno-active-header-menu-trigger=""]',
            ) ?? []),
          ].find((candidate) => candidate.dataset["brunoColumnMenuTrigger"] === columnId);
          if (proxy !== undefined) {
            proxy.focus({ preventScroll: true });
            return;
          }
          gridElement.current?.focus({ preventScroll: true });
        });
      },
    [],
  );

  const clearReorderTarget = (): void => {
    const target = reorderTarget.current;
    if (target !== null) {
      target.removeAttribute("data-bruno-reorder-target");
      target.style.removeProperty("outline");
      target.style.removeProperty("outline-offset");
    }
    reorderTarget.current = null;
  };

  const clearPreviewStyles = (): void => {
    const grid = gridElement.current;
    if (grid !== null) {
      for (const property of previewProperties.current) grid.style.removeProperty(property);
    }
    previewProperties.current.clear();
    clearReorderTarget();
  };

  const clearReorderPreviewStyles = (geometry: readonly BrunoTableReorderGeometry[]): void => {
    const grid = gridElement.current;
    if (grid === null) return;
    for (const cell of geometry) {
      const column = logicalColumns[cell.columnIndex];
      if (column === undefined) continue;
      const property = brunoTableColumnCssVariable("transform", column.columnId);
      if (previewProperties.current.delete(property)) grid.style.removeProperty(property);
    }
  };

  const writePreviewProperty = (property: string, value: string): void => {
    const grid = gridElement.current;
    if (grid === null) return;
    grid.style.setProperty(property, value);
    if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
      recordBrunoTableClientColumnPreviewStyleWrite(property);
    }
    previewProperties.current.add(property);
  };

  const applyResizePreview = (gesture: BrunoTableColumnGesture): void => {
    const delta = gesture.currentX - gesture.startX;
    const logicalDelta = gesture.direction === "rtl" ? -delta : delta;
    const width = clampBrunoTableColumnWidth(gesture.initialWidth + logicalDelta, {
      min: gesture.minWidth,
      max: gesture.maxWidth,
    });
    previewColumnWidth(gesture.columnId, width);
    gesture.target.setAttribute("aria-valuenow", String(width));
    if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) recordBrunoTableClientColumnResizeFrame();
  };

  const readReorderGeometry = (direction: "ltr" | "rtl"): readonly BrunoTableReorderGeometry[] =>
    Object.freeze(
      [...(gridElement.current?.querySelectorAll<HTMLElement>("th[data-bruno-column-id]") ?? [])]
        .map((element) => {
          const columnIndex = logicalColumns.findIndex(
            (candidate) => candidate.columnId === element.dataset["brunoColumnId"],
          );
          const candidate = logicalColumns[columnIndex];
          if (candidate === undefined) return undefined;
          const rect = element.getBoundingClientRect();
          return Object.freeze({ columnIndex, element, left: rect.left, width: rect.width });
        })
        .filter((value): value is BrunoTableReorderGeometry => value !== undefined)
        .sort((left, right) =>
          direction === "rtl" ? right.left - left.left : left.left - right.left,
        ),
    );

  const resolveReorderTargetPin = (
    gesture: BrunoTableColumnGesture,
    headerCells: readonly BrunoTableReorderGeometry[],
  ): "start" | "end" | undefined => {
    const { left, right } = gesture.reorderCenterBounds;
    if (gesture.currentX < left) return gesture.direction === "rtl" ? "end" : "start";
    if (gesture.currentX > right) return gesture.direction === "rtl" ? "start" : "end";

    const remainingCells = headerCells.filter((cell) => cell.columnIndex !== gesture.sourceIndex);
    if (!remainingCells.some((cell) => logicalColumns[cell.columnIndex]?.pinned === undefined)) {
      // A narrow centreless layout temporarily renders formerly pinned columns
      // in the centre window. Only that suspended projection preserves the
      // source pin; a fitting all-pinned layout keeps the centre gap as the
      // pointer's explicit unpin drop zone.
      return gesture.pinningSuspended ? gesture.sourcePinned : undefined;
    }
    let referenceCell = remainingCells.at(-1);
    for (const cell of remainingCells) {
      if (
        gesture.direction === "rtl"
          ? gesture.currentX > cell.left + cell.width / 2
          : gesture.currentX < cell.left + cell.width / 2
      ) {
        referenceCell = cell;
        break;
      }
    }
    return logicalColumns[referenceCell?.columnIndex ?? gesture.targetIndex]?.pinned;
  };

  const autoScrollReorder = (gesture: BrunoTableColumnGesture): boolean => {
    const { left: centerLeft, right: centerRight } = gesture.reorderCenterBounds;
    const edge = 48;
    const physicalDelta =
      gesture.currentX >= centerLeft && gesture.currentX < centerLeft + edge
        ? -64
        : gesture.currentX <= centerRight && gesture.currentX > centerRight - edge
          ? 64
          : 0;
    if (physicalDelta === 0) return false;
    const logicalDelta = gesture.direction === "rtl" ? -physicalDelta : physicalDelta;
    return scrollByLogical(logicalDelta);
  };

  const applyReorderPreview = (
    gesture: BrunoTableColumnGesture,
    allowAutoScroll = true,
  ): boolean => {
    gesture.reorderPreviewApplied = false;
    const didScroll = allowAutoScroll && autoScrollReorder(gesture);
    let headerCells = gesture.reorderGeometry;
    if (didScroll) {
      // Wait for the viewport's own rAF publication and React layout effect before reading the
      // next geometry. This prevents a mounted-window edge from becoming a logical boundary.
      gesture.reorderGeometryVersion = -1;
      gesture.reorderGeometryVersionBeforeScroll = reorderGeometryVersion.current;
      scheduleGestureFrame();
      return false;
    }
    if (gesture.reorderGeometryVersion === -1) {
      if (
        allowAutoScroll &&
        reorderGeometryVersion.current === gesture.reorderGeometryVersionBeforeScroll
      ) {
        scheduleGestureFrame();
        return false;
      }
      gesture.reorderGeometryVersion = reorderGeometryVersion.current;
      clearReorderPreviewStyles(headerCells);
      headerCells = readReorderGeometry(gesture.direction);
      gesture.reorderGeometry = headerCells;
    } else if (gesture.reorderGeometryVersion !== reorderGeometryVersion.current) {
      clearReorderPreviewStyles(headerCells);
      headerCells = readReorderGeometry(gesture.direction);
      gesture.reorderGeometry = headerCells;
      gesture.reorderGeometryVersion = reorderGeometryVersion.current;
    }
    const pointerX = gesture.currentX;
    const sourceCell = headerCells.find((cell) => cell.columnIndex === gesture.sourceIndex);
    gesture.targetIndex = resolveBrunoTableReorderTargetIndex(
      headerCells,
      pointerX,
      gesture.direction,
      gesture.sourceIndex,
      gesture.groupStart,
      gesture.groupEnd,
    );
    gesture.targetPinned = resolveReorderTargetPin(gesture, headerCells);
    const displacement = gesture.currentX - gesture.startX;
    const sourceWidth = sourceCell?.width ?? gesture.initialWidth;
    for (const cell of headerCells) {
      const column = logicalColumns[cell.columnIndex];
      if (column === undefined) continue;
      const property = brunoTableColumnCssVariable("transform", column.columnId);
      let transform = "none";
      if (cell.columnIndex === gesture.sourceIndex) {
        transform = `translate3d(${String(displacement)}px, 0, 0)`;
      } else {
        const projectedIndex = projectBrunoTableLogicalColumnIndex(
          cell.columnIndex,
          gesture.sourceIndex,
          gesture.targetIndex,
        );
        const logicalShift = projectedIndex - cell.columnIndex;
        if (logicalShift !== 0) {
          const visualShift = gesture.direction === "rtl" ? -logicalShift : logicalShift;
          transform = `translate3d(${String(visualShift * sourceWidth)}px, 0, 0)`;
        }
      }
      writePreviewProperty(property, transform);
    }
    const targetColumn = logicalColumns[gesture.targetIndex];
    const targetCell =
      targetColumn === undefined
        ? null
        : (headerCells.find((cell) => cell.columnIndex === gesture.targetIndex)?.element ?? null);
    clearReorderTarget();
    if (targetCell !== null && targetCell !== gesture.target) {
      targetCell.setAttribute("data-bruno-reorder-target", "");
      targetCell.style.setProperty("outline", "2px dashed CanvasText");
      targetCell.style.setProperty("outline-offset", "-2px");
      reorderTarget.current = targetCell;
    } else {
      reorderTarget.current = null;
    }
    if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) recordBrunoTableClientColumnReorderFrame();
    gesture.reorderPreviewApplied = true;
    return true;
  };

  const scheduleGestureFrame = (): void => {
    const gesture = columnGesture.current;
    if (gesture === undefined || gesture.frame !== null) return;
    const measureFrame =
      __BRUNO_TABLE_TEST_DIAGNOSTICS__ && hasBrunoTableClientColumnGestureFrameListener(tableId);
    const frameId = requestAnimationFrame(() => {
      const startedAt = measureFrame ? performance.now() : undefined;
      gesture.frame = null;
      if (columnGesture.current === gesture) {
        if (gesture.kind === "resize") {
          applyResizePreview(gesture);
          gesture.previewedX = gesture.currentX;
        } else if (applyReorderPreview(gesture)) {
          gesture.previewedX = gesture.currentX;
        }
      }
      if (startedAt !== undefined) {
        recordBrunoTableClientColumnGestureFrame(tableId, {
          phase: "ran",
          kind: gesture.kind,
          frameId,
          durationMs: performance.now() - startedAt,
        });
      }
    });
    gesture.frame = frameId;
    if (measureFrame) {
      recordBrunoTableClientColumnGestureFrame(tableId, {
        phase: "scheduled",
        kind: gesture.kind,
        frameId,
      });
    }
  };

  const finishColumnGesture = (commit: boolean): void => {
    const gesture = columnGesture.current;
    if (gesture === undefined) return;
    if (columnGestureActor.getSnapshot().value !== "active") return;
    columnGestureActor.send({ type: commit ? "COMMIT" : "CANCEL" });
    if (columnGestureActor.getSnapshot().value !== "idle") return;
    const needsSynchronousFinalPreview =
      commit &&
      (gesture.previewedX !== gesture.currentX ||
        (gesture.kind === "reorder" && !gesture.reorderPreviewApplied));
    if (needsSynchronousFinalPreview) {
      const measureSynchronousWork =
        __BRUNO_TABLE_TEST_DIAGNOSTICS__ && hasBrunoTableClientColumnGestureFrameListener(tableId);
      const startedAt = measureSynchronousWork ? performance.now() : undefined;
      if (gesture.kind === "resize") applyResizePreview(gesture);
      else if (applyReorderPreview(gesture, false)) gesture.previewedX = gesture.currentX;
      if (startedAt !== undefined) {
        recordBrunoTableClientColumnGestureFrame(tableId, {
          phase: "synchronous",
          kind: gesture.kind,
          durationMs: performance.now() - startedAt,
        });
      }
    }
    if (gesture.frame !== null) {
      const frameId = gesture.frame;
      cancelAnimationFrame(frameId);
      if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
        recordBrunoTableClientColumnGestureFrame(tableId, {
          phase: "cancelled",
          kind: gesture.kind,
          frameId,
        });
      }
    }
    gesture.frame = null;
    window.removeEventListener("pointermove", gesture.onPointerMove, true);
    if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
      recordBrunoTableClientColumnGestureListener(tableId, {
        phase: "detach",
        event: "pointermove",
      });
    }
    window.removeEventListener("pointerup", gesture.onPointerUp, true);
    if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
      recordBrunoTableClientColumnGestureListener(tableId, {
        phase: "detach",
        event: "pointerup",
      });
    }
    window.removeEventListener("pointercancel", gesture.onPointerCancel, true);
    if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
      recordBrunoTableClientColumnGestureListener(tableId, {
        phase: "detach",
        event: "pointercancel",
      });
    }
    try {
      if (gesture.target.hasPointerCapture?.(gesture.pointerId)) {
        gesture.target.releasePointerCapture?.(gesture.pointerId);
      }
    } catch {
      // Synthetic browser tests may not have a native pointer capture to release.
    }
    columnGesture.current = undefined;
    if (gesture.kind === "resize") {
      const delta = gesture.currentX - gesture.startX;
      const logicalDelta = gesture.direction === "rtl" ? -delta : delta;
      const width = clampBrunoTableColumnWidth(gesture.initialWidth + logicalDelta, {
        min: gesture.minWidth,
        max: gesture.maxWidth,
      });
      const widthChanged = width !== gesture.initialWidth;
      clearColumnWidthPreview(commit && widthChanged ? false : true);
      if (commit && widthChanged) {
        runtime.dispatchGridCommand({
          type: "column.resize.commit",
          columnId: gesture.columnId,
          width,
        });
      }
      const settledWidth = runtime.getColumnCommandSnapshot(gesture.columnId).width;
      gesture.target.setAttribute("aria-valuenow", String(settledWidth));
      if (commit) {
        setAnnouncement(
          `${columnHeaderName(columns, gesture.columnId)} width ${String(settledWidth)} pixels`,
        );
      }
    } else if (
      commit &&
      (gesture.targetIndex !== gesture.sourceIndex || gesture.targetPinned !== gesture.sourcePinned)
    ) {
      runtime.dispatchGridCommand({
        type: "column.reorder.commit",
        columnId: gesture.columnId,
        targetIndex: gesture.targetIndex,
        pinned: gesture.targetPinned,
      });
      const settledIndex = runtime
        .getColumnLayoutSnapshot()
        .visibleColumnIds.indexOf(gesture.columnId);
      setAnnouncement(
        `${columnHeaderName(columns, gesture.columnId)} position ${String(settledIndex + 1)} of ${String(logicalColumns.length)}`,
      );
    }
    if (gesture.kind === "reorder") restoreColumnFocus(gesture.columnId);
    clearPreviewStyles();
    if (!commit) setAnnouncement("Column layout change cancelled");
  };
  const onColumnPointerMove = (event: globalThis.PointerEvent): void => {
    const gesture = columnGesture.current;
    if (gesture === undefined || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    gesture.currentX = event.clientX;
    scheduleGestureFrame();
  };
  const onColumnPointerUp = (event: globalThis.PointerEvent): void => {
    const gesture = columnGesture.current;
    if (gesture === undefined || event.pointerId !== gesture.pointerId) return;
    gesture.currentX = event.clientX;
    finishColumnGesture(true);
  };
  const onColumnPointerCancel = (event: globalThis.PointerEvent): void => {
    const gesture = columnGesture.current;
    if (gesture === undefined || event.pointerId !== gesture.pointerId) return;
    finishColumnGesture(false);
  };
  const startColumnGesture = (
    event: ReactPointerEvent<HTMLElement>,
    column: CompiledColumn,
    kind: "resize" | "reorder",
  ): void => {
    if (
      event.button !== 0 ||
      columnGesture.current !== undefined ||
      columnGestureActor.getSnapshot().status !== "active" ||
      columnGestureActor.getSnapshot().value !== "idle"
    )
      return;
    event.preventDefault();
    const target = event.currentTarget;
    navigation.activateHeader(column.columnId);
    target.focus({ preventScroll: true });
    try {
      target.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic browser tests can dispatch a pointer without a native active pointer.
      // Real pointer input still receives capture before the rAF preview begins.
    }
    const direction =
      getComputedStyle(gridElement.current ?? target).direction === "rtl" ? "rtl" : "ltr";
    const sourceIndex = logicalColumns.findIndex(
      (candidate) => candidate.columnId === column.columnId,
    );
    const reorderGeometry = readReorderGeometry(direction);
    const grid = gridElement.current;
    const gridRect = grid?.getBoundingClientRect();
    const pinnedStartRects = [
      ...(grid?.querySelectorAll<HTMLElement>(
        'th[data-bruno-column-id][data-pinned-region="start"]',
      ) ?? []),
    ].map((element) => element.getBoundingClientRect());
    const pinnedEndRects = [
      ...(grid?.querySelectorAll<HTMLElement>(
        'th[data-bruno-column-id][data-pinned-region="end"]',
      ) ?? []),
    ].map((element) => element.getBoundingClientRect());
    const leftPinnedRects = direction === "rtl" ? pinnedEndRects : pinnedStartRects;
    const rightPinnedRects = direction === "rtl" ? pinnedStartRects : pinnedEndRects;
    const selectionRect = grid
      ?.querySelector<HTMLElement>(
        `th[data-bruno-column-id="${BRUNO_TABLE_ROW_SELECTION_COLUMN_ID}"]`,
      )
      ?.getBoundingClientRect();
    const reorderCenterBounds = resolveBrunoTableReorderCenterBounds(
      direction,
      gridRect ?? { left: 0, right: 0 },
      leftPinnedRects,
      rightPinnedRects,
      selectionRect,
    );
    columnGesture.current = {
      kind,
      pointerId: event.pointerId,
      columnId: column.columnId,
      sourceIndex,
      startX: event.clientX,
      initialWidth: column.semantics.width,
      minWidth: runtime.getColumnCommandSnapshot(column.columnId).minWidth,
      maxWidth: runtime.getColumnCommandSnapshot(column.columnId).maxWidth,
      direction,
      sourcePinned: column.pinned,
      pinningSuspended: columnWindow.pinningSuspended,
      groupStart: 0,
      groupEnd: Math.max(0, logicalColumns.length - 1),
      target,
      onPointerMove: onColumnPointerMove,
      onPointerUp: onColumnPointerUp,
      onPointerCancel: onColumnPointerCancel,
      reorderGeometry,
      reorderGeometryVersion: reorderGeometryVersion.current,
      reorderGeometryVersionBeforeScroll: reorderGeometryVersion.current,
      reorderCenterBounds,
      currentX: event.clientX,
      previewedX: undefined,
      reorderPreviewApplied: false,
      targetIndex: sourceIndex,
      targetPinned: column.pinned,
      frame: null,
    };
    columnGestureActor.send({ type: "START", kind });
    window.addEventListener("pointermove", columnGesture.current.onPointerMove, true);
    if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
      recordBrunoTableClientColumnGestureListener(tableId, {
        phase: "attach",
        event: "pointermove",
      });
    }
    window.addEventListener("pointerup", columnGesture.current.onPointerUp, true);
    if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
      recordBrunoTableClientColumnGestureListener(tableId, {
        phase: "attach",
        event: "pointerup",
      });
    }
    window.addEventListener("pointercancel", columnGesture.current.onPointerCancel, true);
    if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
      recordBrunoTableClientColumnGestureListener(tableId, {
        phase: "attach",
        event: "pointercancel",
      });
    }
    if (kind === "resize") {
      writePreviewProperty(
        brunoTableColumnCssVariable("width", column.columnId),
        `${column.semantics.width}px`,
      );
      setAnnouncement(`Resizing ${column.headerName}`);
    } else {
      setAnnouncement(`Reordering ${column.headerName}`);
    }
  };

  useEffect(() => {
    gestureCancel.current = () => finishColumnGesture(false);
    columnPointerDownHandler.current = startColumnGesture;
  });
  useEffect(() => {
    columnGestureActor.start();
    return () => {
      gestureCancel.current();
      columnGestureActor.stop();
    };
  }, [columnGestureActor]);
  useEffect(
    () =>
      subscribeViewportEnvironment(() => {
        gestureCancel.current();
      }),
    [subscribeViewportEnvironment],
  );
  useEffect(
    () =>
      runtime.subscribeChrome(() => {
        const status = runtime.getChromeSnapshot().status;
        if (status === "stale" || status === "closed" || status === "error") {
          gestureCancel.current();
        }
      }),
    [runtime],
  );
  const gestureShapeRef = useRef<
    | {
        readonly columns: readonly CompiledColumn[];
        readonly layoutVersion: number;
        readonly queryGeneration: number;
        readonly totalRows: number;
      }
    | undefined
  >(undefined);
  useEffect(() => {
    const previous = gestureShapeRef.current;
    const next = Object.freeze({
      columns: logicalColumns,
      layoutVersion: columnLayout.version,
      queryGeneration,
      totalRows: rowSpace.totalRows,
    });
    if (
      previous !== undefined &&
      (previous.columns !== next.columns ||
        previous.layoutVersion !== next.layoutVersion ||
        previous.queryGeneration !== next.queryGeneration ||
        previous.totalRows !== next.totalRows)
    ) {
      gestureCancel.current();
    }
    gestureShapeRef.current = next;
  }, [columnLayout.version, logicalColumns, queryGeneration, rowSpace.totalRows]);
  const onColumnPointerDown = useMemo<BrunoTableColumnPointerDownHandler>(
    () => (event, column, kind) => columnPointerDownHandler.current(event, column, kind),
    [],
  );
  const attachGrid = useMemo(
    () => (element: HTMLDivElement | null) => {
      const previousGrid = gridElement.current;
      const activeElement = previousGrid?.ownerDocument.activeElement;
      if (
        element === null &&
        previousGrid !== null &&
        activeElement !== undefined &&
        activeElement !== null &&
        previousGrid.contains(activeElement)
      ) {
        focusHandoff.release();
        focusFallback();
      }
      gridElement.current = element;
      cellRange?.attachGrid(element);
      attach(element);
      if (element !== null && focusHandoff.claim()) element.focus({ preventScroll: true });
    },
    [attach, cellRange, focusFallback, focusHandoff],
  );
  const attachBodyLayerWithFocusHandoff = useMemo<RefCallback<HTMLElement>>(
    () => (element) => {
      const detach = attachBodyLayer(element);
      if (element === null) return detach;
      return () => {
        const activeElement = element.ownerDocument.activeElement;
        if (activeElement !== null && element.contains(activeElement)) {
          gridElement.current?.focus({ preventScroll: true });
        }
        detach?.();
      };
    },
    [attachBodyLayer],
  );
  const activateHeaderCommand = useMemo(
    () => (columnId: string) => {
      navigation.activateHeader(columnId);
      gridElement.current?.focus({ preventScroll: true });
    },
    [navigation],
  );
  const registerColumnFilterOpener = useCallback(
    (columnId: string, open: () => void): (() => void) => {
      columnFilterOpeners.current.set(columnId, open);
      return () => {
        if (columnFilterOpeners.current.get(columnId) === open) {
          columnFilterOpeners.current.delete(columnId);
        }
      };
    },
    [],
  );
  const requestColumnFilterOpen = useCallback((columnId: string): boolean => {
    const open = columnFilterOpeners.current.get(columnId);
    if (open === undefined) return false;
    open();
    return true;
  }, []);
  const cancelFilterOpenRetry = useCallback((): void => {
    filterOpenToken.current += 1;
    filterOpenRetry.current = () => undefined;
    if (filterOpenFrame.current !== null) {
      cancelAnimationFrame(filterOpenFrame.current);
      filterOpenFrame.current = null;
    }
  }, []);
  const toggleHeaderSort = useMemo(
    () =>
      (columnId: string, multi: boolean): void => {
        const accepted = runtime.dispatchGridCommand({
          type: "column.sort.toggle",
          columnId,
          multi,
        });
        if (!accepted) return;
        const next = runtime.getColumnCommandSnapshot(columnId);
        const column = logicalColumns.find((candidate) => candidate.columnId === columnId);
        if (column === undefined) return;
        setAnnouncement(columnSortAnnouncement(column.headerName, next));
      },
    [logicalColumns, runtime, setAnnouncement],
  );
  const toggleHeaderFilter = useMemo(
    () =>
      (columnId: string): void => {
        const command = runtime.getColumnCommandSnapshot(columnId);
        const column = logicalColumns.find((candidate) => candidate.columnId === columnId);
        if (column === undefined) return;
        const action = command.filterActive ? "cleared" : "reset";
        const accepted = runtime.dispatchGridCommand({
          type: command.filterActive ? "column.filter.clear" : "column.filter.reset",
          columnId,
        });
        if (!accepted) return;
        setAnnouncement(`${column.headerName} filter ${action}`);
      },
    [logicalColumns, runtime, setAnnouncement],
  );
  const openHeaderFilter = useMemo(
    () =>
      (columnId: string): void => {
        const column = logicalColumns.find((candidate) => candidate.columnId === columnId);
        if (column === undefined) return;
        cancelFilterOpenRetry();
        if (requestColumnFilterOpen(column.columnId)) return;
        revealCell(0, column.columnId, "header");
        const token = filterOpenToken.current;
        let attemptsRemaining = 4;
        filterOpenRetry.current = (): void => {
          filterOpenFrame.current = null;
          const active = navigation.getSnapshot();
          if (
            token !== filterOpenToken.current ||
            active?.region !== "header" ||
            active.columnId !== column.columnId ||
            !logicalColumns.some((candidate) => candidate.columnId === column.columnId)
          ) {
            return;
          }
          if (requestColumnFilterOpen(column.columnId)) return;
          attemptsRemaining -= 1;
          if (attemptsRemaining > 0) {
            filterOpenFrame.current = requestAnimationFrame(filterOpenRetry.current);
          }
        };
        filterOpenFrame.current = requestAnimationFrame(filterOpenRetry.current);
      },
    [cancelFilterOpenRetry, logicalColumns, navigation, requestColumnFilterOpen, revealCell],
  );
  useEffect(
    () => () => {
      if (interactionFrame.current !== null) cancelAnimationFrame(interactionFrame.current);
      if (focusRestoreFrame.current !== null) cancelAnimationFrame(focusRestoreFrame.current);
      cancelFilterOpenRetry();
      columnFilterOpeners.current.clear();
      focusRestoreFrame.current = null;
      gestureCancel.current();
    },
    [cancelFilterOpenRetry],
  );

  const enterInteractiveCell = (active: BrunoTableActiveCell, column: CompiledColumn): boolean => {
    if (active.region !== "body" || column.cellRenderer === undefined) return false;
    const activeId = activeDomId(instanceId, tableId, active);
    if (activeId === undefined) return false;
    const cell = gridElement.current?.querySelector<HTMLElement>(`#${activeId}`) ?? null;
    if (cell !== null && !cell.hasAttribute("data-bruno-active-proxy")) {
      return focusFirstInteractiveDescendant(cell);
    }
    revealCell(active.rowIndex, active.columnId, active.region, active.rowId);
    if (interactionFrame.current !== null) cancelAnimationFrame(interactionFrame.current);
    let attemptsRemaining = 4;
    const focusAfterMount = () => {
      interactionFrame.current = null;
      const current = navigation.getSnapshot();
      if (
        current?.region !== active.region ||
        current.rowIndex !== active.rowIndex ||
        current.rowId !== active.rowId ||
        current.columnId !== active.columnId
      ) {
        return;
      }
      const mountedCell = gridElement.current?.querySelector<HTMLElement>(`#${activeId}`) ?? null;
      if (
        mountedCell !== null &&
        !mountedCell.hasAttribute("data-bruno-active-proxy") &&
        focusFirstInteractiveDescendant(mountedCell)
      ) {
        return;
      }
      attemptsRemaining -= 1;
      if (attemptsRemaining > 0) interactionFrame.current = requestAnimationFrame(focusAfterMount);
    };
    interactionFrame.current = requestAnimationFrame(focusAfterMount);
    return true;
  };

  const ownsGridSurface = (event: BrunoTableHotkeyGesture): boolean =>
    event.target === gridElement.current;
  const ownsRowSelectionCommand = (event: BrunoTableHotkeyGesture): boolean => {
    const grid = gridElement.current;
    if (grid === null) return false;
    if (event.target === grid) return true;
    if (!isNodeInBrunoTableRealm(grid, event.target)) return false;
    const ElementConstructor = grid.ownerDocument.defaultView?.Element;
    if (ElementConstructor === undefined || !(event.target instanceof ElementConstructor)) {
      return false;
    }
    return (
      event.target.closest("[data-bruno-row-selection-checkbox]")?.closest('[role="grid"]') === grid
    );
  };
  const resolveEventColumn = (event: BrunoTableHotkeyGesture): CompiledColumn | undefined => {
    const target = event.target instanceof Element ? event.target : null;
    const header = target?.closest<HTMLElement>("th[data-bruno-column-id]");
    const columnId = header?.dataset["brunoColumnId"];
    return logicalColumns.find((candidate) => candidate.columnId === columnId);
  };
  const runNavigation = (
    event: BrunoTableHotkeyGesture,
    command: BrunoTableNavigationCommand,
    extendCellRange = false,
  ): void => {
    if (!ownsGridSurface(event)) return;
    event.preventDefault();
    if (cellRange?.isPointerGestureActive() === true) return;
    const currentRange = cellRange?.getSnapshot().range;
    const extendingRange = extendCellRange && cellRange !== undefined;
    if (extendingRange && currentRange !== undefined && cellRangeStructure !== undefined) {
      const rowIndex = cellRangeStructure.rowIndexById.get(currentRange.focus.rowId);
      if (rowIndex !== undefined) {
        navigation.activateBody(rowIndex, currentRange.focus.rowId, currentRange.focus.columnId);
      }
    } else {
      navigation.activateForFocus();
    }
    const current = navigation.getSnapshot();
    if (
      extendingRange &&
      current?.region === "body" &&
      !isBrunoTableCellRangeNavigationCommandAdmitted(currentRange?.axis, command, current.rowIndex)
    ) {
      return;
    }
    const axisProjectedCommand =
      extendingRange && currentRange !== undefined && command.type === "grid-edge"
        ? currentRange.axis === "horizontal"
          ? ({ type: "row-edge", edge: command.edge } as const)
          : ({ type: "column-edge", edge: command.edge } as const)
        : command;
    const effectiveCommand =
      extendingRange && axisProjectedCommand.type === "column-edge"
        ? ({
            type: "page",
            rowDelta:
              axisProjectedCommand.edge === "start" ? -rowSpace.totalRows : rowSpace.totalRows,
          } as const)
        : axisProjectedCommand;
    navigation.navigate(effectiveCommand);
    let next = navigation.getSnapshot();
    if (cellRange !== undefined) {
      if (next?.region === "body" && next.rowId !== undefined && cellRangeStructure !== undefined) {
        if (extendingRange && current?.region === "body" && current.rowId !== undefined) {
          const currentCoordinate = { rowId: current.rowId, columnId: current.columnId };
          const nextCoordinate = { rowId: next.rowId, columnId: next.columnId };
          const selection = cellRange.extendFromCurrent(
            currentCoordinate,
            nextCoordinate,
            cellRangeStructure,
          );
          const focus = selection.range?.focus ?? selection.anchor;
          if (focus !== undefined) {
            const rowIndex = cellRangeStructure.rowIndexById.get(focus.rowId);
            if (rowIndex !== undefined) {
              navigation.activateBody(rowIndex, focus.rowId, focus.columnId);
              next = navigation.getSnapshot();
            }
          }
        } else {
          cellRange.replace({ rowId: next.rowId, columnId: next.columnId }, cellRangeStructure);
        }
      } else {
        cellRange.clear();
      }
    }
    if (next !== undefined) revealCell(next.rowIndex, next.columnId, next.region, next.rowId);
  };
  const runPageNavigation = (
    event: BrunoTableHotkeyGesture,
    direction: -1 | 1,
    extendCellRange = false,
  ): void => {
    const grid = gridElement.current;
    if (grid === null || event.target !== grid) return;
    runNavigation(
      event,
      { type: "page", rowDelta: direction * viewportPageSize(grid) },
      extendCellRange,
    );
  };
  const runCopy = (event: BrunoTableHotkeyGesture): void => {
    if ((!enableActiveCellCopy && cellRange === undefined) || !ownsGridSurface(event)) return;
    const clipboard = navigator.clipboard;
    if (cellRange !== undefined) event.preventDefault();
    const active = navigation.getSnapshot();
    if (cellRangeStructure !== undefined) cellRange?.reconcile(cellRangeStructure);
    const structurallyInvalidated = cellRange?.consumeStructuralInvalidation() === true;
    const selection = cellRange?.getSnapshot() ?? {};
    const activeCoordinate =
      active?.region === "body" && active.rowId !== undefined
        ? { rowId: active.rowId, columnId: active.columnId }
        : undefined;
    const target =
      selection.range !== undefined
        ? clipboardTargetFromRange(selection.range)
        : activeCoordinate === undefined
          ? undefined
          : clipboardTargetFromSelection({}, activeCoordinate);
    if (!structurallyInvalidated && target === undefined) return;
    const copyToken = ++copyCommandToken.current;
    const announceCopy = (message: string): void => {
      if (copyCommandToken.current === copyToken) setAnnouncement(message);
    };
    if (structurallyInvalidated) {
      announceCopy("Copy failed: the selected cells are no longer available");
      return;
    }
    if (clipboard?.writeText === undefined) {
      announceCopy("Copy failed: clipboard access is unavailable");
      return;
    }
    if (target === undefined) return;
    let snapshot: ReturnType<typeof captureBrunoTableClipboardSnapshot>;
    try {
      const readCell = runtime.captureCellCommandReader();
      snapshot = captureBrunoTableClipboardSnapshot(target, ({ rowId, columnId }) => {
        const cell = readCell(rowId, columnId);
        if (
          cell.kind !== "available" ||
          !cell.rowPresent ||
          cell.column === undefined ||
          isBrunoTableInvalidCellValue(cell.value)
        ) {
          return undefined;
        }
        return {
          value: cell.value,
          formatCanonicalText: cell.column.semantics.formatCanonicalText,
        };
      });
    } catch {
      announceCopy("Copy failed: a selected value could not be serialized");
      return;
    }
    if (snapshot === undefined) {
      announceCopy("Copy failed: the selected cells are no longer available");
      return;
    }
    const text = serializeBrunoTableClipboardSnapshot(snapshot);
    event.preventDefault();
    let write: Promise<void>;
    try {
      write = clipboard.writeText(text);
    } catch {
      announceCopy("Copy failed: the browser rejected the clipboard write");
      return;
    }
    void write.then(
      () =>
        announceCopy(
          `${String(snapshot.canonicalTexts.length)} ${snapshot.canonicalTexts.length === 1 ? "cell" : "cells"} copied`,
        ),
      () => announceCopy("Copy failed: the browser rejected the clipboard write"),
    );
  };

  const runCellRangePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (cellRange === undefined || cellRangeStructure === undefined) return;
    const grid = event.currentTarget;
    const ElementConstructor = grid.ownerDocument.defaultView?.Element;
    const target =
      ElementConstructor !== undefined && event.target instanceof ElementConstructor
        ? event.target
        : null;
    const hit = closestBrunoTableCellRangeHit(event.target, grid);
    if (hit === undefined) return;
    const hitCell = target?.closest<HTMLElement>(
      '[role="gridcell"][data-bruno-row-id][data-bruno-row-index][data-bruno-column-id]',
    );
    const excludedDescendant = target?.closest<HTMLElement>(CELL_RANGE_POINTER_EXCLUSION_SELECTOR);
    if (
      hitCell !== null &&
      hitCell !== undefined &&
      excludedDescendant !== null &&
      excludedDescendant !== undefined &&
      excludedDescendant !== hitCell &&
      hitCell.contains(excludedDescendant)
    ) {
      return;
    }
    const horizontalLogicalSign = getComputedStyle(grid).direction === "rtl" ? -1 : 1;
    const activeBefore = navigation.getSnapshot();
    const currentActive =
      activeBefore?.region === "body" && activeBefore.rowId !== undefined
        ? { rowId: activeBefore.rowId, columnId: activeBefore.columnId }
        : undefined;
    cellRange.startPointerGesture(
      event.nativeEvent,
      hit,
      grid,
      (next) => {
        navigation.activateBody(next.rowIndex, next.rowId, next.columnId);
      },
      () => {
        navigation.restoreActiveCell(activeBefore);
      },
      (physicalDelta) => scrollByLogical(horizontalLogicalSign * physicalDelta),
      currentActive,
      isBrunoTableHotkeyHeld("Shift"),
    );
  };
  const runColumnResize = (
    event: BrunoTableHotkeyGesture,
    adjustment: "minimum" | "maximum" | number,
    step: number,
    allowActiveHeader = false,
  ): void => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const separator = target?.closest<HTMLElement>('[role="separator"]') ?? null;
    const active = navigation.getSnapshot();
    const column =
      separator !== null
        ? resolveEventColumn(event)
        : allowActiveHeader && ownsGridSurface(event) && active?.region === "header"
          ? logicalColumns.find((candidate) => candidate.columnId === active.columnId)
          : undefined;
    if (column === undefined) return;
    const command = runtime.getColumnCommandSnapshot(column.columnId);
    const directionSource = gridElement.current ?? target;
    if (directionSource === null) return;
    const direction = getComputedStyle(directionSource).direction === "rtl" ? "rtl" : "ltr";
    const width =
      adjustment === "minimum"
        ? command.minWidth
        : adjustment === "maximum"
          ? command.maxWidth
          : command.width + (direction === "rtl" ? -adjustment : adjustment) * step;
    event.preventDefault();
    const nextWidth = commitBrunoTableColumnResize(runtime, column.columnId, width);
    setAnnouncement(`${column.headerName} width ${String(nextWidth)} pixels`);
  };
  const runHeaderMenu = (event: BrunoTableHotkeyGesture): void => {
    if (event.defaultPrevented) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const directTrigger =
      target?.closest<HTMLButtonElement>("button[data-bruno-column-menu-trigger]") ?? null;
    if (
      directTrigger !== null &&
      gridElement.current?.contains(directTrigger) &&
      isBrunoTableHotkeyWorkflowOwner(directTrigger)
    ) {
      event.preventDefault();
      const column = resolveEventColumn(event);
      if (column !== undefined) navigation.activateHeader(column.columnId);
      requestBrunoTableHotkeyWorkflowAction(directTrigger);
      return;
    }
    if (!ownsGridSurface(event)) return;
    navigation.activateForFocus();
    const active = navigation.getSnapshot();
    if (active?.region !== "header") return;
    const header = [
      ...(gridElement.current?.querySelectorAll<HTMLElement>("th[data-bruno-column-id]") ?? []),
    ].find((candidate) => candidate.dataset["brunoColumnId"] === active.columnId);
    const trigger =
      [
        ...(header?.querySelectorAll<HTMLButtonElement>("button[data-bruno-column-menu-trigger]") ??
          []),
      ].find(isBrunoTableHotkeyWorkflowOwner) ??
      [
        ...(gridElement.current?.querySelectorAll<HTMLButtonElement>(
          '[data-bruno-active-header-menu-trigger=""]',
        ) ?? []),
      ].find(isBrunoTableHotkeyWorkflowOwner);
    if (trigger === undefined) return;
    event.preventDefault();
    requestBrunoTableHotkeyWorkflowAction(trigger);
  };
  const runActivation = (
    event: BrunoTableHotkeyGesture,
    intent: "enter" | "f2" | "space",
    alt: boolean,
    shift: boolean,
  ): void => {
    if (!ownsGridSurface(event)) return;
    navigation.activateForFocus();
    const active = navigation.getSnapshot();
    if (
      intent === "space" &&
      rowSelection !== undefined &&
      active !== undefined &&
      active.region === "body"
    ) {
      event.preventDefault();
      const rowId = active.rowId ?? rowSpace.getRowId(active.rowIndex);
      if (rowId === undefined) return;
      const checked = rowSelection.getRowSnapshot(rowId);
      const result = rowSelection.toggleRow(rowId, !checked, shift);
      if (result.kind === "ignored") return;
      setAnnouncement(
        result.kind === "range" && result.rowCount > 1
          ? `${String(result.rowCount)} rows ${result.checked ? "selected" : "deselected"}, rows ${String(result.startIndex + 1)} through ${String(result.endIndex + 1)}`
          : `Row ${String(active.rowIndex + 1)} ${checked ? "deselected" : "selected"}`,
      );
      return;
    }
    const column = logicalColumns.find((candidate) => candidate.columnId === active?.columnId);
    if (active?.region === "body" && (intent === "enter" || intent === "f2")) {
      if (column !== undefined && enterInteractiveCell(active, column)) event.preventDefault();
      return;
    }
    if (active?.region !== "header" || column === undefined || intent === "f2") return;
    const command = runtime.getColumnCommandSnapshot(column.columnId);
    const filterable = supportsBrunoTableCustomColumnFilter(column, renderColumnFilter);
    const legacyFilterable = column.kind === "field" && column.enableFilter !== false;
    if (alt && filterable) {
      event.preventDefault();
      if (shift && (command.filterActive || command.filterBaselineAvailable)) {
        toggleHeaderFilter(column.columnId);
      } else {
        openHeaderFilter(column.columnId);
      }
    } else if (alt && legacyFilterable && command.filterBaselineAvailable) {
      event.preventDefault();
      toggleHeaderFilter(column.columnId);
    } else if (command.sortable) {
      event.preventDefault();
      toggleHeaderSort(column.columnId, shift);
    } else if (command.filterActive || command.filterBaselineAvailable) {
      event.preventDefault();
      toggleHeaderFilter(column.columnId);
    } else if (filterable) {
      event.preventDefault();
      openHeaderFilter(column.columnId);
    }
  };
  const runSelectAll = (event: BrunoTableHotkeyGesture): void => {
    if (!ownsRowSelectionCommand(event) || rowSelection === undefined) return;
    event.preventDefault();
    const header = rowSelection.getHeaderSnapshot();
    if (header.disabled) return;
    if (header.checked) return;
    rowSelection.toggleAll(true);
    const selectedCount = rowSelection.getHeaderSnapshot().selectedCount;
    setAnnouncement(
      `${String(selectedCount)} matching ${selectedCount === 1 ? "row" : "rows"} selected`,
    );
  };
  useBrunoTableGridHotkeys(gridElement, {
    documentEscapeActive: () =>
      columnGesture.current !== undefined || cellRange?.isPointerGestureActive() === true,
    escape: (event) => {
      if (cellRange?.cancelPointerGesture() === true) {
        event.preventDefault();
        return;
      }
      if (columnGesture.current !== undefined) {
        event.preventDefault();
        gestureCancel.current();
        return;
      }
      const range = cellRange?.getSnapshot().range;
      const active = navigation.getSnapshot();
      if (cellRange !== undefined && range !== undefined && ownsGridSurface(event)) {
        event.preventDefault();
        if (
          active?.region === "body" &&
          active.rowId !== undefined &&
          cellRangeStructure !== undefined
        ) {
          cellRange.replace({ rowId: active.rowId, columnId: active.columnId }, cellRangeStructure);
        } else {
          cellRange.clear();
        }
        return;
      }
      if (event.defaultPrevented) return;
      const grid = gridElement.current;
      if (
        grid !== null &&
        event.target !== grid &&
        isNodeInBrunoTableRealm(grid, event.target) &&
        grid.contains(event.target)
      ) {
        event.preventDefault();
        gestureCancel.current();
        grid.focus({ preventScroll: true });
      }
    },
    shiftTab: (event) => {
      const grid = gridElement.current;
      if (
        grid !== null &&
        event.target !== grid &&
        isNodeInBrunoTableRealm(grid, event.target) &&
        grid.contains(event.target)
      ) {
        yieldGridTabStopForNativeTraversal(grid);
      }
    },
    headerMenu: runHeaderMenu,
    copy: runCopy,
    ...(rowSelection === undefined ? {} : { selectAll: runSelectAll }),
    resize: runColumnResize,
    activate: runActivation,
    navigate: runNavigation,
    page: runPageNavigation,
  });
  return (
    <div style={{ position: "relative" }}>
      {__BRUNO_TABLE_TEST_DIAGNOSTICS__ ? (
        <BrunoTableGridSurfaceCommitDiagnosticProbe
          commitEvidence={[columns, columnLayout, queryGeneration, rowSpace, viewportSnapshot]}
          tableId={tableId}
        />
      ) : null}
      <BrunoTableHeldShiftHotkeyAdapter />
      <div
        ref={attachGrid}
        data-bruno-scroll-owner=""
        data-bruno-column-layout-version={columnLayout.version}
        role="grid"
        aria-label={`Data for ${tableId}`}
        aria-busy={loading || undefined}
        aria-multiselectable={cellRange === undefined ? undefined : true}
        tabIndex={0}
        aria-rowcount={rowSpace.totalRows + 1}
        aria-colcount={
          columnWindow.pinnedStart.length +
          columnWindow.centerCount +
          columnWindow.pinnedEnd.length +
          (rowSelection === undefined ? 0 : 1)
        }
        aria-keyshortcuts={
          rowSelection === undefined
            ? copyEnabled
              ? "Alt+ArrowLeft Alt+ArrowRight Shift+F10 ContextMenu Control+C Meta+C"
              : "Alt+ArrowLeft Alt+ArrowRight Shift+F10 ContextMenu"
            : copyEnabled
              ? "Alt+ArrowLeft Alt+ArrowRight Shift+F10 ContextMenu Control+C Meta+C Space Shift+Space Control+A Meta+A"
              : "Alt+ArrowLeft Alt+ArrowRight Shift+F10 ContextMenu Space Shift+Space Control+A Meta+A"
        }
        onFocus={(event) => {
          if (event.target === event.currentTarget) navigation.activateForFocus();
        }}
        onPointerDown={runCellRangePointerDown}
        style={{
          maxHeight: BRUNO_TABLE_DEFAULT_VIEWPORT_HEIGHT,
          overflow: "auto",
          position: "relative",
        }}
      >
        <NavigationActiveDescendantAdapter
          gridElement={gridElement}
          instanceId={instanceId}
          navigation={navigation}
          runtime={runtime}
          tableId={tableId}
        />
        <span
          ref={announcement}
          aria-label="Table interaction status"
          aria-live="polite"
          role="log"
          style={VISUALLY_HIDDEN}
        />
        <div
          ref={attachRowLayer}
          data-bruno-row-layer=""
          style={{
            position: "relative",
            width: rowSelectionSurfaceWidth(renderedTableWidth, rowSelection),
          }}
        >
          <table
            role="presentation"
            style={{
              tableLayout: "fixed",
              width: rowSelectionSurfaceWidth(renderedTableWidth, rowSelection),
            }}
          >
            <BrunoTableHeaderRow
              activateHeaderCommand={activateHeaderCommand}
              announce={setAnnouncement}
              allColumns={allColumns}
              openHeaderFilter={openHeaderFilter}
              toggleHeaderFilter={toggleHeaderFilter}
              toggleHeaderSort={toggleHeaderSort}
              visibleColumnIds={visibleColumnIds}
              navigation={navigation}
              onColumnPointerDown={onColumnPointerDown}
              restoreColumnFocus={restoreColumnFocus}
              columnWindow={columnWindow}
              instanceId={instanceId}
              renderedTableWidth={renderedTableWidth}
              runtime={runtime}
              tableId={tableId}
              viewportFill={viewportFill}
              renderColumnFilter={renderColumnFilter}
              registerColumnFilterOpener={registerColumnFilterOpener}
              rowSelection={rowSelection}
              columnIndexOffset={columnIndexOffset}
            />
            <tbody
              role="rowgroup"
              style={{
                display: "block",
                height: virtualWindow.totalHeight,
                position: "relative",
                width: rowSelectionSurfaceWidth(renderedTableWidth, rowSelection),
              }}
            >
              {Array.from(
                { length: virtualWindow.rowEnd - virtualWindow.rowStart },
                (_, offset) => {
                  const logicalRowIndex = virtualWindow.rowStart + offset;
                  const rowId = rowSpace.getRowId(logicalRowIndex);
                  return rowId === undefined ? (
                    <UnloadedRow
                      key={`slot:${String(offset)}`}
                      attachBodyLayer={attachBodyLayerWithFocusHandoff}
                      center={columnWindow.center}
                      centerStartIndex={columnWindow.centerStartIndex}
                      instanceId={instanceId}
                      leftPadding={columnWindow.leftPadding}
                      logicalRowIndex={logicalRowIndex}
                      pinnedEnd={columnWindow.pinnedEnd}
                      pinnedStart={columnWindow.pinnedStart}
                      rightPadding={columnWindow.rightPadding}
                      tableId={tableId}
                      top={offset * ROW_HEIGHT}
                      viewportFill={viewportFill}
                      width={renderedTableWidth}
                      rowSelection={rowSelection}
                      columnIndexOffset={columnIndexOffset}
                    />
                  ) : (
                    <BrunoTableRow
                      key={`row:${rowId}`}
                      attachBodyLayer={attachBodyLayerWithFocusHandoff}
                      rowId={rowId}
                      instanceId={instanceId}
                      tableId={tableId}
                      centerStartIndex={columnWindow.centerStartIndex}
                      pinnedStartCount={columnWindow.pinnedStart.length}
                      runtime={runtime}
                      center={columnWindow.center}
                      pinnedStart={columnWindow.pinnedStart}
                      pinnedEnd={columnWindow.pinnedEnd}
                      leftPadding={columnWindow.leftPadding}
                      rightPadding={columnWindow.rightPadding}
                      viewportFill={viewportFill}
                      logicalRowIndex={logicalRowIndex}
                      top={offset * ROW_HEIGHT}
                      width={renderedTableWidth}
                      rowSelection={rowSelection}
                      columnIndexOffset={columnIndexOffset}
                    />
                  );
                },
              )}
            </tbody>
          </table>
          {columnWindow.pinnedStart.length > 0 ? (
            <BrunoTablePinnedBodyRegion
              attachBodyLayer={attachBodyLayerWithFocusHandoff}
              columns={columnWindow.pinnedStart}
              instanceId={instanceId}
              pinnedStartCount={columnWindow.pinnedStart.length}
              rowEnd={virtualWindow.rowEnd}
              rowSpace={rowSpace}
              rowStart={virtualWindow.rowStart}
              runtime={runtime}
              side="start"
              tableId={tableId}
              layerWidth={renderedTableWidth}
              leadingUtilityWidth={rowSelectionWidth}
              columnIndexOffset={columnIndexOffset}
              totalHeight={virtualWindow.totalHeight}
            />
          ) : null}
          {columnWindow.pinnedEnd.length > 0 ? (
            <BrunoTablePinnedBodyRegion
              attachBodyLayer={attachBodyLayerWithFocusHandoff}
              columns={columnWindow.pinnedEnd}
              instanceId={instanceId}
              pinnedStartCount={columnWindow.pinnedStart.length}
              precedingColumnCount={columnWindow.centerCount}
              rowEnd={virtualWindow.rowEnd}
              rowSpace={rowSpace}
              rowStart={virtualWindow.rowStart}
              runtime={runtime}
              side="end"
              tableId={tableId}
              layerWidth={renderedTableWidth}
              leadingUtilityWidth={rowSelectionWidth}
              columnIndexOffset={columnIndexOffset}
              totalHeight={virtualWindow.totalHeight}
            />
          ) : null}
        </div>
        <ActiveDescendantOutlet
          allColumns={allColumns}
          announce={setAnnouncement}
          instanceId={instanceId}
          logicalColumns={logicalColumns}
          navigation={navigation}
          cellRange={cellRange}
          openHeaderFilter={openHeaderFilter}
          renderColumnFilter={renderColumnFilter}
          restoreColumnFocus={restoreColumnFocus}
          runtime={runtime}
          tableId={tableId}
          visibleColumnIds={visibleColumnIds}
          virtualWindow={virtualWindow}
          columnIndexOffset={columnIndexOffset}
        />
      </div>
      <BrunoTableScrollbarOverlay attach={attachScrollbarOverlay} />
    </div>
  );
});

const BrunoTableScrollbarOverlay = memo(function BrunoTableScrollbarOverlay({
  attach,
}: {
  readonly attach: (element: HTMLElement | null) => void;
}) {
  return (
    <div
      ref={attach}
      aria-hidden="true"
      data-bruno-scrollbar-overlay=""
      style={{ inset: 0, pointerEvents: "none", position: "absolute", zIndex: 8 }}
    >
      <div
        data-bruno-scrollbar-track="horizontal"
        style={{
          background: "color-mix(in srgb, CanvasText 12%, transparent)",
          bottom: "var(--bruno-table-scrollbar-horizontal-bottom, 0px)",
          display: "var(--bruno-table-scrollbar-horizontal-display, none)",
          height: BRUNO_TABLE_SCROLLBAR_TRACK_THICKNESS,
          insetInlineEnd: "var(--bruno-table-scrollbar-horizontal-end, 0px)",
          insetInlineStart: "var(--bruno-table-scrollbar-horizontal-start, 0px)",
          position: "absolute",
        }}
      >
        <div
          data-bruno-scrollbar-thumb="horizontal"
          style={{
            background: "color-mix(in srgb, CanvasText 42%, transparent)",
            borderRadius: 999,
            height: "100%",
            insetInlineStart: 0,
            position: "absolute",
            transform:
              "translate3d(var(--bruno-table-scrollbar-horizontal-thumb-offset, 0px), 0, 0)",
            width: "var(--bruno-table-scrollbar-horizontal-thumb-width, 0px)",
          }}
        />
      </div>
      <div
        data-bruno-scrollbar-track="vertical"
        style={{
          background: "color-mix(in srgb, CanvasText 12%, transparent)",
          bottom: "var(--bruno-table-scrollbar-vertical-bottom, 0px)",
          display: "var(--bruno-table-scrollbar-vertical-display, none)",
          insetInlineEnd: "var(--bruno-table-scrollbar-vertical-right, 0px)",
          position: "absolute",
          top: "var(--bruno-table-scrollbar-vertical-top, 0px)",
          width: BRUNO_TABLE_SCROLLBAR_TRACK_THICKNESS,
        }}
      >
        <div
          data-bruno-scrollbar-thumb="vertical"
          style={{
            background: "color-mix(in srgb, CanvasText 42%, transparent)",
            borderRadius: 999,
            height: "var(--bruno-table-scrollbar-vertical-thumb-height, 0px)",
            insetInlineStart: 0,
            position: "absolute",
            transform: "translate3d(0, var(--bruno-table-scrollbar-vertical-thumb-offset, 0px), 0)",
            width: "100%",
          }}
        />
      </div>
    </div>
  );
});

// Active Cell movement updates the composite attribute without waking the structural grid tree.
const NavigationActiveDescendantAdapter = memo(function NavigationActiveDescendantAdapter({
  gridElement,
  instanceId,
  navigation,
  runtime,
  tableId,
}: {
  readonly gridElement: Readonly<{ current: HTMLDivElement | null }>;
  readonly instanceId: string;
  readonly navigation: BrunoTableNavigationRuntime;
  readonly runtime: BrunoTableRuntimeView;
  readonly tableId: string;
}) {
  useLayoutEffect(() => {
    const synchronize = () => {
      const element = gridElement.current;
      if (element === null) return;
      const activeCell = navigation.getSnapshot();
      const id =
        activeCell === undefined
          ? undefined
          : mountedActiveDomId(instanceId, tableId, activeCell, runtime.getRowSpaceSnapshot());
      if (id === undefined) element.removeAttribute("aria-activedescendant");
      else element.setAttribute("aria-activedescendant", id);
    };
    synchronize();
    const unsubscribeNavigation = navigation.subscribe(synchronize);
    const unsubscribeRows = runtime.subscribeRowSpace(synchronize);
    return () => {
      unsubscribeRows();
      unsubscribeNavigation();
    };
  }, [gridElement, instanceId, navigation, runtime, tableId]);
  return null;
});

const ActiveDescendantOutlet = memo(function ActiveDescendantOutlet({
  allColumns,
  announce,
  instanceId,
  logicalColumns,
  navigation,
  cellRange,
  openHeaderFilter,
  renderColumnFilter,
  restoreColumnFocus,
  runtime,
  tableId,
  visibleColumnIds,
  virtualWindow,
  columnIndexOffset,
}: {
  readonly allColumns: readonly CompiledColumn[];
  readonly announce: (message: string) => void;
  readonly instanceId: string;
  readonly logicalColumns: readonly CompiledColumn[];
  readonly navigation: BrunoTableNavigationRuntime;
  readonly cellRange?: BrunoTableCellRangeRuntime | undefined;
  readonly openHeaderFilter: (columnId: string) => void;
  readonly renderColumnFilter?: BrunoTableColumnFilterRenderer | undefined;
  readonly restoreColumnFocus: (columnId: string) => void;
  readonly runtime: BrunoTableRuntimeView;
  readonly tableId: string;
  readonly visibleColumnIds: readonly string[];
  readonly virtualWindow: BrunoTableViewportSnapshot["virtualWindow"];
  readonly columnIndexOffset: number;
}) {
  const activeCell = useSyncExternalStore(
    navigation.subscribe,
    navigation.getSnapshot,
    navigation.getSnapshot,
  );
  if (activeCell === undefined) return null;
  const activeColumnMounted = [
    virtualWindow.pinnedStart,
    virtualWindow.center,
    virtualWindow.pinnedEnd,
  ].some((columns) => columns.some((column) => column.columnId === activeCell.columnId));
  const activeRowMounted =
    activeCell.region === "header" ||
    (activeCell.rowIndex >= virtualWindow.rowStart && activeCell.rowIndex < virtualWindow.rowEnd);
  if (activeCell.region === "header" && !activeColumnMounted) {
    return (
      <ActiveHeaderMenuProxy
        activeCell={activeCell}
        announce={announce}
        allColumns={allColumns}
        visibleColumnIds={visibleColumnIds}
        column={logicalColumns.find((column) => column.columnId === activeCell.columnId)}
        columnIndex={offsetLogicalColumnIndex(
          logicalColumns.findIndex((column) => column.columnId === activeCell.columnId),
          columnIndexOffset,
        )}
        instanceId={instanceId}
        openHeaderFilter={openHeaderFilter}
        renderColumnFilter={renderColumnFilter}
        restoreColumnFocus={restoreColumnFocus}
        runtime={runtime}
        tableId={tableId}
      />
    );
  }
  if (activeColumnMounted && activeRowMounted) return null;
  return (
    <ActiveDescendantProxy
      activeCell={activeCell}
      cellRange={cellRange}
      column={logicalColumns.find((column) => column.columnId === activeCell.columnId)}
      columnIndex={offsetLogicalColumnIndex(
        logicalColumns.findIndex((column) => column.columnId === activeCell.columnId),
        columnIndexOffset,
      )}
      instanceId={instanceId}
      renderColumnFilter={renderColumnFilter}
      runtime={runtime}
      tableId={tableId}
    />
  );
});

type BrunoTableMenuFilterTransfer = Readonly<{
  closeMenu: (preserveFocus?: boolean) => void;
  onOpenChange: (nextOpen: boolean) => void;
  openHeaderFilterFromMenu: (columnId: string) => void;
}>;

function useBrunoTableMenuFilterTransfer({
  columnId,
  onOpen,
  openHeaderFilter,
  restoreColumnFocus,
  setOpen,
}: {
  readonly columnId: string;
  readonly onOpen?: () => void;
  readonly openHeaderFilter: (columnId: string) => void;
  readonly restoreColumnFocus: (columnId: string) => void;
  readonly setOpen: (open: boolean) => void;
}): BrunoTableMenuFilterTransfer {
  const menuFilterTransfer = useRef(false);
  const openHeaderFilterFromMenu = useCallback(
    (nextColumnId: string): void => {
      menuFilterTransfer.current = true;
      openHeaderFilter(nextColumnId);
    },
    [openHeaderFilter],
  );
  const closeMenu = useCallback(
    (preserveFocus = false): void => {
      if (preserveFocus) menuFilterTransfer.current = true;
      setOpen(false);
    },
    [setOpen],
  );
  const onOpenChange = useCallback(
    (nextOpen: boolean): void => {
      if (nextOpen) onOpen?.();
      setOpen(nextOpen);
      if (!nextOpen) {
        const transferred = menuFilterTransfer.current;
        menuFilterTransfer.current = false;
        if (!transferred) restoreColumnFocus(columnId);
      }
    },
    [columnId, onOpen, restoreColumnFocus, setOpen],
  );
  return { closeMenu, onOpenChange, openHeaderFilterFromMenu };
}

const ActiveHeaderMenuProxy = memo(function ActiveHeaderMenuProxy({
  allColumns,
  activeCell,
  announce,
  column,
  columnIndex,
  instanceId,
  openHeaderFilter,
  restoreColumnFocus,
  renderColumnFilter,
  runtime,
  tableId,
  visibleColumnIds,
}: {
  readonly allColumns: readonly CompiledColumn[];
  readonly activeCell: BrunoTableActiveCell;
  readonly announce: (message: string) => void;
  readonly column: CompiledColumn | undefined;
  readonly columnIndex: number;
  readonly instanceId: string;
  readonly openHeaderFilter: (columnId: string) => void;
  readonly restoreColumnFocus: (columnId: string) => void;
  readonly renderColumnFilter?: BrunoTableColumnFilterRenderer | undefined;
  readonly runtime: BrunoTableRuntimeView;
  readonly tableId: string;
  readonly visibleColumnIds: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const [menuDirection, setMenuDirection] = useState<"ltr" | "rtl">("ltr");
  const { closeMenu, onOpenChange, openHeaderFilterFromMenu } = useBrunoTableMenuFilterTransfer({
    columnId: column?.columnId ?? "",
    onOpen: () => setMenuDirection(readBrunoTableMenuDirection()),
    openHeaderFilter,
    restoreColumnFocus,
    setOpen,
  });
  const columnId = column?.columnId ?? "";
  const subscribe = useMemo(
    () => (listener: () => void) => runtime.subscribeColumnCommands(columnId, listener),
    [columnId, runtime],
  );
  const getSnapshot = useMemo(
    () => () => runtime.getColumnCommandSnapshot(columnId),
    [columnId, runtime],
  );
  const command = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const groupingStructure = useSyncExternalStore(
    runtime.subscribeInstalledGroupingStructure,
    runtime.getInstalledGroupingStructureSnapshot,
    runtime.getInstalledGroupingStructureSnapshot,
  );
  const groupBy = groupingStructure.groupBy;
  const menuTriggerId = headerDomId(instanceId, tableId, `${columnId}-menu-proxy`);
  const attachMenuHotkeyWorkflow = useBrunoTableHotkeyWorkflowAction(() => {
    if (column !== undefined) {
      setMenuDirection(readBrunoTableMenuDirection());
      setOpen(true);
    }
  });
  if (column === undefined) return null;
  return (
    <>
      <ActiveDescendantProxy
        activeCell={activeCell}
        column={column}
        columnIndex={columnIndex}
        instanceId={instanceId}
        renderColumnFilter={renderColumnFilter}
        runtime={runtime}
        tableId={tableId}
      />
      <DirectionProvider direction={menuDirection}>
        <DropdownMenu
          open={open}
          onOpenChange={onOpenChange}
          triggerId={open ? menuTriggerId : null}
        >
          <DropdownMenuTrigger
            ref={attachMenuHotkeyWorkflow}
            aria-label={`Column menu for ${column.headerName}`}
            aria-keyshortcuts="Shift+F10 ContextMenu"
            data-bruno-active-header-menu-trigger=""
            data-bruno-column-menu-trigger={column.columnId}
            id={menuTriggerId}
            style={VISUALLY_HIDDEN}
            tabIndex={-1}
          />
          {open ? (
            <ColumnManagementMenu
              allColumns={allColumns}
              announce={announce}
              closeMenu={closeMenu}
              column={column}
              command={command}
              direction={menuDirection}
              groupBy={groupBy}
              openHeaderFilter={openHeaderFilterFromMenu}
              preventMenuFinalFocus
              renderColumnFilter={renderColumnFilter}
              restoreColumnFocus={restoreColumnFocus}
              runtime={runtime}
              visibleColumnIds={visibleColumnIds}
            />
          ) : null}
        </DropdownMenu>
      </DirectionProvider>
    </>
  );
});

const BrunoTableRowSelectionHeaderCell = memo(function BrunoTableRowSelectionHeaderCell({
  selection,
  tableId,
}: {
  readonly selection: BrunoTableRowSelectionRuntime;
  readonly tableId: string;
}) {
  const checkbox = useRef<HTMLSpanElement | null>(null);
  const snapshot = useSyncExternalStore(
    selection.subscribeHeader,
    selection.getHeaderSnapshot,
    selection.getHeaderSnapshot,
  );
  useLayoutEffect(() => {
    const element = checkbox.current;
    if (!snapshot.disabled || element === null || element.ownerDocument.activeElement !== element) {
      return;
    }
    element.closest<HTMLElement>('[role="grid"]')?.focus({ preventScroll: true });
  }, [snapshot.disabled]);
  return (
    <th
      aria-colindex={1}
      data-bruno-column-id={BRUNO_TABLE_ROW_SELECTION_COLUMN_ID}
      role="columnheader"
      scope="col"
      style={rowSelectionCellStyle(6)}
    >
      {__BRUNO_TABLE_TEST_DIAGNOSTICS__ ? (
        <BrunoTableRowSelectionCommitDiagnosticProbe commitEvidence={snapshot} tableId={tableId} />
      ) : null}
      <Checkbox
        ref={checkbox}
        aria-label="Select all rows"
        aria-keyshortcuts="Control+A Meta+A"
        checked={snapshot.checked}
        data-bruno-row-selection-checkbox=""
        disabled={snapshot.disabled}
        indeterminate={snapshot.mixed}
        onClick={() => selection.toggleAll(!snapshot.checked)}
        onPointerDown={(event) => event.stopPropagation()}
        tabIndex={-1}
      />
    </th>
  );
});

const BrunoTableHeaderRow = memo(function BrunoTableHeaderRow({
  activateHeaderCommand,
  allColumns,
  announce,
  navigation,
  onColumnPointerDown,
  openHeaderFilter,
  restoreColumnFocus,
  toggleHeaderFilter,
  toggleHeaderSort,
  columnWindow,
  instanceId,
  renderedTableWidth,
  runtime,
  renderColumnFilter,
  registerColumnFilterOpener,
  tableId,
  viewportFill,
  visibleColumnIds,
  rowSelection,
  columnIndexOffset,
}: {
  readonly activateHeaderCommand: (columnId: string) => void;
  readonly allColumns: readonly CompiledColumn[];
  readonly announce: (message: string) => void;
  readonly navigation: BrunoTableNavigationRuntime;
  readonly onColumnPointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    column: CompiledColumn,
    kind: "resize" | "reorder",
  ) => void;
  readonly openHeaderFilter: (columnId: string) => void;
  readonly restoreColumnFocus: (columnId: string) => void;
  readonly toggleHeaderFilter: (columnId: string) => void;
  readonly toggleHeaderSort: (columnId: string, multi: boolean) => void;
  readonly columnWindow: BrunoTableColumnWindow;
  readonly instanceId: string;
  readonly renderedTableWidth: number;
  readonly runtime: BrunoTableRuntimeView;
  readonly renderColumnFilter?: BrunoTableColumnFilterRenderer | undefined;
  readonly registerColumnFilterOpener: (columnId: string, open: () => void) => () => void;
  readonly tableId: string;
  readonly viewportFill: number;
  readonly visibleColumnIds: readonly string[];
  readonly rowSelection?: BrunoTableRowSelectionRuntime | undefined;
  readonly columnIndexOffset: number;
}) {
  return (
    <thead
      role="rowgroup"
      style={{
        background: "Canvas",
        position: "sticky",
        top: 0,
        width: rowSelectionSurfaceWidth(renderedTableWidth, rowSelection),
        zIndex: 4,
      }}
    >
      <tr aria-rowindex={1} role="row" style={{ height: ROW_HEIGHT, maxHeight: ROW_HEIGHT }}>
        {rowSelection === undefined ? null : (
          <BrunoTableRowSelectionHeaderCell selection={rowSelection} tableId={tableId} />
        )}
        {__BRUNO_TABLE_TEST_DIAGNOSTICS__ ? (
          <BrunoTableHeaderCommitDiagnosticProbe commitEvidence={columnWindow} tableId={tableId} />
        ) : null}
        {columnWindow.pinnedStart.map((column, index) => (
          <BrunoTableHeaderCell
            allColumns={allColumns}
            key={column.columnId}
            pinned="start"
            activateHeaderForResize={navigation.activateHeader}
            navigation={navigation}
            instanceId={instanceId}
            tableId={tableId}
            columnIndex={columnIndexOffset + index}
            column={column}
            openHeaderFilter={openHeaderFilter}
            runtime={runtime}
            renderColumnFilter={renderColumnFilter}
            registerColumnFilterOpener={registerColumnFilterOpener}
            announce={announce}
            activateHeaderCommand={activateHeaderCommand}
            toggleHeaderFilter={toggleHeaderFilter}
            toggleHeaderSort={toggleHeaderSort}
            onColumnPointerDown={onColumnPointerDown}
            restoreColumnFocus={restoreColumnFocus}
            style={pinnedCellStyle(
              "start",
              columnWindow.pinnedStart,
              index,
              rowSelection === undefined ? 0 : ROW_SELECTION_COLUMN_WIDTH,
            )}
            visibleColumnIds={visibleColumnIds}
          />
        ))}
        {columnWindow.centerCount > 0 ? (
          <th
            aria-hidden="true"
            style={{
              padding: 0,
              width: `var(${BRUNO_TABLE_LIVE_LEFT_PADDING_CSS_VARIABLE}, ${String(columnWindow.leftPadding)}px)`,
            }}
          />
        ) : null}
        {columnWindow.center.map((column, index) => (
          <BrunoTableHeaderCell
            allColumns={allColumns}
            key={column.columnId}
            activateHeaderForResize={navigation.activateHeader}
            navigation={navigation}
            instanceId={instanceId}
            tableId={tableId}
            columnIndex={
              columnIndexOffset +
              columnWindow.pinnedStart.length +
              columnWindow.centerStartIndex +
              index
            }
            column={column}
            openHeaderFilter={openHeaderFilter}
            runtime={runtime}
            renderColumnFilter={renderColumnFilter}
            registerColumnFilterOpener={registerColumnFilterOpener}
            announce={announce}
            activateHeaderCommand={activateHeaderCommand}
            toggleHeaderFilter={toggleHeaderFilter}
            toggleHeaderSort={toggleHeaderSort}
            onColumnPointerDown={onColumnPointerDown}
            restoreColumnFocus={restoreColumnFocus}
            style={{ width: column.semantics.width }}
            visibleColumnIds={visibleColumnIds}
          />
        ))}
        {columnWindow.centerCount > 0 ? (
          <th
            aria-hidden="true"
            style={{
              padding: 0,
              width: `var(${BRUNO_TABLE_LIVE_RIGHT_PADDING_CSS_VARIABLE}, ${String(columnWindow.rightPadding)}px)`,
            }}
          />
        ) : null}
        {columnWindow.pinnedEnd.length > 0 ? (
          <th
            aria-hidden="true"
            style={{
              padding: 0,
              width: rowSelectionViewportFillWidth(viewportFill, rowSelection),
            }}
          />
        ) : null}
        {columnWindow.pinnedEnd.map((column, index) => (
          <BrunoTableHeaderCell
            allColumns={allColumns}
            key={column.columnId}
            pinned="end"
            activateHeaderForResize={navigation.activateHeader}
            navigation={navigation}
            instanceId={instanceId}
            tableId={tableId}
            columnIndex={
              columnIndexOffset + columnWindow.pinnedStart.length + columnWindow.centerCount + index
            }
            column={column}
            openHeaderFilter={openHeaderFilter}
            runtime={runtime}
            renderColumnFilter={renderColumnFilter}
            registerColumnFilterOpener={registerColumnFilterOpener}
            announce={announce}
            activateHeaderCommand={activateHeaderCommand}
            toggleHeaderFilter={toggleHeaderFilter}
            toggleHeaderSort={toggleHeaderSort}
            onColumnPointerDown={onColumnPointerDown}
            restoreColumnFocus={restoreColumnFocus}
            style={pinnedCellStyle("end", columnWindow.pinnedEnd, index)}
            visibleColumnIds={visibleColumnIds}
          />
        ))}
      </tr>
    </thead>
  );
});

const BrunoTableRowSelectionCell = memo(function BrunoTableRowSelectionCell({
  logicalRowIndex,
  rowId,
  selection,
  tableId,
}: {
  readonly logicalRowIndex: number;
  readonly rowId: string;
  readonly selection: BrunoTableRowSelectionRuntime;
  readonly tableId: string;
}) {
  const subscribe = useMemo(
    () => (listener: () => void) => selection.subscribeRow(rowId, listener),
    [rowId, selection],
  );
  const getSnapshot = useMemo(() => () => selection.getRowSnapshot(rowId), [rowId, selection]);
  const checked = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <td
      aria-colindex={1}
      data-bruno-column-id={BRUNO_TABLE_ROW_SELECTION_COLUMN_ID}
      role="gridcell"
      style={rowSelectionCellStyle(5)}
    >
      {__BRUNO_TABLE_TEST_DIAGNOSTICS__ ? (
        <BrunoTableRowSelectionCommitDiagnosticProbe
          commitEvidence={checked}
          rowId={rowId}
          tableId={tableId}
        />
      ) : null}
      <Checkbox
        aria-label={`Select row ${String(logicalRowIndex + 1)}`}
        checked={checked}
        data-bruno-row-selection-checkbox=""
        onClick={(event) =>
          selection.toggleRow(rowId, !checked, event.detail > 0 && isBrunoTableHotkeyHeld("Shift"))
        }
        onPointerDown={(event) => event.stopPropagation()}
        tabIndex={-1}
      />
    </td>
  );
});

const BrunoTableRowSelectionLoadingCell = memo(function BrunoTableRowSelectionLoadingCell() {
  return (
    <td
      aria-colindex={1}
      aria-label="Row selection loading"
      data-bruno-column-id={BRUNO_TABLE_ROW_SELECTION_COLUMN_ID}
      role="gridcell"
      style={rowSelectionCellStyle(5)}
    >
      <Skeleton aria-hidden="true" className="size-4" />
    </td>
  );
});

function rowSelectionCellStyle(zIndex: number): CSSProperties {
  return {
    alignItems: "center",
    background: "Canvas",
    display: "flex",
    height: ROW_HEIGHT,
    insetInlineStart: 0,
    justifyContent: "center",
    padding: 0,
    position: "sticky",
    width: ROW_SELECTION_COLUMN_WIDTH,
    zIndex,
  };
}

function rowSelectionSurfaceWidth(
  fallbackWidth: number,
  selection: BrunoTableRowSelectionRuntime | undefined,
): string {
  return surfaceWidthWithUtility(
    fallbackWidth,
    selection === undefined ? 0 : ROW_SELECTION_COLUMN_WIDTH,
  );
}

function surfaceWidthWithUtility(fallbackWidth: number, utilityWidth: number): string {
  const liveWidth = `var(${BRUNO_TABLE_LIVE_TOTAL_WIDTH_CSS_VARIABLE}, ${String(fallbackWidth)}px)`;
  return utilityWidth === 0 ? liveWidth : `calc(${liveWidth} + ${String(utilityWidth)}px)`;
}

function rowSelectionViewportFillWidth(
  fallbackWidth: number,
  _selection: BrunoTableRowSelectionRuntime | undefined,
): string {
  const liveWidth = `var(${BRUNO_TABLE_LIVE_VIEWPORT_FILL_CSS_VARIABLE}, ${String(fallbackWidth)}px)`;
  return liveWidth;
}

function offsetLogicalColumnIndex(index: number, offset: number): number {
  return index < 0 ? index : index + offset;
}

const BrunoTableHeaderCell = memo(function BrunoTableHeaderCell({
  activateHeaderCommand,
  activateHeaderForResize,
  allColumns,
  announce,
  onColumnPointerDown,
  restoreColumnFocus,
  toggleHeaderFilter,
  toggleHeaderSort,
  instanceId,
  tableId,
  columnIndex,
  column,
  pinned,
  navigation,
  openHeaderFilter,
  runtime,
  renderColumnFilter,
  registerColumnFilterOpener,
  style,
  visibleColumnIds,
}: {
  readonly activateHeaderCommand: (columnId: string) => void;
  readonly activateHeaderForResize: (columnId: string) => void;
  readonly allColumns: readonly CompiledColumn[];
  readonly announce: (message: string) => void;
  readonly onColumnPointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    column: CompiledColumn,
    kind: "resize" | "reorder",
  ) => void;
  readonly restoreColumnFocus: (columnId: string) => void;
  readonly toggleHeaderFilter: (columnId: string) => void;
  readonly toggleHeaderSort: (columnId: string, multi: boolean) => void;
  readonly instanceId: string;
  readonly tableId: string;
  readonly columnIndex: number;
  readonly column: CompiledColumn;
  readonly pinned?: "start" | "end";
  readonly navigation: BrunoTableNavigationRuntime;
  readonly openHeaderFilter: (columnId: string) => void;
  readonly runtime: BrunoTableRuntimeView;
  readonly renderColumnFilter?: BrunoTableColumnFilterRenderer | undefined;
  readonly registerColumnFilterOpener: (columnId: string, open: () => void) => () => void;
  readonly style?: CSSProperties;
  readonly visibleColumnIds: readonly string[];
}) {
  const subscribe = useMemo(
    () => (listener: () => void) => runtime.subscribeColumnCommands(column.columnId, listener),
    [column.columnId, runtime],
  );
  const getSnapshot = useMemo(
    () => () => runtime.getColumnCommandSnapshot(column.columnId),
    [column.columnId, runtime],
  );
  const command = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const groupingStructure = useSyncExternalStore(
    runtime.subscribeInstalledGroupingStructure,
    runtime.getInstalledGroupingStructureSnapshot,
    runtime.getInstalledGroupingStructureSnapshot,
  );
  const groupBy = groupingStructure.groupBy;
  const presentation = headerSortPresentation(column.headerName, command);
  const sortLabel =
    command.sortDirection === undefined
      ? `Sort by ${column.headerName}`
      : `Sort by ${column.headerName}, currently ${presentation.direction}${sortPriorityLabel(command.sortPriority)}`;
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuDirection, setMenuDirection] = useState<"ltr" | "rtl">("ltr");
  const { closeMenu, onOpenChange, openHeaderFilterFromMenu } = useBrunoTableMenuFilterTransfer({
    columnId: column.columnId,
    onOpen: () => setMenuDirection(readBrunoTableMenuDirection()),
    openHeaderFilter,
    restoreColumnFocus,
    setOpen: setMenuOpen,
  });
  const pinLabel = command.pinned === undefined ? "unpinned" : `pinned ${command.pinned}`;
  const menuTriggerId = headerDomId(instanceId, tableId, `${column.columnId}-menu`);
  const attachMenuHotkeyWorkflow = useBrunoTableHotkeyWorkflowAction(() => {
    setMenuDirection(readBrunoTableMenuDirection());
    activateHeaderForResize(column.columnId);
    setMenuOpen(true);
  });
  const subscribeActiveResize = useMemo(
    () => (listener: () => void) => navigation.subscribeColumn(column.columnId, listener),
    [column.columnId, navigation],
  );
  const resizeActive = useSyncExternalStore(
    subscribeActiveResize,
    () => navigation.getColumnSnapshot(column.columnId),
    () => navigation.getColumnSnapshot(column.columnId),
  );

  const content = (
    <div className="flex min-w-0 items-center gap-0.5 overflow-hidden">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {command.sortable ? (
          <Button
            aria-label={sortLabel}
            tabIndex={-1}
            size="xs"
            type="button"
            variant="ghost"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              activateHeaderCommand(column.columnId);
            }}
            onClick={() => {
              activateHeaderCommand(column.columnId);
              toggleHeaderSort(column.columnId, isBrunoTableHotkeyHeld("Shift"));
            }}
          >
            <span className="truncate">{column.headerName}</span>
            {command.sortPriority === undefined ? null : (
              <>
                <span aria-hidden="true">{command.sortDirection === "asc" ? "↑" : "↓"}</span>
                <span aria-hidden="true">{String(command.sortPriority)}</span>
              </>
            )}
          </Button>
        ) : (
          <span className="truncate">{column.headerName}</span>
        )}
        {supportsBrunoTableCustomColumnFilter(column, renderColumnFilter)
          ? renderColumnFilter?.({
              activateHeaderCommand,
              column,
              command,
              restoreColumnFocus,
              runtime,
              registerColumnFilterOpener,
            })
          : null}
        {command.filterActive || command.filterBaselineAvailable ? (
          <Button
            aria-label={`${command.filterActive ? "Clear" : "Reset"} filter for ${column.headerName}`}
            tabIndex={-1}
            size="xs"
            type="button"
            variant="ghost"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.focus({ preventScroll: true });
              navigation.activateHeader(column.columnId);
            }}
            onClick={(event) => {
              const header = event.currentTarget.closest("th");
              event.currentTarget.focus({ preventScroll: true });
              navigation.activateHeader(column.columnId);
              toggleHeaderFilter(column.columnId);
              const next = runtime.getColumnCommandSnapshot(column.columnId);
              if (!next.filterActive && !next.filterBaselineAvailable) {
                requestAnimationFrame(() => {
                  const label = `Filter ${column.headerName}`;
                  const trigger = [
                    ...(header?.querySelectorAll<HTMLButtonElement>("button") ?? []),
                  ].find((candidate) => candidate.getAttribute("aria-label")?.startsWith(label));
                  trigger?.focus({ preventScroll: true });
                });
              }
            }}
          >
            {command.filterActive ? "Clear" : "Reset"}
          </Button>
        ) : null}
      </div>
      {groupBy.length === 0 ? (
        <button
          aria-label={`Reorder ${column.headerName}`}
          className="inline-flex size-5 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 active:cursor-grabbing"
          tabIndex={-1}
          type="button"
          onPointerDown={(event) => onColumnPointerDown(event, column, "reorder")}
        >
          <ArrowsHorizontalIcon aria-hidden="true" />
        </button>
      ) : null}
      <DirectionProvider direction={menuDirection}>
        <DropdownMenu
          open={menuOpen}
          onOpenChange={onOpenChange}
          triggerId={menuOpen ? menuTriggerId : null}
        >
          <DropdownMenuTrigger
            ref={attachMenuHotkeyWorkflow}
            aria-label={`Column menu for ${column.headerName}`}
            aria-keyshortcuts="Shift+F10 ContextMenu"
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            data-bruno-column-menu-trigger={column.columnId}
            id={menuTriggerId}
            tabIndex={-1}
            onPointerDown={(event) => {
              if (event.button === 0) {
                setMenuDirection(readBrunoTableMenuDirection(event.currentTarget));
                activateHeaderForResize(column.columnId);
              }
            }}
          >
            <DotsThreeVerticalIcon aria-hidden="true" />
          </DropdownMenuTrigger>
          {menuOpen ? (
            <ColumnManagementMenu
              allColumns={allColumns}
              announce={announce}
              closeMenu={closeMenu}
              column={column}
              command={command}
              direction={menuDirection}
              groupBy={groupBy}
              openHeaderFilter={openHeaderFilterFromMenu}
              renderColumnFilter={renderColumnFilter}
              restoreColumnFocus={restoreColumnFocus}
              runtime={runtime}
              visibleColumnIds={visibleColumnIds}
            />
          ) : null}
        </DropdownMenu>
      </DirectionProvider>
      {groupBy.length === 0 ||
      column.columnId === "COL_ID_BRUNO_TABLE_ROWS" ||
      (column.kind === "field" &&
        column.aggFunc !== undefined &&
        !groupBy.includes(column.columnId)) ? (
        <span
          aria-label={`Resize ${column.headerName}`}
          aria-orientation="vertical"
          aria-valuemax={command.maxWidth}
          aria-valuemin={command.minWidth}
          aria-valuenow={command.width}
          aria-keyshortcuts="ArrowLeft ArrowRight Home End"
          className="-mr-1 inline-flex h-7 w-2 shrink-0 cursor-col-resize touch-none items-center justify-center outline-none after:h-4 after:w-px after:bg-border hover:after:bg-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          role="separator"
          tabIndex={resizeActive ? 0 : -1}
          onFocus={() => activateHeaderForResize(column.columnId)}
          onPointerDown={(event) => onColumnPointerDown(event, column, "resize")}
        />
      ) : null}
    </div>
  );
  const headerProps = {
    "data-pinned-region": pinned,
    "data-bruno-column-id": column.columnId,
    id: headerDomId(instanceId, tableId, column.columnId),
    "aria-label": `${presentation.label}, width ${String(command.width)} pixels, ${pinLabel}`,
    "aria-colindex": columnIndex + 1,
    "aria-keyshortcuts": supportsBrunoTableCustomColumnFilter(column, renderColumnFilter)
      ? "Alt+Enter Alt+Shift+Enter"
      : command.filterBaselineAvailable
        ? "Alt+Enter"
        : undefined,
    "aria-sort": presentation.ariaSort,
    role: "columnheader",
    style: {
      boxSizing: "border-box",
      height: ROW_HEIGHT,
      maxHeight: ROW_HEIGHT,
      overflow: "hidden",
      ...style,
      transform: `var(${brunoTableColumnCssVariable("transform", column.columnId)}, none)`,
      width: `var(${brunoTableColumnCssVariable("width", column.columnId)}, ${String(column.semantics.width)}px)`,
    } satisfies CSSProperties,
  } as const;
  return (
    <th {...headerProps} scope="col">
      {content}
    </th>
  );
});

const ColumnManagementMenu = memo(function ColumnManagementMenu({
  allColumns,
  announce,
  closeMenu,
  column,
  command,
  direction,
  groupBy,
  openHeaderFilter,
  preventMenuFinalFocus = false,
  renderColumnFilter,
  restoreColumnFocus,
  runtime,
  visibleColumnIds,
}: {
  readonly allColumns: readonly CompiledColumn[];
  readonly announce: (message: string) => void;
  readonly closeMenu: (preserveFocus?: boolean) => void;
  readonly column: CompiledColumn;
  readonly command: BrunoTableColumnCommandSnapshot;
  readonly direction: "ltr" | "rtl";
  readonly groupBy: readonly string[];
  readonly openHeaderFilter: (columnId: string) => void;
  readonly preventMenuFinalFocus?: boolean;
  readonly renderColumnFilter?: BrunoTableColumnFilterRenderer | undefined;
  readonly restoreColumnFocus: (columnId: string) => void;
  readonly runtime: BrunoTableRuntimeView;
  readonly visibleColumnIds: readonly string[];
}) {
  const index = visibleColumnIds.indexOf(column.columnId);
  const MoveStartIcon = direction === "rtl" ? ArrowRightIcon : ArrowLeftIcon;
  const MoveEndIcon = direction === "rtl" ? ArrowLeftIcon : ArrowRightIcon;
  const groupIndexes = visibleColumnIds.flatMap((id, candidateIndex) => {
    const candidate = allColumns.find((columnToCheck) => columnToCheck.columnId === id);
    return candidate?.pinned === command.pinned ? [candidateIndex] : [];
  });
  const groupStart = groupIndexes[0] ?? index;
  const groupEnd = groupIndexes.at(-1) ?? index;
  const isFirst = index < 0 || index <= groupStart;
  const isLast = index < 0 || index >= groupEnd;
  const filterTransfer = useRef(false);
  const finalFocus = preventMenuFinalFocus
    ? false
    : () => {
        if (!filterTransfer.current) return null;
        filterTransfer.current = false;
        return false;
      };
  const closeMenuPreservingActiveFocus = (): void => {
    const focusTarget =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    filterTransfer.current = true;
    closeMenu(true);
    requestAnimationFrame(() => {
      if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
    });
  };
  const dispatch = (commandToDispatch: BrunoTableGridCommand): boolean => {
    const accepted = runtime.dispatchGridCommand(commandToDispatch);
    if (!accepted) return false;
    restoreColumnFocus(column.columnId);
    return true;
  };
  const move = (requestedIndex: number): void => {
    const targetIndex = Math.max(groupStart, Math.min(groupEnd, requestedIndex));
    if (targetIndex === index) return;
    if (
      !dispatch({
        type: "column.reorder.commit",
        columnId: column.columnId,
        targetIndex,
        pinned: command.pinned,
      })
    )
      return;
    announce(
      `${column.headerName} position ${String(targetIndex + 1)} of ${String(visibleColumnIds.length)}`,
    );
  };
  const resize = (delta: number): void => {
    const width = clampBrunoTableColumnWidth(command.width + delta, {
      min: command.minWidth,
      max: command.maxWidth,
    });
    if (width === command.width) return;
    if (!dispatch({ type: "column.resize.commit", columnId: column.columnId, width })) return;
    announce(`${column.headerName} width ${String(width)} pixels`);
  };
  const grouped = groupBy.length > 0;
  const groupingEligible =
    runtime.getGroupingEnabledSnapshot() && column.kind === "field" && column.groupBy;
  const groupingActive = groupBy.includes(column.columnId);
  const groupedResizeAvailable =
    column.columnId === "COL_ID_BRUNO_TABLE_ROWS" ||
    (column.kind === "field" && column.aggFunc !== undefined && !groupingActive);
  const visibilityColumns = grouped
    ? allColumns.filter(
        (candidate) =>
          candidate.columnId !== "COL_ID_BRUNO_TABLE_ROWS" && !groupBy.includes(candidate.columnId),
      )
    : allColumns;
  return (
    <DropdownMenuContent align="start" finalFocus={finalFocus}>
      {command.sortable ? (
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sort</DropdownMenuLabel>
          <DropdownMenuItem
            closeOnClick={false}
            aria-label={
              command.sortDirection === undefined
                ? `Sort by ${column.headerName}`
                : `Sort by ${column.headerName}, currently ${
                    command.sortDirection === "asc" ? "ascending" : "descending"
                  }${sortPriorityLabel(command.sortPriority)}`
            }
            onClick={() => {
              const accepted = runtime.dispatchGridCommand({
                type: "column.sort.toggle",
                columnId: column.columnId,
                multi: false,
              });
              if (!accepted) {
                closeMenuPreservingActiveFocus();
                return;
              }
              const next = runtime.getColumnCommandSnapshot(column.columnId);
              announce(columnSortAnnouncement(column.headerName, next));
              closeMenu();
              restoreColumnFocus(column.columnId);
            }}
          >
            Sort by {column.headerName}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      ) : null}
      {groupingEligible ? (
        <DropdownMenuGroup>
          <DropdownMenuLabel>Group</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => {
              const cancelGroupingFocus = groupingActive
                ? prepareBrunoTableGroupingRemovalFocus(runtime, column.columnId)
                : () => undefined;
              const accepted = runtime.dispatchGridCommand({
                type: groupingActive ? "grouping.remove" : "grouping.add",
                columnId: column.columnId,
              });
              if (!accepted) {
                cancelGroupingFocus();
                return;
              }
              announce(
                groupingActive
                  ? `${column.headerName} removed from Group By`
                  : `${column.headerName} added to Group By`,
              );
            }}
          >
            {groupingActive
              ? `Remove ${column.headerName} from grouping`
              : `Group by ${column.headerName}`}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      ) : null}
      {supportsBrunoTableCustomColumnFilter(column, renderColumnFilter) ||
      command.filterActive ||
      command.filterBaselineAvailable ? (
        <DropdownMenuGroup>
          <DropdownMenuLabel>Filter</DropdownMenuLabel>
          {supportsBrunoTableCustomColumnFilter(column, renderColumnFilter) ? (
            <DropdownMenuItem
              onClick={() => {
                filterTransfer.current = true;
                openHeaderFilter(column.columnId);
              }}
            >
              Open filter for {column.headerName}
            </DropdownMenuItem>
          ) : null}
          {command.filterActive || command.filterBaselineAvailable ? (
            <DropdownMenuItem
              closeOnClick={false}
              onClick={() => {
                const action = command.filterActive ? "cleared" : "reset";
                const accepted = runtime.dispatchGridCommand({
                  type: command.filterActive ? "column.filter.clear" : "column.filter.reset",
                  columnId: column.columnId,
                });
                if (!accepted) {
                  closeMenuPreservingActiveFocus();
                  return;
                }
                announce(`${column.headerName} filter ${action}`);
                closeMenu();
                restoreColumnFocus(column.columnId);
              }}
            >
              {command.filterActive ? "Clear filter" : "Reset filter"}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
      ) : null}
      {!grouped || groupedResizeAvailable ? (
        <DropdownMenuGroup>
          <DropdownMenuLabel>Resize</DropdownMenuLabel>
          <DropdownMenuItem
            disabled={command.width <= command.minWidth}
            onClick={() => resize(-10)}
          >
            Decrease width
          </DropdownMenuItem>
          <DropdownMenuItem disabled={command.width >= command.maxWidth} onClick={() => resize(10)}>
            Increase width
          </DropdownMenuItem>
        </DropdownMenuGroup>
      ) : null}
      {!grouped ? <DropdownMenuSeparator /> : null}
      {!grouped ? (
        <DropdownMenuGroup>
          <DropdownMenuLabel>Pin</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={command.pinned ?? "none"}
            onValueChange={(value) => {
              if (value === "start" || value === "end" || value === "none") {
                if (
                  !dispatch({
                    type: "column.pin.commit",
                    columnId: column.columnId,
                    pinned: value === "none" ? undefined : value,
                  })
                )
                  return;
                announce(
                  value === "none"
                    ? `${column.headerName} unpinned`
                    : `${column.headerName} pinned to logical ${value}`,
                );
              }
            }}
          >
            <DropdownMenuRadioItem value="start">
              <PushPinIcon aria-hidden="true" />
              Pin to logical start
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="end">
              <PushPinIcon aria-hidden="true" />
              Pin to logical end
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="none">
              <PushPinSlashIcon aria-hidden="true" />
              Unpin
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      ) : null}
      {!grouped ? (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Move</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem disabled={isFirst} onClick={() => move(index - 1)}>
              <MoveStartIcon aria-hidden="true" />
              Move toward logical start
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isLast} onClick={() => move(index + 1)}>
              <MoveEndIcon aria-hidden="true" />
              Move toward logical end
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ) : null}
      {visibilityColumns.length > 0 ? (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Visibility</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Columns</DropdownMenuLabel>
              {visibilityColumns.map((candidate) => {
                const visible = visibleColumnIds.includes(candidate.columnId);
                return (
                  <DropdownMenuCheckboxItem
                    key={candidate.columnId}
                    checked={visible}
                    disabled={visible && visibleColumnIds.length === 1}
                    onCheckedChange={(checked) => {
                      if (checked === true || checked === false) {
                        if (
                          !dispatch({
                            type: "column.visibility.commit",
                            columnId: candidate.columnId,
                            visible: checked,
                          })
                        )
                          return;
                        announce(`${candidate.headerName} ${checked ? "shown" : "hidden"}`);
                      }
                    }}
                  >
                    {candidate.headerName}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ) : null}
      {!grouped ? (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Reset</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem
              onClick={() => {
                if (dispatch({ type: "column.reset.order" })) announce("Column order reset");
              }}
            >
              Reset order
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                if (dispatch({ type: "column.reset.widths" })) announce("Column widths reset");
              }}
            >
              Reset widths
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                if (dispatch({ type: "column.reset.visibility" }))
                  announce("Column visibility reset");
              }}
            >
              Reset visibility
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                if (dispatch({ type: "column.reset.pinning" })) announce("Column pinning reset");
              }}
            >
              Reset pinning
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                if (dispatch({ type: "column.reset.layout" }))
                  announce("Complete column layout reset");
              }}
            >
              Reset complete layout
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ) : null}
    </DropdownMenuContent>
  );
});

const ActiveDescendantProxy = memo(function ActiveDescendantProxy({
  activeCell,
  cellRange,
  column,
  columnIndex,
  instanceId,
  runtime,
  renderColumnFilter,
  tableId,
}: {
  readonly activeCell: BrunoTableActiveCell;
  readonly cellRange?: BrunoTableCellRangeRuntime | undefined;
  readonly column: CompiledColumn | undefined;
  readonly columnIndex: number;
  readonly instanceId: string;
  readonly runtime: BrunoTableRuntimeView;
  readonly renderColumnFilter?: BrunoTableColumnFilterRenderer | undefined;
  readonly tableId: string;
}) {
  if (column === undefined || columnIndex < 0) return null;
  if (activeCell.region === "header") {
    return (
      <ActiveHeaderDescendantProxy
        column={column}
        columnIndex={columnIndex}
        instanceId={instanceId}
        renderColumnFilter={renderColumnFilter}
        runtime={runtime}
        tableId={tableId}
      />
    );
  }
  return (
    <ActiveBodyDescendantProxy
      activeCell={activeCell}
      cellRange={cellRange}
      column={column}
      columnIndex={columnIndex}
      instanceId={instanceId}
      runtime={runtime}
      tableId={tableId}
    />
  );
});

const ActiveHeaderDescendantProxy = memo(function ActiveHeaderDescendantProxy({
  column,
  columnIndex,
  instanceId,
  renderColumnFilter,
  runtime,
  tableId,
}: {
  readonly column: CompiledColumn;
  readonly columnIndex: number;
  readonly instanceId: string;
  readonly renderColumnFilter?: BrunoTableColumnFilterRenderer | undefined;
  readonly runtime: BrunoTableRuntimeView;
  readonly tableId: string;
}) {
  const subscribe = useMemo(
    () => (listener: () => void) => runtime.subscribeColumnCommands(column.columnId, listener),
    [column.columnId, runtime],
  );
  const getSnapshot = useMemo(
    () => () => runtime.getColumnCommandSnapshot(column.columnId),
    [column.columnId, runtime],
  );
  const command = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const presentation = headerSortPresentation(column.headerName, command);
  return (
    <div aria-rowindex={1} role="row" style={VISUALLY_HIDDEN}>
      <div
        id={headerDomId(instanceId, tableId, column.columnId)}
        aria-colindex={columnIndex + 1}
        aria-keyshortcuts={
          supportsBrunoTableCustomColumnFilter(column, renderColumnFilter)
            ? "Alt+Enter Alt+Shift+Enter"
            : command.filterBaselineAvailable
              ? "Alt+Enter"
              : undefined
        }
        aria-label={presentation.label}
        aria-sort={presentation.ariaSort}
        role="columnheader"
      >
        {column.headerName}
      </div>
    </div>
  );
});

const ActiveBodyDescendantProxy = memo(function ActiveBodyDescendantProxy({
  activeCell,
  cellRange,
  column,
  columnIndex,
  instanceId,
  runtime,
  tableId,
}: {
  readonly activeCell: BrunoTableActiveCell;
  readonly cellRange?: BrunoTableCellRangeRuntime | undefined;
  readonly column: CompiledColumn;
  readonly columnIndex: number;
  readonly instanceId: string;
  readonly runtime: BrunoTableRuntimeView;
  readonly tableId: string;
}) {
  const rowId = activeCell.rowId;
  const subscribeCellRange = useMemo(
    () => cellRange?.subscribe ?? (() => () => undefined),
    [cellRange],
  );
  const getCellRangeSelection = useMemo(
    () => () => rowId !== undefined && cellRange?.isCellSelected(rowId, column.columnId) === true,
    [cellRange, column.columnId, rowId],
  );
  const selected = useSyncExternalStore(
    subscribeCellRange,
    getCellRangeSelection,
    getCellRangeSelection,
  );
  const rowAware = proxyPresentationUsesRawRow(column);
  const getRowIdentitySnapshot = useMemo(
    () => () => runtime.getRowSpaceSnapshot()?.getRowId(activeCell.rowIndex),
    [activeCell.rowIndex, runtime],
  );
  const currentRowId = useSyncExternalStore(
    runtime.subscribeRowSpace,
    getRowIdentitySnapshot,
    getRowIdentitySnapshot,
  );
  const loadingSlot = rowId !== undefined && currentRowId === undefined;
  const subscribe = useMemo(
    () => (listener: () => void) =>
      rowId === undefined || loadingSlot
        ? () => undefined
        : rowAware
          ? runtime.subscribeRowCell(rowId, column.columnId, listener)
          : runtime.subscribeCell(rowId, column.columnId, listener),
    [column.columnId, loadingSlot, rowAware, rowId, runtime],
  );
  const getSnapshot = useMemo(
    () => () =>
      rowId === undefined || loadingSlot
        ? undefined
        : rowAware
          ? runtime.getRowCellSnapshot(rowId, column.columnId)
          : runtime.getCellSnapshot(rowId, column.columnId),
    [column.columnId, loadingSlot, rowAware, rowId, runtime],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const cellSnapshot = rowAware ? undefined : (snapshot as BrunoTableCellSnapshot | undefined);
  const rowSnapshot = rowAware ? (snapshot as BrunoTableRowCellSnapshot | undefined) : undefined;
  const row = rowSnapshot?.row;
  const unavailable = rowAware
    ? rowSnapshot?.kind === "unavailable"
    : cellSnapshot?.kind === "unavailable";
  const rowPresent = rowAware
    ? row !== undefined
    : cellSnapshot?.kind === "available" && cellSnapshot.rowPresent;
  const value = rowAware ? rowSnapshot?.value : cellSnapshot?.value;
  const invalid = isBrunoTableInvalidCellValue(value) ? value : undefined;
  const content = loadingSlot
    ? "Loading row"
    : unavailable
      ? null
      : !rowPresent
        ? "Loading row"
        : invalid
          ? invalidSourceDetails(invalid.invalid)
          : resolveProxyCellContent(column, row, value);
  return (
    <div aria-rowindex={activeCell.rowIndex + 2} role="row" style={VISUALLY_HIDDEN}>
      <div
        id={activeDomIdForRowIdentity(instanceId, tableId, activeCell, currentRowId)}
        data-bruno-active-proxy=""
        aria-colindex={columnIndex + 1}
        aria-selected={selected || undefined}
        role="gridcell"
      >
        {content}
      </div>
    </div>
  );
});

const UnloadedRow = memo(function UnloadedRow({
  attachBodyLayer,
  center,
  centerStartIndex,
  instanceId,
  leftPadding,
  logicalRowIndex,
  pinnedEnd,
  pinnedStart,
  rightPadding,
  tableId,
  top,
  viewportFill,
  width,
  rowSelection,
  columnIndexOffset,
}: {
  readonly attachBodyLayer: RefCallback<HTMLElement>;
  readonly center: readonly CompiledColumn[];
  readonly centerStartIndex: number;
  readonly instanceId: string;
  readonly leftPadding: number;
  readonly logicalRowIndex: number;
  readonly pinnedEnd: readonly CompiledColumn[];
  readonly pinnedStart: readonly CompiledColumn[];
  readonly rightPadding: number;
  readonly tableId: string;
  readonly top: number;
  readonly viewportFill: number;
  readonly width: number;
  readonly rowSelection?: BrunoTableRowSelectionRuntime | undefined;
  readonly columnIndexOffset: number;
}) {
  return (
    <LoadingRow
      ariaRowIndexOffset={2}
      attachBodyLayer={attachBodyLayer}
      center={center}
      centerStartIndex={centerStartIndex}
      instanceId={instanceId}
      leftPadding={leftPadding}
      logicalRowIndex={logicalRowIndex}
      pinnedEnd={pinnedEnd}
      pinnedStart={pinnedStart}
      rightPadding={rightPadding}
      tableId={tableId}
      top={top}
      viewportFill={viewportFill}
      width={width}
      rowSelection={rowSelection}
      columnIndexOffset={columnIndexOffset}
    />
  );
});

type BrunoTableRowProps = Readonly<{
  readonly attachBodyLayer: RefCallback<HTMLElement>;
  readonly rowId: string;
  readonly instanceId: string;
  readonly tableId: string;
  readonly centerStartIndex: number;
  readonly pinnedStartCount: number;
  readonly runtime: BrunoTableRuntimeView;
  readonly center: readonly CompiledColumn[];
  readonly pinnedStart: readonly CompiledColumn[];
  readonly pinnedEnd: readonly CompiledColumn[];
  readonly leftPadding: number;
  readonly rightPadding: number;
  readonly viewportFill: number;
  readonly logicalRowIndex: number;
  readonly top: number;
  readonly width: number;
  readonly rowSelection?: BrunoTableRowSelectionRuntime | undefined;
  readonly columnIndexOffset: number;
}>;

const BrunoTableRow = memo(function BrunoTableRow(props: BrunoTableRowProps) {
  const {
    attachBodyLayer,
    rowId,
    instanceId,
    tableId,
    centerStartIndex,
    pinnedStartCount,
    runtime,
    center,
    pinnedStart,
    pinnedEnd,
    leftPadding,
    rightPadding,
    viewportFill,
    logicalRowIndex,
    top,
    width,
    rowSelection,
    columnIndexOffset,
  } = props;
  const ownedCells = useMemo(
    () =>
      [...pinnedStart, ...center, ...pinnedEnd]
        .map((column) => cellDomId(instanceId, tableId, rowId, column.columnId))
        .join(" "),
    [center, instanceId, pinnedEnd, pinnedStart, rowId, tableId],
  );
  return (
    <tr
      ref={attachBodyLayer}
      role="row"
      aria-rowindex={logicalRowIndex + 2}
      aria-owns={ownedCells === "" ? undefined : ownedCells}
      style={{
        display: "table",
        height: ROW_HEIGHT,
        maxHeight: ROW_HEIGHT,
        overflow: "hidden",
        position: "absolute",
        tableLayout: "fixed",
        top,
        willChange: "transform",
        width: rowSelectionSurfaceWidth(width, rowSelection),
      }}
    >
      {__BRUNO_TABLE_TEST_DIAGNOSTICS__ ? (
        <BrunoTableRowCommitDiagnosticProbe
          commitEvidence={props}
          rowId={rowId}
          tableId={tableId}
        />
      ) : null}
      {rowSelection === undefined ? null : (
        <BrunoTableRowSelectionCell
          logicalRowIndex={logicalRowIndex}
          rowId={rowId}
          selection={rowSelection}
          tableId={tableId}
        />
      )}
      {pinnedStart.length > 0 ? (
        <td
          aria-hidden="true"
          style={{
            padding: 0,
            width: `var(${brunoTablePinnedWidthCssVariable("start")}, ${String(totalColumnWidth(pinnedStart))}px)`,
          }}
        />
      ) : null}
      {center.length > 0 ? (
        <td
          aria-hidden="true"
          style={{
            padding: 0,
            width: `var(${BRUNO_TABLE_LIVE_LEFT_PADDING_CSS_VARIABLE}, ${String(leftPadding)}px)`,
          }}
        />
      ) : null}
      {center.map((column, index) => (
        <BrunoTableCell
          key={column.columnId}
          runtime={runtime}
          rowId={rowId}
          instanceId={instanceId}
          tableId={tableId}
          columnIndex={columnIndexOffset + pinnedStartCount + centerStartIndex + index}
          column={column}
          logicalRowIndex={logicalRowIndex}
        />
      ))}
      {center.length > 0 ? (
        <td
          aria-hidden="true"
          style={{
            padding: 0,
            width: `var(${BRUNO_TABLE_LIVE_RIGHT_PADDING_CSS_VARIABLE}, ${String(rightPadding)}px)`,
          }}
        />
      ) : null}
      {pinnedEnd.length > 0 ? (
        <td
          aria-hidden="true"
          style={{
            padding: 0,
            width: rowSelectionViewportFillWidth(viewportFill, rowSelection),
          }}
        />
      ) : null}
      {pinnedEnd.length > 0 ? (
        <td
          aria-hidden="true"
          style={{
            padding: 0,
            width: `var(${brunoTablePinnedWidthCssVariable("end")}, ${String(totalColumnWidth(pinnedEnd))}px)`,
          }}
        />
      ) : null}
    </tr>
  );
});

const BrunoTablePinnedBodyRegion = memo(function BrunoTablePinnedBodyRegion({
  attachBodyLayer,
  columns,
  instanceId,
  layerWidth,
  pinnedStartCount,
  precedingColumnCount = 0,
  rowEnd,
  rowSpace,
  rowStart,
  runtime,
  side,
  tableId,
  totalHeight,
  leadingUtilityWidth,
  columnIndexOffset,
}: {
  readonly attachBodyLayer: RefCallback<HTMLElement>;
  readonly columns: readonly CompiledColumn[];
  readonly instanceId: string;
  readonly layerWidth: number;
  readonly pinnedStartCount: number;
  readonly precedingColumnCount?: number;
  readonly rowEnd: number;
  readonly rowSpace: BrunoTableLogicalRowSpace;
  readonly rowStart: number;
  readonly runtime: BrunoTableRuntimeView;
  readonly side: "start" | "end";
  readonly tableId: string;
  readonly totalHeight: number;
  readonly leadingUtilityWidth: number;
  readonly columnIndexOffset: number;
}) {
  const width = totalColumnWidth(columns);
  return (
    <BrunoTablePinnedOverlayShell
      layerWidth={layerWidth}
      side={side}
      top={ROW_HEIGHT}
      totalHeight={totalHeight}
      width={width}
      leadingUtilityWidth={leadingUtilityWidth}
    >
      {Array.from({ length: rowEnd - rowStart }, (_, offset) => {
        const logicalRowIndex = rowStart + offset;
        const rowId = rowSpace.getRowId(logicalRowIndex);
        return (
          <tr
            ref={attachBodyLayer}
            key={rowId === undefined ? `slot:${String(offset)}` : `row:${rowId}`}
            role="presentation"
            style={{
              display: "table",
              height: ROW_HEIGHT,
              maxHeight: ROW_HEIGHT,
              overflow: "hidden",
              position: "absolute",
              tableLayout: "fixed",
              top: offset * ROW_HEIGHT,
              willChange: "transform",
              width: `var(${brunoTablePinnedWidthCssVariable(side)}, ${String(width)}px)`,
            }}
          >
            {columns.map((column, index) =>
              rowId === undefined ? (
                <LoadingCell
                  key={column.columnId}
                  column={column}
                  columnIndex={
                    columnIndexOffset +
                    (side === "start" ? index : pinnedStartCount + precedingColumnCount + index)
                  }
                  id={loadingCellDomId(instanceId, tableId, logicalRowIndex, column.columnId)}
                />
              ) : (
                <BrunoTableCell
                  key={column.columnId}
                  column={column}
                  columnIndex={
                    columnIndexOffset +
                    (side === "start" ? index : pinnedStartCount + precedingColumnCount + index)
                  }
                  instanceId={instanceId}
                  rowId={rowId}
                  runtime={runtime}
                  tableId={tableId}
                  logicalRowIndex={logicalRowIndex}
                />
              ),
            )}
          </tr>
        );
      })}
    </BrunoTablePinnedOverlayShell>
  );
});

const BrunoTablePinnedOverlayShell = memo(function BrunoTablePinnedOverlayShell({
  children,
  layerWidth,
  side,
  top,
  totalHeight,
  width,
  leadingUtilityWidth,
}: {
  readonly children: ReactNode;
  readonly layerWidth: number;
  readonly side: "start" | "end";
  readonly top: number;
  readonly totalHeight: number;
  readonly width: number | string;
  readonly leadingUtilityWidth: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        height: totalHeight,
        insetInlineStart: 0,
        pointerEvents: "none",
        position: "absolute",
        top,
        width: surfaceWidthWithUtility(layerWidth, leadingUtilityWidth),
        zIndex: 3,
      }}
    >
      <div
        data-bruno-pinned-body-region={side}
        data-pinned-region={side}
        style={{
          background: "Canvas",
          height: totalHeight,
          insetInlineEnd: side === "end" ? 0 : undefined,
          insetInlineStart: side === "start" ? leadingUtilityWidth : undefined,
          marginInlineStart: side === "end" ? "auto" : undefined,
          pointerEvents: "auto",
          position: "sticky",
          width: `var(${brunoTablePinnedWidthCssVariable(side)}, ${String(width)}px)`,
        }}
      >
        <table
          role="presentation"
          style={{
            tableLayout: "fixed",
            width: `var(${brunoTablePinnedWidthCssVariable(side)}, ${String(width)}px)`,
          }}
        >
          <tbody
            role="presentation"
            style={{ display: "block", height: totalHeight, position: "relative" }}
          >
            {children}
          </tbody>
        </table>
      </div>
    </div>
  );
});

type BrunoTableCellProps = Readonly<{
  readonly runtime: BrunoTableRuntimeView;
  readonly rowId: string;
  readonly instanceId?: string;
  readonly tableId?: string;
  readonly columnIndex?: number;
  readonly column: CompiledColumn;
  readonly logicalRowIndex: number;
}>;

const BrunoTableCell = memo(function BrunoTableCell(props: BrunoTableCellProps) {
  const { runtime, rowId, instanceId, tableId, columnIndex, column, logicalRowIndex } = props;
  const rowAware = cellPresentationUsesRawRow(column);
  const subscribe = useMemo(
    () => (listener: () => void) =>
      rowAware
        ? runtime.subscribeRowCell(rowId, column.columnId, listener)
        : runtime.subscribeCell(rowId, column.columnId, listener),
    [column.columnId, rowAware, rowId, runtime],
  );
  const getSnapshot = useMemo(
    () => () =>
      rowAware
        ? runtime.getRowCellSnapshot(rowId, column.columnId)
        : runtime.getCellSnapshot(rowId, column.columnId),
    [column.columnId, rowAware, rowId, runtime],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const cellSnapshot = rowAware ? undefined : (snapshot as BrunoTableCellSnapshot);
  const rowSnapshot = rowAware ? (snapshot as BrunoTableRowCellSnapshot) : undefined;
  const presentationColumn = snapshot.column;
  const row = rowSnapshot?.row;
  const unavailable =
    presentationColumn === undefined ||
    (rowAware ? rowSnapshot?.kind === "unavailable" : cellSnapshot?.kind === "unavailable");
  const rowMissing = rowAware
    ? row === undefined
    : cellSnapshot?.kind === "available" && !cellSnapshot.rowPresent;
  const value = rowAware ? rowSnapshot?.value : cellSnapshot?.value;
  const invalid = isBrunoTableInvalidCellValue(value) ? value : undefined;
  const className =
    invalid || unavailable || rowMissing || presentationColumn === undefined
      ? undefined
      : resolveCellClassName(presentationColumn, row, value);
  const content =
    unavailable || rowMissing || presentationColumn === undefined ? null : invalid ? (
      <span role="alert">{invalidSourceDetails(invalid.invalid)}</span>
    ) : (
      resolveCellContent(presentationColumn, row, value)
    );
  const id =
    instanceId === undefined || tableId === undefined || columnIndex === undefined
      ? undefined
      : cellDomId(instanceId, tableId, rowId, column.columnId);
  const cellStyle: CSSProperties = {
    boxSizing: "border-box",
    height: ROW_HEIGHT,
    maxHeight: ROW_HEIGHT,
    overflow: "hidden",
    padding: 0,
    textAlign: presentationColumn?.semantics.cellAlign,
    transform: `var(${brunoTableColumnCssVariable("transform", column.columnId)}, none)`,
    width: `var(${brunoTableColumnCssVariable("width", column.columnId)}, ${String(column.semantics.width)}px)`,
  };
  const cellContent = (
    <div
      style={{
        boxSizing: "border-box",
        height: ROW_HEIGHT,
        maxHeight: ROW_HEIGHT,
        overflow: "hidden",
        width: "100%",
      }}
    >
      {rowMissing || invalid || presentationColumn?.cellRenderer === undefined ? (
        content
      ) : (
        <NonTabbableCellContent>{content}</NonTabbableCellContent>
      )}
    </div>
  );
  return (
    <td
      id={id}
      data-bruno-column-id={column.columnId}
      data-bruno-row-id={rowId}
      data-bruno-row-index={logicalRowIndex}
      aria-colindex={columnIndex === undefined ? undefined : columnIndex + 1}
      className={className}
      role="gridcell"
      style={cellStyle}
    >
      {__BRUNO_TABLE_TEST_DIAGNOSTICS__ ? (
        <BrunoTableCellCommitDiagnosticProbe
          columnId={column.columnId}
          commitEvidence={[props, snapshot]}
          rowId={rowId}
          tableId={tableId}
        />
      ) : null}
      {cellContent}
    </td>
  );
});

function NonTabbableCellContent({ children }: { readonly children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (root === null) return;
    const grid = root.closest<HTMLElement>('[role="grid"]');
    const originalTabIndexes = new WeakMap<InteractiveDomElement, string | null>();
    const pendingManagedTabIndexWrites = new WeakMap<InteractiveDomElement, number>();
    const trackedCandidates = new Set<InteractiveDomElement>();
    let focusedCandidate: InteractiveDomElement | null = null;
    const trackFocusedCandidate = (event: FocusEvent) => {
      if (
        (event.target instanceof HTMLElement || event.target instanceof SVGElement) &&
        root.contains(event.target)
      ) {
        focusedCandidate = event.target;
      }
    };
    root.addEventListener("focusin", trackFocusedCandidate);
    const restoreTabIndex = (candidate: InteractiveDomElement) => {
      const tabIndex = originalTabIndexes.get(candidate);
      if (tabIndex === null) candidate.removeAttribute("tabindex");
      else if (tabIndex !== undefined) candidate.setAttribute("tabindex", tabIndex);
    };
    const writeManagedTabIndex = (candidate: InteractiveDomElement) => {
      pendingManagedTabIndexWrites.set(
        candidate,
        (pendingManagedTabIndexWrites.get(candidate) ?? 0) + 1,
      );
      candidate.setAttribute("tabindex", "-1");
    };
    const removeFromTabOrder = (records: readonly MutationRecord[] = []) => {
      for (const record of records) {
        if (
          record.type !== "attributes" ||
          record.attributeName !== "tabindex" ||
          (!(record.target instanceof HTMLElement) && !(record.target instanceof SVGElement))
        ) {
          continue;
        }
        const managedWrites = pendingManagedTabIndexWrites.get(record.target) ?? 0;
        if (managedWrites > 0) {
          if (managedWrites === 1) pendingManagedTabIndexWrites.delete(record.target);
          else pendingManagedTabIndexWrites.set(record.target, managedWrites - 1);
          continue;
        }
        if (trackedCandidates.has(record.target)) {
          originalTabIndexes.set(record.target, record.target.getAttribute("tabindex"));
        }
      }
      for (const candidate of trackedCandidates) {
        if (root.contains(candidate)) continue;
        const recoverGridFocus =
          candidate === focusedCandidate && document.activeElement === document.body;
        restoreTabIndex(candidate);
        trackedCandidates.delete(candidate);
        if (candidate === focusedCandidate) focusedCandidate = null;
        if (recoverGridFocus) grid?.focus({ preventScroll: true });
      }
      for (const candidate of root.querySelectorAll<InteractiveDomElement>(
        INTERACTIVE_DESCENDANT_SELECTOR,
      )) {
        if (!trackedCandidates.has(candidate)) {
          originalTabIndexes.set(candidate, candidate.getAttribute("tabindex"));
          trackedCandidates.add(candidate);
        }
        if (candidate.getAttribute("tabindex") !== "-1") writeManagedTabIndex(candidate);
      }
      if (
        focusedCandidate !== null &&
        root.contains(focusedCandidate) &&
        (document.activeElement === document.body ||
          (document.activeElement !== null && focusedCandidate.contains(document.activeElement))) &&
        !interactiveDescendantIsUsable(focusedCandidate)
      ) {
        focusedCandidate = null;
        grid?.focus({ preventScroll: true });
      }
    };
    const observer = new MutationObserver(removeFromTabOrder);
    observer.observe(root, {
      attributes: true,
      attributeFilter: [
        "aria-hidden",
        "class",
        "contenteditable",
        "controls",
        "disabled",
        "hidden",
        "href",
        "inert",
        "style",
        "tabindex",
      ],
      childList: true,
      subtree: true,
    });
    removeFromTabOrder();
    root.removeAttribute("inert");
    return () => {
      observer.disconnect();
      root.removeEventListener("focusin", trackFocusedCandidate);
      if (document.activeElement !== null && root.contains(document.activeElement)) {
        grid?.focus({ preventScroll: true });
      }
      for (const candidate of trackedCandidates) restoreTabIndex(candidate);
      trackedCandidates.clear();
    };
  }, []);
  return (
    <span ref={ref} inert style={{ display: "contents" }}>
      {children}
    </span>
  );
}

function headerSortPresentation(
  headerName: string,
  command: BrunoTableColumnCommandSnapshot,
): Readonly<{
  readonly ariaSort?: "ascending" | "descending";
  readonly direction?: "ascending" | "descending";
  readonly label: string;
}> {
  const direction =
    command.sortDirection === "asc"
      ? "ascending"
      : command.sortDirection === "desc"
        ? "descending"
        : undefined;
  return Object.freeze({
    ...(command.sortPriority === 1 && direction !== undefined ? { ariaSort: direction } : {}),
    ...(direction === undefined ? {} : { direction }),
    label:
      direction === undefined
        ? headerName
        : `${headerName}, sorted ${direction}${sortPriorityLabel(command.sortPriority)}`,
  });
}

function sortPriorityLabel(priority: number | undefined): string {
  return priority === undefined ? "" : `, priority ${String(priority)}`;
}

function columnSortAnnouncement(
  headerName: string,
  command: BrunoTableColumnCommandSnapshot,
): string {
  if (command.sortDirection === undefined) return `${headerName} sorting cleared`;
  const direction = command.sortDirection === "asc" ? "ascending" : "descending";
  return `${headerName} sorted ${direction}${sortPriorityLabel(command.sortPriority)}`;
}

function focusFirstInteractiveDescendant(cell: HTMLElement): boolean {
  for (const candidate of cell.querySelectorAll<InteractiveDomElement>(
    INTERACTIVE_DESCENDANT_SELECTOR,
  )) {
    if (candidate.matches(EMBEDDED_BROWSING_CONTEXT_SELECTOR)) continue;
    if (!interactiveDescendantIsUsable(candidate)) continue;
    candidate.focus({ preventScroll: true });
    if (document.activeElement === candidate) return true;
  }
  return false;
}

function interactiveDescendantIsUsable(candidate: InteractiveDomElement): boolean {
  return (
    !candidate.matches(":disabled") &&
    candidate.closest("[inert]") === null &&
    candidate.closest('[aria-hidden="true"]') === null &&
    candidate.getClientRects().length > 0
  );
}

function pinnedCellStyle(
  side: "start" | "end",
  columns: readonly CompiledColumn[],
  index: number,
  leadingUtilityWidth = 0,
): CSSProperties {
  const column = columns[index];
  let offset = 0;
  if (side === "start") {
    for (let cursor = 0; cursor < index; cursor += 1) {
      offset += columns[cursor]?.semantics.width ?? 0;
    }
  } else {
    for (let cursor = index + 1; cursor < columns.length; cursor += 1) {
      offset += columns[cursor]?.semantics.width ?? 0;
    }
  }
  if (side === "start") offset += leadingUtilityWidth;
  return {
    background: "Canvas",
    minWidth:
      column === undefined
        ? undefined
        : `var(${brunoTableColumnCssVariable("width", column.columnId)}, ${String(column.semantics.width)}px)`,
    padding: 0,
    position: "sticky",
    transform:
      column === undefined
        ? undefined
        : `var(${brunoTableColumnCssVariable("transform", column.columnId)}, none)`,
    width:
      column === undefined
        ? undefined
        : `var(${brunoTableColumnCssVariable("width", column.columnId)}, ${String(column.semantics.width)}px)`,
    zIndex: 3,
    ...(column === undefined
      ? {}
      : side === "start"
        ? {
            insetInlineStart: `var(${brunoTableColumnCssVariable("pinned-start-offset", column.columnId)}, ${String(offset)}px)`,
          }
        : {
            insetInlineEnd: `var(${brunoTableColumnCssVariable("pinned-end-offset", column.columnId)}, ${String(offset)}px)`,
          }),
  };
}

function hasRenderableChildren(children: ReactNode): boolean {
  return Children.toArray(children).some((child) => {
    if (!isValidElement(child)) return true;
    if (child.type !== Fragment && child.type !== BrunoTableToolbar) return true;
    return hasRenderableChildren(
      (child as ReactElement<{ readonly children?: ReactNode }>).props.children,
    );
  });
}

function cellPresentationUsesRawRow(column: CompiledColumn): boolean {
  return (
    column.valueFormatter !== undefined ||
    typeof column.cellClassName === "function" ||
    column.cellRenderer !== undefined
  );
}

function proxyPresentationUsesRawRow(column: CompiledColumn): boolean {
  return column.valueFormatter !== undefined;
}

function resolveCellText(column: CompiledColumn, row: unknown, value: unknown): string {
  if (column.valueFormatter !== undefined) {
    const formatted = Reflect.apply(column.valueFormatter, undefined, [{ row, value }]);
    if (typeof formatted === "string") return formatted;
  }
  if (value === null || value === undefined) return "";
  return column.semantics.formatDisplay(value);
}

function resolveCellContent(column: CompiledColumn, row: unknown, value: unknown): ReactNode {
  if (column.cellRenderer !== undefined) return resolveCellRenderer(column, row, value);
  const booleanContent = resolveBooleanCellContent(column, value);
  if (booleanContent !== undefined) return booleanContent;
  return resolveCellText(column, row, value);
}

function resolveProxyCellContent(column: CompiledColumn, row: unknown, value: unknown): ReactNode {
  const booleanContent = resolveBooleanCellContent(column, value);
  if (booleanContent !== undefined) return booleanContent;
  return resolveCellText(column, row, value);
}

function resolveBooleanCellContent(column: CompiledColumn, value: unknown): ReactNode | undefined {
  if (
    column.valueFormatter === undefined &&
    column.valueType === "boolean" &&
    typeof value === "boolean"
  ) {
    return <input aria-label={column.headerName} checked={value} disabled type="checkbox" />;
  }
  return undefined;
}

function resolveCellClassName(
  column: CompiledColumn,
  row: unknown,
  value: unknown,
): string | undefined {
  if (typeof column.cellClassName === "string") return column.cellClassName;
  if (column.cellClassName === undefined) return undefined;
  const className = Reflect.apply(column.cellClassName, undefined, [{ row, value }]);
  return typeof className === "string" ? className : undefined;
}

function resolveCellRenderer(
  column: CompiledColumn,
  row: unknown,
  value: unknown,
): ReactNode | undefined {
  if (column.cellRenderer === undefined) return undefined;
  return Reflect.apply(column.cellRenderer, undefined, [{ row, value }]) as ReactNode | undefined;
}

const DEFAULT_LOADING_ROW_COUNT = 5;

const LoadingRows = memo(function LoadingRows({
  runtime,
  totalRows,
  compiledColumns,
  focusFallback,
  focusHandoff,
  tableId,
  rowSelection,
}: {
  readonly runtime: BrunoTableRuntimeView;
  readonly totalRows: number;
  readonly compiledColumns: readonly CompiledColumn[];
  readonly focusFallback: () => void;
  readonly focusHandoff: BrunoTableBodyFocusHandoff;
  readonly tableId: string;
  readonly rowSelection?: BrunoTableRowSelectionRuntime | undefined;
}) {
  const rowSelectionWidth = rowSelection === undefined ? 0 : ROW_SELECTION_COLUMN_WIDTH;
  return (
    <BrunoTableLoadingViewportAdapterBoundary
      key={rowSelection === undefined ? "no-leading-utility" : "row-selection-utility"}
      compiledColumns={compiledColumns}
      defaultLoadingRowCount={DEFAULT_LOADING_ROW_COUNT}
      focusFallback={focusFallback}
      focusHandoff={focusHandoff}
      runtime={runtime}
      totalRows={totalRows}
      leadingUtilityWidth={rowSelectionWidth}
    >
      {(adapter) => {
        const virtualWindow = adapter.viewportSnapshot.virtualWindow;
        const tableWidth = virtualWindow.totalWidth;
        const viewportFill =
          virtualWindow.pinnedEnd.length === 0
            ? 0
            : Math.max(0, adapter.viewportSnapshot.width - tableWidth);
        const renderedTableWidth = tableWidth + viewportFill;
        return (
          <div style={{ position: "relative" }}>
            <div
              ref={adapter.attachGrid}
              aria-busy="true"
              aria-colcount={adapter.columns.length + (rowSelection === undefined ? 0 : 1)}
              aria-label="Loading table rows"
              aria-rowcount={adapter.logicalRowCount}
              data-bruno-scroll-owner=""
              role="grid"
              tabIndex={0}
              style={{
                maxHeight: BRUNO_TABLE_DEFAULT_VIEWPORT_HEIGHT,
                overflow: "auto",
                position: "relative",
              }}
            >
              <div
                ref={adapter.attachRowLayer}
                data-bruno-row-layer=""
                style={{
                  position: "relative",
                  width: rowSelectionSurfaceWidth(renderedTableWidth, rowSelection),
                }}
              >
                <table
                  role="presentation"
                  style={{
                    tableLayout: "fixed",
                    width: rowSelectionSurfaceWidth(renderedTableWidth, rowSelection),
                  }}
                >
                  <tbody
                    role="rowgroup"
                    style={{
                      display: "block",
                      height: virtualWindow.totalHeight,
                      position: "relative",
                      width: rowSelectionSurfaceWidth(renderedTableWidth, rowSelection),
                    }}
                  >
                    {Array.from(
                      { length: virtualWindow.rowEnd - virtualWindow.rowStart },
                      (_, offset) => (
                        <LoadingRow
                          key={`loading-slot-${String(offset)}`}
                          attachBodyLayer={adapter.attachBodyLayer}
                          center={virtualWindow.center}
                          centerStartIndex={virtualWindow.centerStartIndex}
                          instanceId={adapter.instanceId}
                          leftPadding={virtualWindow.leftPadding}
                          logicalRowIndex={virtualWindow.rowStart + offset}
                          pinnedEnd={virtualWindow.pinnedEnd}
                          pinnedStart={virtualWindow.pinnedStart}
                          rightPadding={virtualWindow.rightPadding}
                          tableId={tableId}
                          top={offset * ROW_HEIGHT}
                          viewportFill={viewportFill}
                          width={renderedTableWidth}
                          rowSelection={rowSelection}
                          columnIndexOffset={rowSelection === undefined ? 0 : 1}
                        />
                      ),
                    )}
                  </tbody>
                </table>
                {virtualWindow.pinnedStart.length > 0 ? (
                  <LoadingPinnedBodyRegion
                    attachBodyLayer={adapter.attachBodyLayer}
                    columns={virtualWindow.pinnedStart}
                    instanceId={adapter.instanceId}
                    layerWidth={renderedTableWidth}
                    pinnedStartCount={virtualWindow.pinnedStart.length}
                    rowEnd={virtualWindow.rowEnd}
                    rowStart={virtualWindow.rowStart}
                    side="start"
                    tableId={tableId}
                    totalHeight={virtualWindow.totalHeight}
                    leadingUtilityWidth={rowSelectionWidth}
                    columnIndexOffset={rowSelection === undefined ? 0 : 1}
                  />
                ) : null}
                {virtualWindow.pinnedEnd.length > 0 ? (
                  <LoadingPinnedBodyRegion
                    attachBodyLayer={adapter.attachBodyLayer}
                    columns={virtualWindow.pinnedEnd}
                    instanceId={adapter.instanceId}
                    layerWidth={renderedTableWidth}
                    pinnedStartCount={virtualWindow.pinnedStart.length}
                    precedingColumnCount={virtualWindow.centerCount}
                    rowEnd={virtualWindow.rowEnd}
                    rowStart={virtualWindow.rowStart}
                    side="end"
                    tableId={tableId}
                    totalHeight={virtualWindow.totalHeight}
                    leadingUtilityWidth={rowSelectionWidth}
                    columnIndexOffset={rowSelection === undefined ? 0 : 1}
                  />
                ) : null}
              </div>
            </div>
            <BrunoTableScrollbarOverlay attach={adapter.attachScrollbarOverlay} />
          </div>
        );
      }}
    </BrunoTableLoadingViewportAdapterBoundary>
  );
});

const LoadingPinnedBodyRegion = memo(function LoadingPinnedBodyRegion({
  attachBodyLayer,
  columns,
  instanceId,
  layerWidth,
  pinnedStartCount,
  precedingColumnCount = 0,
  rowEnd,
  rowStart,
  side,
  tableId,
  totalHeight,
  leadingUtilityWidth,
  columnIndexOffset,
}: {
  readonly attachBodyLayer: RefCallback<HTMLElement>;
  readonly columns: readonly CompiledColumn[];
  readonly instanceId: string;
  readonly layerWidth: number;
  readonly pinnedStartCount: number;
  readonly precedingColumnCount?: number;
  readonly rowEnd: number;
  readonly rowStart: number;
  readonly side: "start" | "end";
  readonly tableId: string;
  readonly totalHeight: number;
  readonly leadingUtilityWidth: number;
  readonly columnIndexOffset: number;
}) {
  const width = totalColumnWidth(columns);
  return (
    <BrunoTablePinnedOverlayShell
      layerWidth={layerWidth}
      leadingUtilityWidth={leadingUtilityWidth}
      side={side}
      top={0}
      totalHeight={totalHeight}
      width={width}
    >
      {Array.from({ length: rowEnd - rowStart }, (_, offset) => (
        <tr
          ref={attachBodyLayer}
          key={`pinned-loading-slot-${String(offset)}`}
          role="presentation"
          style={{
            display: "table",
            height: ROW_HEIGHT,
            maxHeight: ROW_HEIGHT,
            overflow: "hidden",
            position: "absolute",
            tableLayout: "fixed",
            top: offset * ROW_HEIGHT,
            willChange: "transform",
            width: `var(${BRUNO_TABLE_LIVE_TOTAL_WIDTH_CSS_VARIABLE}, ${String(width)}px)`,
          }}
        >
          {columns.map((column, index) => (
            <LoadingCell
              key={column.columnId}
              column={column}
              columnIndex={
                columnIndexOffset +
                (side === "start" ? index : pinnedStartCount + precedingColumnCount + index)
              }
              id={loadingCellDomId(instanceId, tableId, rowStart + offset, column.columnId)}
            />
          ))}
        </tr>
      ))}
    </BrunoTablePinnedOverlayShell>
  );
});

const LoadingRow = memo(function LoadingRow({
  ariaRowIndexOffset = 1,
  attachBodyLayer,
  center,
  centerStartIndex,
  instanceId,
  leftPadding,
  logicalRowIndex,
  pinnedEnd,
  pinnedStart,
  rightPadding,
  tableId,
  top,
  viewportFill,
  width,
  rowSelection,
  columnIndexOffset = 0,
}: {
  readonly ariaRowIndexOffset?: number;
  readonly attachBodyLayer: RefCallback<HTMLElement>;
  readonly center: readonly CompiledColumn[];
  readonly centerStartIndex: number;
  readonly instanceId: string;
  readonly leftPadding: number;
  readonly logicalRowIndex: number;
  readonly pinnedEnd: readonly CompiledColumn[];
  readonly pinnedStart: readonly CompiledColumn[];
  readonly rightPadding: number;
  readonly tableId: string;
  readonly top: number;
  readonly viewportFill: number;
  readonly width: number;
  readonly rowSelection?: BrunoTableRowSelectionRuntime | undefined;
  readonly columnIndexOffset?: number;
}) {
  const ownedCells = useMemo(
    () =>
      [...pinnedStart, ...center, ...pinnedEnd]
        .map((column) => loadingCellDomId(instanceId, tableId, logicalRowIndex, column.columnId))
        .join(" "),
    [center, instanceId, logicalRowIndex, pinnedEnd, pinnedStart, tableId],
  );
  return (
    <tr
      ref={attachBodyLayer}
      aria-rowindex={logicalRowIndex + ariaRowIndexOffset}
      aria-owns={ownedCells === "" ? undefined : ownedCells}
      role="row"
      style={{
        display: "table",
        height: ROW_HEIGHT,
        maxHeight: ROW_HEIGHT,
        overflow: "hidden",
        position: "absolute",
        tableLayout: "fixed",
        top,
        willChange: "transform",
        width: rowSelectionSurfaceWidth(width, rowSelection),
      }}
    >
      {rowSelection === undefined ? null : <BrunoTableRowSelectionLoadingCell />}
      {pinnedStart.length > 0 ? (
        <td
          aria-hidden="true"
          style={{
            padding: 0,
            width: `var(${brunoTablePinnedWidthCssVariable("start")}, ${String(totalColumnWidth(pinnedStart))}px)`,
          }}
        />
      ) : null}
      {center.length > 0 ? (
        <td
          aria-hidden="true"
          style={{
            padding: 0,
            width: `var(${BRUNO_TABLE_LIVE_LEFT_PADDING_CSS_VARIABLE}, ${String(leftPadding)}px)`,
          }}
        />
      ) : null}
      {center.map((column, index) => (
        <LoadingCell
          key={column.columnId}
          column={column}
          columnIndex={columnIndexOffset + pinnedStart.length + centerStartIndex + index}
          id={loadingCellDomId(instanceId, tableId, logicalRowIndex, column.columnId)}
        />
      ))}
      {center.length > 0 ? (
        <td
          aria-hidden="true"
          style={{
            padding: 0,
            width: `var(${BRUNO_TABLE_LIVE_RIGHT_PADDING_CSS_VARIABLE}, ${String(rightPadding)}px)`,
          }}
        />
      ) : null}
      {pinnedEnd.length > 0 ? (
        <td
          aria-hidden="true"
          style={{
            padding: 0,
            width: rowSelectionViewportFillWidth(viewportFill, rowSelection),
          }}
        />
      ) : null}
      {pinnedEnd.length > 0 ? (
        <td
          aria-hidden="true"
          style={{
            padding: 0,
            width: `var(${brunoTablePinnedWidthCssVariable("end")}, ${String(totalColumnWidth(pinnedEnd))}px)`,
          }}
        />
      ) : null}
    </tr>
  );
});

const LoadingCell = memo(function LoadingCell({
  column,
  columnIndex,
  id,
}: {
  readonly column: CompiledColumn;
  readonly columnIndex: number;
  readonly id: string;
}) {
  const skeletonStyle = loadingSkeletonStyle(column);
  const props = {
    id,
    "data-bruno-column-id": column.columnId,
    "aria-colindex": columnIndex + 1,
    "aria-label": `Loading ${column.headerName}`,
    role: "gridcell",
    style: {
      boxSizing: "border-box",
      height: ROW_HEIGHT,
      maxHeight: ROW_HEIGHT,
      overflow: "hidden",
      padding: 4,
      transform: `var(${brunoTableColumnCssVariable("transform", column.columnId)}, none)`,
      width: `var(${brunoTableColumnCssVariable("width", column.columnId)}, ${String(column.semantics.width)}px)`,
    } satisfies CSSProperties,
  } as const;
  const content = <Skeleton aria-hidden="true" style={skeletonStyle} />;
  return <td {...props}>{content}</td>;
});

function loadingSkeletonStyle(column: CompiledColumn): CSSProperties {
  const boolean = column.semantics.editorFamily === "boolean";
  const width = boolean ? 16 : column.semantics.editorLayout === "fullWidth" ? "100%" : "64%";
  return {
    height: boolean ? 16 : 12,
    marginBlock: boolean ? 6 : 8,
    width,
    ...(column.semantics.cellAlign === "center"
      ? { marginInline: "auto" }
      : column.semantics.cellAlign === "end"
        ? { marginInlineStart: "auto" }
        : { marginInlineEnd: "auto" }),
  };
}

type BrunoTableToolbarSnapshot = Readonly<{
  readonly children: ReactNode;
  readonly hasToolbar: boolean;
}>;

export class BrunoTableToolbarStore {
  private readonly listeners = new Set<() => void>();
  private snapshot: BrunoTableToolbarSnapshot;

  public constructor(children: ReactNode) {
    this.snapshot = createToolbarSnapshot(children);
  }

  public readonly getSnapshot = (): BrunoTableToolbarSnapshot => this.snapshot;

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public readonly publish = (children: ReactNode): void => {
    if (sameToolbarNode(this.snapshot.children, children)) return;
    this.snapshot = createToolbarSnapshot(children);
    for (const listener of this.listeners) listener();
  };
}

function createToolbarSnapshot(children: ReactNode): BrunoTableToolbarSnapshot {
  return Object.freeze({ children, hasToolbar: hasRenderableChildren(children) });
}

function sameToolbarNode(previous: ReactNode, next: ReactNode): boolean {
  if (Object.is(previous, next)) return true;
  if (isValidElement(previous) && isValidElement(next)) {
    if (previous.type !== next.type || previous.key !== next.key) return false;
    return sameToolbarProps(
      previous as ReactElement<Readonly<Record<string, unknown>>>,
      next as ReactElement<Readonly<Record<string, unknown>>>,
    );
  }
  if (Array.isArray(previous) && Array.isArray(next)) {
    return (
      previous.length === next.length &&
      previous.every((child, index) => sameToolbarNode(child, next[index]))
    );
  }
  return false;
}

function sameToolbarProps(
  previous: ReactElement<Readonly<Record<string, unknown>>>,
  next: ReactElement<Readonly<Record<string, unknown>>>,
): boolean {
  const previousKeys = Object.keys(previous.props);
  const nextKeys = Object.keys(next.props);
  if (previousKeys.length !== nextKeys.length) return false;
  return previousKeys.every((key) => {
    if (!Object.hasOwn(next.props, key)) return false;
    return key === "children"
      ? sameToolbarNode(previous.props[key] as ReactNode, next.props[key] as ReactNode)
      : Object.is(previous.props[key], next.props[key]);
  });
}

function viewportPageSize(viewport: HTMLElement): number {
  return Math.max(1, Math.floor(Math.max(0, viewport.clientHeight - ROW_HEIGHT) / ROW_HEIGHT));
}
