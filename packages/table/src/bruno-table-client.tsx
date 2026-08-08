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
import {
  sanitizeClientInitialFilters,
  sanitizeClientInitialOrderBy,
  filterClientRows,
  useClientRowIds,
} from "./internal/client-adapter";
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

function cellDomId(tableId: string, rowId: string, columnId: string): string {
  return `bruno-table-cell-${encodeURIComponent(tableId)}-${encodeURIComponent(rowId)}-${columnId}`;
}

function headerDomId(tableId: string, columnId: string): string {
  return `bruno-table-header-${encodeURIComponent(tableId)}-${columnId}`;
}

function activeDomId(tableId: string, activeCell: BrunoTableActiveCell): string | undefined {
  return activeCell.region === "header"
    ? headerDomId(tableId, activeCell.columnId)
    : activeCell.rowId === undefined
      ? undefined
      : cellDomId(tableId, activeCell.rowId, activeCell.columnId);
}

export function BrunoTableClient<TRow, const TColumns extends BrunoTableColumns<TRow>>(
  props: BrunoTableClientRenderProps<TRow, TColumns>,
): ReactNode {
  const compiledColumns = useMemo(() => compileColumns(props.columns), [props.columns]);
  const [runtime] = useState(() => new BrunoTableClientRuntime(props.clientSource, props.getRowId));
  const [initialFilters] = useState(() =>
    sanitizeClientInitialFilters(props.initialFilters, compiledColumns),
  );
  const [initialOrderBy] = useState(() =>
    sanitizeClientInitialOrderBy(props.initialOrderBy, compiledColumns),
  );
  const runtimeView = runtime.getView();

  useLayoutEffect(() => {
    runtime.configure(props.getRowId);
    runtime.publish(props.clientSource);
  }, [props.clientSource, props.getRowId, runtime]);

  return (
    <BrunoTableView
      runtime={runtimeView}
      tableId={props.tableId}
      compiledColumns={compiledColumns}
      initialFilters={initialFilters}
      initialOrderBy={initialOrderBy}
    >
      {props.children}
    </BrunoTableView>
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
  readonly initialFilters: readonly unknown[] | undefined;
  readonly initialOrderBy:
    | readonly { readonly columnId: string; readonly direction: "asc" | "desc" }[]
    | undefined;
};

const BrunoTableView = memo(function BrunoTableView({
  runtime,
  tableId,
  compiledColumns,
  initialFilters,
  initialOrderBy,
  children,
}: BrunoTableViewProps & { readonly children?: ReactNode }) {
  const hasToolbar = hasRenderableChildren(children);

  return (
    <section aria-label={tableId} data-bruno-table={tableId}>
      {hasToolbar ? (
        <div aria-label="Table toolbar" role="region">
          {children}
        </div>
      ) : null}
      <SourceLifecycle runtime={runtime} />
      <ClientGridBody
        runtime={runtime}
        tableId={tableId}
        compiledColumns={compiledColumns}
        initialFilters={initialFilters}
        initialOrderBy={initialOrderBy}
      />
    </section>
  );
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
  readonly initialFilters: readonly unknown[] | undefined;
  readonly initialOrderBy:
    | readonly { readonly columnId: string; readonly direction: "asc" | "desc" }[]
    | undefined;
};

function ClientGridBody({
  runtime,
  tableId,
  compiledColumns,
  initialFilters,
  initialOrderBy,
}: ClientGridBodyProps) {
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

  return (
    <ClientRowOrder
      tableId={tableId}
      runtime={runtime}
      columns={compiledColumns}
      initialFilters={initialFilters}
      initialOrderBy={initialOrderBy ?? EMPTY_ORDER_BY}
    />
  );
}

const ClientRowOrder = memo(function ClientRowOrder({
  initialOrderBy,
  ...props
}: ClientRowOrderProps) {
  return initialOrderBy.length === 0 ? (
    <ClientUnsortedRowOrder {...props} initialOrderBy={initialOrderBy} />
  ) : (
    <ClientSortedRowOrder {...props} initialOrderBy={initialOrderBy} />
  );
});

type ClientRowOrderProps = {
  readonly tableId: string;
  readonly runtime: BrunoTableClientRuntimeView;
  readonly columns: readonly CompiledColumn[];
  readonly initialFilters: readonly unknown[] | undefined;
  readonly initialOrderBy: readonly {
    readonly columnId: string;
    readonly direction: "asc" | "desc";
  }[];
};

const ClientUnsortedRowOrder = memo(function ClientUnsortedRowOrder({
  tableId,
  runtime,
  columns,
  initialFilters,
  initialOrderBy,
}: ClientRowOrderProps) {
  const rowOrderDetector = useMemo<BrunoTableRowOrderChangeDetector>(
    () => (previousRows, nextRows, previousRowIds, nextRowIds) =>
      rowOrderChanged(
        previousRows,
        nextRows,
        previousRowIds,
        nextRowIds,
        columns,
        initialFilters,
        initialOrderBy,
      ),
    [columns, initialFilters, initialOrderBy],
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
    () => filterClientRows(rows, columns, initialFilters),
    [columns, initialFilters, rows],
  );
  const rowIds = useMemo(() => filteredRows.map(runtime.resolveRowId), [filteredRows, runtime]);
  return (
    <ClientVirtualTable tableId={tableId} rowIds={rowIds} runtime={runtime} columns={columns} />
  );
});

const ClientSortedRowOrder = memo(function ClientSortedRowOrder({
  tableId,
  runtime,
  columns,
  initialFilters,
  initialOrderBy,
}: {
  readonly tableId: string;
  readonly runtime: BrunoTableClientRuntimeView;
  readonly columns: readonly CompiledColumn[];
  readonly initialFilters: readonly unknown[] | undefined;
  readonly initialOrderBy: readonly {
    readonly columnId: string;
    readonly direction: "asc" | "desc";
  }[];
}) {
  const rowOrderDetector = useMemo<BrunoTableRowOrderChangeDetector>(
    () => (previousRows, nextRows, previousRowIds, nextRowIds) =>
      rowOrderChanged(
        previousRows,
        nextRows,
        previousRowIds,
        nextRowIds,
        columns,
        initialFilters,
        initialOrderBy,
      ),
    [columns, initialFilters, initialOrderBy],
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
  const nextRowIds = useClientRowIds(
    rows,
    columns,
    initialOrderBy,
    runtime.resolveRowId,
    initialFilters,
  );
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
    <ClientVirtualTable tableId={tableId} rowIds={rowIds} runtime={runtime} columns={columns} />
  );
});

// The private viewport adapter coordinates mutable DOM geometry outside React's compiled data path.
const ClientVirtualTable = memo(function ClientVirtualTable({
  tableId,
  rowIds,
  runtime,
  columns,
}: {
  readonly tableId: string;
  readonly rowIds: readonly string[];
  readonly runtime: BrunoTableClientRuntimeView;
  readonly columns: readonly CompiledColumn[];
}) {
  return <ViewportAdapter tableId={tableId} rowIds={rowIds} runtime={runtime} columns={columns} />;
});

// DOM attachment and measurement are isolated here from the compiler-managed render surface.
// oxlint-disable react/react-compiler
const ViewportAdapter = memo(function ViewportAdapter({
  tableId,
  rowIds,
  runtime,
  columns,
}: {
  readonly tableId: string;
  readonly rowIds: readonly string[];
  readonly runtime: BrunoTableClientRuntimeView;
  readonly columns: readonly CompiledColumn[];
}) {
  "use no memo";
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
    viewport.setLayout(rowIds.length, columns);
    navigation.setShape(rowIds, columns);
  }, [columns, navigation, rowIds, viewport]);
  useEffect(() => () => viewport.dispose(), [viewport]);

  return (
    <ClientGridSurface
      tableId={tableId}
      rowIds={rowIds}
      runtime={runtime}
      viewportSnapshot={viewportSnapshot}
      attach={viewport.attach}
      navigation={navigation}
      revealCell={viewport.revealCell}
    />
  );
});
// oxlint-enable react/react-compiler

const ClientGridSurface = memo(function ClientGridSurface({
  tableId,
  rowIds,
  runtime,
  viewportSnapshot,
  attach,
  navigation,
  revealCell,
}: {
  readonly tableId: string;
  readonly rowIds: readonly string[];
  readonly runtime: BrunoTableClientRuntimeView;
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

  return (
    <div
      ref={attach}
      role="grid"
      aria-label={`Data for ${tableId}`}
      tabIndex={0}
      aria-activedescendant={
        activeCell === undefined ? undefined : activeDomId(tableId, activeCell)
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
      {virtualWindow.pinnedStart.length > 0 ? (
        <PinnedRegion
          side="start"
          columns={virtualWindow.pinnedStart}
          rowIds={rowIds}
          rowStart={virtualWindow.rowStart}
          rowEnd={virtualWindow.rowEnd}
          totalHeight={virtualWindow.totalHeight}
          width={totalColumnWidth(virtualWindow.pinnedStart)}
          runtime={runtime}
        />
      ) : null}
      {virtualWindow.pinnedEnd.length > 0 ? (
        <PinnedRegion
          side="end"
          columns={virtualWindow.pinnedEnd}
          rowIds={rowIds}
          rowStart={virtualWindow.rowStart}
          rowEnd={virtualWindow.rowEnd}
          totalHeight={virtualWindow.totalHeight}
          width={totalColumnWidth(virtualWindow.pinnedEnd)}
          runtime={runtime}
        />
      ) : null}
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
            {virtualWindow.pinnedStart.map((column) => (
              <th
                key={column.columnId}
                role="columnheader"
                id={headerDomId(tableId, column.columnId)}
                aria-colindex={virtualWindow.pinnedStart.indexOf(column) + 1}
                scope="col"
                style={{
                  color: "transparent",
                  opacity: 0,
                  pointerEvents: "none",
                  width: column.semantics.width,
                  ...pinnedCellStyle("start", column, virtualWindow.pinnedStart),
                }}
              >
                {column.headerName}
              </th>
            ))}
            {virtualWindow.leftPadding > 0 ? (
              <th aria-hidden="true" style={{ padding: 0, width: virtualWindow.leftPadding }} />
            ) : null}
            {virtualWindow.center.map((column) => (
              <th
                key={column.columnId}
                role="columnheader"
                id={headerDomId(tableId, column.columnId)}
                aria-colindex={
                  virtualWindow.pinnedStart.length +
                  virtualWindow.centerStartIndex +
                  virtualWindow.center.indexOf(column) +
                  1
                }
                scope="col"
                style={{ width: column.semantics.width }}
              >
                {column.headerName}
              </th>
            ))}
            {virtualWindow.rightPadding > 0 ? (
              <th aria-hidden="true" style={{ padding: 0, width: virtualWindow.rightPadding }} />
            ) : null}
            {virtualWindow.pinnedEnd.map((column) => (
              <th
                key={column.columnId}
                role="columnheader"
                id={headerDomId(tableId, column.columnId)}
                aria-colindex={
                  virtualWindow.pinnedStart.length +
                  virtualWindow.centerCount +
                  virtualWindow.pinnedEnd.indexOf(column) +
                  1
                }
                scope="col"
                style={{
                  color: "transparent",
                  opacity: 0,
                  pointerEvents: "none",
                  width: column.semantics.width,
                  ...pinnedCellStyle("end", column, virtualWindow.pinnedEnd),
                }}
              >
                {column.headerName}
              </th>
            ))}
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
        activeCell.region === "header" ? (
          <div
            id={headerDomId(tableId, activeCell.columnId)}
            role="columnheader"
            style={VISUALLY_HIDDEN}
          />
        ) : (
          <div
            id={cellDomId(tableId, activeCell.rowId ?? "", activeCell.columnId)}
            role="gridcell"
            style={VISUALLY_HIDDEN}
          />
        )
      ) : null}
    </div>
  );
});

const PinnedRegion = memo(function PinnedRegion({
  side,
  columns,
  rowIds,
  rowStart,
  rowEnd,
  totalHeight,
  width,
  runtime,
}: {
  readonly side: "start" | "end";
  readonly columns: readonly CompiledColumn[];
  readonly rowIds: readonly string[];
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly totalHeight: number;
  readonly width: number;
  readonly runtime: BrunoTableClientRuntimeView;
}) {
  return (
    <div
      data-pinned-region={side}
      aria-hidden="true"
      style={{
        background: "Canvas",
        height: 0,
        pointerEvents: "none",
        position: "sticky",
        top: 0,
        width,
        zIndex: 3,
        ...(side === "start" ? { left: 0 } : { right: 0 }),
      }}
    >
      <div style={{ position: "absolute", top: 0, width }}>
        <table style={{ tableLayout: "fixed", width }}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.columnId} scope="col" style={{ width: column.semantics.width }}>
                  {column.headerName}
                </th>
              ))}
            </tr>
          </thead>
        </table>
      </div>
      <div
        style={{
          height: totalHeight,
          position: "absolute",
          top: ROW_HEIGHT,
          transform: "translateY(calc(-1 * var(--bruno-table-scroll-top, 0px)))",
          width,
        }}
      >
        <table style={{ tableLayout: "fixed", width }}>
          <tbody style={{ display: "block", height: totalHeight, position: "relative" }}>
            {rowIds.slice(rowStart, rowEnd).map((rowId, offset) => (
              <PinnedRow
                key={rowId}
                rowId={rowId}
                rowIndex={rowStart + offset}
                runtime={runtime}
                columns={columns}
                top={(rowStart + offset) * ROW_HEIGHT}
                width={width}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

const ClientRow = memo(function ClientRow({
  rowId,
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
      {pinnedStart.map((column) => (
        <ClientSemanticCell
          key={column.columnId}
          row={row}
          rowId={rowId}
          rowIndex={top / ROW_HEIGHT}
          tableId={tableId}
          columnIndex={pinnedStart.indexOf(column)}
          column={column}
        />
      ))}
      {leftPadding > 0 ? (
        <td aria-hidden="true" style={{ padding: 0, width: leftPadding }} />
      ) : null}
      {center.map((column) => (
        <ClientCell
          key={column.columnId}
          row={row}
          rowId={rowId}
          rowIndex={top / ROW_HEIGHT}
          tableId={tableId}
          columnIndex={pinnedStartCount + centerStartIndex + center.indexOf(column)}
          column={column}
        />
      ))}
      {rightPadding > 0 ? (
        <td aria-hidden="true" style={{ padding: 0, width: rightPadding }} />
      ) : null}
      {pinnedEnd.map((column) => (
        <ClientSemanticCell
          key={column.columnId}
          row={row}
          rowId={rowId}
          rowIndex={top / ROW_HEIGHT}
          tableId={tableId}
          columnIndex={pinnedStartCount + centerCount + pinnedEnd.indexOf(column)}
          column={column}
        />
      ))}
    </tr>
  );
});

const PinnedRow = memo(function PinnedRow({
  rowId,
  rowIndex: _rowIndex,
  runtime,
  columns,
  top,
  width,
}: {
  readonly rowId: string;
  readonly rowIndex: number;
  readonly runtime: BrunoTableClientRuntimeView;
  readonly columns: readonly CompiledColumn[];
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
      {columns.map((column) => (
        <ClientCell key={column.columnId} row={row} rowId={rowId} column={column} />
      ))}
    </tr>
  );
});

const ClientCell = memo(function ClientCell({
  row,
  rowId,
  rowIndex: _rowIndex,
  tableId,
  columnIndex,
  column,
  style,
}: {
  readonly row: unknown;
  readonly rowId: string;
  readonly rowIndex?: number;
  readonly tableId?: string;
  readonly columnIndex?: number;
  readonly column: CompiledColumn;
  readonly style?: CSSProperties;
}) {
  const value = readCompiledColumnValue(column, row);
  const className = resolveCellClassName(column, row, value);
  const rendered = resolveCellRenderer(column, row, value);
  return (
    <td
      role="gridcell"
      {...(tableId === undefined || columnIndex === undefined
        ? {}
        : { id: cellDomId(tableId, rowId, column.columnId) })}
      aria-colindex={columnIndex === undefined ? undefined : columnIndex + 1}
      className={className}
      style={{
        boxSizing: "border-box",
        height: ROW_HEIGHT,
        maxHeight: ROW_HEIGHT,
        overflow: "hidden",
        padding: 0,
        textAlign: column.semantics.cellAlign,
        width: column.semantics.width,
        ...style,
      }}
    >
      <div
        style={{
          boxSizing: "border-box",
          height: ROW_HEIGHT,
          maxHeight: ROW_HEIGHT,
          overflow: "hidden",
          width: "100%",
        }}
      >
        {rendered ?? resolveCellText(column, row, value)}
      </div>
    </td>
  );
});

const ClientSemanticCell = memo(function ClientSemanticCell({
  row,
  rowId,
  rowIndex: _rowIndex,
  tableId,
  columnIndex,
  column,
}: {
  readonly row: unknown;
  readonly rowId: string;
  readonly rowIndex?: number;
  readonly tableId: string;
  readonly columnIndex: number;
  readonly column: CompiledColumn;
}) {
  const value = readCompiledColumnValue(column, row);
  return (
    <td
      role="gridcell"
      id={cellDomId(tableId, rowId, column.columnId)}
      aria-colindex={columnIndex + 1}
      style={{
        color: "transparent",
        height: ROW_HEIGHT,
        maxHeight: ROW_HEIGHT,
        opacity: 0,
        padding: 0,
        pointerEvents: "none",
      }}
    >
      <div style={{ height: ROW_HEIGHT, maxHeight: ROW_HEIGHT, overflow: "hidden" }}>
        {resolveCellText(column, row, value)}
      </div>
    </td>
  );
});

function pinnedCellStyle(
  side: "start" | "end",
  column: CompiledColumn,
  columns: readonly CompiledColumn[],
): CSSProperties {
  const index = columns.indexOf(column);
  const offset = columns
    .slice(side === "start" ? 0 : index + 1, side === "start" ? index : undefined)
    .reduce((total, item) => total + item.semantics.width, 0);
  return {
    background: "Canvas",
    position: "sticky",
    zIndex: 2,
    ...(side === "start" ? { left: offset } : { right: offset }),
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
  initialOrderBy: readonly { readonly columnId: string; readonly direction: "asc" | "desc" }[],
): boolean {
  if (!sameRowIds(previousRowIds, nextRowIds)) return true;
  const relevantIds = new Set(initialOrderBy.map((sort) => sort.columnId));
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
    <div aria-label="Loading table rows" role="region">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} role="row" style={{ height: ROW_HEIGHT }}>
          <Skeleton aria-label="Loading row" style={{ height: ROW_HEIGHT - 8, margin: 4 }} />
        </div>
      ))}
    </div>
  );
}

const EMPTY_ORDER_BY: readonly never[] = [];
