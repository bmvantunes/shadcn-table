import { describe, expect, it } from "vitest";

import { compileColumns } from "./compile-columns";
import { compileBrunoTableServerQueryPlan } from "./server-query";

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
    columnId: "COL_ID_NOTIONAL",
    fields: ["quantity", "price"],
    headerName: "Notional",
    valueGetter: () => 0,
    valueType: "number",
  },
]);
const completeRawSelect = ["id", "symbol", "quantity", "price", "desk", "hiddenLabel"] as const;

describe("compileBrunoTableServerQuery", () => {
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
      select: ["symbol", "quantity", "price", "desk"],
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
    ).toEqual(["symbol", "quantity", "price"]);
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
