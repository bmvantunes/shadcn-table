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
  useId,
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
  KeyboardEvent as ReactKeyboardEvent,
  ReactElement,
  ReactNode,
  RefCallback,
} from "react";

import type { CompiledColumn } from "./compile-columns";
import {
  BrunoTableCellCommitDiagnosticProbe,
  BrunoTableGridSurfaceCommitDiagnosticProbe,
  BrunoTableHeaderCommitDiagnosticProbe,
  BrunoTableRowCommitDiagnosticProbe,
  BrunoTableSortPanelCommitDiagnosticProbe,
  BrunoTableViewCommitDiagnosticProbe,
} from "./commit-diagnostic-probes";
import {
  createBrunoTableColumnGestureActor,
  type BrunoTableColumnGestureActor,
} from "./column-gesture";
import {
  projectBrunoTableLogicalColumnIndex,
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
  type BrunoTableActiveCell,
  type BrunoTableNavigationCommand,
  type BrunoTableNavigationDirection,
} from "./navigation";
import type {
  BrunoTableCellSnapshot,
  BrunoTableChromeSnapshot,
  BrunoTableColumnCommandSnapshot,
  BrunoTableRuntimeView,
} from "./grid-runtime";
import { isBrunoTableInvalidCellValue } from "./grid-runtime";
import {
  recordBrunoTableClientColumnPreviewStyleWrite,
  recordBrunoTableClientColumnReorderFrame,
  recordBrunoTableClientColumnResizeFrame,
  recordBrunoTableClientColumnGestureFrame,
  recordBrunoTableClientColumnGestureListener,
  hasBrunoTableClientColumnGestureFrameListener,
} from "./render-instrumentation";
import {
  BRUNO_TABLE_DEFAULT_VIEWPORT_HEIGHT,
  BRUNO_TABLE_ROW_HEIGHT,
  BRUNO_TABLE_SCROLLBAR_TRACK_THICKNESS,
  BrunoTableViewportRuntime,
  type BrunoTableViewportSnapshot,
} from "./virtual-viewport";

const ROW_HEIGHT = BRUNO_TABLE_ROW_HEIGHT;
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
  readonly onKeyDown: (event: globalThis.KeyboardEvent) => void;
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
type BrunoTableColumnResizeKeyDownHandler = (
  event: ReactKeyboardEvent<HTMLElement>,
  column: CompiledColumn,
) => void;
const INTERACTIVE_DESCENDANT_SELECTOR =
  'a[href],area[href],button,input,select,summary,textarea,iframe,object,embed,audio[controls],video[controls],[contenteditable]:not([contenteditable="false"]),[tabindex]';
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

function columnLayoutSignature(columns: readonly CompiledColumn[]): string {
  return JSON.stringify(
    columns.map((column) => [column.columnId, column.pinned ?? null, column.semantics.width]),
  );
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

function navigationDelta(key: string): BrunoTableNavigationDirection | undefined {
  if (key === "ArrowUp") return "up";
  if (key === "ArrowDown") return "down";
  if (key === "ArrowLeft") return "left";
  if (key === "ArrowRight") return "right";
  return undefined;
}

function keyboardNavigationCommand(
  event: Readonly<
    Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey"> & {
      readonly currentTarget: HTMLElement;
    }
  >,
): BrunoTableNavigationCommand | undefined {
  if (event.altKey) return undefined;
  const boundaryModifier = event.ctrlKey || event.metaKey;
  if (event.key === "Home" || event.key === "End") {
    const edge = event.key === "Home" ? "start" : "end";
    return boundaryModifier ? { type: "grid-edge", edge } : { type: "row-edge", edge };
  }
  if (boundaryModifier && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    return {
      type: "column-edge",
      edge: event.key === "ArrowUp" ? "start" : "end",
    };
  }
  if (boundaryModifier && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    return {
      type: "row-edge",
      edge: event.key === "ArrowLeft" ? "start" : "end",
    };
  }
  if (event.key === "PageUp" || event.key === "PageDown") {
    const pageSize = viewportPageSize(event.currentTarget);
    return { type: "page", rowDelta: event.key === "PageUp" ? -pageSize : pageSize };
  }
  const delta = navigationDelta(event.key);
  return delta === undefined ? undefined : { type: "step", direction: delta };
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

const documentInstanceCounters = new WeakMap<Document, number>();

function allocateDocumentInstanceId(ownerDocument: Document): string {
  const next = (documentInstanceCounters.get(ownerDocument) ?? 0) + 1;
  documentInstanceCounters.set(ownerDocument, next);
  return `document-${String(next)}`;
}

class BrunoTableInstanceIdStore {
  private hydrated = false;
  private snapshot: string;

  public constructor(private readonly serverId: string) {
    this.snapshot = serverId;
  }

  public readonly getSnapshot = (): string => this.snapshot;

  public readonly getServerSnapshot = (): string => this.serverId;

  public readonly subscribe = (listener: () => void): (() => void) => {
    if (!this.hydrated) {
      this.hydrated = true;
      this.snapshot = `${this.serverId}-${allocateDocumentInstanceId(document)}`;
      listener();
    }
    return () => undefined;
  };
}

export function BrunoTableToolbar({ children }: { readonly children?: ReactNode }): ReactNode {
  if (!hasRenderableChildren(children)) return null;
  return (
    <div
      aria-label="Table controls"
      className="flex min-w-0 items-center gap-2 overflow-x-auto"
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
  /** Private capability seam for controls that belong to every variant's grid-owned rail. */
  readonly gridOwnedControls?: ReactNode;
};

export type BrunoTableColumnFilterRendererProps = {
  readonly column: CompiledColumn;
  readonly command: BrunoTableColumnCommandSnapshot;
  readonly runtime: BrunoTableRuntimeView;
  readonly activateHeaderCommand: (columnId: string) => void;
  readonly focusFallback: (columnId: string) => void;
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
  readonly children: (snapshot: BrunoTableRowPipelineSnapshot) => ReactElement;
};

export type BrunoTableRowPipelineSnapshot =
  | Readonly<{
      readonly kind: "rows";
      readonly columns: readonly CompiledColumn[];
      readonly rowSpace: BrunoTableLogicalRowSpace;
      readonly queryGeneration: number;
      readonly preserveActiveCellOnQueryChange?: boolean;
    }>
  | Readonly<{
      readonly kind: "invalid";
      readonly columns: readonly CompiledColumn[];
      readonly invalid: Extract<
        BrunoTableChromeSnapshot["invalid"],
        { readonly kind: "invalid-value" }
      >;
    }>;

export type BrunoTableLogicalRowSpace = Readonly<{
  readonly totalRows: number;
  readonly getRowId: (index: number) => string | undefined;
  readonly findRowIndex: (rowId: string) => number | undefined;
  readonly setRequiredRange: (start: number, end: number) => void;
}>;

function BrunoTableViewImplementation<TRuntime extends BrunoTableRuntimeView, TAdapter>({
  runtime,
  tableId,
  compiledColumns,
  toolbar,
  rowPipeline,
  rowPipelineAdapter,
  renderColumnFilter,
  gridOwnedControls,
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
  const sortableColumns = columns.filter((column) => column.enableSorting !== false);
  if (sortableColumns.length === 0) return null;
  const activeIds = new Set(orderBy.map((sort) => sort.columnId));
  const eligibleColumns = sortableColumns.filter((column) => !activeIds.has(column.columnId));
  const headerName = (columnId: string): string =>
    sortableColumns.find((column) => column.columnId === columnId)?.headerName ?? columnId;
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
    chrome.invalid?.kind === "invalid-value" &&
    chrome.status !== "closed" &&
    chrome.status !== "error"
  ) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Invalid source value</AlertTitle>
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
};

function BrunoTableGridBody<TRuntime extends BrunoTableRuntimeView, TAdapter>({
  runtime,
  tableId,
  compiledColumns,
  focusFallback,
  rowPipeline: RowPipeline,
  rowPipelineAdapter,
  renderColumnFilter,
}: BrunoTableGridBodyProps<TRuntime, TAdapter>) {
  const [navigation] = useState(() => new BrunoTableNavigationRuntime());
  const [focusHandoff] = useState(() => new BrunoTableBodyFocusHandoff());
  const body = useSyncExternalStore(
    runtime.subscribeBody,
    runtime.getBodySnapshot,
    runtime.getBodySnapshot,
  );
  useLayoutEffect(() => {
    if (body.kind !== "rows" && body.kind !== "loading") {
      navigation.setShape([], compiledColumns);
      focusHandoff.clear();
    }
  }, [body.kind, compiledColumns, focusHandoff, navigation]);
  if (body.kind === "loading") {
    return (
      <LoadingRows
        runtime={runtime}
        totalRows={body.totalRows}
        compiledColumns={compiledColumns}
        focusFallback={focusFallback}
        focusHandoff={focusHandoff}
        tableId={tableId}
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
    >
      {(snapshot) =>
        body.kind === "empty" || body.kind === "invalid" ? (
          <></>
        ) : snapshot.kind === "invalid" ? (
          <Alert variant="destructive">
            <AlertTitle>Invalid source value</AlertTitle>
            <AlertDescription>{invalidSourceDetails(snapshot.invalid)}</AlertDescription>
          </Alert>
        ) : (
          <BrunoTableViewportAdapter
            tableId={tableId}
            rowSpace={snapshot.rowSpace}
            runtime={runtime}
            columns={snapshot.columns}
            focusFallback={focusFallback}
            focusHandoff={focusHandoff}
            navigation={navigation}
            queryGeneration={snapshot.queryGeneration}
            preserveActiveCellOnQueryChange={snapshot.preserveActiveCellOnQueryChange === true}
            renderColumnFilter={renderColumnFilter}
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
      if (document.activeElement !== null && root?.contains(document.activeElement)) {
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

// DOM attachment and measurement are isolated here from the compiler-managed render surface.
// oxlint-disable react/react-compiler
type BrunoTableViewportAdapterProps = {
  readonly tableId: string;
  readonly rowSpace: BrunoTableLogicalRowSpace;
  readonly runtime: BrunoTableRuntimeView;
  readonly columns: readonly CompiledColumn[];
  readonly focusFallback: () => void;
  readonly focusHandoff: BrunoTableBodyFocusHandoff;
  readonly navigation: BrunoTableNavigationRuntime;
  readonly queryGeneration: number;
  readonly preserveActiveCellOnQueryChange: boolean;
  readonly renderColumnFilter?: BrunoTableColumnFilterRenderer | undefined;
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
    preserveActiveCellOnQueryChange,
    renderColumnFilter,
  }: BrunoTableViewportAdapterProps): ReactElement {
    "use no memo";
    const reactInstanceId = useId();
    const [instanceIdStore] = useState(() => new BrunoTableInstanceIdStore(reactInstanceId));
    const instanceId = useSyncExternalStore(
      instanceIdStore.subscribe,
      instanceIdStore.getSnapshot,
      instanceIdStore.getServerSnapshot,
    );
    const columnLayout = useSyncExternalStore(
      runtime.subscribeColumnLayout,
      runtime.getColumnLayoutSnapshot,
      runtime.getColumnLayoutSnapshot,
    );
    const stableColumns = useRef<readonly CompiledColumn[] | undefined>(undefined);
    const visibleColumnIds = useMemo(
      () => new Set(columnLayout.visibleColumnIds),
      [columnLayout.visibleColumnIds],
    );
    const layoutColumnsById = useMemo(
      () => new Map(columnLayout.allColumns.map((column) => [column.columnId, column])),
      [columnLayout.allColumns],
    );
    const logicalColumns = useMemo(() => {
      const nextColumns = columns.flatMap((column) => {
        if (!visibleColumnIds.has(column.columnId)) return [];
        return [layoutColumnsById.get(column.columnId) ?? column];
      });
      const previousColumns = stableColumns.current;
      if (
        previousColumns !== undefined &&
        previousColumns.length === nextColumns.length &&
        previousColumns.every((column, index) => column === nextColumns[index])
      ) {
        return previousColumns;
      }
      const next = Object.freeze(nextColumns);
      stableColumns.current = next;
      return next;
    }, [columns, layoutColumnsById, visibleColumnIds]);
    const logicalColumnLayoutSignature = useMemo(
      () => columnLayoutSignature(logicalColumns),
      [logicalColumns],
    );
    const [viewport] = useState(() => {
      const next = new BrunoTableViewportRuntime();
      next.setLayout(rowSpace.totalRows, logicalColumns, rowSpace.findRowIndex);
      return next;
    });
    const queryGenerationRef = useRef(queryGeneration);
    const appliedColumnLayoutSignatureRef = useRef<string | undefined>(undefined);
    const publishedRangeRef = useRef<
      | {
          readonly rowSpace: BrunoTableLogicalRowSpace;
          readonly generation: number;
          readonly start: number;
          readonly end: number;
        }
      | undefined
    >(undefined);
    const viewportSnapshot = useSyncExternalStore(
      viewport.subscribe,
      viewport.getSnapshot,
      viewport.getSnapshot,
    );
    useLayoutEffect(() => {
      if (queryGenerationRef.current === queryGeneration) return;
      queryGenerationRef.current = queryGeneration;
      viewport.setLayout(rowSpace.totalRows, logicalColumns, rowSpace.findRowIndex);
      viewport.resetVertical();
      const resetWindow = viewport.getSnapshot().virtualWindow;
      rowSpace.setRequiredRange(resetWindow.rowStart, resetWindow.rowEnd);
      publishedRangeRef.current = Object.freeze({
        rowSpace,
        generation: queryGeneration,
        start: resetWindow.rowStart,
        end: resetWindow.rowEnd,
      });
      const activeCell = navigation.getSnapshot();
      if (activeCell?.region !== "header") {
        const shouldReconcileActiveCell =
          preserveActiveCellOnQueryChange ||
          runtime.getPreserveActiveCellOnQueryChangeSnapshot?.() === true;
        if (shouldReconcileActiveCell) {
          navigation.reconcileForQuery(rowSpace, logicalColumns);
        } else {
          navigation.clearForQuery();
          navigation.setShape(rowSpace, logicalColumns);
        }
      } else {
        navigation.setShape(rowSpace, logicalColumns);
      }
    }, [
      logicalColumns,
      navigation,
      preserveActiveCellOnQueryChange,
      queryGeneration,
      rowSpace,
      runtime,
      viewport,
    ]);
    useLayoutEffect(() => {
      const columnsChanged =
        appliedColumnLayoutSignatureRef.current !== logicalColumnLayoutSignature;
      viewport.setLayout(rowSpace.totalRows, logicalColumns, rowSpace.findRowIndex);
      navigation.setShape(rowSpace, logicalColumns);
      if (columnsChanged) {
        const activeCell = navigation.getSnapshot();
        if (activeCell !== undefined) {
          viewport.revealCell(
            activeCell.rowIndex,
            activeCell.columnId,
            activeCell.region,
            activeCell.rowId,
          );
        }
      }
      appliedColumnLayoutSignatureRef.current = logicalColumnLayoutSignature;
    }, [logicalColumnLayoutSignature, logicalColumns, navigation, rowSpace, viewport]);
    useLayoutEffect(() => {
      if (viewportSnapshot !== viewport.getSnapshot()) return;
      const start = viewportSnapshot.virtualWindow.rowStart;
      const end = viewportSnapshot.virtualWindow.rowEnd;
      const previous = publishedRangeRef.current;
      if (
        previous?.rowSpace === rowSpace &&
        previous.generation === queryGeneration &&
        previous.start === start &&
        previous.end === end
      ) {
        return;
      }
      rowSpace.setRequiredRange(start, end);
      publishedRangeRef.current = Object.freeze({
        rowSpace,
        generation: queryGeneration,
        start,
        end,
      });
    }, [queryGeneration, rowSpace, viewport, viewportSnapshot]);
    useEffect(() => () => viewport.dispose(), [viewport]);

    return (
      <BrunoTableGridSurface
        instanceId={instanceId}
        tableId={tableId}
        rowSpace={rowSpace}
        runtime={runtime}
        columns={logicalColumns}
        allColumns={columnLayout.allColumns}
        visibleColumnIds={columnLayout.visibleColumnIds}
        columnLayout={columnLayout}
        queryGeneration={queryGeneration}
        viewportSnapshot={viewportSnapshot}
        attach={viewport.attach}
        attachBodyLayer={viewport.attachBodyLayer}
        attachRowLayer={viewport.attachRowLayer}
        attachScrollbarOverlay={viewport.attachScrollbarOverlay}
        subscribeViewportEnvironment={viewport.subscribeEnvironment}
        scrollByLogical={viewport.scrollByLogical}
        previewColumnWidth={viewport.previewColumnWidth}
        clearColumnWidthPreview={viewport.clearColumnWidthPreview}
        focusFallback={focusFallback}
        focusHandoff={focusHandoff}
        navigation={navigation}
        revealCell={viewport.revealCell}
        renderColumnFilter={renderColumnFilter}
      />
    );
  },
);
// oxlint-enable react/react-compiler

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
  const viewportFill =
    columnWindow.pinnedEnd.length === 0 ? 0 : Math.max(0, viewportSnapshot.width - tableWidth);
  const renderedTableWidth = tableWidth + viewportFill;
  const logicalColumns = columns;
  const gridElement = useRef<HTMLDivElement | null>(null);
  const interactionFrame = useRef<number | null>(null);
  const focusRestoreFrame = useRef<number | null>(null);
  const filterOpenFrame = useRef<number | null>(null);
  const filterOpenToken = useRef(0);
  const filterOpenRetry = useRef<() => void>(() => undefined);
  const columnFilterOpeners = useRef(new Map<string, () => void>());
  const columnGesture = useRef<BrunoTableColumnGesture | undefined>(undefined);
  const gestureCancel = useRef<() => void>(() => undefined);
  const columnPointerDownHandler = useRef<BrunoTableColumnPointerDownHandler>(() => undefined);
  const columnResizeKeyDownHandler = useRef<BrunoTableColumnResizeKeyDownHandler>(() => undefined);
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
            (candidate) =>
              candidate.getAttribute("aria-label") ===
              `Column menu for ${columnHeaderName(logicalColumns, columnId)}`,
          );
          if (trigger !== undefined) {
            trigger.focus({ preventScroll: true });
            return;
          }
          const proxy = gridElement.current?.querySelector<HTMLButtonElement>(
            '[data-bruno-active-header-menu-trigger=""]',
          );
          if (
            proxy?.getAttribute("aria-label") ===
            `Column menu for ${columnHeaderName(logicalColumns, columnId)}`
          ) {
            proxy.focus({ preventScroll: true });
            return;
          }
          gridElement.current?.focus({ preventScroll: true });
        });
      },
    [logicalColumns],
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
    window.removeEventListener("keydown", gesture.onKeyDown, true);
    if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
      recordBrunoTableClientColumnGestureListener(tableId, {
        phase: "detach",
        event: "keydown",
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
  const onColumnKeyDown = (event: globalThis.KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
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
    const reorderCenterBounds = Object.freeze({
      left:
        leftPinnedRects.length === 0
          ? (gridRect?.left ?? 0)
          : Math.max(...leftPinnedRects.map((rect) => rect.right)),
      right:
        rightPinnedRects.length === 0
          ? (gridRect?.right ?? 0)
          : Math.min(...rightPinnedRects.map((rect) => rect.left)),
    });
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
      onKeyDown: onColumnKeyDown,
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
    window.addEventListener("keydown", columnGesture.current.onKeyDown, true);
    if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
      recordBrunoTableClientColumnGestureListener(tableId, {
        phase: "attach",
        event: "keydown",
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

  const resizeColumnWithKeyboard = (
    event: ReactKeyboardEvent<HTMLElement>,
    column: CompiledColumn,
  ): void => {
    const command = runtime.getColumnCommandSnapshot(column.columnId);
    const step = event.shiftKey ? 50 : 10;
    const direction =
      getComputedStyle(gridElement.current ?? event.currentTarget).direction === "rtl"
        ? "rtl"
        : "ltr";
    let width: number | undefined;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const physicalDelta = event.key === "ArrowRight" ? step : -step;
      width = command.width + (direction === "rtl" ? -physicalDelta : physicalDelta);
    }
    if (event.key === "Home") width = command.minWidth;
    if (event.key === "End") width = command.maxWidth;
    if (width === undefined) return;
    event.preventDefault();
    const nextWidth = commitBrunoTableColumnResize(runtime, column.columnId, width);
    setAnnouncement(`${column.headerName} width ${String(nextWidth)} pixels`);
  };
  useEffect(() => {
    gestureCancel.current = () => finishColumnGesture(false);
    columnPointerDownHandler.current = startColumnGesture;
    columnResizeKeyDownHandler.current = resizeColumnWithKeyboard;
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
  const onColumnResizeKeyDown = useMemo<BrunoTableColumnResizeKeyDownHandler>(
    () => (event, column) => columnResizeKeyDownHandler.current(event, column),
    [],
  );
  const attachGrid = useMemo(
    () => (element: HTMLDivElement | null) => {
      if (
        element === null &&
        document.activeElement !== null &&
        gridElement.current?.contains(document.activeElement)
      ) {
        focusHandoff.release();
        focusFallback();
      }
      gridElement.current = element;
      attach(element);
      if (element !== null && focusHandoff.claim()) element.focus({ preventScroll: true });
    },
    [attach, focusFallback, focusHandoff],
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
        runtime.dispatchGridCommand({ type: "column.sort.toggle", columnId, multi });
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

  return (
    <div style={{ position: "relative" }}>
      {__BRUNO_TABLE_TEST_DIAGNOSTICS__ ? (
        <BrunoTableGridSurfaceCommitDiagnosticProbe
          commitEvidence={[columns, columnLayout, queryGeneration, rowSpace, viewportSnapshot]}
          tableId={tableId}
        />
      ) : null}
      <div
        ref={attachGrid}
        data-bruno-scroll-owner=""
        data-bruno-column-layout-version={columnLayout.version}
        role="grid"
        aria-label={`Data for ${tableId}`}
        tabIndex={0}
        aria-rowcount={rowSpace.totalRows + 1}
        aria-colcount={
          columnWindow.pinnedStart.length + columnWindow.centerCount + columnWindow.pinnedEnd.length
        }
        aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Shift+F10 ContextMenu"
        onFocus={(event) => {
          if (event.target === event.currentTarget) navigation.activateForFocus();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && columnGesture.current !== undefined) {
            event.preventDefault();
            gestureCancel.current();
            return;
          }
          if (event.target !== event.currentTarget) {
            if (event.key === "Escape" && event.currentTarget.contains(event.target as Node)) {
              event.preventDefault();
              gestureCancel.current();
              event.currentTarget.focus({ preventScroll: true });
            } else if (
              event.key === "Tab" &&
              event.shiftKey &&
              event.currentTarget.contains(event.target as Node)
            ) {
              yieldGridTabStopForNativeTraversal(event.currentTarget);
            }
            return;
          }
          navigation.activateForFocus();
          const activeForLayout = navigation.getSnapshot();
          if (
            activeForLayout?.region === "header" &&
            ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu")
          ) {
            event.preventDefault();
            const header = [
              ...(gridElement.current?.querySelectorAll<HTMLElement>(`th[data-bruno-column-id]`) ??
                []),
            ].find((candidate) => candidate.dataset["brunoColumnId"] === activeForLayout.columnId);
            const trigger =
              header?.querySelector<HTMLButtonElement>('button[aria-label^="Column menu for "]') ??
              gridElement.current?.querySelector<HTMLButtonElement>(
                '[data-bruno-active-header-menu-trigger=""]',
              );
            trigger?.click();
            return;
          }
          if (
            activeForLayout?.region === "header" &&
            event.altKey &&
            (event.key === "ArrowLeft" || event.key === "ArrowRight")
          ) {
            const activeColumn = logicalColumns.find(
              (candidate) => candidate.columnId === activeForLayout.columnId,
            );
            if (activeColumn !== undefined) {
              event.preventDefault();
              const command = runtime.getColumnCommandSnapshot(activeColumn.columnId);
              const delta = event.shiftKey ? 50 : 10;
              const direction =
                getComputedStyle(event.currentTarget).direction === "rtl" ? "rtl" : "ltr";
              const physicalDelta = event.key === "ArrowRight" ? delta : -delta;
              const nextWidth = commitBrunoTableColumnResize(
                runtime,
                activeColumn.columnId,
                command.width + (direction === "rtl" ? -physicalDelta : physicalDelta),
              );
              setAnnouncement(`${activeColumn.headerName} width ${String(nextWidth)} pixels`);
              return;
            }
          }
          if (event.key === "Enter" || event.key === " " || event.key === "F2") {
            const active = navigation.getSnapshot();
            const column = logicalColumns.find(
              (candidate) => candidate.columnId === active?.columnId,
            );
            if (active?.region === "body" && (event.key === "Enter" || event.key === "F2")) {
              if (column !== undefined && enterInteractiveCell(active, column))
                event.preventDefault();
              return;
            }
            if (active?.region !== "header" || column === undefined || event.key === "F2") return;
            const command = runtime.getColumnCommandSnapshot(column.columnId);
            const filterable = supportsBrunoTableCustomColumnFilter(column, renderColumnFilter);
            const legacyFilterable = column.kind === "field" && column.enableFilter !== false;
            if (event.altKey && event.key === "Enter" && filterable) {
              event.preventDefault();
              if (event.shiftKey && (command.filterActive || command.filterBaselineAvailable)) {
                toggleHeaderFilter(column.columnId);
              } else {
                openHeaderFilter(column.columnId);
              }
            } else if (
              event.altKey &&
              event.key === "Enter" &&
              legacyFilterable &&
              command.filterBaselineAvailable
            ) {
              event.preventDefault();
              toggleHeaderFilter(column.columnId);
            } else if (command.sortable) {
              event.preventDefault();
              toggleHeaderSort(column.columnId, event.shiftKey);
            } else if (command.filterActive || command.filterBaselineAvailable) {
              event.preventDefault();
              toggleHeaderFilter(column.columnId);
            } else if (filterable) {
              event.preventDefault();
              openHeaderFilter(column.columnId);
            }
            return;
          }
          const command = keyboardNavigationCommand(event);
          if (command === undefined) return;
          event.preventDefault();
          navigation.navigate(command);
          const next = navigation.getSnapshot();
          if (next !== undefined) {
            revealCell(next.rowIndex, next.columnId, next.region, next.rowId);
          }
        }}
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
          tableId={tableId}
        />
        <span ref={announcement} aria-live="polite" style={VISUALLY_HIDDEN} />
        <div
          ref={attachRowLayer}
          data-bruno-row-layer=""
          style={{
            position: "relative",
            width: `var(${BRUNO_TABLE_LIVE_TOTAL_WIDTH_CSS_VARIABLE}, ${String(renderedTableWidth)}px)`,
          }}
        >
          <table
            role="presentation"
            style={{
              tableLayout: "fixed",
              width: `var(${BRUNO_TABLE_LIVE_TOTAL_WIDTH_CSS_VARIABLE}, ${String(renderedTableWidth)}px)`,
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
              onColumnResizeKeyDown={onColumnResizeKeyDown}
              restoreColumnFocus={restoreColumnFocus}
              columnWindow={columnWindow}
              instanceId={instanceId}
              renderedTableWidth={renderedTableWidth}
              runtime={runtime}
              tableId={tableId}
              viewportFill={viewportFill}
              renderColumnFilter={renderColumnFilter}
              registerColumnFilterOpener={registerColumnFilterOpener}
            />
            <tbody
              role="rowgroup"
              style={{
                display: "block",
                height: virtualWindow.totalHeight,
                position: "relative",
                width: `var(${BRUNO_TABLE_LIVE_TOTAL_WIDTH_CSS_VARIABLE}, ${String(renderedTableWidth)}px)`,
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
                      attachBodyLayer={attachBodyLayer}
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
                    />
                  ) : (
                    <BrunoTableRow
                      key={`row:${rowId}`}
                      attachBodyLayer={attachBodyLayer}
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
                    />
                  );
                },
              )}
            </tbody>
          </table>
          {columnWindow.pinnedStart.length > 0 ? (
            <BrunoTablePinnedBodyRegion
              attachBodyLayer={attachBodyLayer}
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
              totalHeight={virtualWindow.totalHeight}
            />
          ) : null}
          {columnWindow.pinnedEnd.length > 0 ? (
            <BrunoTablePinnedBodyRegion
              attachBodyLayer={attachBodyLayer}
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
          openHeaderFilter={openHeaderFilter}
          renderColumnFilter={renderColumnFilter}
          restoreColumnFocus={restoreColumnFocus}
          runtime={runtime}
          tableId={tableId}
          visibleColumnIds={visibleColumnIds}
          virtualWindow={virtualWindow}
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
  tableId,
}: {
  readonly gridElement: Readonly<{ current: HTMLDivElement | null }>;
  readonly instanceId: string;
  readonly navigation: BrunoTableNavigationRuntime;
  readonly tableId: string;
}) {
  useLayoutEffect(() => {
    const synchronize = () => {
      const element = gridElement.current;
      if (element === null) return;
      const activeCell = navigation.getSnapshot();
      const id =
        activeCell === undefined ? undefined : activeDomId(instanceId, tableId, activeCell);
      if (id === undefined) element.removeAttribute("aria-activedescendant");
      else element.setAttribute("aria-activedescendant", id);
    };
    synchronize();
    return navigation.subscribe(synchronize);
  }, [gridElement, instanceId, navigation, tableId]);
  return null;
});

const ActiveDescendantOutlet = memo(function ActiveDescendantOutlet({
  allColumns,
  announce,
  instanceId,
  logicalColumns,
  navigation,
  openHeaderFilter,
  renderColumnFilter,
  restoreColumnFocus,
  runtime,
  tableId,
  visibleColumnIds,
  virtualWindow,
}: {
  readonly allColumns: readonly CompiledColumn[];
  readonly announce: (message: string) => void;
  readonly instanceId: string;
  readonly logicalColumns: readonly CompiledColumn[];
  readonly navigation: BrunoTableNavigationRuntime;
  readonly openHeaderFilter: (columnId: string) => void;
  readonly renderColumnFilter?: BrunoTableColumnFilterRenderer | undefined;
  readonly restoreColumnFocus: (columnId: string) => void;
  readonly runtime: BrunoTableRuntimeView;
  readonly tableId: string;
  readonly visibleColumnIds: readonly string[];
  readonly virtualWindow: BrunoTableViewportSnapshot["virtualWindow"];
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
        columnIndex={logicalColumns.findIndex((column) => column.columnId === activeCell.columnId)}
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
      column={logicalColumns.find((column) => column.columnId === activeCell.columnId)}
      columnIndex={logicalColumns.findIndex((column) => column.columnId === activeCell.columnId)}
      instanceId={instanceId}
      renderColumnFilter={renderColumnFilter}
      runtime={runtime}
      tableId={tableId}
    />
  );
});

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
          onOpenChange={(nextOpen) => {
            if (nextOpen) setMenuDirection(readBrunoTableMenuDirection());
            setOpen(nextOpen);
            if (!nextOpen) restoreColumnFocus(column.columnId);
          }}
        >
          <DropdownMenuTrigger
            aria-label={`Column menu for ${column.headerName}`}
            aria-keyshortcuts="Shift+F10 ContextMenu"
            data-bruno-active-header-menu-trigger=""
            id={headerDomId(instanceId, tableId, `${column.columnId}-menu-proxy`)}
            style={VISUALLY_HIDDEN}
            tabIndex={-1}
            onKeyDown={(event) => {
              if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
                event.preventDefault();
                setMenuDirection(readBrunoTableMenuDirection(event.currentTarget));
                setOpen(true);
              }
            }}
          />
          {open ? (
            <ColumnManagementMenu
              allColumns={allColumns}
              announce={announce}
              column={column}
              command={command}
              direction={menuDirection}
              openHeaderFilter={openHeaderFilter}
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

const BrunoTableHeaderRow = memo(function BrunoTableHeaderRow({
  activateHeaderCommand,
  allColumns,
  announce,
  navigation,
  onColumnPointerDown,
  onColumnResizeKeyDown,
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
  readonly onColumnResizeKeyDown: (
    event: ReactKeyboardEvent<HTMLElement>,
    column: CompiledColumn,
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
}) {
  return (
    <thead
      role="rowgroup"
      style={{
        background: "Canvas",
        position: "sticky",
        top: 0,
        width: `var(${BRUNO_TABLE_LIVE_TOTAL_WIDTH_CSS_VARIABLE}, ${String(renderedTableWidth)}px)`,
        zIndex: 4,
      }}
    >
      <tr aria-rowindex={1} role="row" style={{ height: ROW_HEIGHT, maxHeight: ROW_HEIGHT }}>
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
            columnIndex={index}
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
            onColumnResizeKeyDown={onColumnResizeKeyDown}
            restoreColumnFocus={restoreColumnFocus}
            style={pinnedCellStyle("start", columnWindow.pinnedStart, index)}
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
            columnIndex={columnWindow.pinnedStart.length + columnWindow.centerStartIndex + index}
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
            onColumnResizeKeyDown={onColumnResizeKeyDown}
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
              width: `var(${BRUNO_TABLE_LIVE_VIEWPORT_FILL_CSS_VARIABLE}, ${String(viewportFill)}px)`,
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
            columnIndex={columnWindow.pinnedStart.length + columnWindow.centerCount + index}
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
            onColumnResizeKeyDown={onColumnResizeKeyDown}
            restoreColumnFocus={restoreColumnFocus}
            style={pinnedCellStyle("end", columnWindow.pinnedEnd, index)}
            visibleColumnIds={visibleColumnIds}
          />
        ))}
      </tr>
    </thead>
  );
});

const BrunoTableHeaderCell = memo(function BrunoTableHeaderCell({
  activateHeaderCommand,
  activateHeaderForResize,
  allColumns,
  announce,
  onColumnPointerDown,
  onColumnResizeKeyDown,
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
  readonly onColumnResizeKeyDown: (
    event: ReactKeyboardEvent<HTMLElement>,
    column: CompiledColumn,
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
  const presentation = headerSortPresentation(column.headerName, command);
  const sortLabel =
    command.sortDirection === undefined
      ? `Sort by ${column.headerName}`
      : `Sort by ${column.headerName}, currently ${presentation.direction}${sortPriorityLabel(command.sortPriority)}`;
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuDirection, setMenuDirection] = useState<"ltr" | "rtl">("ltr");
  const pinLabel = command.pinned === undefined ? "unpinned" : `pinned ${command.pinned}`;
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
            onClick={(event) => {
              activateHeaderCommand(column.columnId);
              toggleHeaderSort(column.columnId, event.shiftKey);
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
              focusFallback: restoreColumnFocus,
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
              activateHeaderCommand(column.columnId);
            }}
            onClick={() => {
              activateHeaderCommand(column.columnId);
              toggleHeaderFilter(column.columnId);
            }}
          >
            {command.filterActive ? "Clear" : "Reset"}
          </Button>
        ) : null}
      </div>
      <button
        aria-label={`Reorder ${column.headerName}`}
        className="inline-flex size-5 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 active:cursor-grabbing"
        tabIndex={-1}
        type="button"
        onPointerDown={(event) => onColumnPointerDown(event, column, "reorder")}
      >
        <ArrowsHorizontalIcon aria-hidden="true" />
      </button>
      <DirectionProvider direction={menuDirection}>
        <DropdownMenu
          open={menuOpen}
          onOpenChange={(nextOpen) => {
            if (nextOpen) setMenuDirection(readBrunoTableMenuDirection());
            setMenuOpen(nextOpen);
            if (!nextOpen) restoreColumnFocus(column.columnId);
          }}
        >
          <DropdownMenuTrigger
            aria-label={`Column menu for ${column.headerName}`}
            aria-keyshortcuts="Shift+F10 ContextMenu"
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            tabIndex={-1}
            onPointerDown={(event) => {
              if (event.button === 0) {
                setMenuDirection(readBrunoTableMenuDirection(event.currentTarget));
                activateHeaderForResize(column.columnId);
              }
            }}
            onKeyDown={(event) => {
              if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
                event.preventDefault();
                setMenuDirection(readBrunoTableMenuDirection(event.currentTarget));
                activateHeaderForResize(column.columnId);
                setMenuOpen(true);
              }
            }}
          >
            <DotsThreeVerticalIcon aria-hidden="true" />
          </DropdownMenuTrigger>
          {menuOpen ? (
            <ColumnManagementMenu
              allColumns={allColumns}
              announce={announce}
              column={column}
              command={command}
              direction={menuDirection}
              openHeaderFilter={openHeaderFilter}
              renderColumnFilter={renderColumnFilter}
              restoreColumnFocus={restoreColumnFocus}
              runtime={runtime}
              visibleColumnIds={visibleColumnIds}
            />
          ) : null}
        </DropdownMenu>
      </DirectionProvider>
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
        onKeyDown={(event) => onColumnResizeKeyDown(event, column)}
        onPointerDown={(event) => onColumnPointerDown(event, column, "resize")}
      />
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
  column,
  command,
  direction,
  openHeaderFilter,
  preventMenuFinalFocus = false,
  renderColumnFilter,
  restoreColumnFocus,
  runtime,
  visibleColumnIds,
}: {
  readonly allColumns: readonly CompiledColumn[];
  readonly announce: (message: string) => void;
  readonly column: CompiledColumn;
  readonly command: BrunoTableColumnCommandSnapshot;
  readonly direction: "ltr" | "rtl";
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
  const dispatch = (commandToDispatch: BrunoTableGridCommand): void => {
    runtime.dispatchGridCommand(commandToDispatch);
    restoreColumnFocus(column.columnId);
  };
  const move = (requestedIndex: number): void => {
    const targetIndex = Math.max(groupStart, Math.min(groupEnd, requestedIndex));
    if (targetIndex === index) return;
    dispatch({
      type: "column.reorder.commit",
      columnId: column.columnId,
      targetIndex,
      pinned: command.pinned,
    });
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
    dispatch({ type: "column.resize.commit", columnId: column.columnId, width });
    announce(`${column.headerName} width ${String(width)} pixels`);
  };
  return (
    <DropdownMenuContent align="start" finalFocus={preventMenuFinalFocus ? false : undefined}>
      {command.sortable ? (
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sort</DropdownMenuLabel>
          <DropdownMenuItem
            aria-label={
              command.sortDirection === undefined
                ? `Sort by ${column.headerName}`
                : `Sort by ${column.headerName}, currently ${
                    command.sortDirection === "asc" ? "ascending" : "descending"
                  }${sortPriorityLabel(command.sortPriority)}`
            }
            onClick={() => {
              runtime.dispatchGridCommand({
                type: "column.sort.toggle",
                columnId: column.columnId,
                multi: false,
              });
              const next = runtime.getColumnCommandSnapshot(column.columnId);
              announce(columnSortAnnouncement(column.headerName, next));
              restoreColumnFocus(column.columnId);
            }}
          >
            Sort by {column.headerName}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      ) : null}
      {supportsBrunoTableCustomColumnFilter(column, renderColumnFilter) ||
      command.filterBaselineAvailable ? (
        <DropdownMenuGroup>
          <DropdownMenuLabel>Filter</DropdownMenuLabel>
          {supportsBrunoTableCustomColumnFilter(column, renderColumnFilter) ? (
            <DropdownMenuItem
              onClick={() => {
                openHeaderFilter(column.columnId);
              }}
            >
              Open filter for {column.headerName}
            </DropdownMenuItem>
          ) : null}
          {command.filterActive || command.filterBaselineAvailable ? (
            <DropdownMenuItem
              onClick={() => {
                const action = command.filterActive ? "cleared" : "reset";
                const accepted = runtime.dispatchGridCommand({
                  type: command.filterActive ? "column.filter.clear" : "column.filter.reset",
                  columnId: column.columnId,
                });
                if (!accepted) return;
                announce(`${column.headerName} filter ${action}`);
                restoreColumnFocus(column.columnId);
              }}
            >
              {command.filterActive ? "Clear filter" : "Reset filter"}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
      ) : null}
      <DropdownMenuGroup>
        <DropdownMenuLabel>Resize</DropdownMenuLabel>
        <DropdownMenuItem disabled={command.width <= command.minWidth} onClick={() => resize(-10)}>
          Decrease width
        </DropdownMenuItem>
        <DropdownMenuItem disabled={command.width >= command.maxWidth} onClick={() => resize(10)}>
          Increase width
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>Pin</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={command.pinned ?? "none"}
          onValueChange={(value) => {
            if (value === "start" || value === "end" || value === "none") {
              dispatch({
                type: "column.pin.commit",
                columnId: column.columnId,
                pinned: value === "none" ? undefined : value,
              });
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
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Visibility</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Columns</DropdownMenuLabel>
            {allColumns.map((candidate) => {
              const visible = visibleColumnIds.includes(candidate.columnId);
              return (
                <DropdownMenuCheckboxItem
                  key={candidate.columnId}
                  checked={visible}
                  disabled={visible && visibleColumnIds.length === 1}
                  onCheckedChange={(checked) => {
                    if (checked === true || checked === false) {
                      dispatch({
                        type: "column.visibility.commit",
                        columnId: candidate.columnId,
                        visible: checked,
                      });
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
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Reset</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem
            onClick={() => {
              dispatch({ type: "column.reset.order" });
              announce("Column order reset");
            }}
          >
            Reset order
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              dispatch({ type: "column.reset.widths" });
              announce("Column widths reset");
            }}
          >
            Reset widths
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              dispatch({ type: "column.reset.visibility" });
              announce("Column visibility reset");
            }}
          >
            Reset visibility
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              dispatch({ type: "column.reset.pinning" });
              announce("Column pinning reset");
            }}
          >
            Reset pinning
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              dispatch({ type: "column.reset.layout" });
              announce("Complete column layout reset");
            }}
          >
            Reset complete layout
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </DropdownMenuContent>
  );
});

const ActiveDescendantProxy = memo(function ActiveDescendantProxy({
  activeCell,
  column,
  columnIndex,
  instanceId,
  runtime,
  renderColumnFilter,
  tableId,
}: {
  readonly activeCell: BrunoTableActiveCell;
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
  column,
  columnIndex,
  instanceId,
  runtime,
  tableId,
}: {
  readonly activeCell: BrunoTableActiveCell;
  readonly column: CompiledColumn;
  readonly columnIndex: number;
  readonly instanceId: string;
  readonly runtime: BrunoTableRuntimeView;
  readonly tableId: string;
}) {
  const rowId = activeCell.rowId;
  const rowAware = proxyPresentationUsesRawRow(column);
  const subscribe = useMemo(
    () => (listener: () => void) =>
      rowId === undefined
        ? () => undefined
        : rowAware
          ? runtime.subscribeRow(rowId, listener)
          : runtime.subscribeCell(rowId, column.columnId, listener),
    [column.columnId, rowAware, rowId, runtime],
  );
  const getSnapshot = useMemo(
    () => () =>
      rowId === undefined
        ? undefined
        : rowAware
          ? runtime.getRowSnapshot(rowId)
          : runtime.getCellSnapshot(rowId, column.columnId),
    [column.columnId, rowAware, rowId, runtime],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const cellSnapshot = rowAware ? undefined : (snapshot as BrunoTableCellSnapshot | undefined);
  const row = rowAware ? snapshot : undefined;
  const rowPresent = rowAware ? row !== undefined : (cellSnapshot?.rowPresent ?? false);
  const value =
    rowAware && rowId !== undefined
      ? runtime.getCellValueSnapshot(rowId, column.columnId)
      : cellSnapshot?.value;
  const invalid = isBrunoTableInvalidCellValue(value) ? value : undefined;
  const content = !rowPresent
    ? "Loading row"
    : invalid
      ? invalidSourceDetails(invalid.invalid)
      : resolveProxyCellContent(column, row, value);
  return (
    <div aria-rowindex={activeCell.rowIndex + 2} role="row" style={VISUALLY_HIDDEN}>
      <div
        id={activeDomId(instanceId, tableId, activeCell)}
        data-bruno-active-proxy=""
        aria-colindex={columnIndex + 1}
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
        width: `var(${BRUNO_TABLE_LIVE_TOTAL_WIDTH_CSS_VARIABLE}, ${String(width)}px)`,
      }}
    >
      {__BRUNO_TABLE_TEST_DIAGNOSTICS__ ? (
        <BrunoTableRowCommitDiagnosticProbe
          commitEvidence={props}
          rowId={rowId}
          tableId={tableId}
        />
      ) : null}
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
          columnIndex={pinnedStartCount + centerStartIndex + index}
          column={column}
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
            width: `var(${BRUNO_TABLE_LIVE_VIEWPORT_FILL_CSS_VARIABLE}, ${String(viewportFill)}px)`,
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
}) {
  const width = totalColumnWidth(columns);
  return (
    <BrunoTablePinnedOverlayShell
      layerWidth={layerWidth}
      side={side}
      top={ROW_HEIGHT}
      totalHeight={totalHeight}
      width={width}
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
                    side === "start" ? index : pinnedStartCount + precedingColumnCount + index
                  }
                  id={loadingCellDomId(instanceId, tableId, logicalRowIndex, column.columnId)}
                />
              ) : (
                <BrunoTableCell
                  key={column.columnId}
                  column={column}
                  columnIndex={
                    side === "start" ? index : pinnedStartCount + precedingColumnCount + index
                  }
                  instanceId={instanceId}
                  rowId={rowId}
                  runtime={runtime}
                  tableId={tableId}
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
}: {
  readonly children: ReactNode;
  readonly layerWidth: number;
  readonly side: "start" | "end";
  readonly top: number;
  readonly totalHeight: number;
  readonly width: number | string;
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
        width: `var(${BRUNO_TABLE_LIVE_TOTAL_WIDTH_CSS_VARIABLE}, ${String(layerWidth)}px)`,
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
          insetInlineStart: side === "start" ? 0 : undefined,
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
}>;

const BrunoTableCell = memo(function BrunoTableCell(props: BrunoTableCellProps) {
  const { runtime, rowId, instanceId, tableId, columnIndex, column } = props;
  const rowAware = cellPresentationUsesRawRow(column);
  const subscribe = useMemo(
    () => (listener: () => void) =>
      rowAware
        ? runtime.subscribeRow(rowId, listener)
        : runtime.subscribeCell(rowId, column.columnId, listener),
    [column.columnId, rowAware, rowId, runtime],
  );
  const getSnapshot = useMemo(
    () => () =>
      rowAware ? runtime.getRowSnapshot(rowId) : runtime.getCellSnapshot(rowId, column.columnId),
    [column.columnId, rowAware, rowId, runtime],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const cellSnapshot = rowAware ? undefined : (snapshot as BrunoTableCellSnapshot);
  const row = rowAware ? snapshot : undefined;
  const rowMissing = rowAware && row === undefined;
  const value = rowAware
    ? runtime.getCellValueSnapshot(rowId, column.columnId)
    : cellSnapshot?.value;
  const invalid = isBrunoTableInvalidCellValue(value) ? value : undefined;
  const className = invalid || rowMissing ? undefined : resolveCellClassName(column, row, value);
  const content = rowMissing ? null : invalid ? (
    <span role="alert">{invalidSourceDetails(invalid.invalid)}</span>
  ) : (
    resolveCellContent(column, row, value)
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
    textAlign: column.semantics.cellAlign,
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
      {rowMissing || invalid || column.cellRenderer === undefined ? (
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

// Loading scroll attachment stays outside the compiler-managed render surface.
// oxlint-disable react/react-compiler
const LoadingRows = memo(function LoadingRows({
  runtime,
  totalRows,
  compiledColumns,
  focusFallback,
  focusHandoff,
  tableId,
}: {
  readonly runtime: BrunoTableRuntimeView;
  readonly totalRows: number;
  readonly compiledColumns: readonly CompiledColumn[];
  readonly focusFallback: () => void;
  readonly focusHandoff: BrunoTableBodyFocusHandoff;
  readonly tableId: string;
}) {
  "use no memo";
  const columnLayout = useSyncExternalStore(
    runtime.subscribeColumnLayout,
    runtime.getColumnLayoutSnapshot,
    runtime.getColumnLayoutSnapshot,
  );
  const columns = columnLayout.columns.length > 0 ? columnLayout.columns : compiledColumns;
  const reactInstanceId = useId();
  const [instanceIdStore] = useState(() => new BrunoTableInstanceIdStore(reactInstanceId));
  const instanceId = useSyncExternalStore(
    instanceIdStore.subscribe,
    instanceIdStore.getSnapshot,
    instanceIdStore.getServerSnapshot,
  );
  const logicalRowCount =
    Number.isSafeInteger(totalRows) && totalRows > 0 ? totalRows : DEFAULT_LOADING_ROW_COUNT;
  const [viewport] = useState(() => {
    const next = new BrunoTableViewportRuntime(0);
    next.setLayout(logicalRowCount, columns);
    return next;
  });
  const viewportSnapshot = useSyncExternalStore(
    viewport.subscribe,
    viewport.getSnapshot,
    viewport.getSnapshot,
  );
  useLayoutEffect(
    () => viewport.setLayout(logicalRowCount, columns),
    [columns, logicalRowCount, viewport],
  );
  useEffect(() => () => viewport.dispose(), [viewport]);
  const gridElement = useRef<HTMLDivElement | null>(null);
  const attachGrid = useMemo(
    () => (element: HTMLDivElement | null) => {
      if (
        element === null &&
        document.activeElement !== null &&
        gridElement.current?.contains(document.activeElement)
      ) {
        focusHandoff.release();
        focusFallback();
      }
      gridElement.current = element;
      viewport.attach(element);
      if (element !== null && focusHandoff.claim()) element.focus({ preventScroll: true });
    },
    [focusFallback, focusHandoff, viewport],
  );
  const virtualWindow = viewportSnapshot.virtualWindow;
  const tableWidth = virtualWindow.totalWidth;
  const viewportFill =
    virtualWindow.pinnedEnd.length === 0 ? 0 : Math.max(0, viewportSnapshot.width - tableWidth);
  const renderedTableWidth = tableWidth + viewportFill;
  return (
    <div style={{ position: "relative" }}>
      <div
        ref={attachGrid}
        aria-busy="true"
        aria-colcount={columns.length}
        aria-label="Loading table rows"
        aria-rowcount={logicalRowCount}
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
          ref={viewport.attachRowLayer}
          data-bruno-row-layer=""
          style={{
            position: "relative",
            width: `var(${BRUNO_TABLE_LIVE_TOTAL_WIDTH_CSS_VARIABLE}, ${String(renderedTableWidth)}px)`,
          }}
        >
          <table
            role="presentation"
            style={{
              tableLayout: "fixed",
              width: `var(${BRUNO_TABLE_LIVE_TOTAL_WIDTH_CSS_VARIABLE}, ${String(renderedTableWidth)}px)`,
            }}
          >
            <tbody
              role="rowgroup"
              style={{
                display: "block",
                height: virtualWindow.totalHeight,
                position: "relative",
                width: `var(${BRUNO_TABLE_LIVE_TOTAL_WIDTH_CSS_VARIABLE}, ${String(renderedTableWidth)}px)`,
              }}
            >
              {Array.from(
                { length: virtualWindow.rowEnd - virtualWindow.rowStart },
                (_, offset) => (
                  <LoadingRow
                    key={`loading-slot-${String(offset)}`}
                    attachBodyLayer={viewport.attachBodyLayer}
                    center={virtualWindow.center}
                    centerStartIndex={virtualWindow.centerStartIndex}
                    instanceId={instanceId}
                    leftPadding={virtualWindow.leftPadding}
                    logicalRowIndex={virtualWindow.rowStart + offset}
                    pinnedEnd={virtualWindow.pinnedEnd}
                    pinnedStart={virtualWindow.pinnedStart}
                    rightPadding={virtualWindow.rightPadding}
                    tableId={tableId}
                    top={offset * ROW_HEIGHT}
                    viewportFill={viewportFill}
                    width={renderedTableWidth}
                  />
                ),
              )}
            </tbody>
          </table>
          {virtualWindow.pinnedStart.length > 0 ? (
            <LoadingPinnedBodyRegion
              attachBodyLayer={viewport.attachBodyLayer}
              columns={virtualWindow.pinnedStart}
              instanceId={instanceId}
              layerWidth={renderedTableWidth}
              pinnedStartCount={virtualWindow.pinnedStart.length}
              rowEnd={virtualWindow.rowEnd}
              rowStart={virtualWindow.rowStart}
              side="start"
              tableId={tableId}
              totalHeight={virtualWindow.totalHeight}
            />
          ) : null}
          {virtualWindow.pinnedEnd.length > 0 ? (
            <LoadingPinnedBodyRegion
              attachBodyLayer={viewport.attachBodyLayer}
              columns={virtualWindow.pinnedEnd}
              instanceId={instanceId}
              layerWidth={renderedTableWidth}
              pinnedStartCount={virtualWindow.pinnedStart.length}
              precedingColumnCount={virtualWindow.centerCount}
              rowEnd={virtualWindow.rowEnd}
              rowStart={virtualWindow.rowStart}
              side="end"
              tableId={tableId}
              totalHeight={virtualWindow.totalHeight}
            />
          ) : null}
        </div>
      </div>
      <BrunoTableScrollbarOverlay attach={viewport.attachScrollbarOverlay} />
    </div>
  );
});
// oxlint-enable react/react-compiler

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
}) {
  const width = totalColumnWidth(columns);
  return (
    <BrunoTablePinnedOverlayShell
      layerWidth={layerWidth}
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
                side === "start" ? index : pinnedStartCount + precedingColumnCount + index
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
        width: `var(${BRUNO_TABLE_LIVE_TOTAL_WIDTH_CSS_VARIABLE}, ${String(width)}px)`,
      }}
    >
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
          columnIndex={pinnedStart.length + centerStartIndex + index}
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
            width: `var(${BRUNO_TABLE_LIVE_VIEWPORT_FILL_CSS_VARIABLE}, ${String(viewportFill)}px)`,
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
