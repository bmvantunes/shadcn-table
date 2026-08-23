import { describe, expect, it } from "vitest";
import * as BigDecimal from "effect/BigDecimal";

import { BrunoTableBigDecimalValueType } from "../effect";
import { compileColumns } from "./compile-columns";
import {
  BRUNO_TABLE_SERVER_FACET_COUNT_ALIAS,
  compileBrunoTableServerFacetQuery,
  compileBrunoTableServerQueryPlan,
} from "./server-query";

const columns = compileColumns([
  {
    columnId: "COL_ID_SYMBOL",
    field: "symbol",
    headerName: "Symbol",
    valueType: "text",
    enableSetFilter: true,
  },
  {
    columnId: "COL_ID_QUANTITY",
    field: "quantity",
    headerName: "Quantity",
    valueType: "bigint",
  },
  {
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Price",
    valueType: "number",
  },
  {
    columnId: "COL_ID_AMOUNT",
    field: "amount",
    headerName: "Amount",
    valueType: BrunoTableBigDecimalValueType,
  },
  {
    columnId: "COL_ID_NOTIONAL",
    fields: ["quantity", "price"],
    headerName: "Notional",
    valueGetter: () => 0,
    valueType: "number",
  },
]);
const completeRawSelect = [
  "id",
  "symbol",
  "quantity",
  "price",
  "amount",
  "desk",
  "hiddenLabel",
] as const;

describe("compileBrunoTableServerQueryPlan", () => {
  it("rejects empty and non-field sorting at the runtime boundary", () => {
    expect(() =>
      compileBrunoTableServerQueryPlan(
        columns,
        { filters: [], quickFilter: "", quickFilterFields: [], orderBy: [] },
        completeRawSelect,
      ),
    ).toThrow("BrunoTable Server requires a non-empty orderBy query.");
    expect(() =>
      compileBrunoTableServerQueryPlan(
        columns,
        {
          filters: [],
          quickFilter: "",
          quickFilterFields: [],
          orderBy: [{ columnId: "COL_ID_UNKNOWN", direction: "asc" }],
        },
        completeRawSelect,
      ),
    ).toThrow("BrunoTable Server sort has no Query Field: COL_ID_UNKNOWN");
    expect(() =>
      compileBrunoTableServerQueryPlan(
        columns,
        {
          filters: [],
          quickFilter: "",
          quickFilterFields: [],
          orderBy: [{ columnId: "COL_ID_NOTIONAL", direction: "asc" }],
        },
        completeRawSelect,
      ),
    ).toThrow("BrunoTable Server sort has no Query Field: COL_ID_NOTIONAL");
  });

  it("maps Column Identity to fields and retains native exact operands", () => {
    const minimum = 9_007_199_254_740_993n;
    const query = compileBrunoTableServerQueryPlan(
      columns,
      {
        filters: [
          {
            type: "AND",
            conditions: [
              { columnId: "COL_ID_SYMBOL", type: "startsWith", filter: "A" },
              {
                columnId: "COL_ID_QUANTITY",
                type: "inRange",
                filter: minimum,
                filterTo: minimum + 10n,
              },
            ],
          },
        ],
        quickFilter: "desk",
        quickFilterFields: ["symbol", "desk"],
        orderBy: [{ columnId: "COL_ID_QUANTITY", direction: "desc" }],
      },
      completeRawSelect,
    ).query;

    expect(query).toEqual({
      select: ["symbol", "quantity", "price", "amount", "desk"],
      where: [
        {
          type: "AND",
          conditions: [
            { field: "symbol", type: "startsWith", filter: "A" },
            {
              field: "quantity",
              type: "inRange",
              filter: minimum,
              filterTo: minimum + 10n,
            },
          ],
        },
        {
          type: "OR",
          conditions: [
            { field: "desk", type: "contains", filter: "desk" },
            { field: "symbol", type: "contains", filter: "desk" },
          ],
        },
      ],
      orderBy: [{ field: "quantity", direction: "desc" }],
    });
  });

  it("retains Number, BigInt, and BigDecimal operands in their native domains", () => {
    const amount = BigDecimal.fromStringUnsafe("9007199254740993.125");
    const query = compileBrunoTableServerQueryPlan(
      columns,
      {
        filters: [
          { columnId: "COL_ID_PRICE", type: "equals", filter: 1.25 },
          { columnId: "COL_ID_QUANTITY", type: "equals", filter: 9_007_199_254_740_993n },
          { columnId: "COL_ID_AMOUNT", type: "equals", filter: amount },
        ],
        quickFilter: "",
        quickFilterFields: [],
        orderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
      },
      completeRawSelect,
    ).query;

    expect(query.where).toEqual([
      { field: "price", type: "equals", filter: 1.25 },
      { field: "quantity", type: "equals", filter: 9_007_199_254_740_993n },
      { field: "amount", type: "equals", filter: amount },
    ]);
    expect(Reflect.get(query.where[2]!, "filter")).toBe(amount);
  });

  it("forwards Feed Route and combines external, Quick, and Grid constraints in order", () => {
    const minimum = 9_007_199_254_740_993n;
    const routeBy = Object.freeze({ region: "emea", book: 7n });
    const externalFilters = Object.freeze([
      Object.freeze({ field: "desk", type: "equals", filter: "rates" }),
      Object.freeze({ field: "quantity", type: "greaterThanOrEqual", filter: minimum }),
    ]);

    const query = compileBrunoTableServerQueryPlan(
      columns,
      {
        routeBy,
        externalFilters,
        filters: [{ columnId: "COL_ID_SYMBOL", type: "equals", filter: "EUR" }],
        quickFilter: "swap",
        quickFilterFields: ["hiddenLabel", "symbol"],
        visibleColumnIds: ["COL_ID_SYMBOL", "COL_ID_NOTIONAL"],
        orderBy: [{ columnId: "COL_ID_QUANTITY", direction: "desc" }],
      },
      completeRawSelect,
    ).query;

    expect(query).toEqual({
      routeBy,
      select: ["symbol", "quantity", "price", "hiddenLabel"],
      where: [
        ...externalFilters,
        { field: "symbol", type: "equals", filter: "EUR" },
        {
          type: "OR",
          conditions: [
            { field: "hiddenLabel", type: "contains", filter: "swap" },
            { field: "symbol", type: "contains", filter: "swap" },
          ],
        },
      ],
      orderBy: [{ field: "quantity", direction: "desc" }],
    });
    expect(query.routeBy).toBe(routeBy);
    expect(query.where[0]).toBe(externalFilters[0]);
    expect(query.where[1]).toBe(externalFilters[1]);
  });

  it("compiles empty Set inclusion intent through source-native FALSE", () => {
    expect(
      compileBrunoTableServerQueryPlan(
        columns,
        {
          filters: [{ columnId: "COL_ID_SYMBOL", type: "matchNone" }],
          quickFilter: "",
          quickFilterFields: [],
          orderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
        },
        completeRawSelect,
      ).query.where,
    ).toEqual([{ type: "FALSE" }]);
    expect(() =>
      compileBrunoTableServerQueryPlan(
        columns,
        {
          filters: [{ columnId: "COL_ID_QUANTITY", type: "matchNone" }],
          quickFilter: "",
          quickFilterFields: [],
          orderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
        },
        completeRawSelect,
      ),
    ).toThrow("Match None requires a Set Filter");
  });

  it("compiles one narrow whole-result facet excluding only its own Grid Filter", () => {
    const routeBy = Object.freeze({ region: "emea" });
    expect(
      compileBrunoTableServerFacetQuery(columns, "COL_ID_SYMBOL", {
        routeBy,
        externalFilters: [{ field: "desk", type: "equals", filter: "rates" }],
        filters: [
          { columnId: "COL_ID_SYMBOL", type: "matchNone" },
          { columnId: "COL_ID_QUANTITY", type: "greaterThan", filter: 10n },
        ],
        quickFilter: "swap",
        quickFilterFields: ["hiddenLabel", "symbol"],
        orderBy: [{ columnId: "COL_ID_QUANTITY", direction: "desc" }],
      }),
    ).toEqual({
      countAlias: BRUNO_TABLE_SERVER_FACET_COUNT_ALIAS,
      query: {
        routeBy,
        groupBy: ["symbol"],
        aggregates: { [BRUNO_TABLE_SERVER_FACET_COUNT_ALIAS]: { aggFunc: "count" } },
        where: [
          { field: "desk", type: "equals", filter: "rates" },
          { field: "quantity", type: "greaterThan", filter: 10n },
          {
            type: "OR",
            conditions: [
              { field: "hiddenLabel", type: "contains", filter: "swap" },
              { field: "symbol", type: "contains", filter: "swap" },
            ],
          },
        ],
        orderBy: [{ field: "symbol", direction: "asc" }],
      },
    });
  });

  it("derives a private facet count alias that cannot collide with the grouped source Field", () => {
    const collidingColumns = compileColumns([
      {
        columnId: "COL_ID_COLLIDING_FACET",
        enableSetFilter: true,
        field: BRUNO_TABLE_SERVER_FACET_COUNT_ALIAS,
        headerName: "Facet",
        valueType: "text",
      },
    ]);
    const plan = compileBrunoTableServerFacetQuery(collidingColumns, "COL_ID_COLLIDING_FACET", {
      filters: [],
      quickFilter: "",
      quickFilterFields: [],
      orderBy: [{ columnId: "COL_ID_COLLIDING_FACET", direction: "asc" }],
    });

    expect(plan.countAlias).not.toBe(BRUNO_TABLE_SERVER_FACET_COUNT_ALIAS);
    expect(plan.query.groupBy).toEqual([BRUNO_TABLE_SERVER_FACET_COUNT_ALIAS]);
    expect(plan.query.aggregates).toEqual({ [plan.countAlias]: { aggFunc: "count" } });
  });

  it("deduplicates projection fields without inferring from formatted output", () => {
    expect(
      compileBrunoTableServerQueryPlan(
        columns,
        {
          filters: [],
          quickFilter: "",
          quickFilterFields: ["price", "symbol"],
          orderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
        },
        completeRawSelect,
      ).query.select,
    ).toEqual(["symbol", "quantity", "price", "amount"]);
  });

  it("uses the source-owned complete raw projection only for raw-row-aware presentation", () => {
    const input = {
      filters: [],
      quickFilter: "",
      quickFilterFields: [],
      orderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" as const }],
    };
    const withPresentation = (presentation: Readonly<Record<string, unknown>>) =>
      compileColumns([
        {
          columnId: "COL_ID_SYMBOL",
          field: "symbol",
          headerName: "Symbol",
          valueType: "text",
          ...presentation,
        },
      ]);

    expect(
      compileBrunoTableServerQueryPlan(
        withPresentation({ valueFormatter: () => "formatted" }),
        input,
        completeRawSelect,
      ).query.select,
    ).toBe(completeRawSelect);
    expect(
      compileBrunoTableServerQueryPlan(
        withPresentation({ cellClassName: () => "risk" }),
        input,
        completeRawSelect,
      ).query.select,
    ).toBe(completeRawSelect);
    expect(
      compileBrunoTableServerQueryPlan(
        withPresentation({ cellRenderer: () => "rendered" }),
        input,
        completeRawSelect,
      ).query.select,
    ).toBe(completeRawSelect);
    expect(
      compileBrunoTableServerQueryPlan(
        withPresentation({ cellClassName: "static" }),
        input,
        completeRawSelect,
      ).query.select,
    ).toEqual(["symbol"]);
    expect(() =>
      compileBrunoTableServerQueryPlan(
        withPresentation({ cellRenderer: () => "rendered" }),
        input,
        undefined,
      ),
    ).toThrow("requires source-owned completeRawSelect");
  });
});
