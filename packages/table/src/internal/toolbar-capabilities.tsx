import { createContext, memo, useContext, useMemo, useSyncExternalStore } from "react";

import type { NamedExoticComponent, ReactElement, ReactNode } from "react";
import type {
  BrunoTableColumns,
  BrunoTableFilterExpression,
  BrunoTableFilterableColumnId,
} from "../public-types";
import type { CompiledColumn } from "./compile-columns";
import type { BrunoTableRuntimeView } from "./grid-runtime";
import { compileClientFilterCollection } from "./grid-query";
import {
  recordBrunoTableToolbarSubscription,
  type BrunoTableToolbarProjection,
} from "./toolbar-instrumentation";

type BrunoTableResultRowCountSource = Readonly<{
  readonly getResultRowCountSnapshot: () => number;
  readonly subscribeResultRowCount: (listener: () => void) => () => void;
}>;

type BrunoTableToolbarCapabilityContextValue = Readonly<{
  readonly runtime: BrunoTableRuntimeView;
  readonly resultRows: BrunoTableResultRowCountSource;
  readonly commands: Readonly<{
    readonly replace: (filter: unknown) => boolean;
    readonly clear: (columnId: string) => boolean;
    readonly reset: (columnId: string) => boolean;
    readonly clearAll: () => boolean;
  }>;
  readonly subscribe: (
    projection: BrunoTableToolbarProjection,
    source: (listener: () => void) => () => void,
    listener: () => void,
  ) => () => void;
}>;

const BrunoTableToolbarCapabilityContext = createContext<
  BrunoTableToolbarCapabilityContextValue | undefined
>(undefined);

export type BrunoTableGridFilterCommandCapability<
  TRow,
  TColumns extends BrunoTableColumns<TRow>,
> = Readonly<{
  readonly replace: (filter: BrunoTableFilterExpression<TRow, TColumns>) => boolean;
  readonly clear: (columnId: BrunoTableFilterableColumnId<TColumns>) => boolean;
  readonly reset: (columnId: BrunoTableFilterableColumnId<TColumns>) => boolean;
  readonly clearAll: () => boolean;
}>;

export type BrunoTableFilterControlProps<TRow, TColumns extends BrunoTableColumns<TRow>> =
  | Readonly<{
      readonly ownership: "grid";
      readonly children: (
        commands: BrunoTableGridFilterCommandCapability<TRow, TColumns>,
      ) => ReactNode;
    }>
  | Readonly<{
      readonly ownership: "external";
      readonly children: ReactNode;
    }>;

export function BrunoTableToolbarProvider({
  columns,
  runtime,
  resultRows,
  tableId,
  children,
}: Readonly<{
  readonly columns: readonly CompiledColumn[];
  readonly runtime: BrunoTableRuntimeView;
  readonly resultRows: BrunoTableResultRowCountSource;
  readonly tableId: string;
  readonly children: ReactNode;
}>): ReactElement {
  const value = useMemo<BrunoTableToolbarCapabilityContextValue>(() => {
    const commands = Object.freeze({
      replace: (filter: unknown) => {
        try {
          const admitted = compileClientFilterCollection([filter], columns);
          if (admitted.columnIds.size !== 1 || admitted.filters.length !== 1) return false;
          const columnId = admitted.columnIds.values().next().value;
          const admittedFilter = admitted.filters[0];
          return (
            columnId !== undefined &&
            admittedFilter !== undefined &&
            runtime.dispatchGridCommand({
              type: "column.filter.replace",
              columnId,
              filter: admittedFilter,
            })
          );
        } catch {
          return false;
        }
      },
      clear: (columnId: string) =>
        runtime.dispatchGridCommand({ type: "column.filter.clear", columnId }),
      reset: (columnId: string) =>
        runtime.dispatchGridCommand({ type: "column.filter.reset", columnId }),
      clearAll: () => runtime.dispatchGridCommand({ type: "column.filters.clear" }),
    });
    const subscribe: BrunoTableToolbarCapabilityContextValue["subscribe"] = (
      projection,
      source,
      listener,
    ) => {
      if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
        recordBrunoTableToolbarSubscription({ tableId, projection, phase: "subscribe" });
      }
      const unsubscribe = source(() => {
        if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
          recordBrunoTableToolbarSubscription({ tableId, projection, phase: "notify" });
        }
        listener();
      });
      return () => {
        unsubscribe();
        if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
          recordBrunoTableToolbarSubscription({ tableId, projection, phase: "unsubscribe" });
        }
      };
    };
    return Object.freeze({ runtime, resultRows, commands, subscribe });
  }, [columns, resultRows, runtime, tableId]);
  return (
    <BrunoTableToolbarCapabilityContext.Provider value={value}>
      {children}
    </BrunoTableToolbarCapabilityContext.Provider>
  );
}

export function BrunoTableFilterControl<TRow, const TColumns extends BrunoTableColumns<TRow>>(
  props: BrunoTableFilterControlProps<TRow, TColumns>,
): ReactNode {
  return props.ownership === "external" ? (
    props.children
  ) : (
    <BrunoTableGridFilterControl>{props.children}</BrunoTableGridFilterControl>
  );
}

function BrunoTableGridFilterControl<TRow, TColumns extends BrunoTableColumns<TRow>>({
  children,
}: Readonly<{
  readonly children: (commands: BrunoTableGridFilterCommandCapability<TRow, TColumns>) => ReactNode;
}>): ReactNode {
  const { commands } = useBrunoTableToolbarCapabilities();
  return children(commands as BrunoTableGridFilterCommandCapability<TRow, TColumns>);
}

type BrunoTableCountProps = Readonly<{
  readonly children?: ((count: number) => ReactNode) | undefined;
}>;

export const BrunoTableResultRowCount: NamedExoticComponent<BrunoTableCountProps> = memo(
  function BrunoTableResultRowCount({ children }: BrunoTableCountProps): ReactElement {
    const { resultRows, subscribe } = useBrunoTableToolbarCapabilities();
    const subscribeResultRows = useMemo(
      () => (listener: () => void) =>
        subscribe("result-row-count", resultRows.subscribeResultRowCount, listener),
      [resultRows, subscribe],
    );
    const count = useSyncExternalStore(
      subscribeResultRows,
      resultRows.getResultRowCountSnapshot,
      resultRows.getResultRowCountSnapshot,
    );
    return renderCount("Result rows", count, children);
  },
);

export const BrunoTableLoadedRowCount: NamedExoticComponent<BrunoTableCountProps> = memo(
  function BrunoTableLoadedRowCount({ children }: BrunoTableCountProps): ReactElement {
    const { runtime, subscribe } = useBrunoTableToolbarCapabilities();
    const subscribeLoadedRows = useMemo(
      () => (listener: () => void) =>
        subscribe("loaded-row-count", runtime.subscribeLoadedRowCount, listener),
      [runtime, subscribe],
    );
    const count = useSyncExternalStore(
      subscribeLoadedRows,
      runtime.getLoadedRowCountSnapshot,
      runtime.getLoadedRowCountSnapshot,
    );
    return renderCount("Loaded rows", count, children);
  },
);

export const BrunoTableActiveFilterCount: NamedExoticComponent<BrunoTableCountProps> = memo(
  function BrunoTableActiveFilterCount({ children }: BrunoTableCountProps): ReactElement {
    const { runtime, subscribe } = useBrunoTableToolbarCapabilities();
    const subscribeActiveFilters = useMemo(
      () => (listener: () => void) =>
        subscribe("active-filter-count", runtime.subscribeActiveFilterCount, listener),
      [runtime, subscribe],
    );
    const count = useSyncExternalStore(
      subscribeActiveFilters,
      runtime.getActiveFilterCountSnapshot,
      runtime.getActiveFilterCountSnapshot,
    );
    return renderCount("Active filters", count, children);
  },
);

export const BrunoTableActiveSortCount: NamedExoticComponent<BrunoTableCountProps> = memo(
  function BrunoTableActiveSortCount({ children }: BrunoTableCountProps): ReactElement {
    const { runtime, subscribe } = useBrunoTableToolbarCapabilities();
    const subscribeActiveSorts = useMemo(
      () => (listener: () => void) =>
        subscribe("active-sort-count", runtime.subscribeActiveSortCount, listener),
      [runtime, subscribe],
    );
    const count = useSyncExternalStore(
      subscribeActiveSorts,
      runtime.getActiveSortCountSnapshot,
      runtime.getActiveSortCountSnapshot,
    );
    return renderCount("Active sorts", count, children);
  },
);

export function BrunoTableToolbarSpacer(): ReactElement {
  return <span aria-hidden="true" className="min-w-2 flex-1" />;
}

function renderCount(
  label: string,
  count: number,
  children: ((count: number) => ReactNode) | undefined,
): ReactElement {
  return (
    <output aria-label={label} className="text-muted-foreground text-sm tabular-nums" role="status">
      {children === undefined ? `${String(count)} ${label.toLowerCase()}` : children(count)}
    </output>
  );
}

function useBrunoTableToolbarCapabilities(): BrunoTableToolbarCapabilityContextValue {
  const context = useContext(BrunoTableToolbarCapabilityContext);
  if (context === undefined) {
    throw new TypeError(
      "BrunoTable toolbar controls must be composed inside a BrunoTable variant.",
    );
  }
  return context;
}
