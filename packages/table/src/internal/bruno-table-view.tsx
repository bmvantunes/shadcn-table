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
  RefCallback,
} from "react";

import type { CompiledColumn } from "./compile-columns";
import { BrunoTableNavigationRuntime, type BrunoTableActiveCell } from "./navigation";
import type {
  BrunoTableCellSnapshot,
  BrunoTableChromeSnapshot,
  BrunoTableColumnCommandSnapshot,
  BrunoTableRuntimeView,
} from "./grid-runtime";
import { isBrunoTableInvalidCellValue } from "./grid-runtime";
import {
  recordBrunoTableClientCellRender,
  recordBrunoTableClientGridSurfaceRender,
  recordBrunoTableClientHeaderRender,
  recordBrunoTableClientViewRender,
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
    | "centerStartIndex"
    | "centerCount"
    | "leftPadding"
    | "rightPadding"
    | "totalWidth"
  >
>;
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

function yieldGridTabStopForNativeTraversal(grid: HTMLElement): void {
  grid.tabIndex = -1;
  setTimeout(() => {
    if (grid.isConnected) grid.tabIndex = 0;
  }, 0);
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
};

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
        totalRows={body.totalRows}
        columns={compiledColumns}
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
  }: BrunoTableViewportAdapterProps): ReactElement {
    "use no memo";
    const reactInstanceId = useId();
    const [instanceIdStore] = useState(() => new BrunoTableInstanceIdStore(reactInstanceId));
    const instanceId = useSyncExternalStore(
      instanceIdStore.subscribe,
      instanceIdStore.getSnapshot,
      instanceIdStore.getServerSnapshot,
    );
    const [viewport] = useState(() => {
      const next = new BrunoTableViewportRuntime();
      next.setLayout(rowSpace.totalRows, columns, rowSpace.findRowIndex);
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
      viewport.setLayout(rowSpace.totalRows, columns, rowSpace.findRowIndex);
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
      viewport.setLayout(rowSpace.totalRows, columns, rowSpace.findRowIndex);
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
        attachBodyLayer={viewport.attachBodyLayer}
        attachRowLayer={viewport.attachRowLayer}
        attachScrollbarOverlay={viewport.attachScrollbarOverlay}
        focusFallback={focusFallback}
        focusHandoff={focusHandoff}
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
  attachBodyLayer,
  attachRowLayer,
  attachScrollbarOverlay,
  focusFallback,
  focusHandoff,
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
  readonly attachBodyLayer: RefCallback<HTMLElement>;
  readonly attachRowLayer: (element: HTMLElement | null) => void;
  readonly attachScrollbarOverlay: (element: HTMLElement | null) => void;
  readonly focusFallback: () => void;
  readonly focusHandoff: BrunoTableBodyFocusHandoff;
  readonly navigation: BrunoTableNavigationRuntime;
  readonly revealCell: (
    rowIndex: number,
    columnId: string,
    region?: "header" | "body",
    rowId?: string,
  ) => void;
}) {
  useLayoutEffect(recordBrunoTableClientGridSurfaceRender);
  const virtualWindow = viewportSnapshot.virtualWindow;
  const columnWindow = useMemo<BrunoTableColumnWindow>(
    () =>
      Object.freeze({
        pinnedStart: virtualWindow.pinnedStart,
        center: virtualWindow.center,
        pinnedEnd: virtualWindow.pinnedEnd,
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
      <div
        ref={attachGrid}
        data-bruno-scroll-owner=""
        role="grid"
        aria-label={`Data for ${tableId}`}
        tabIndex={0}
        aria-rowcount={rowSpace.totalRows + 1}
        aria-colcount={
          columnWindow.pinnedStart.length + columnWindow.centerCount + columnWindow.pinnedEnd.length
        }
        onFocus={(event) => {
          if (event.target === event.currentTarget) navigation.activateForFocus();
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) {
            if (event.key === "Escape" && event.currentTarget.contains(event.target as Node)) {
              event.preventDefault();
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
          const boundaryModifier = event.ctrlKey || event.metaKey;
          const rowEdge = event.key === "Home" ? "start" : event.key === "End" ? "end" : undefined;
          const columnEdge =
            boundaryModifier && event.key === "ArrowUp"
              ? "start"
              : boundaryModifier && event.key === "ArrowDown"
                ? "end"
                : undefined;
          const modifiedRowEdge =
            boundaryModifier && event.key === "ArrowLeft"
              ? "start"
              : boundaryModifier && event.key === "ArrowRight"
                ? "end"
                : undefined;
          const delta = boundaryModifier ? undefined : navigationDelta(event.key);
          const pageDelta =
            event.key === "PageUp"
              ? -viewportPageSize(event.currentTarget)
              : event.key === "PageDown"
                ? viewportPageSize(event.currentTarget)
                : undefined;
          if (
            delta === undefined &&
            pageDelta === undefined &&
            rowEdge === undefined &&
            columnEdge === undefined &&
            modifiedRowEdge === undefined
          )
            return;
          event.preventDefault();
          if (rowEdge !== undefined && boundaryModifier) navigation.moveToGridEdge(rowEdge);
          else if (rowEdge !== undefined) navigation.moveToRowEdge(rowEdge);
          else if (columnEdge !== undefined) navigation.moveToColumnEdge(columnEdge);
          else if (modifiedRowEdge !== undefined) navigation.moveToRowEdge(modifiedRowEdge);
          else if (pageDelta !== undefined) navigation.movePage(pageDelta);
          else if (delta !== undefined) navigation.move(delta.row, delta.column);
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
        <div
          ref={attachRowLayer}
          data-bruno-row-layer=""
          style={{ position: "relative", width: renderedTableWidth }}
        >
          <table role="presentation" style={{ tableLayout: "fixed", width: renderedTableWidth }}>
            <BrunoTableHeaderRow
              activateHeaderCommand={activateHeaderCommand}
              columnWindow={columnWindow}
              instanceId={instanceId}
              renderedTableWidth={renderedTableWidth}
              runtime={runtime}
              tableId={tableId}
              viewportFill={viewportFill}
            />
            <tbody
              role="rowgroup"
              style={{
                display: "block",
                height: virtualWindow.totalHeight,
                position: "relative",
                width: renderedTableWidth,
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
          instanceId={instanceId}
          logicalColumns={logicalColumns}
          navigation={navigation}
          runtime={runtime}
          tableId={tableId}
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
    (activeCell.rowIndex >= virtualWindow.rowStart && activeCell.rowIndex < virtualWindow.rowEnd);
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

const BrunoTableHeaderRow = memo(function BrunoTableHeaderRow({
  activateHeaderCommand,
  columnWindow,
  instanceId,
  renderedTableWidth,
  runtime,
  tableId,
  viewportFill,
}: {
  readonly activateHeaderCommand: (columnId: string) => void;
  readonly columnWindow: BrunoTableColumnWindow;
  readonly instanceId: string;
  readonly renderedTableWidth: number;
  readonly runtime: BrunoTableRuntimeView;
  readonly tableId: string;
  readonly viewportFill: number;
}) {
  useLayoutEffect(recordBrunoTableClientHeaderRender);
  return (
    <thead
      role="rowgroup"
      style={{
        background: "Canvas",
        position: "sticky",
        top: 0,
        width: renderedTableWidth,
        zIndex: 4,
      }}
    >
      <tr aria-rowindex={1} role="row" style={{ height: ROW_HEIGHT, maxHeight: ROW_HEIGHT }}>
        {columnWindow.pinnedStart.map((column, index) => (
          <BrunoTableHeaderCell
            key={column.columnId}
            pinned="start"
            instanceId={instanceId}
            tableId={tableId}
            columnIndex={index}
            column={column}
            runtime={runtime}
            activateHeaderCommand={activateHeaderCommand}
            style={pinnedCellStyle("start", columnWindow.pinnedStart, index)}
          />
        ))}
        {columnWindow.leftPadding > 0 ? (
          <th aria-hidden="true" style={{ padding: 0, width: columnWindow.leftPadding }} />
        ) : null}
        {columnWindow.center.map((column, index) => (
          <BrunoTableHeaderCell
            key={column.columnId}
            instanceId={instanceId}
            tableId={tableId}
            columnIndex={columnWindow.pinnedStart.length + columnWindow.centerStartIndex + index}
            column={column}
            runtime={runtime}
            activateHeaderCommand={activateHeaderCommand}
            style={{ width: column.semantics.width }}
          />
        ))}
        {columnWindow.rightPadding > 0 ? (
          <th aria-hidden="true" style={{ padding: 0, width: columnWindow.rightPadding }} />
        ) : null}
        {viewportFill > 0 ? (
          <th aria-hidden="true" style={{ padding: 0, width: viewportFill }} />
        ) : null}
        {columnWindow.pinnedEnd.map((column, index) => (
          <BrunoTableHeaderCell
            key={column.columnId}
            pinned="end"
            instanceId={instanceId}
            tableId={tableId}
            columnIndex={columnWindow.pinnedStart.length + columnWindow.centerCount + index}
            column={column}
            runtime={runtime}
            activateHeaderCommand={activateHeaderCommand}
            style={pinnedCellStyle("end", columnWindow.pinnedEnd, index)}
          />
        ))}
      </tr>
    </thead>
  );
});

const BrunoTableHeaderCell = memo(function BrunoTableHeaderCell({
  activateHeaderCommand,
  instanceId,
  tableId,
  columnIndex,
  column,
  pinned,
  runtime,
  style,
}: {
  readonly activateHeaderCommand: (columnId: string) => void;
  readonly instanceId: string;
  readonly tableId: string;
  readonly columnIndex: number;
  readonly column: CompiledColumn;
  readonly pinned?: "start" | "end";
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
    "data-pinned-region": pinned,
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
  return (
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

const BrunoTableRow = memo(function BrunoTableRow({
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
}: {
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
}) {
  const ownedCells = [...pinnedStart, ...center, ...pinnedEnd]
    .map((column) => cellDomId(instanceId, tableId, rowId, column.columnId))
    .join(" ");
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
        width,
      }}
    >
      {pinnedStart.length > 0 ? (
        <td aria-hidden="true" style={{ padding: 0, width: totalColumnWidth(pinnedStart) }} />
      ) : null}
      {leftPadding > 0 ? (
        <td aria-hidden="true" style={{ padding: 0, width: leftPadding }} />
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
      {rightPadding > 0 ? (
        <td aria-hidden="true" style={{ padding: 0, width: rightPadding }} />
      ) : null}
      {viewportFill > 0 ? (
        <td aria-hidden="true" style={{ padding: 0, width: viewportFill }} />
      ) : null}
      {pinnedEnd.length > 0 ? (
        <td aria-hidden="true" style={{ padding: 0, width: totalColumnWidth(pinnedEnd) }} />
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
              width,
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
  readonly width: number;
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
        width: layerWidth,
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
          width,
        }}
      >
        <table role="presentation" style={{ tableLayout: "fixed", width }}>
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

const BrunoTableCell = memo(function BrunoTableCell({
  runtime,
  rowId,
  instanceId,
  tableId,
  columnIndex,
  column,
}: {
  readonly runtime: BrunoTableRuntimeView;
  readonly rowId: string;
  readonly instanceId?: string;
  readonly tableId?: string;
  readonly columnIndex?: number;
  readonly column: CompiledColumn;
}) {
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
  recordBrunoTableClientCellRender(rowId, column.columnId);
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
    width: column.semantics.width,
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
    minWidth: column?.semantics.width,
    padding: 0,
    position: "sticky",
    width: column?.semantics.width,
    zIndex: 3,
    ...(side === "start" ? { insetInlineStart: offset } : { insetInlineEnd: offset }),
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
  totalRows,
  columns,
  focusFallback,
  focusHandoff,
  tableId,
}: {
  readonly totalRows: number;
  readonly columns: readonly CompiledColumn[];
  readonly focusFallback: () => void;
  readonly focusHandoff: BrunoTableBodyFocusHandoff;
  readonly tableId: string;
}) {
  "use no memo";
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
          style={{ position: "relative", width: renderedTableWidth }}
        >
          <table role="presentation" style={{ tableLayout: "fixed", width: renderedTableWidth }}>
            <tbody
              role="rowgroup"
              style={{
                display: "block",
                height: virtualWindow.totalHeight,
                position: "relative",
                width: renderedTableWidth,
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
            width,
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
  const ownedCells = [...pinnedStart, ...center, ...pinnedEnd]
    .map((column) => loadingCellDomId(instanceId, tableId, logicalRowIndex, column.columnId))
    .join(" ");
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
        width,
      }}
    >
      {pinnedStart.length > 0 ? (
        <td aria-hidden="true" style={{ padding: 0, width: totalColumnWidth(pinnedStart) }} />
      ) : null}
      {leftPadding > 0 ? (
        <td aria-hidden="true" style={{ padding: 0, width: leftPadding }} />
      ) : null}
      {center.map((column, index) => (
        <LoadingCell
          key={column.columnId}
          column={column}
          columnIndex={pinnedStart.length + centerStartIndex + index}
          id={loadingCellDomId(instanceId, tableId, logicalRowIndex, column.columnId)}
        />
      ))}
      {rightPadding > 0 ? (
        <td aria-hidden="true" style={{ padding: 0, width: rightPadding }} />
      ) : null}
      {viewportFill > 0 ? (
        <td aria-hidden="true" style={{ padding: 0, width: viewportFill }} />
      ) : null}
      {pinnedEnd.length > 0 ? (
        <td aria-hidden="true" style={{ padding: 0, width: totalColumnWidth(pinnedEnd) }} />
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
    "aria-colindex": columnIndex + 1,
    "aria-label": `Loading ${column.headerName}`,
    role: "gridcell",
    style: {
      boxSizing: "border-box",
      height: ROW_HEIGHT,
      maxHeight: ROW_HEIGHT,
      overflow: "hidden",
      padding: 4,
      width: column.semantics.width,
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
