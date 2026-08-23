import { describe, expect, it } from "vitest";

import { compileColumns } from "./compile-columns";
import type { BrunoTableQuerySnapshot, BrunoTableRowPipelineRuntimeView } from "./grid-runtime";
import { compileClientFilterCollection } from "./grid-query";
import {
  BrunoTableServerFacetRuntime,
  type BrunoTableServerFacetSemanticSnapshot,
} from "./server-facet";

const columns = compileColumns([
  {
    columnId: "COL_ID_SYMBOL",
    field: "symbol",
    headerName: "Symbol",
    valueType: "text",
    enableFilter: true,
    enableSetFilter: true,
  },
  {
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Price",
    valueType: "number",
    enableFilter: true,
  },
]);
const replacementColumns = compileColumns([
  {
    columnId: "COL_ID_DESK",
    field: "desk",
    headerName: "Desk",
    valueType: "text",
    enableFilter: true,
    enableSetFilter: true,
  },
]);

const runtimeView = Object.freeze({}) as BrunoTableRowPipelineRuntimeView;
const emptyQuickFilterFields: readonly string[] = Object.freeze([]);
const defaultTransportIdentity = Object.freeze({});

function snapshot({
  externalFilters,
  compiledColumns = columns,
  filters = [],
  orderDirection = "asc",
  quickFilter = "",
  quickFilterFields = emptyQuickFilterFields,
  routeBy,
  source = Object.freeze({}),
  transportIdentity = defaultTransportIdentity,
}: Readonly<{
  readonly externalFilters?: readonly unknown[];
  readonly compiledColumns?: typeof columns;
  readonly filters?: readonly unknown[];
  readonly orderDirection?: "asc" | "desc";
  readonly quickFilter?: string;
  readonly quickFilterFields?: readonly string[];
  readonly routeBy?: Readonly<Record<string, unknown>>;
  readonly source?: unknown;
  readonly transportIdentity?: unknown;
}> = {}): BrunoTableServerFacetSemanticSnapshot {
  const filterCollection = compileClientFilterCollection(filters, compiledColumns);
  const querySnapshot: BrunoTableQuerySnapshot = Object.freeze({
    columns: compiledColumns,
    filters: filterCollection.filters,
    filterCollection,
    generation: 0,
    navigationMode: "reconcile",
    orderBy: Object.freeze([
      Object.freeze({ columnId: "COL_ID_SYMBOL", direction: orderDirection }),
    ]),
    quickFilter,
  });
  return Object.freeze({
    externalFilters,
    quickFilterFields,
    querySnapshot,
    routeBy,
    runtime: runtimeView,
    semanticIdentity: Object.freeze({}),
    source,
    transportIdentity,
  });
}

describe("BrunoTableServerFacetRuntime", () => {
  it("retains its plan across normal sorting, own-filter intent, and source wrapper identity", () => {
    const runtime = new BrunoTableServerFacetRuntime(snapshot());
    const initialSnapshot = runtime.getSnapshot();
    const initial = runtime.getFacetPlan(initialSnapshot, "COL_ID_SYMBOL");
    const ignored = snapshot({
      filters: [{ columnId: "COL_ID_SYMBOL", type: "startsWith", filter: "A" }],
      orderDirection: "desc",
      source: Object.freeze({}),
    });

    expect(runtime.getFacetPlan(ignored, "COL_ID_SYMBOL")).toBe(initial);
  });

  it("replaces its plan for External, peer, Route, Quick Filter, and transport inputs", () => {
    const runtime = new BrunoTableServerFacetRuntime(snapshot());
    let previous = runtime.getFacetPlan(runtime.getSnapshot(), "COL_ID_SYMBOL");
    const cases = [
      snapshot({ externalFilters: [{ field: "desk", type: "equals", filter: "rates" }] }),
      snapshot({
        filters: [{ columnId: "COL_ID_PRICE", type: "greaterThan", filter: 10 }],
      }),
      snapshot({ routeBy: { desk: "rates" } }),
      snapshot({ quickFilter: "A", quickFilterFields: ["symbol"] }),
      snapshot({ transportIdentity: Object.freeze({}) }),
    ];

    for (const next of cases) {
      const plan = runtime.getFacetPlan(next, "COL_ID_SYMBOL");
      expect(plan).not.toBe(previous);
      previous = plan;
    }
  });

  it("drops cached plans when the compiled Column registry is replaced", () => {
    const original = snapshot();
    const runtime = new BrunoTableServerFacetRuntime(original);
    const initial = runtime.getFacetPlan(runtime.getSnapshot(), "COL_ID_SYMBOL");
    const replaced = snapshot({ compiledColumns: replacementColumns });

    runtime.reconcile(replaced);
    runtime.reconcile(original);

    expect(runtime.getFacetPlan(runtime.getSnapshot(), "COL_ID_SYMBOL")).not.toBe(initial);
  });
});
