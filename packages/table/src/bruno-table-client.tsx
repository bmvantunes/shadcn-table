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
  useState,
  useSyncExternalStore,
} from "react";

import type { CSSProperties, ReactElement, ReactNode } from "react";

import type {
  BrunoTableClientProps,
  BrunoTableColumns,
  BrunoTableReadOnlyCapability,
  BrunoTableSortableColumnId,
  BrunoTableSortBy,
} from "./public-types";
import { compileColumns, type CompiledColumn } from "./internal/compile-columns";
import { useClientRowIds } from "./internal/client-adapter";
import { filterClientRows } from "./internal/client-row-model";
import { readCompiledColumnValue } from "./internal/cell-value";
import { BrunoTableNavigationRuntime, type BrunoTableActiveCell } from "./internal/navigation";
import {
  BrunoTableClientRuntime,
  type BrunoTableClientRuntimeView,
  type BrunoTableRowOrderChangeDetector,
} from "./internal/grid-runtime";
import {
  BrunoTableViewportRuntime,
  type BrunoTableViewportSnapshot,
} from "./internal/virtual-viewport";

const ROW_HEIGHT = 36;
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
  return `bruno-table-cell-${encodeURIComponent(instanceId)}-${encodeURIComponent(tableId)}-${encodeURIComponent(rowId)}-${columnId}`;
}

function headerDomId(instanceId: string, tableId: string, columnId: string): string {
  return `bruno-table-header-${encodeURIComponent(instanceId)}-${encodeURIComponent(tableId)}-${columnId}`;
}

function activeDomId(
  instanceId: string,
  tableId: string,
  activeCell: BrunoTableActiveCell,
): string | undefined {
  return activeCell.region === "header"
    ? headerDomId(instanceId, tableId, activeCell.columnId)
    : activeCell.rowId === undefined
      ? undefined
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

export function BrunoTableClient<TRow, const TColumns extends BrunoTableColumns<TRow>>(
  props: BrunoTableClientRenderProps<TRow, TColumns>,
): ReactNode {
  const compiledColumns = useMemo(() => compileColumns(props.columns), [props.columns]);
  const [runtime] = useState(
    () =>
      new BrunoTableClientRuntime(
        props.clientSource,
        props.getRowId,
        compiledColumns,
        props.initialFilters,
        props.initialOrderBy,
      ),
  );
  const [toolbar] = useState(() => new BrunoTableToolbarStore(props.children));
  const runtimeView = runtime.getView();

  useLayoutEffect(() => {
    runtime.configure(props.getRowId, compiledColumns);
    runtime.publish(props.clientSource);
  }, [compiledColumns, props.clientSource, props.getRowId, runtime]);

  useLayoutEffect(() => {
    toolbar.publish(props.children);
  }, [props.children, toolbar]);

  return (
    <BrunoTableView
      runtime={runtimeView}
      tableId={props.tableId}
      compiledColumns={compiledColumns}
      toolbar={toolbar}
    />
  );
}

type BrunoTableClientRenderProps<TRow, TColumns extends BrunoTableColumns<TRow>> = Omit<
  BrunoTableClientProps<TRow, TColumns>,
  "initialOrderBy"
> &
  BrunoTableReadOnlyCapability & {
    readonly initialOrderBy?: [BrunoTableSortableColumnId<TColumns>] extends [never]
      ? never
      : BrunoTableSortBy<TColumns>;
  } & ([BrunoTableSortableColumnId<TColumns>] extends [never]
    ? unknown
    : { readonly initialOrderBy: BrunoTableSortBy<TColumns> });

type BrunoTableViewProps = {
  readonly runtime: BrunoTableClientRuntimeView;
  readonly tableId: string;
  readonly compiledColumns: readonly CompiledColumn[];
  readonly toolbar: BrunoTableToolbarStore;
};

const BrunoTableView = memo(function BrunoTableView({
  runtime,
  tableId,
  compiledColumns,
  toolbar,
}: BrunoTableViewProps) {
  return (
    <section aria-label={tableId} data-bruno-table={tableId}>
      <ToolbarOutlet toolbar={toolbar} />
      <SourceLifecycle runtime={runtime} />
      <ClientGridBody runtime={runtime} tableId={tableId} compiledColumns={compiledColumns} />
    </section>
  );
});

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

type RuntimeProps = { readonly runtime: BrunoTableClientRuntimeView };

function SourceLifecycle({ runtime }: RuntimeProps) {
  const chrome = useSyncExternalStore(
    runtime.subscribeChrome,
    runtime.getChromeSnapshot,
    runtime.getChromeSnapshot,
  );

  if (chrome.incomplete) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Incomplete client source</AlertTitle>
        <AlertDescription>
          Expected {String(chrome.totalRows)} rows but received {String(chrome.receivedRows)}.
        </AlertDescription>
      </Alert>
    );
  }

  if (chrome.status === "stale" && chrome.hasCoherentRows) {
    return (
      <LifecycleAlert
        title="Live data delayed"
        {...lifecycleDetails(chrome.message, chrome.statusCode)}
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
}: {
  readonly title: string;
  readonly message?: string;
  readonly destructive?: boolean;
  readonly retry?: { readonly pending: boolean };
  readonly onRetry?: () => void;
}) {
  return (
    <Alert variant={destructive ? "destructive" : "default"}>
      <AlertTitle>{title}</AlertTitle>
      {message !== undefined ? <AlertDescription>{message}</AlertDescription> : null}
      {retry !== undefined && onRetry !== undefined ? (
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
      ) : null}
    </Alert>
  );
}

type ClientGridBodyProps = {
  readonly runtime: BrunoTableClientRuntimeView;
  readonly tableId: string;
  readonly compiledColumns: readonly CompiledColumn[];
};

function ClientGridBody({ runtime, tableId, compiledColumns }: ClientGridBodyProps) {
  const body = useSyncExternalStore(
    runtime.subscribeBody,
    runtime.getBodySnapshot,
    runtime.getBodySnapshot,
  );
  if (body.kind === "loading") return <LoadingRows count={body.skeletonCount} />;
  if (body.kind === "invalid") return null;
  if (body.kind === "empty") {
    return (
      <Empty
        className={body.destructive ? "border-destructive text-destructive" : undefined}
        role={body.destructive ? "alert" : undefined}
      >
        <EmptyHeader>
          <EmptyTitle>{body.emptyTitle}</EmptyTitle>
          <EmptyDescription>
            {body.emptyDescription ?? "No rows are available for this table."}
          </EmptyDescription>
        </EmptyHeader>
        {body.retry !== undefined ? (
          <EmptyContent>
            <Button
              type="button"
              variant="outline"
              onClick={() => runtime.retry()}
              disabled={body.retry.pending}
            >
              {body.retry.pending ? <Spinner /> : null}
              Retry
            </Button>
          </EmptyContent>
        ) : null}
      </Empty>
    );
  }

  return <ClientRowOrder tableId={tableId} runtime={runtime} columns={compiledColumns} />;
}

const ClientRowOrder = memo(function ClientRowOrder(props: ClientRowOrderProps) {
  const query = useSyncExternalStore(
    props.runtime.subscribeQuery,
    props.runtime.getQuerySnapshot,
    props.runtime.getQuerySnapshot,
  );
  return query.orderBy.length === 0 ? (
    <ClientUnsortedRowOrder
      {...props}
      filters={query.filters}
      orderBy={query.orderBy}
      queryGeneration={query.generation}
    />
  ) : (
    <ClientSortedRowOrder
      {...props}
      filters={query.filters}
      orderBy={query.orderBy}
      queryGeneration={query.generation}
    />
  );
});

type ClientRowOrderProps = {
  readonly tableId: string;
  readonly runtime: BrunoTableClientRuntimeView;
  readonly columns: readonly CompiledColumn[];
};

type ClientResolvedRowOrderProps = ClientRowOrderProps & {
  readonly filters: readonly unknown[];
  readonly queryGeneration: number;
  readonly orderBy: readonly {
    readonly columnId: string;
    readonly direction: "asc" | "desc";
  }[];
};

const ClientUnsortedRowOrder = memo(function ClientUnsortedRowOrder({
  tableId,
  runtime,
  columns,
  filters,
  orderBy,
  queryGeneration,
}: ClientResolvedRowOrderProps) {
  const rowOrderDetector = useMemo<BrunoTableRowOrderChangeDetector>(
    () => (previousRows, nextRows, previousRowIds, nextRowIds) =>
      rowOrderChanged(
        previousRows,
        nextRows,
        previousRowIds,
        nextRowIds,
        columns,
        filters,
        orderBy,
      ),
    [columns, filters, orderBy],
  );
  const subscribeRowOrder = useMemo(
    () => (listener: () => void) => runtime.subscribeRows(listener, rowOrderDetector),
    [rowOrderDetector, runtime],
  );
  const rows = useSyncExternalStore(
    subscribeRowOrder,
    runtime.getRowsSnapshot,
    runtime.getRowsSnapshot,
  );
  const filteredRows = useMemo(
    () => filterClientRows(rows, columns, filters),
    [columns, filters, rows],
  );
  const rowIds = useMemo(() => filteredRows.map(runtime.resolveRowId), [filteredRows, runtime]);
  return (
    <ClientVirtualTable
      tableId={tableId}
      rowIds={rowIds}
      runtime={runtime}
      columns={columns}
      queryGeneration={queryGeneration}
    />
  );
});

const ClientSortedRowOrder = memo(function ClientSortedRowOrder({
  tableId,
  runtime,
  columns,
  filters,
  orderBy,
  queryGeneration,
}: ClientResolvedRowOrderProps) {
  const rowOrderDetector = useMemo<BrunoTableRowOrderChangeDetector>(
    () => (previousRows, nextRows, previousRowIds, nextRowIds) =>
      rowOrderChanged(
        previousRows,
        nextRows,
        previousRowIds,
        nextRowIds,
        columns,
        filters,
        orderBy,
      ),
    [columns, filters, orderBy],
  );
  const subscribeRowOrder = useMemo(
    () => (listener: () => void) => runtime.subscribeRows(listener, rowOrderDetector),
    [rowOrderDetector, runtime],
  );
  const rows = useSyncExternalStore(
    subscribeRowOrder,
    runtime.getRowsSnapshot,
    runtime.getRowsSnapshot,
  );
  const nextRowIds = useClientRowIds(rows, columns, orderBy, runtime.resolveRowId, filters);
  const [orderStore] = useState(() => new ClientRowOrderStore());
  useLayoutEffect(() => {
    orderStore.publish(nextRowIds);
  }, [nextRowIds, orderStore]);
  const rowIds = useSyncExternalStore(
    orderStore.subscribe,
    orderStore.getSnapshot,
    orderStore.getSnapshot,
  );

  return (
    <ClientVirtualTable
      tableId={tableId}
      rowIds={rowIds}
      runtime={runtime}
      columns={columns}
      queryGeneration={queryGeneration}
    />
  );
});

// The private viewport adapter coordinates mutable DOM geometry outside React's compiled data path.
const ClientVirtualTable = memo(function ClientVirtualTable({
  tableId,
  rowIds,
  runtime,
  columns,
  queryGeneration,
}: {
  readonly tableId: string;
  readonly rowIds: readonly string[];
  readonly runtime: BrunoTableClientRuntimeView;
  readonly columns: readonly CompiledColumn[];
  readonly queryGeneration: number;
}) {
  return (
    <ViewportAdapter
      tableId={tableId}
      rowIds={rowIds}
      runtime={runtime}
      columns={columns}
      queryGeneration={queryGeneration}
    />
  );
});

// DOM attachment and measurement are isolated here from the compiler-managed render surface.
// oxlint-disable react/react-compiler
const ViewportAdapter = memo(function ViewportAdapter({
  tableId,
  rowIds,
  runtime,
  columns,
  queryGeneration,
}: {
  readonly tableId: string;
  readonly rowIds: readonly string[];
  readonly runtime: BrunoTableClientRuntimeView;
  readonly columns: readonly CompiledColumn[];
  readonly queryGeneration: number;
}) {
  "use no memo";
  const instanceId = useId();
  const [viewport] = useState(() => {
    const next = new BrunoTableViewportRuntime();
    next.setLayout(rowIds.length, columns);
    return next;
  });
  const [navigation] = useState(() => new BrunoTableNavigationRuntime());
  const viewportSnapshot = useSyncExternalStore(
    viewport.subscribe,
    viewport.getSnapshot,
    viewport.getSnapshot,
  );
  useLayoutEffect(() => {
    viewport.resetVertical();
    navigation.reset();
  }, [navigation, queryGeneration, viewport]);
  useLayoutEffect(() => {
    viewport.setLayout(rowIds.length, columns);
    navigation.setShape(rowIds, columns);
  }, [columns, navigation, rowIds, viewport]);
  useEffect(() => () => viewport.dispose(), [viewport]);

  return (
    <ClientGridSurface
      instanceId={instanceId}
      tableId={tableId}
      rowIds={rowIds}
      runtime={runtime}
      columns={columns}
      viewportSnapshot={viewportSnapshot}
      attach={viewport.attach}
      navigation={navigation}
      revealCell={viewport.revealCell}
    />
  );
});
// oxlint-enable react/react-compiler

const ClientGridSurface = memo(function ClientGridSurface({
  instanceId,
  tableId,
  rowIds,
  runtime,
  columns,
  viewportSnapshot,
  attach,
  navigation,
  revealCell,
}: {
  readonly instanceId: string;
  readonly tableId: string;
  readonly rowIds: readonly string[];
  readonly runtime: BrunoTableClientRuntimeView;
  readonly columns: readonly CompiledColumn[];
  readonly viewportSnapshot: BrunoTableViewportSnapshot;
  readonly attach: (element: HTMLElement | null) => void;
  readonly navigation: BrunoTableNavigationRuntime;
  readonly revealCell: (rowIndex: number, columnId: string) => void;
}) {
  const virtualWindow = viewportSnapshot.virtualWindow;
  const tableWidth = virtualWindow.totalWidth;
  const activeCell = useSyncExternalStore(
    navigation.subscribe,
    navigation.getSnapshot,
    navigation.getSnapshot,
  );
  const activeColumnMounted =
    activeCell === undefined ||
    [virtualWindow.pinnedStart, virtualWindow.center, virtualWindow.pinnedEnd].some((columns) =>
      columns.some((column) => column.columnId === activeCell.columnId),
    );
  const activeRowMounted =
    activeCell === undefined ||
    activeCell.region === "header" ||
    (activeCell.rowIndex >= virtualWindow.rowStart && activeCell.rowIndex < virtualWindow.rowEnd);
  const activeProxyNeeded = activeCell !== undefined && (!activeColumnMounted || !activeRowMounted);
  const logicalColumns = useMemo(
    () => [
      ...columns.filter((column) => column.pinned === "start"),
      ...columns.filter((column) => column.pinned === undefined),
      ...columns.filter((column) => column.pinned === "end"),
    ],
    [columns],
  );

  return (
    <div
      ref={attach}
      role="grid"
      aria-label={`Data for ${tableId}`}
      tabIndex={0}
      aria-activedescendant={
        activeCell === undefined ? undefined : activeDomId(instanceId, tableId, activeCell)
      }
      aria-rowcount={rowIds.length + 1}
      aria-colcount={
        virtualWindow.pinnedStart.length +
        virtualWindow.centerCount +
        virtualWindow.pinnedEnd.length
      }
      onKeyDown={(event) => {
        const delta = navigationDelta(event.key);
        if (delta === undefined) return;
        event.preventDefault();
        navigation.move(delta.row, delta.column);
        const next = navigation.getSnapshot();
        if (next !== undefined) revealCell(next.rowIndex, next.columnId);
      }}
      style={{ maxHeight: 480, overflow: "auto", position: "relative" }}
    >
      <table
        role="presentation"
        style={{ minWidth: "100%", tableLayout: "fixed", width: tableWidth }}
      >
        <thead
          role="rowgroup"
          style={{
            background: "Canvas",
            position: "sticky",
            top: 0,
            width: tableWidth,
            zIndex: 1,
          }}
        >
          <tr aria-rowindex={1} role="row">
            {virtualWindow.pinnedStart.length > 0 ? (
              <th
                data-pinned-region="start"
                role="presentation"
                style={pinnedRegionStyle("start", totalColumnWidth(virtualWindow.pinnedStart))}
              >
                <div style={{ display: "flex" }}>
                  {virtualWindow.pinnedStart.map((column, index) => (
                    <ClientHeaderCell
                      key={column.columnId}
                      regionCell
                      instanceId={instanceId}
                      tableId={tableId}
                      columnIndex={index}
                      column={column}
                      runtime={runtime}
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
              <ClientHeaderCell
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
                <div style={{ display: "flex" }}>
                  {virtualWindow.pinnedEnd.map((column, index) => (
                    <ClientHeaderCell
                      key={column.columnId}
                      regionCell
                      instanceId={instanceId}
                      tableId={tableId}
                      columnIndex={
                        virtualWindow.pinnedStart.length + virtualWindow.centerCount + index
                      }
                      column={column}
                      runtime={runtime}
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
          {rowIds.slice(virtualWindow.rowStart, virtualWindow.rowEnd).map((rowId, offset) => (
            <ClientRow
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
              top={(virtualWindow.rowStart + offset) * ROW_HEIGHT}
              width={tableWidth}
            />
          ))}
        </tbody>
      </table>
      {activeProxyNeeded && activeCell !== undefined ? (
        <ActiveDescendantProxy
          activeCell={activeCell}
          column={logicalColumns.find((column) => column.columnId === activeCell.columnId)}
          columnIndex={logicalColumns.findIndex(
            (column) => column.columnId === activeCell.columnId,
          )}
          instanceId={instanceId}
          runtime={runtime}
          tableId={tableId}
        />
      ) : null}
    </div>
  );
});

const ClientHeaderCell = memo(function ClientHeaderCell({
  instanceId,
  tableId,
  columnIndex,
  column,
  regionCell = false,
  runtime,
  style,
}: {
  readonly instanceId: string;
  readonly tableId: string;
  readonly columnIndex: number;
  readonly column: CompiledColumn;
  readonly regionCell?: boolean;
  readonly runtime: BrunoTableClientRuntimeView;
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
  const ariaSort =
    command.sortDirection === "asc"
      ? "ascending"
      : command.sortDirection === "desc"
        ? "descending"
        : "none";
  const sortLabel =
    command.sortDirection === undefined
      ? `Sort by ${column.headerName}`
      : `Sort by ${column.headerName}, currently ${ariaSort}, priority ${String(command.sortPriority)}`;

  const content = (
    <div className="flex min-w-0 items-center gap-1 overflow-hidden">
      {command.sortable ? (
        <Button
          aria-label={sortLabel}
          size="xs"
          type="button"
          variant="ghost"
          onClick={(event) => runtime.toggleColumnSort(column.columnId, event.shiftKey)}
        >
          <span className="truncate">{column.headerName}</span>
          {command.sortPriority === undefined ? null : (
            <span aria-hidden="true">{String(command.sortPriority)}</span>
          )}
        </Button>
      ) : (
        <span className="truncate">{column.headerName}</span>
      )}
      {command.filterBaselineAvailable ? (
        <Button
          aria-label={`${command.filterActive ? "Clear" : "Reset"} filter for ${column.headerName}`}
          size="xs"
          type="button"
          variant="ghost"
          onClick={() => {
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
    "aria-label": column.headerName,
    "aria-colindex": columnIndex + 1,
    "aria-sort": command.sortable ? ariaSort : undefined,
    role: "columnheader",
    style: { boxSizing: "border-box", overflow: "hidden", ...style } satisfies CSSProperties,
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
  readonly runtime: BrunoTableClientRuntimeView;
  readonly tableId: string;
}) {
  const rowId = activeCell.rowId ?? "";
  const subscribe = useMemo(
    () => (listener: () => void) => runtime.subscribeRow(rowId, listener),
    [rowId, runtime],
  );
  const getSnapshot = useMemo(() => () => runtime.getRowSnapshot(rowId), [rowId, runtime]);
  const row = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (column === undefined || columnIndex < 0) return null;

  if (activeCell.region === "header") {
    return (
      <div aria-rowindex={1} role="row" style={VISUALLY_HIDDEN}>
        <div
          id={headerDomId(instanceId, tableId, column.columnId)}
          aria-colindex={columnIndex + 1}
          role="columnheader"
        >
          {column.headerName}
        </div>
      </div>
    );
  }

  const value = row === undefined ? undefined : readCompiledColumnValue(column, row);
  return (
    <div aria-rowindex={activeCell.rowIndex + 2} role="row" style={VISUALLY_HIDDEN}>
      <div
        id={cellDomId(instanceId, tableId, rowId, column.columnId)}
        aria-colindex={columnIndex + 1}
        role="gridcell"
      >
        {row === undefined ? "Unavailable row" : resolveCellText(column, row, value)}
      </div>
    </div>
  );
});

const ClientRow = memo(function ClientRow({
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
  top,
  width,
}: {
  readonly rowId: string;
  readonly instanceId: string;
  readonly tableId: string;
  readonly centerStartIndex: number;
  readonly centerCount: number;
  readonly pinnedStartCount: number;
  readonly runtime: BrunoTableClientRuntimeView;
  readonly center: readonly CompiledColumn[];
  readonly pinnedStart: readonly CompiledColumn[];
  readonly pinnedEnd: readonly CompiledColumn[];
  readonly leftPadding: number;
  readonly rightPadding: number;
  readonly top: number;
  readonly width: number;
}) {
  const row = useSyncExternalStore(
    (listener) => runtime.subscribeRow(rowId, listener),
    () => runtime.getRowSnapshot(rowId),
    () => runtime.getRowSnapshot(rowId),
  );
  if (row === undefined) return null;

  return (
    <tr
      role="row"
      aria-rowindex={top / ROW_HEIGHT + 2}
      style={{
        display: "table",
        height: ROW_HEIGHT,
        maxHeight: ROW_HEIGHT,
        overflow: "hidden",
        position: "absolute",
        tableLayout: "fixed",
        top,
        width,
      }}
    >
      {pinnedStart.length > 0 ? (
        <td
          data-pinned-region="start"
          role="presentation"
          style={pinnedRegionStyle("start", totalColumnWidth(pinnedStart))}
        >
          <div style={{ display: "flex" }}>
            {pinnedStart.map((column, index) => (
              <ClientCell
                key={column.columnId}
                regionCell
                row={row}
                rowId={rowId}
                rowIndex={top / ROW_HEIGHT}
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
        <ClientCell
          key={column.columnId}
          row={row}
          rowId={rowId}
          rowIndex={top / ROW_HEIGHT}
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
          <div style={{ display: "flex" }}>
            {pinnedEnd.map((column, index) => (
              <ClientCell
                key={column.columnId}
                regionCell
                row={row}
                rowId={rowId}
                rowIndex={top / ROW_HEIGHT}
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

const ClientCell = memo(function ClientCell({
  row,
  rowId,
  rowIndex: _rowIndex,
  instanceId,
  tableId,
  columnIndex,
  column,
  regionCell = false,
  style,
}: {
  readonly row: unknown;
  readonly rowId: string;
  readonly rowIndex?: number;
  readonly instanceId?: string;
  readonly tableId?: string;
  readonly columnIndex?: number;
  readonly column: CompiledColumn;
  readonly regionCell?: boolean;
  readonly style?: CSSProperties;
}) {
  const value = readCompiledColumnValue(column, row);
  const className = resolveCellClassName(column, row, value);
  const content =
    column.cellRenderer === undefined
      ? resolveCellText(column, row, value)
      : resolveCellRenderer(column, row, value);
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
      {content}
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

function pinnedRegionStyle(side: "start" | "end", width: number): CSSProperties {
  return {
    background: "Canvas",
    boxSizing: "border-box",
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
    if (!isValidElement(child) || child.type !== Fragment) return true;
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

function rowOrderChanged(
  previousRows: readonly unknown[],
  nextRows: readonly unknown[],
  previousRowIds: readonly string[],
  nextRowIds: readonly string[],
  columns: readonly CompiledColumn[],
  filters: readonly unknown[] | undefined,
  orderBy: readonly { readonly columnId: string; readonly direction: "asc" | "desc" }[],
): boolean {
  if (!sameRowIds(previousRowIds, nextRowIds)) return true;
  const relevantIds = new Set(orderBy.map((sort) => sort.columnId));
  for (const filter of filters ?? EMPTY_ORDER_BY) collectFilterColumnIds(filter, relevantIds);
  const relevantColumns = columns.filter((column) => relevantIds.has(column.columnId));
  if (relevantColumns.length === 0) return false;
  for (let index = 0; index < previousRows.length; index += 1) {
    const previousRow = previousRows[index];
    const nextRow = nextRows[index];
    if (previousRow === nextRow) continue;
    for (const column of relevantColumns) {
      if (
        !column.semantics.equivalent(
          readCompiledColumnValue(column, previousRow),
          readCompiledColumnValue(column, nextRow),
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function collectFilterColumnIds(candidate: unknown, target: Set<string>): void {
  const filter = asRecord(candidate);
  if (typeof filter["columnId"] === "string") target.add(filter["columnId"]);
  if (Array.isArray(filter["conditions"])) {
    for (const condition of filter["conditions"]) collectFilterColumnIds(condition, target);
  }
  if (filter["condition"] !== undefined) collectFilterColumnIds(filter["condition"], target);
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Readonly<Record<string, unknown>>;
}

class ClientRowOrderStore {
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly string[] = EMPTY_ORDER_BY;

  public readonly getSnapshot = (): readonly string[] => this.snapshot;

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public readonly publish = (next: readonly string[]): void => {
    if (sameRowIds(this.snapshot, next)) return;
    this.snapshot = Object.freeze(Array.from(next));
    for (const listener of this.listeners) listener();
  };
}

function sameRowIds(previous: readonly string[], next: readonly string[]): boolean {
  return previous.length === next.length && previous.every((rowId, index) => rowId === next[index]);
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

class BrunoTableToolbarStore {
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

const EMPTY_ORDER_BY: readonly never[] = Object.freeze([]);
