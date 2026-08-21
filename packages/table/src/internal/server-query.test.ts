import { describe, expect, it } from "vitest";

import { compileColumns } from "./compile-columns";
import { compileBrunoTableServerQuery } from "./server-query";

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

describe("compileBrunoTableServerQuery", () => {
  it("maps Column Identity to fields and retains native exact operands", () => {
    const minimum = 9_007_199_254_740_993n;
    const query = compileBrunoTableServerQuery(columns, {
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
    });

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
            { field: "symbol", type: "contains", filter: "desk" },
            { field: "desk", type: "contains", filter: "desk" },
          ],
        },
      ],
      orderBy: [{ field: "quantity", direction: "desc" }],
    });
  });

  it("compiles empty Set inclusion intent through source-native FALSE", () => {
    expect(
      compileBrunoTableServerQuery(columns, {
        filters: [{ columnId: "COL_ID_SYMBOL", type: "matchNone" }],
        quickFilter: "",
        quickFilterFields: [],
        orderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
      }).where,
    ).toEqual([{ type: "FALSE" }]);
    expect(() =>
      compileBrunoTableServerQuery(columns, {
        filters: [{ columnId: "COL_ID_QUANTITY", type: "matchNone" }],
        quickFilter: "",
        quickFilterFields: [],
        orderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
      }),
    ).toThrow("Match None requires a Set Filter");
  });

  it("deduplicates projection fields without inferring from formatted output", () => {
    expect(
      compileBrunoTableServerQuery(columns, {
        filters: [],
        quickFilter: "",
        quickFilterFields: ["price", "symbol"],
        orderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
      }).select,
    ).toEqual(["symbol", "quantity", "price"]);
  });
});
