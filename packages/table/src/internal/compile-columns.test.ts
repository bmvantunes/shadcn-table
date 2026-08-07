import { describe, expect, it } from "vitest";

import { ColumnConfigurationError, compileColumns } from "./compile-columns";

describe("compileColumns", () => {
  it("compiles immutable field and computed representations once", () => {
    const valueGetter = ({ row }: { row: { price: number; quantity: number } }) =>
      row.price * row.quantity;
    const dependencies = ["price", "quantity"];
    const columns = [
      {
        columnId: "COL_ID_PRICE",
        field: "price",
        headerName: "Price",
        valueType: "number",
      },
      {
        columnId: "COL_ID_NOTIONAL",
        fields: dependencies,
        headerName: "Notional",
        valueGetter,
        valueType: "number",
      },
    ];

    const compiled = compileColumns(columns);

    expect(compiled).toEqual([
      expect.objectContaining({ kind: "field", columnId: "COL_ID_PRICE", field: "price" }),
      expect.objectContaining({
        kind: "computed",
        columnId: "COL_ID_NOTIONAL",
        fields: ["price", "quantity"],
        valueGetter,
      }),
    ]);
    expect(Object.isFrozen(compiled)).toBe(true);
    expect(Object.isFrozen(compiled[0])).toBe(true);
    expect(Object.isFrozen(compiled[1])).toBe(true);

    dependencies.push("status");
    expect(compiled[1]?.kind === "computed" ? compiled[1].fields : undefined).toEqual([
      "price",
      "quantity",
    ]);
  });

  it("accepts unique namespaced uppercase identities", () => {
    expect(() => {
      compileColumns([
        {
          columnId: "COL_ID_SYMBOL",
          field: "symbol",
          headerName: "Symbol",
          valueType: "text",
        },
        {
          columnId: "COL_ID_AÉTAT",
          field: "state",
          headerName: "State",
          valueType: "text",
        },
      ]);
    }).not.toThrow();
  });

  it("rejects malformed identities, duplicate identities, and missing headers", () => {
    for (const columnId of [
      "price",
      "COL_ID_price",
      "COL_ID_",
      "COL_ID_ÉTAT",
      "COL_ID_-TOTAL",
      "COL_ID_é",
      "COL_ID_ß",
      "COL_ID_δ",
      42,
      null,
      undefined,
      Symbol("COL_ID_PRICE"),
    ]) {
      expect(() => {
        compileColumns([{ columnId, field: "price", headerName: "Price", valueType: "number" }]);
      }).toThrow(ColumnConfigurationError);
    }

    expect(() => {
      compileColumns([
        {
          columnId: "COL_ID_PRICE",
          field: "price",
          headerName: "Price",
          valueType: "number",
        },
        {
          columnId: "COL_ID_PRICE",
          field: "price",
          headerName: "Unit price",
          valueType: "number",
        },
      ]);
    }).toThrow("BrunoTable columnId must be unique: COL_ID_PRICE");

    for (const headerName of [undefined, 42, "   "]) {
      expect(() => {
        compileColumns([
          { columnId: "COL_ID_PRICE", field: "price", headerName, valueType: "number" },
        ]);
      }).toThrow(ColumnConfigurationError);
    }
  });

  it("rejects malformed widened Field Columns", () => {
    for (const column of [
      null,
      [],
      {
        columnId: "COL_ID_PRICE",
        headerName: "Price",
        valueType: "currency",
        field: "price",
      },
      {
        columnId: "COL_ID_PRICE",
        headerName: "Price",
        valueType: "number",
      },
      {
        columnId: "COL_ID_PRICE",
        headerName: "Price",
        valueType: "number",
        field: " ",
      },
      {
        columnId: "COL_ID_PRICE",
        headerName: "Price",
        valueType: "number",
        field: "price",
        isEditable: "yes",
      },
      {
        columnId: "COL_ID_PRICE",
        headerName: "Price",
        valueType: "number",
        field: "price",
        valueFormatter: 42,
      },
      {
        columnId: "COL_ID_PRICE",
        headerName: "Price",
        valueType: "number",
        field: "price",
        fields: ["price"],
        valueGetter: () => 1,
      },
    ]) {
      expect(() => compileColumns([column])).toThrow(ColumnConfigurationError);
    }
  });

  it("rejects sparse top-level and computed dependency arrays", () => {
    expect(() => compileColumns(Array(1))).toThrow(ColumnConfigurationError);

    expect(() =>
      compileColumns([
        {
          columnId: "COL_ID_NOTIONAL",
          headerName: "Notional",
          valueType: "number",
          fields: Array(1),
          valueGetter: () => 1,
        },
      ]),
    ).toThrow(ColumnConfigurationError);
  });

  it("rejects malformed widened Computed Columns", () => {
    for (const column of [
      {
        columnId: "COL_ID_NOTIONAL",
        headerName: "Notional",
        valueType: "number",
        fields: [],
        valueGetter: () => 1,
      },
      {
        columnId: "COL_ID_NOTIONAL",
        headerName: "Notional",
        valueType: "number",
        fields: ["price", ""],
        valueGetter: () => 1,
      },
      {
        columnId: "COL_ID_NOTIONAL",
        headerName: "Notional",
        valueType: "number",
        fields: ["price"],
        valueGetter: "not a function",
      },
      {
        columnId: "COL_ID_NOTIONAL",
        headerName: "Notional",
        valueType: "number",
        fields: ["price"],
        valueGetter: () => 1,
        isEditable: false,
      },
    ]) {
      expect(() => compileColumns([column])).toThrow(ColumnConfigurationError);
    }
  });
});
