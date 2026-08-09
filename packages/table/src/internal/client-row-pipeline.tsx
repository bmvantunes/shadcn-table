import { memo, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { NamedExoticComponent, ReactElement } from "react";
import type { CompiledColumn } from "./compile-columns";
import type { BrunoTableRowPipelineRuntimeView } from "./grid-runtime";
import type { BrunoTableRowPipelineProps } from "./bruno-table-view";
import type {
  BrunoTableClientAdmittedRow,
  BrunoTableClientRowOrderChangeDetector,
  BrunoTableClientRowsStore,
} from "./client-source-adapter";
import { useClientRowIds } from "./client-adapter";
import { collectClientFilterColumnIds } from "./client-row-model";

export type BrunoTableClientRowPipelineAdapterView = Readonly<{
  readonly resolveRowId: (row: unknown) => string;
  readonly createRowsStore: (
    runtime: BrunoTableRowPipelineRuntimeView,
    detector: BrunoTableClientRowOrderChangeDetector,
  ) => BrunoTableClientRowsStore;
}>;

type ClientResolvedRowOrderProps = BrunoTableRowPipelineProps<
  BrunoTableRowPipelineRuntimeView,
  BrunoTableClientRowPipelineAdapterView
> & {
  readonly filters: readonly unknown[];
  readonly queryGeneration: number;
  readonly orderBy: readonly {
    readonly columnId: string;
    readonly direction: "asc" | "desc";
  }[];
};

export const BrunoTableClientRowPipeline: NamedExoticComponent<
  BrunoTableRowPipelineProps<
    BrunoTableRowPipelineRuntimeView,
    BrunoTableClientRowPipelineAdapterView
  >
> = memo(function BrunoTableClientRowPipeline(
  props: BrunoTableRowPipelineProps<
    BrunoTableRowPipelineRuntimeView,
    BrunoTableClientRowPipelineAdapterView
  >,
): ReactElement {
  const query = useSyncExternalStore(
    props.runtime.subscribeQuery,
    props.runtime.getQuerySnapshot,
    props.runtime.getQuerySnapshot,
  );
  return (
    <ClientResolvedRowOrder
      {...props}
      filters={query.filters}
      orderBy={query.orderBy}
      queryGeneration={query.generation}
    />
  );
});

const ClientResolvedRowOrder = memo(function ClientResolvedRowOrder({
  runtime,
  columns,
  rowPipelineAdapter,
  children,
  filters,
  orderBy,
  queryGeneration,
}: ClientResolvedRowOrderProps) {
  const rowOrderDetector = useMemo<BrunoTableClientRowOrderChangeDetector>(
    () => (previousRows, nextRows, change) =>
      rowOrderChanged(previousRows, nextRows, change, columns, filters, orderBy),
    [columns, filters, orderBy],
  );
  const rowsStore = useMemo(
    () => rowPipelineAdapter.createRowsStore(runtime, rowOrderDetector),
    [rowOrderDetector, rowPipelineAdapter, runtime],
  );
  const rows = useSyncExternalStore(
    rowsStore.subscribe,
    rowsStore.getSnapshot,
    rowsStore.getSnapshot,
  );
  const nextRowIds = useClientRowIds(rows, columns, orderBy, filters);
  const [orderStore] = useState(() => new ClientRowOrderStore(nextRowIds, queryGeneration));
  useLayoutEffect(() => {
    orderStore.publish(nextRowIds, queryGeneration);
  }, [nextRowIds, orderStore, queryGeneration]);
  const orderSnapshot = useSyncExternalStore(
    orderStore.subscribe,
    orderStore.getSnapshot,
    orderStore.getSnapshot,
  );

  return children(orderSnapshot);
});

function rowOrderChanged(
  previousRows: readonly BrunoTableClientAdmittedRow[],
  nextRows: readonly BrunoTableClientAdmittedRow[],
  change: Readonly<{
    readonly rowIdsChanged: boolean;
    readonly changedIndexes: readonly number[];
  }>,
  columns: readonly CompiledColumn[],
  filters: readonly unknown[] | undefined,
  orderBy: readonly { readonly columnId: string; readonly direction: "asc" | "desc" }[],
): boolean {
  if (change.rowIdsChanged) return true;
  const relevantIds = new Set(orderBy.map((sort) => sort.columnId));
  for (const filter of filters ?? EMPTY_FILTERS) {
    collectClientFilterColumnIds(filter, relevantIds);
  }
  const relevantColumns = columns.filter((column) => relevantIds.has(column.columnId));
  if (relevantColumns.length === 0) return false;
  for (const index of change.changedIndexes) {
    const previousRow = previousRows[index];
    const nextRow = nextRows[index];
    if (previousRow === nextRow) continue;
    for (const column of relevantColumns) {
      if (
        !column.semantics.equivalent(
          previousRow?.values.get(column.columnId),
          nextRow?.values.get(column.columnId),
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

class ClientRowOrderStore {
  private readonly listeners = new Set<() => void>();
  private snapshot: Readonly<{
    readonly rowSpace: Readonly<{
      readonly totalRows: number;
      readonly getRowId: (index: number) => string | undefined;
      readonly findRowIndex: (rowId: string) => number | undefined;
      readonly setRequiredRange: (start: number, end: number) => void;
    }>;
    readonly queryGeneration: number;
  }>;

  public constructor(initialRowIds: readonly string[], queryGeneration: number) {
    const rowIds = Object.freeze(Array.from(initialRowIds));
    this.snapshot = Object.freeze({
      rowSpace: createLogicalRowSpace(rowIds),
      queryGeneration,
    });
  }

  public readonly getSnapshot = (): typeof this.snapshot => this.snapshot;

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public readonly publish = (nextRowIds: readonly string[], queryGeneration: number): void => {
    const previousRowIds = Array.from({ length: this.snapshot.rowSpace.totalRows }, (_, index) =>
      this.snapshot.rowSpace.getRowId(index)!,
    );
    const rowIdsUnchanged = sameRowIds(previousRowIds, nextRowIds);
    if (this.snapshot.queryGeneration === queryGeneration && rowIdsUnchanged) return;
    const rowIds = rowIdsUnchanged ? previousRowIds : Object.freeze(Array.from(nextRowIds));
    this.snapshot = Object.freeze({
      rowSpace: rowIdsUnchanged ? this.snapshot.rowSpace : createLogicalRowSpace(rowIds),
      queryGeneration,
    });
    for (const listener of this.listeners) listener();
  };
}

function createLogicalRowSpace(rowIds: readonly string[]) {
  return Object.freeze({
    totalRows: rowIds.length,
    getRowId: (index: number) => rowIds[index],
    findRowIndex: (rowId: string) => {
      const index = rowIds.indexOf(rowId);
      return index < 0 ? undefined : index;
    },
    setRequiredRange: (_start: number, _end: number) => undefined,
  });
}

function sameRowIds(previous: readonly string[], next: readonly string[]): boolean {
  return previous.length === next.length && previous.every((rowId, index) => rowId === next[index]);
}

const EMPTY_FILTERS: readonly never[] = Object.freeze([]);
