import { Alert, AlertDescription, AlertTitle } from "@bruno/shadcn/alert";
import { Button } from "@bruno/shadcn/button";
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
  Children,
  Fragment,
  isValidElement,
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
  ReactElement,
  ReactNode,
} from "react";

import type { CompiledColumn } from "./compile-columns";
import { readCompiledColumnValue } from "./cell-value";
import {
  BrunoTableNavigationRuntime,
  orderBrunoTableLogicalColumns,
  type BrunoTableActiveCell,
} from "./navigation";
import type {
  BrunoTableChromeSnapshot,
  BrunoTableColumnCommandSnapshot,
  BrunoTableRuntimeView,
} from "./grid-runtime";
import {
  recordBrunoTableClientGridSurfaceRender,
  recordBrunoTableClientViewRender,
} from "./render-instrumentation";
import {
  BRUNO_TABLE_DEFAULT_VIEWPORT_HEIGHT,
  BRUNO_TABLE_ROW_HEIGHT,
  BrunoTableViewportRuntime,
  type BrunoTableViewportSnapshot,
} from "./virtual-viewport";

const ROW_HEIGHT = BRUNO_TABLE_ROW_HEIGHT;
type InteractiveDomElement = HTMLElement | SVGElement;
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

function navigationDelta(
  key: string,
): { readonly row: number; readonly column: number } | undefined {
  if (key === "ArrowUp") return { row: -1, column: 0 };
  if (key === "ArrowDown") return { row: 1, column: 0 };
  if (key === "ArrowLeft") return { row: 0, column: -1 };
  if (key === "ArrowRight") return { row: 0, column: 1 };
  return undefined;
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
};

export type BrunoTableRowPipelineProps<
  TRuntime extends BrunoTableRuntimeView = BrunoTableRuntimeView,
  TAdapter = unknown,
> = {
  readonly runtime: TRuntime;
  readonly columns: readonly CompiledColumn[];
  readonly rowPipelineAdapter: TAdapter;
  readonly children: (snapshot: BrunoTableRowPipelineSnapshot) => ReactElement;
};

export type BrunoTableRowPipelineSnapshot = Readonly<{
  readonly rowSpace: BrunoTableLogicalRowSpace;
  readonly queryGeneration: number;
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
}: BrunoTableViewProps<TRuntime, TAdapter>): ReactElement {
  useLayoutEffect(recordBrunoTableClientViewRender);
  const tableElement = useRef<HTMLElement | null>(null);
  const focusFallback = useMemo(
    () => () => tableElement.current?.focus({ preventScroll: true }),
    [],
  );
  return (
    <section
      ref={tableElement}
      aria-label={tableId}
      className="data-[bruno-table]:isolate"
      data-bruno-table={tableId}
      tabIndex={-1}
    >
      <ToolbarOutlet toolbar={toolbar} />
      <SourceLifecycle runtime={runtime} focusFallback={focusFallback} />
      <BrunoTableGridBody
        runtime={runtime}
        tableId={tableId}
        compiledColumns={compiledColumns}
        focusFallback={focusFallback}
        rowPipeline={rowPipeline}
        rowPipelineAdapter={rowPipelineAdapter}
      />
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
  toolbar,
}: {
  readonly toolbar: BrunoTableToolbarStore;
}) {
  const snapshot = useSyncExternalStore(
    toolbar.subscribe,
    toolbar.getSnapshot,
    toolbar.getSnapshot,
  );
  return snapshot.hasToolbar ? (
    <div aria-label="Table toolbar" role="region">
      {snapshot.children}
    </div>
  ) : null;
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

  if (chrome.invalid?.kind === "row-count-mismatch") {
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

  if (chrome.status === "stale" && chrome.hasCoherentRows) {
    return (
      <LifecycleAlert
        title="Live data delayed"
        {...lifecycleDetails(chrome.message, chrome.statusCode)}
        focusFallback={focusFallback}
      />
    );
  }
  if (chrome.status === "closed" && chrome.hasCoherentRows) {
    return (
      <LifecycleAlert
        title="Live updates stopped"
        {...lifecycleDetails(chrome.message, chrome.statusCode)}
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
        {...lifecycleDetails(chrome.message, chrome.statusCode)}
        {...(chrome.retry === undefined ? {} : { retry: chrome.retry })}
        onRetry={runtime.retry}
        focusFallback={focusFallback}
      />
    );
  }
  return null;
}

function lifecycleDetails(message: string | undefined, statusCode: string | undefined) {
  const details = [message, statusCode].filter(
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
            onClick={onRetry}
            disabled={retry.pending}
          >
            {retry.pending ? <Spinner /> : null}
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
};

function BrunoTableGridBody<TRuntime extends BrunoTableRuntimeView, TAdapter>({
  runtime,
  tableId,
  compiledColumns,
  focusFallback,
  rowPipeline: RowPipeline,
  rowPipelineAdapter,
}: BrunoTableGridBodyProps<TRuntime, TAdapter>) {
  const [navigation] = useState(() => new BrunoTableNavigationRuntime());
  const body = useSyncExternalStore(
    runtime.subscribeBody,
    runtime.getBodySnapshot,
    runtime.getBodySnapshot,
  );
  useLayoutEffect(() => {
    if (body.kind !== "rows") navigation.setShape([], compiledColumns);
  }, [body.kind, compiledColumns, navigation]);
  if (body.kind === "loading") return <LoadingRows count={skeletonCount(body.totalRows)} />;
  if (body.kind === "invalid") return null;
  if (body.kind === "empty") {
    return <EmptySourceBody runtime={runtime} focusFallback={focusFallback} />;
  }

  return (
    <RowPipeline
      runtime={runtime}
      columns={compiledColumns}
      rowPipelineAdapter={rowPipelineAdapter}
    >
      {({ rowSpace, queryGeneration }) => (
        <BrunoTableViewportAdapter
          tableId={tableId}
          rowSpace={rowSpace}
          runtime={runtime}
          columns={compiledColumns}
          focusFallback={focusFallback}
          navigation={navigation}
          queryGeneration={queryGeneration}
        />
      )}
    </RowPipeline>
  );
}

const EmptySourceBody = memo(function EmptySourceBody({ runtime, focusFallback }: RuntimeProps) {
  const chrome = useSyncExternalStore(
    runtime.subscribeChrome,
    runtime.getChromeSnapshot,
    runtime.getChromeSnapshot,
  );
  const announcement =
    chrome.status === "closed" ? "status" : chrome.status === "error" ? "alert" : undefined;
  const retry = chrome.status === "closed" || chrome.status === "error" ? chrome.retry : undefined;
  return (
    <Empty
      className={announcement === "alert" ? "border-destructive text-destructive" : undefined}
      role={announcement}
    >
      <EmptyHeader>
        <EmptyTitle>{emptyTitle(chrome.status)}</EmptyTitle>
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
              onClick={() => runtime.retry()}
              disabled={retry.pending}
            >
              {retry.pending ? <Spinner /> : null}
              Retry
            </Button>
          </FocusFallbackOnUnmount>
        </EmptyContent>
      ) : null}
    </Empty>
  );
});

function skeletonCount(totalRows: number): number {
  return Number.isSafeInteger(totalRows) && totalRows > 0 ? Math.min(totalRows, 10) : 5;
}

function emptyTitle(status: BrunoTableChromeSnapshot["status"]): string {
  if (status === "closed") return "Live updates stopped";
  if (status === "error") return "Live data error";
  return "No rows";
}

function emptyDescription(chrome: BrunoTableChromeSnapshot): string | undefined {
  const details = [chrome.message, chrome.statusCode].filter(
    (detail): detail is string => detail !== undefined && detail.length > 0,
  );
  return details.length === 0 ? undefined : details.join(" · ");
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
  readonly navigation: BrunoTableNavigationRuntime;
  readonly queryGeneration: number;
};

export const BrunoTableViewportAdapter: NamedExoticComponent<BrunoTableViewportAdapterProps> = memo(
  function BrunoTableViewportAdapter({
    tableId,
    rowSpace,
    runtime,
    columns,
    focusFallback,
    navigation,
    queryGeneration,
  }: BrunoTableViewportAdapterProps): ReactElement {
    "use no memo";
    const instanceId = useId();
    const [viewport] = useState(() => {
      const next = new BrunoTableViewportRuntime();
      next.setLayout(rowSpace.totalRows, columns);
      return next;
    });
    const queryGenerationRef = useRef(queryGeneration);
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
      viewport.setLayout(rowSpace.totalRows, columns);
      viewport.resetVertical();
      const resetWindow = viewport.getSnapshot().virtualWindow;
      rowSpace.setRequiredRange(resetWindow.rowStart, resetWindow.rowEnd);
      publishedRangeRef.current = Object.freeze({
        rowSpace,
        generation: queryGeneration,
        start: resetWindow.rowStart,
        end: resetWindow.rowEnd,
      });
      if (navigation.getSnapshot()?.region !== "header") navigation.clearForQuery();
      navigation.setShape(rowSpace, columns);
    }, [columns, navigation, queryGeneration, rowSpace, viewport]);
    useLayoutEffect(() => {
      viewport.setLayout(rowSpace.totalRows, columns);
      navigation.setShape(rowSpace, columns);
    }, [columns, navigation, rowSpace, viewport]);
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
        columns={columns}
        viewportSnapshot={viewportSnapshot}
        attach={viewport.attach}
        focusFallback={focusFallback}
        navigation={navigation}
        revealCell={viewport.revealCell}
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
  viewportSnapshot,
  attach,
  focusFallback,
  navigation,
  revealCell,
}: {
  readonly instanceId: string;
  readonly tableId: string;
  readonly rowSpace: BrunoTableLogicalRowSpace;
  readonly runtime: BrunoTableRuntimeView;
  readonly columns: readonly CompiledColumn[];
  readonly viewportSnapshot: BrunoTableViewportSnapshot;
  readonly attach: (element: HTMLElement | null) => void;
  readonly focusFallback: () => void;
  readonly navigation: BrunoTableNavigationRuntime;
  readonly revealCell: (rowIndex: number, columnId: string, region?: "header" | "body") => void;
}) {
  useLayoutEffect(recordBrunoTableClientGridSurfaceRender);
  const virtualWindow = viewportSnapshot.virtualWindow;
  const tableWidth = virtualWindow.totalWidth;
  const logicalColumns = useMemo(() => orderBrunoTableLogicalColumns(columns), [columns]);
  const gridElement = useRef<HTMLDivElement | null>(null);
  const interactionFrame = useRef<number | null>(null);
  const attachGrid = useMemo(
    () => (element: HTMLDivElement | null) => {
      if (
        element === null &&
        document.activeElement !== null &&
        gridElement.current?.contains(document.activeElement)
      ) {
        focusFallback();
      }
      gridElement.current = element;
      attach(element);
    },
    [attach, focusFallback],
  );
  const activateHeaderCommand = useMemo(
    () => (columnId: string) => {
      navigation.activateHeader(columnId);
      gridElement.current?.focus({ preventScroll: true });
    },
    [navigation],
  );
  useEffect(
    () => () => {
      if (interactionFrame.current !== null) cancelAnimationFrame(interactionFrame.current);
    },
    [],
  );

  const enterInteractiveCell = (active: BrunoTableActiveCell, column: CompiledColumn): boolean => {
    if (active.region !== "body" || column.cellRenderer === undefined) return false;
    const activeId = activeDomId(instanceId, tableId, active);
    if (activeId === undefined) return false;
    const cell = document.getElementById(activeId);
    if (cell !== null && !cell.hasAttribute("data-bruno-active-proxy")) {
      return focusFirstInteractiveDescendant(cell);
    }
    revealCell(active.rowIndex, active.columnId, active.region);
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
      const mountedCell = document.getElementById(activeId);
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
    <div
      ref={attachGrid}
      role="grid"
      aria-label={`Data for ${tableId}`}
      tabIndex={0}
      aria-rowcount={rowSpace.totalRows + 1}
      aria-colcount={
        virtualWindow.pinnedStart.length +
        virtualWindow.centerCount +
        virtualWindow.pinnedEnd.length
      }
      onFocus={(event) => {
        if (event.target === event.currentTarget) navigation.activateForFocus();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) {
          if (event.key === "Escape" && event.currentTarget.contains(event.target as Node)) {
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
          }
          return;
        }
        navigation.activateForFocus();
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
          if (event.altKey && event.key === "Enter" && command.filterBaselineAvailable) {
            event.preventDefault();
            if (command.filterActive) runtime.clearColumnFilters(column.columnId);
            else runtime.resetColumnFilters(column.columnId);
          } else if (command.sortable) {
            event.preventDefault();
            runtime.toggleColumnSort(column.columnId, event.shiftKey);
          } else if (command.filterBaselineAvailable) {
            event.preventDefault();
            if (command.filterActive) runtime.clearColumnFilters(column.columnId);
            else runtime.resetColumnFilters(column.columnId);
          }
          return;
        }
        const delta = navigationDelta(event.key);
        const pageDelta =
          event.key === "PageUp"
            ? -viewportPageSize(event.currentTarget)
            : event.key === "PageDown"
              ? viewportPageSize(event.currentTarget)
              : undefined;
        if (delta === undefined && pageDelta === undefined) return;
        event.preventDefault();
        if (pageDelta !== undefined) navigation.movePage(pageDelta);
        else if (delta !== undefined) navigation.move(delta.row, delta.column);
        const next = navigation.getSnapshot();
        if (next !== undefined) revealCell(next.rowIndex, next.columnId, next.region);
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
      <table role="presentation" style={{ tableLayout: "fixed", width: tableWidth }}>
        <thead
          role="rowgroup"
          style={{
            background: "Canvas",
            position: "sticky",
            top: 0,
            width: tableWidth,
            zIndex: 4,
          }}
        >
          <tr aria-rowindex={1} role="row" style={{ height: ROW_HEIGHT, maxHeight: ROW_HEIGHT }}>
            {virtualWindow.pinnedStart.length > 0 ? (
              <th
                data-pinned-region="start"
                role="presentation"
                style={pinnedRegionStyle("start", totalColumnWidth(virtualWindow.pinnedStart))}
              >
                <div role="presentation" style={{ display: "flex" }}>
                  {virtualWindow.pinnedStart.map((column, index) => (
                    <BrunoTableHeaderCell
                      key={column.columnId}
                      regionCell
                      instanceId={instanceId}
                      tableId={tableId}
                      columnIndex={index}
                      column={column}
                      runtime={runtime}
                      activateHeaderCommand={activateHeaderCommand}
                      style={{ width: column.semantics.width }}
                    />
                  ))}
                </div>
              </th>
            ) : null}
            {virtualWindow.leftPadding > 0 ? (
              <th aria-hidden="true" style={{ padding: 0, width: virtualWindow.leftPadding }} />
            ) : null}
            {virtualWindow.center.map((column) => (
              <BrunoTableHeaderCell
                key={column.columnId}
                instanceId={instanceId}
                tableId={tableId}
                columnIndex={
                  virtualWindow.pinnedStart.length +
                  virtualWindow.centerStartIndex +
                  virtualWindow.center.indexOf(column)
                }
                column={column}
                runtime={runtime}
                activateHeaderCommand={activateHeaderCommand}
                style={{ width: column.semantics.width }}
              />
            ))}
            {virtualWindow.rightPadding > 0 ? (
              <th aria-hidden="true" style={{ padding: 0, width: virtualWindow.rightPadding }} />
            ) : null}
            {virtualWindow.pinnedEnd.length > 0 ? (
              <th
                data-pinned-region="end"
                role="presentation"
                style={pinnedRegionStyle("end", totalColumnWidth(virtualWindow.pinnedEnd))}
              >
                <div role="presentation" style={{ display: "flex" }}>
                  {virtualWindow.pinnedEnd.map((column, index) => (
                    <BrunoTableHeaderCell
                      key={column.columnId}
                      regionCell
                      instanceId={instanceId}
                      tableId={tableId}
                      columnIndex={
                        virtualWindow.pinnedStart.length + virtualWindow.centerCount + index
                      }
                      column={column}
                      runtime={runtime}
                      activateHeaderCommand={activateHeaderCommand}
                      style={{ width: column.semantics.width }}
                    />
                  ))}
                </div>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody
          role="rowgroup"
          style={{
            display: "block",
            height: virtualWindow.totalHeight,
            position: "relative",
            width: tableWidth,
          }}
        >
          {Array.from({ length: virtualWindow.rowEnd - virtualWindow.rowStart }, (_, offset) => {
            const logicalRowIndex = virtualWindow.rowStart + offset;
            const rowId = rowSpace.getRowId(logicalRowIndex);
            return rowId === undefined ? (
              <UnloadedRow
                key={`unloaded-${String(logicalRowIndex)}`}
                logicalRowIndex={logicalRowIndex}
                top={offset * ROW_HEIGHT}
                width={tableWidth}
              />
            ) : (
              <BrunoTableRow
                key={rowId}
                rowId={rowId}
                instanceId={instanceId}
                tableId={tableId}
                centerStartIndex={virtualWindow.centerStartIndex}
                centerCount={virtualWindow.centerCount}
                pinnedStartCount={virtualWindow.pinnedStart.length}
                runtime={runtime}
                center={virtualWindow.center}
                pinnedStart={virtualWindow.pinnedStart}
                pinnedEnd={virtualWindow.pinnedEnd}
                leftPadding={virtualWindow.leftPadding}
                rightPadding={virtualWindow.rightPadding}
                logicalRowIndex={logicalRowIndex}
                top={offset * ROW_HEIGHT}
                width={tableWidth}
              />
            );
          })}
        </tbody>
      </table>
      <ActiveDescendantOutlet
        instanceId={instanceId}
        logicalColumns={logicalColumns}
        navigation={navigation}
        runtime={runtime}
        tableId={tableId}
        virtualWindow={virtualWindow}
      />
    </div>
  );
});

// Active Cell movement updates the composite attribute without waking the structural grid tree.
// oxlint-disable react/react-compiler
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
  "use no memo";
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
// oxlint-enable react/react-compiler

const ActiveDescendantOutlet = memo(function ActiveDescendantOutlet({
  instanceId,
  logicalColumns,
  navigation,
  runtime,
  tableId,
  virtualWindow,
}: {
  readonly instanceId: string;
  readonly logicalColumns: readonly CompiledColumn[];
  readonly navigation: BrunoTableNavigationRuntime;
  readonly runtime: BrunoTableRuntimeView;
  readonly tableId: string;
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
    (activeCell.rowId !== undefined &&
      activeCell.rowIndex >= virtualWindow.rowStart &&
      activeCell.rowIndex < virtualWindow.rowEnd);
  if (activeColumnMounted && activeRowMounted) return null;
  return (
    <ActiveDescendantProxy
      activeCell={activeCell}
      column={logicalColumns.find((column) => column.columnId === activeCell.columnId)}
      columnIndex={logicalColumns.findIndex((column) => column.columnId === activeCell.columnId)}
      instanceId={instanceId}
      runtime={runtime}
      tableId={tableId}
    />
  );
});

const BrunoTableHeaderCell = memo(function BrunoTableHeaderCell({
  activateHeaderCommand,
  instanceId,
  tableId,
  columnIndex,
  column,
  regionCell = false,
  runtime,
  style,
}: {
  readonly activateHeaderCommand: (columnId: string) => void;
  readonly instanceId: string;
  readonly tableId: string;
  readonly columnIndex: number;
  readonly column: CompiledColumn;
  readonly regionCell?: boolean;
  readonly runtime: BrunoTableRuntimeView;
  readonly style?: CSSProperties;
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

  const content = (
    <div className="flex min-w-0 items-center gap-1 overflow-hidden">
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
            runtime.toggleColumnSort(column.columnId, event.shiftKey);
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
      {command.filterBaselineAvailable ? (
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
            if (command.filterActive) runtime.clearColumnFilters(column.columnId);
            else runtime.resetColumnFilters(column.columnId);
          }}
        >
          {command.filterActive ? "Clear" : "Reset"}
        </Button>
      ) : null}
    </div>
  );
  const headerProps = {
    id: headerDomId(instanceId, tableId, column.columnId),
    "aria-label": presentation.label,
    "aria-colindex": columnIndex + 1,
    "aria-keyshortcuts": command.filterBaselineAvailable ? "Alt+Enter" : undefined,
    "aria-sort": presentation.ariaSort,
    role: "columnheader",
    style: {
      boxSizing: "border-box",
      height: ROW_HEIGHT,
      maxHeight: ROW_HEIGHT,
      overflow: "hidden",
      ...style,
    } satisfies CSSProperties,
  } as const;
  return regionCell ? (
    <div {...headerProps}>{content}</div>
  ) : (
    <th {...headerProps} scope="col">
      {content}
    </th>
  );
});

const ActiveDescendantProxy = memo(function ActiveDescendantProxy({
  activeCell,
  column,
  columnIndex,
  instanceId,
  runtime,
  tableId,
}: {
  readonly activeCell: BrunoTableActiveCell;
  readonly column: CompiledColumn | undefined;
  readonly columnIndex: number;
  readonly instanceId: string;
  readonly runtime: BrunoTableRuntimeView;
  readonly tableId: string;
}) {
  if (column === undefined || columnIndex < 0) return null;
  if (activeCell.region === "header") {
    return (
      <ActiveHeaderDescendantProxy
        column={column}
        columnIndex={columnIndex}
        instanceId={instanceId}
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
  runtime,
  tableId,
}: {
  readonly column: CompiledColumn;
  readonly columnIndex: number;
  readonly instanceId: string;
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
        aria-keyshortcuts={command.filterBaselineAvailable ? "Alt+Enter" : undefined}
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
  const subscribe = useMemo(
    () => (listener: () => void) =>
      rowId === undefined ? () => undefined : runtime.subscribeRow(rowId, listener),
    [rowId, runtime],
  );
  const getSnapshot = useMemo(
    () => () => (rowId === undefined ? undefined : runtime.getRowSnapshot(rowId)),
    [rowId, runtime],
  );
  const row = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const value = row === undefined ? undefined : readCompiledColumnValue(column, row);
  const content = row === undefined ? "Loading row" : resolveProxyCellContent(column, row, value);
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
  logicalRowIndex,
  top,
  width,
}: {
  readonly logicalRowIndex: number;
  readonly top: number;
  readonly width: number;
}) {
  return (
    <tr
      aria-rowindex={logicalRowIndex + 2}
      role="row"
      style={{
        display: "table",
        height: ROW_HEIGHT,
        maxHeight: ROW_HEIGHT,
        position: "absolute",
        tableLayout: "fixed",
        top: `calc(var(--bruno-table-row-layer-offset, 0px) + ${String(top)}px)`,
        width,
      }}
    >
      <td aria-label="Loading row" role="gridcell" style={{ width }}>
        <Skeleton style={{ height: ROW_HEIGHT }} />
      </td>
    </tr>
  );
});

const BrunoTableRow = memo(function BrunoTableRow({
  rowId,
  instanceId,
  tableId,
  centerStartIndex,
  centerCount,
  pinnedStartCount,
  runtime,
  center,
  pinnedStart,
  pinnedEnd,
  leftPadding,
  rightPadding,
  logicalRowIndex,
  top,
  width,
}: {
  readonly rowId: string;
  readonly instanceId: string;
  readonly tableId: string;
  readonly centerStartIndex: number;
  readonly centerCount: number;
  readonly pinnedStartCount: number;
  readonly runtime: BrunoTableRuntimeView;
  readonly center: readonly CompiledColumn[];
  readonly pinnedStart: readonly CompiledColumn[];
  readonly pinnedEnd: readonly CompiledColumn[];
  readonly leftPadding: number;
  readonly rightPadding: number;
  readonly logicalRowIndex: number;
  readonly top: number;
  readonly width: number;
}) {
  const subscribe = useMemo(
    () => (listener: () => void) => runtime.subscribeRow(rowId, listener),
    [rowId, runtime],
  );
  const getSnapshot = useMemo(() => () => runtime.getRowSnapshot(rowId), [rowId, runtime]);
  const row = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (row === undefined) return null;

  return (
    <tr
      role="row"
      aria-rowindex={logicalRowIndex + 2}
      style={{
        display: "table",
        height: ROW_HEIGHT,
        maxHeight: ROW_HEIGHT,
        overflow: "hidden",
        position: "absolute",
        tableLayout: "fixed",
        top: `calc(var(--bruno-table-row-layer-offset, 0px) + ${top}px)`,
        width,
      }}
    >
      {pinnedStart.length > 0 ? (
        <td
          data-pinned-region="start"
          role="presentation"
          style={pinnedRegionStyle("start", totalColumnWidth(pinnedStart))}
        >
          <div role="presentation" style={{ display: "flex" }}>
            {pinnedStart.map((column, index) => (
              <BrunoTableCell
                key={column.columnId}
                regionCell
                row={row}
                rowId={rowId}
                instanceId={instanceId}
                tableId={tableId}
                columnIndex={index}
                column={column}
              />
            ))}
          </div>
        </td>
      ) : null}
      {leftPadding > 0 ? (
        <td aria-hidden="true" style={{ padding: 0, width: leftPadding }} />
      ) : null}
      {center.map((column) => (
        <BrunoTableCell
          key={column.columnId}
          row={row}
          rowId={rowId}
          instanceId={instanceId}
          tableId={tableId}
          columnIndex={pinnedStartCount + centerStartIndex + center.indexOf(column)}
          column={column}
        />
      ))}
      {rightPadding > 0 ? (
        <td aria-hidden="true" style={{ padding: 0, width: rightPadding }} />
      ) : null}
      {pinnedEnd.length > 0 ? (
        <td
          data-pinned-region="end"
          role="presentation"
          style={pinnedRegionStyle("end", totalColumnWidth(pinnedEnd))}
        >
          <div role="presentation" style={{ display: "flex" }}>
            {pinnedEnd.map((column, index) => (
              <BrunoTableCell
                key={column.columnId}
                regionCell
                row={row}
                rowId={rowId}
                instanceId={instanceId}
                tableId={tableId}
                columnIndex={pinnedStartCount + centerCount + index}
                column={column}
              />
            ))}
          </div>
        </td>
      ) : null}
    </tr>
  );
});

const BrunoTableCell = memo(function BrunoTableCell({
  row,
  rowId,
  instanceId,
  tableId,
  columnIndex,
  column,
  regionCell = false,
  style,
}: {
  readonly row: unknown;
  readonly rowId: string;
  readonly instanceId?: string;
  readonly tableId?: string;
  readonly columnIndex?: number;
  readonly column: CompiledColumn;
  readonly regionCell?: boolean;
  readonly style?: CSSProperties;
}) {
  const value = readCompiledColumnValue(column, row);
  const className = resolveCellClassName(column, row, value);
  const content = resolveCellContent(column, row, value);
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
    width: column.semantics.width,
    ...style,
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
      {column.cellRenderer === undefined ? (
        content
      ) : (
        <NonTabbableCellContent>{content}</NonTabbableCellContent>
      )}
    </div>
  );
  return regionCell ? (
    <div
      id={id}
      aria-colindex={columnIndex === undefined ? undefined : columnIndex + 1}
      className={className}
      role="gridcell"
      style={cellStyle}
    >
      {cellContent}
    </div>
  ) : (
    <td
      id={id}
      aria-colindex={columnIndex === undefined ? undefined : columnIndex + 1}
      className={className}
      role="gridcell"
      style={cellStyle}
    >
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
    <span ref={ref} style={{ display: "contents" }}>
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

function pinnedRegionStyle(side: "start" | "end", width: number): CSSProperties {
  return {
    background: "Canvas",
    boxSizing: "border-box",
    height: ROW_HEIGHT,
    maxHeight: ROW_HEIGHT,
    minWidth: width,
    padding: 0,
    position: "sticky",
    width,
    zIndex: 3,
    ...(side === "start" ? { left: 0 } : { right: 0 }),
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

function resolveCellText(column: CompiledColumn, row: unknown, value: unknown): string {
  if (column.valueFormatter !== undefined) {
    const formatted = Reflect.apply(column.valueFormatter, undefined, [{ row, value }]);
    if (typeof formatted === "string") return formatted;
  }
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

function LoadingRows({ count }: { readonly count: number }) {
  return (
    <div
      aria-busy="true"
      aria-colcount={1}
      aria-label="Loading table rows"
      aria-rowcount={count}
      role="grid"
    >
      <div role="rowgroup">
        {Array.from({ length: count }, (_, index) => (
          <div key={index} aria-rowindex={index + 1} role="row" style={{ height: ROW_HEIGHT }}>
            <div role="gridcell">
              <Skeleton aria-label="Loading row" style={{ height: ROW_HEIGHT - 8, margin: 4 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
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
