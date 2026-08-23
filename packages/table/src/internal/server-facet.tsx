import {
  createContext,
  memo,
  useContext,
  useMemo,
  useSyncExternalStore,
  type NamedExoticComponent,
  type ReactElement,
  type ReactNode,
} from "react";

import { createBrunoTableServerFacetSnapshot } from "./client-facet";
import { BrunoTableSetFilterView, type BrunoTableSetFilterFacetProps } from "./client-filter";
import type { CompiledColumn } from "./compile-columns";
import type { BrunoTableRowPipelineRuntimeView } from "./grid-runtime";
import {
  compileBrunoTableServerFacetQuery,
  type BrunoTableCompiledServerFacetQuery,
} from "./server-query";

type BrunoTableServerWholeResult = Readonly<{
  readonly rows: readonly unknown[];
  readonly status: "loading" | "ready" | "stale" | "closed" | "error";
  readonly message?: string | undefined;
}>;

type BrunoTableServerFacetContextValue = Readonly<{
  readonly columns: readonly CompiledColumn[];
  readonly externalFilters: readonly unknown[] | undefined;
  readonly quickFilterFields: readonly string[];
  readonly routeBy: Readonly<Record<string, unknown>> | undefined;
  readonly runtime: BrunoTableRowPipelineRuntimeView;
  readonly source: unknown;
}>;

const BrunoTableServerFacetContext = createContext<BrunoTableServerFacetContextValue | null>(null);

export function BrunoTableServerFacetProvider({
  children,
  columns,
  externalFilters,
  quickFilterFields,
  routeBy,
  runtime,
  source,
}: Readonly<{
  readonly children: ReactNode;
  readonly columns: readonly CompiledColumn[];
  readonly externalFilters: readonly unknown[] | undefined;
  readonly quickFilterFields: readonly string[];
  readonly routeBy: Readonly<Record<string, unknown>> | undefined;
  readonly runtime: BrunoTableRowPipelineRuntimeView;
  readonly source: unknown;
}>): ReactElement {
  const value = useMemo(
    () => ({ columns, externalFilters, quickFilterFields, routeBy, runtime, source }),
    [columns, externalFilters, quickFilterFields, routeBy, runtime, source],
  );
  return (
    <BrunoTableServerFacetContext.Provider value={value}>
      {children}
    </BrunoTableServerFacetContext.Provider>
  );
}

export const BrunoTableServerSetFilterFacet: NamedExoticComponent<BrunoTableSetFilterFacetProps> =
  memo(function BrunoTableServerSetFilterFacet({
    column,
  }: BrunoTableSetFilterFacetProps): ReactElement {
    const context = useContext(BrunoTableServerFacetContext);
    if (context === null) {
      throw new TypeError("BrunoTable Server Set Filter is missing its source Adapter context.");
    }
    const querySnapshot = useSyncExternalStore(
      context.runtime.subscribeQuery,
      context.runtime.getQuerySnapshot,
      context.runtime.getQuerySnapshot,
    );
    const plan = useMemo(
      () =>
        compileBrunoTableServerFacetQuery(context.columns, column.columnId, {
          ...(context.routeBy === undefined ? {} : { routeBy: context.routeBy }),
          ...(context.externalFilters === undefined
            ? {}
            : { externalFilters: context.externalFilters }),
          filters: querySnapshot.filters,
          quickFilter: querySnapshot.quickFilter,
          quickFilterFields: context.quickFilterFields,
          orderBy: querySnapshot.orderBy,
        }),
      [column.columnId, context, querySnapshot],
    );
    const result = useBrunoTableServerWholeResult(context.source, plan.query);
    const expression = querySnapshot.filterCollection.filtersByColumn.get(column.columnId);
    const snapshot = useMemo(
      () =>
        createBrunoTableServerFacetSnapshot({
          column,
          countAlias: plan.countAlias,
          rows: result.rows,
          expression,
        }),
      [column, expression, plan.countAlias, result.rows],
    );
    return (
      <BrunoTableSetFilterView
        column={column}
        lifecycle={{ status: result.status, message: result.message }}
        runtime={context.runtime}
        snapshot={snapshot}
      />
    );
  });

function useBrunoTableServerWholeResult(
  source: unknown,
  query: BrunoTableCompiledServerFacetQuery,
): BrunoTableServerWholeResult {
  "use no memo";
  if (typeof source !== "object" || source === null) {
    throw new TypeError("BrunoTable Server viewportSource must be an object.");
  }
  const hook = Reflect.get(source, "useWholeResult");
  if (typeof hook !== "function") {
    throw new TypeError("BrunoTable Server viewportSource must expose useWholeResult().");
  }
  return requireWholeResult(Reflect.apply(hook, source, [query]));
}

function requireWholeResult(candidate: unknown): BrunoTableServerWholeResult {
  if (typeof candidate !== "object" || candidate === null) {
    throw new TypeError("BrunoTable Server useWholeResult() returned no source result.");
  }
  const rows = Reflect.get(candidate, "rows");
  const status = Reflect.get(candidate, "status");
  const message = Reflect.get(candidate, "message");
  if (!Array.isArray(rows) || !isServerFacetStatus(status)) {
    throw new TypeError("BrunoTable Server useWholeResult() returned an invalid source result.");
  }
  if (message !== undefined && typeof message !== "string") {
    throw new TypeError("BrunoTable Server useWholeResult() returned an invalid message.");
  }
  return Object.freeze({
    rows,
    status,
    ...(message === undefined ? {} : { message }),
  });
}

function isServerFacetStatus(value: unknown): value is BrunoTableServerWholeResult["status"] {
  return (
    value === "loading" ||
    value === "ready" ||
    value === "stale" ||
    value === "closed" ||
    value === "error"
  );
}
