import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { ReactElement, RefCallback } from "react";

import type { CompiledColumn } from "./compile-columns";
import type { BrunoTableColumnLayoutSnapshot } from "./column-management";
import type { BrunoTableQueryNavigationMode, BrunoTableRuntimeView } from "./grid-runtime";
import type { BrunoTableActiveCell, BrunoTableNavigationRuntime } from "./navigation";
import {
  BRUNO_TABLE_ROW_HEIGHT,
  BrunoTableViewportRuntime,
  type BrunoTableViewportSnapshot,
} from "./virtual-viewport";

import type { BrunoTableLogicalRowSpace } from "./bruno-table-view";

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

type BrunoTableServerFacetHookSource = Readonly<{
  readonly useWholeResult: (...arguments_: never[]) => unknown;
  readonly viewport: unknown;
}>;

class BrunoTableServerFacetHookBridge {
  public readonly source: BrunoTableServerFacetHookSource;

  public constructor(
    public readonly viewport: unknown,
    private hook: BrunoTableServerFacetHookSource["useWholeResult"],
  ) {
    this.source = Object.freeze({
      useWholeResult: (...arguments_: never[]) => this.hook(...arguments_),
      viewport,
    });
  }

  public updateHook(hook: BrunoTableServerFacetHookSource["useWholeResult"]): void {
    this.hook = hook;
  }
}

class BrunoTableServerFacetHookBridgeStore {
  private committed: BrunoTableServerFacetHookBridge;

  public constructor(source: BrunoTableServerFacetHookSource) {
    this.committed = new BrunoTableServerFacetHookBridge(source.viewport, source.useWholeResult);
  }

  public resolve(source: BrunoTableServerFacetHookSource): BrunoTableServerFacetHookBridge {
    return Object.is(this.committed.viewport, source.viewport)
      ? this.committed
      : new BrunoTableServerFacetHookBridge(source.viewport, source.useWholeResult);
  }

  public commit(
    source: BrunoTableServerFacetHookSource,
    bridge: BrunoTableServerFacetHookBridge,
  ): void {
    bridge.updateHook(source.useWholeResult);
    this.committed = bridge;
  }
}

export function useBrunoTableServerFacetHookSource(
  source: BrunoTableServerFacetHookSource,
): BrunoTableServerFacetHookSource {
  "use no memo";
  const [store] = useState(() => new BrunoTableServerFacetHookBridgeStore(source));
  const bridge = store.resolve(source);
  useLayoutEffect(() => {
    store.commit(source, bridge);
  }, [bridge, source, store]);
  return bridge.source;
}

function useBrunoTableInstanceId(): string {
  const reactInstanceId = useId();
  const [{ subscribeInstanceId, getInstanceId, getServerInstanceId }] = useState(() => {
    const store = new BrunoTableInstanceIdStore(reactInstanceId);
    return {
      subscribeInstanceId: store.subscribe,
      getInstanceId: store.getSnapshot,
      getServerInstanceId: store.getServerSnapshot,
    };
  });
  return useSyncExternalStore(subscribeInstanceId, getInstanceId, getServerInstanceId);
}

export type BrunoTableViewportAdapterState = Readonly<{
  instanceId: string;
  columns: readonly CompiledColumn[];
  columnLayout: BrunoTableColumnLayoutSnapshot;
  viewportSnapshot: BrunoTableViewportSnapshot;
  attach: (element: HTMLElement | null) => void;
  attachBodyLayer: RefCallback<HTMLElement>;
  attachRowLayer: (element: HTMLElement | null) => void;
  attachScrollbarOverlay: (element: HTMLElement | null) => void;
  subscribeViewportEnvironment: (listener: () => void) => () => void;
  scrollByLogical: (delta: number) => boolean;
  previewColumnWidth: (columnId: string, width: number) => void;
  clearColumnWidthPreview: (publishSnapshot?: boolean) => void;
  revealCell: (
    rowIndex: number,
    columnId: string,
    region?: "header" | "body",
    rowId?: string,
  ) => void;
}>;

export function BrunoTableViewportAdapterBoundary({
  rowSpace,
  runtime,
  columns,
  navigation,
  queryGeneration,
  queryNavigationMode,
  onCommittedNavigationChange,
  leadingUtilityWidth = 0,
  children,
}: {
  readonly rowSpace: BrunoTableLogicalRowSpace;
  readonly runtime: BrunoTableRuntimeView;
  readonly columns: readonly CompiledColumn[];
  readonly navigation: BrunoTableNavigationRuntime;
  readonly queryGeneration: number;
  readonly queryNavigationMode: BrunoTableQueryNavigationMode;
  readonly onCommittedNavigationChange?: (
    activeCell: BrunoTableActiveCell | undefined,
    columns: readonly CompiledColumn[],
  ) => void;
  readonly leadingUtilityWidth?: number;
  readonly children: (state: BrunoTableViewportAdapterState) => ReactElement;
}): ReactElement {
  const instanceId = useBrunoTableInstanceId();
  const installedColumns = columns;
  const installedRowSpace = rowSpace;
  const installedQueryGeneration = queryGeneration;
  const installedQueryNavigationMode = queryNavigationMode;
  const columnLayout = useSyncExternalStore(
    runtime.subscribeColumnLayout,
    runtime.getColumnLayoutSnapshot,
    runtime.getColumnLayoutSnapshot,
  );
  const visibleColumnIds = useMemo(
    () => new Set(columnLayout.visibleColumnIds),
    [columnLayout.visibleColumnIds],
  );
  const layoutColumnsById = useMemo(
    () => new Map(columnLayout.allColumns.map((column) => [column.columnId, column])),
    [columnLayout.allColumns],
  );
  const logicalColumns = useMemo(() => {
    const groupedProjection = installedColumns.some(
      (column) => column.columnId === "COL_ID_BRUNO_TABLE_ROWS",
    );
    return groupedProjection
      ? installedColumns
      : Object.freeze(
          installedColumns.flatMap((column) => {
            if (!visibleColumnIds.has(column.columnId)) return [];
            return [layoutColumnsById.get(column.columnId) ?? column];
          }),
        );
  }, [installedColumns, layoutColumnsById, visibleColumnIds]);
  const logicalColumnLayoutSignature = useMemo(
    () =>
      JSON.stringify(
        logicalColumns.map((column) => [
          column.columnId,
          column.pinned ?? null,
          column.semantics.width,
        ]),
      ),
    [logicalColumns],
  );
  const [viewport] = useState(() => {
    const next = new BrunoTableViewportRuntime(BRUNO_TABLE_ROW_HEIGHT, leadingUtilityWidth);
    next.setLayout(installedRowSpace.totalRows, logicalColumns, installedRowSpace.findRowIndex);
    return next;
  });
  const [viewportBindings] = useState(() => ({
    subscribe: viewport.subscribe,
    getSnapshot: viewport.getSnapshot,
    setLayout: viewport.setLayout,
    resetVertical: viewport.resetVertical,
    dispose: viewport.dispose,
    attach: viewport.attach,
    attachBodyLayer: viewport.attachBodyLayer,
    attachRowLayer: viewport.attachRowLayer,
    attachScrollbarOverlay: viewport.attachScrollbarOverlay,
    subscribeEnvironment: viewport.subscribeEnvironment,
    scrollByLogical: viewport.scrollByLogical,
    previewColumnWidth: viewport.previewColumnWidth,
    clearColumnWidthPreview: viewport.clearColumnWidthPreview,
    revealCell: viewport.revealCell,
  }));
  const queryGenerationRef = useRef<number | undefined>(
    installedQueryNavigationMode === "projection-reset" ? undefined : installedQueryGeneration,
  );
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
    viewportBindings.subscribe,
    viewportBindings.getSnapshot,
    viewportBindings.getSnapshot,
  );
  const filterPositionResetEpoch = useSyncExternalStore(
    runtime.subscribeFilterPositionReset,
    runtime.getFilterPositionResetEpochSnapshot,
    runtime.getFilterPositionResetEpochSnapshot,
  );
  const filterPositionResetEpochRef = useRef(filterPositionResetEpoch);
  const resetViewportForCommittedQuery = useCallback((): void => {
    viewportBindings.setLayout(
      installedRowSpace.totalRows,
      logicalColumns,
      installedRowSpace.findRowIndex,
    );
    viewportBindings.resetVertical();
    const resetWindow = viewportBindings.getSnapshot().virtualWindow;
    installedRowSpace.setRequiredRange(resetWindow.rowStart, resetWindow.rowEnd);
    publishedRangeRef.current = Object.freeze({
      rowSpace: installedRowSpace,
      generation: installedQueryGeneration,
      start: resetWindow.rowStart,
      end: resetWindow.rowEnd,
    });
  }, [installedQueryGeneration, installedRowSpace, logicalColumns, viewportBindings]);
  useLayoutEffect(() => {
    if (queryGenerationRef.current === installedQueryGeneration) return;
    queryGenerationRef.current = installedQueryGeneration;
    resetViewportForCommittedQuery();
    if (installedQueryNavigationMode === "projection-reset") {
      navigation.resetForProjection(installedRowSpace, logicalColumns);
    } else if (installedQueryNavigationMode === "reconcile") {
      navigation.reconcileForQuery(installedRowSpace, logicalColumns);
    } else if (installedQueryNavigationMode === "clear") {
      navigation.clearForCommittedSort(installedRowSpace, logicalColumns);
    } else {
      // Issue #12 resets body position without retaining a hidden/non-zero row. A header
      // origin remains a header origin, so its DOM focus and logical header navigation survive.
      navigation.resetForCommittedQuery(installedRowSpace, logicalColumns);
    }
    onCommittedNavigationChange?.(navigation.getSnapshot(), logicalColumns);
  }, [
    logicalColumns,
    navigation,
    onCommittedNavigationChange,
    installedQueryNavigationMode,
    installedQueryGeneration,
    installedRowSpace,
    resetViewportForCommittedQuery,
    viewportBindings,
  ]);
  useLayoutEffect(() => {
    if (filterPositionResetEpochRef.current === filterPositionResetEpoch) return;
    filterPositionResetEpochRef.current = filterPositionResetEpoch;
    resetViewportForCommittedQuery();
    navigation.resetForCommittedQuery(rowSpace, logicalColumns);
    onCommittedNavigationChange?.(navigation.getSnapshot(), logicalColumns);
  }, [
    filterPositionResetEpoch,
    logicalColumns,
    navigation,
    onCommittedNavigationChange,
    resetViewportForCommittedQuery,
    rowSpace,
  ]);
  useLayoutEffect(() => {
    const columnsChanged = appliedColumnLayoutSignatureRef.current !== logicalColumnLayoutSignature;
    viewportBindings.setLayout(
      installedRowSpace.totalRows,
      logicalColumns,
      installedRowSpace.findRowIndex,
    );
    navigation.setShape(installedRowSpace, logicalColumns);
    if (columnsChanged) {
      const activeCell = navigation.getSnapshot();
      if (activeCell !== undefined) {
        viewportBindings.revealCell(
          activeCell.rowIndex,
          activeCell.columnId,
          activeCell.region,
          activeCell.rowId,
        );
      }
    }
    appliedColumnLayoutSignatureRef.current = logicalColumnLayoutSignature;
  }, [
    installedRowSpace,
    logicalColumnLayoutSignature,
    logicalColumns,
    navigation,
    viewportBindings,
  ]);
  useLayoutEffect(() => {
    if (viewportSnapshot !== viewportBindings.getSnapshot()) return;
    const start = viewportSnapshot.virtualWindow.rowStart;
    const end = viewportSnapshot.virtualWindow.rowEnd;
    const previous = publishedRangeRef.current;
    if (
      previous?.rowSpace === installedRowSpace &&
      previous.generation === installedQueryGeneration &&
      previous.start === start &&
      previous.end === end
    ) {
      return;
    }
    installedRowSpace.setRequiredRange(start, end);
    publishedRangeRef.current = Object.freeze({
      rowSpace: installedRowSpace,
      generation: installedQueryGeneration,
      start,
      end,
    });
  }, [installedQueryGeneration, installedRowSpace, viewportBindings, viewportSnapshot]);
  useEffect(() => () => viewportBindings.dispose(), [viewportBindings]);

  return children({
    instanceId,
    columns: logicalColumns,
    columnLayout,
    viewportSnapshot,
    attach: viewportBindings.attach,
    attachBodyLayer: viewportBindings.attachBodyLayer,
    attachRowLayer: viewportBindings.attachRowLayer,
    attachScrollbarOverlay: viewportBindings.attachScrollbarOverlay,
    subscribeViewportEnvironment: viewportBindings.subscribeEnvironment,
    scrollByLogical: viewportBindings.scrollByLogical,
    previewColumnWidth: viewportBindings.previewColumnWidth,
    clearColumnWidthPreview: viewportBindings.clearColumnWidthPreview,
    revealCell: viewportBindings.revealCell,
  });
}

type BrunoTableFocusHandoff = Readonly<{
  claim: () => boolean;
  release: () => void;
}>;

class BrunoTableGridAttachment {
  private element: HTMLDivElement | null = null;

  public constructor(
    private focusFallback: () => void,
    private focusHandoff: BrunoTableFocusHandoff,
    private readonly attachViewport: (element: HTMLDivElement | null) => void,
  ) {}

  public updateFocusBindings(
    focusFallback: () => void,
    focusHandoff: BrunoTableFocusHandoff,
  ): void {
    this.focusFallback = focusFallback;
    this.focusHandoff = focusHandoff;
  }

  public readonly attach = (element: HTMLDivElement | null): void => {
    const previousGrid = this.element;
    const activeElement = previousGrid?.ownerDocument.activeElement;
    if (
      element === null &&
      previousGrid !== null &&
      activeElement !== undefined &&
      activeElement !== null &&
      previousGrid.contains(activeElement)
    ) {
      this.focusHandoff.release();
      this.focusFallback();
    }
    this.element = element;
    this.attachViewport(element);
    if (element !== null && this.focusHandoff.claim()) element.focus({ preventScroll: true });
  };
}

export type BrunoTableLoadingViewportAdapterState = Readonly<{
  columns: readonly CompiledColumn[];
  instanceId: string;
  logicalRowCount: number;
  viewportSnapshot: BrunoTableViewportSnapshot;
  attachGrid: (element: HTMLDivElement | null) => void;
  attachBodyLayer: RefCallback<HTMLElement>;
  attachRowLayer: (element: HTMLElement | null) => void;
  attachScrollbarOverlay: (element: HTMLElement | null) => void;
}>;

export function BrunoTableLoadingViewportAdapterBoundary({
  runtime,
  totalRows,
  compiledColumns,
  focusFallback,
  focusHandoff,
  defaultLoadingRowCount,
  leadingUtilityWidth = 0,
  children,
}: {
  readonly runtime: BrunoTableRuntimeView;
  readonly totalRows: number;
  readonly compiledColumns: readonly CompiledColumn[];
  readonly focusFallback: () => void;
  readonly focusHandoff: BrunoTableFocusHandoff;
  readonly defaultLoadingRowCount: number;
  readonly leadingUtilityWidth?: number;
  readonly children: (state: BrunoTableLoadingViewportAdapterState) => ReactElement;
}): ReactElement {
  const columnLayout = useSyncExternalStore(
    runtime.subscribeColumnLayout,
    runtime.getColumnLayoutSnapshot,
    runtime.getColumnLayoutSnapshot,
  );
  const columns = columnLayout.columns.length > 0 ? columnLayout.columns : compiledColumns;
  const instanceId = useBrunoTableInstanceId();
  const logicalRowCount =
    Number.isSafeInteger(totalRows) && totalRows > 0 ? totalRows : defaultLoadingRowCount;
  const [viewport] = useState(() => {
    const next = new BrunoTableViewportRuntime(0, leadingUtilityWidth);
    next.setLayout(logicalRowCount, columns);
    return next;
  });
  const [viewportBindings] = useState(() => ({
    subscribe: viewport.subscribe,
    getSnapshot: viewport.getSnapshot,
    setLayout: viewport.setLayout,
    dispose: viewport.dispose,
    attach: viewport.attach,
    attachBodyLayer: viewport.attachBodyLayer,
    attachRowLayer: viewport.attachRowLayer,
    attachScrollbarOverlay: viewport.attachScrollbarOverlay,
  }));
  const viewportSnapshot = useSyncExternalStore(
    viewportBindings.subscribe,
    viewportBindings.getSnapshot,
    viewportBindings.getSnapshot,
  );
  useLayoutEffect(() => {
    viewportBindings.setLayout(logicalRowCount, columns);
  }, [columns, logicalRowCount, viewportBindings]);
  useEffect(() => () => viewportBindings.dispose(), [viewportBindings]);
  const [gridAttachment] = useState(
    () => new BrunoTableGridAttachment(focusFallback, focusHandoff, viewportBindings.attach),
  );
  useLayoutEffect(() => {
    gridAttachment.updateFocusBindings(focusFallback, focusHandoff);
  }, [focusFallback, focusHandoff, gridAttachment]);

  return children({
    columns,
    instanceId,
    logicalRowCount,
    viewportSnapshot,
    attachGrid: gridAttachment.attach,
    attachBodyLayer: viewportBindings.attachBodyLayer,
    attachRowLayer: viewportBindings.attachRowLayer,
    attachScrollbarOverlay: viewportBindings.attachScrollbarOverlay,
  });
}
