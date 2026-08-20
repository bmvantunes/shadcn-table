import {
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
import type { BrunoTableRuntimeView } from "./grid-runtime";
import type { BrunoTableNavigationRuntime } from "./navigation";
import { BrunoTableViewportRuntime, type BrunoTableViewportSnapshot } from "./virtual-viewport";

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
  children,
}: {
  readonly rowSpace: BrunoTableLogicalRowSpace;
  readonly runtime: BrunoTableRuntimeView;
  readonly columns: readonly CompiledColumn[];
  readonly navigation: BrunoTableNavigationRuntime;
  readonly queryGeneration: number;
  readonly children: (state: BrunoTableViewportAdapterState) => ReactElement;
}): ReactElement {
  const reactInstanceId = useId();
  const [{ subscribeInstanceId, getInstanceId, getServerInstanceId }] = useState(() => {
    const store = new BrunoTableInstanceIdStore(reactInstanceId);
    return {
      subscribeInstanceId: store.subscribe,
      getInstanceId: store.getSnapshot,
      getServerInstanceId: store.getServerSnapshot,
    };
  });
  const instanceId = useSyncExternalStore(subscribeInstanceId, getInstanceId, getServerInstanceId);
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
  const logicalColumns = useMemo(
    () =>
      Object.freeze(
        columns.flatMap((column) => {
          if (!visibleColumnIds.has(column.columnId)) return [];
          return [layoutColumnsById.get(column.columnId) ?? column];
        }),
      ),
    [columns, layoutColumnsById, visibleColumnIds],
  );
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
    const next = new BrunoTableViewportRuntime();
    next.setLayout(rowSpace.totalRows, logicalColumns, rowSpace.findRowIndex);
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
    viewportBindings.subscribe,
    viewportBindings.getSnapshot,
    viewportBindings.getSnapshot,
  );
  useLayoutEffect(() => {
    if (queryGenerationRef.current === queryGeneration) return;
    queryGenerationRef.current = queryGeneration;
    viewportBindings.setLayout(rowSpace.totalRows, logicalColumns, rowSpace.findRowIndex);
    viewportBindings.resetVertical();
    const resetWindow = viewportBindings.getSnapshot().virtualWindow;
    rowSpace.setRequiredRange(resetWindow.rowStart, resetWindow.rowEnd);
    publishedRangeRef.current = Object.freeze({
      rowSpace,
      generation: queryGeneration,
      start: resetWindow.rowStart,
      end: resetWindow.rowEnd,
    });
    if (navigation.getSnapshot()?.region !== "header") navigation.clearForQuery();
    navigation.setShape(rowSpace, logicalColumns);
  }, [logicalColumns, navigation, queryGeneration, rowSpace, viewportBindings]);
  useLayoutEffect(() => {
    const columnsChanged = appliedColumnLayoutSignatureRef.current !== logicalColumnLayoutSignature;
    viewportBindings.setLayout(rowSpace.totalRows, logicalColumns, rowSpace.findRowIndex);
    navigation.setShape(rowSpace, logicalColumns);
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
  }, [logicalColumnLayoutSignature, logicalColumns, navigation, rowSpace, viewportBindings]);
  useLayoutEffect(() => {
    if (viewportSnapshot !== viewportBindings.getSnapshot()) return;
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
  }, [queryGeneration, rowSpace, viewportBindings, viewportSnapshot]);
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
    private readonly focusFallback: () => void,
    private readonly focusHandoff: BrunoTableFocusHandoff,
    private readonly attachViewport: (element: HTMLDivElement | null) => void,
  ) {}

  public readonly attach = (element: HTMLDivElement | null): void => {
    if (
      element === null &&
      document.activeElement !== null &&
      this.element?.contains(document.activeElement)
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
  children,
}: {
  readonly runtime: BrunoTableRuntimeView;
  readonly totalRows: number;
  readonly compiledColumns: readonly CompiledColumn[];
  readonly focusFallback: () => void;
  readonly focusHandoff: BrunoTableFocusHandoff;
  readonly defaultLoadingRowCount: number;
  readonly children: (state: BrunoTableLoadingViewportAdapterState) => ReactElement;
}): ReactElement {
  const columnLayout = useSyncExternalStore(
    runtime.subscribeColumnLayout,
    runtime.getColumnLayoutSnapshot,
    runtime.getColumnLayoutSnapshot,
  );
  const columns = columnLayout.columns.length > 0 ? columnLayout.columns : compiledColumns;
  const reactInstanceId = useId();
  const [{ subscribeInstanceId, getInstanceId, getServerInstanceId }] = useState(() => {
    const store = new BrunoTableInstanceIdStore(reactInstanceId);
    return {
      subscribeInstanceId: store.subscribe,
      getInstanceId: store.getSnapshot,
      getServerInstanceId: store.getServerSnapshot,
    };
  });
  const instanceId = useSyncExternalStore(subscribeInstanceId, getInstanceId, getServerInstanceId);
  const logicalRowCount =
    Number.isSafeInteger(totalRows) && totalRows > 0 ? totalRows : defaultLoadingRowCount;
  const [viewport] = useState(() => {
    const next = new BrunoTableViewportRuntime(0);
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
  useLayoutEffect(
    () => viewportBindings.setLayout(logicalRowCount, columns),
    [columns, logicalRowCount, viewportBindings],
  );
  useEffect(() => () => viewportBindings.dispose(), [viewportBindings]);
  const [attachGrid] = useState(
    () => new BrunoTableGridAttachment(focusFallback, focusHandoff, viewportBindings.attach).attach,
  );

  return children({
    columns,
    instanceId,
    logicalRowCount,
    viewportSnapshot,
    attachGrid,
    attachBodyLayer: viewportBindings.attachBodyLayer,
    attachRowLayer: viewportBindings.attachRowLayer,
    attachScrollbarOverlay: viewportBindings.attachScrollbarOverlay,
  });
}
