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
      expect.objectContaining({
        kind: "field",
        columnId: "COL_ID_PRICE",
        field: "price",
        enableFilter: true,
        enableSorting: true,
      }),
      expect.objectContaining({
        kind: "computed",
        columnId: "COL_ID_NOTIONAL",
        enableFilter: false,
        enableSorting: false,
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

  it("snapshots accessor-backed definition properties once", () => {
    const reads = new Map<string, number>();
    const valueGetter = () => 42;
    const valueFormatter = () => "42";
    const property = (name: string, firstValue: unknown, laterValue: unknown) => ({
      enumerable: true,
      get() {
        const count = (reads.get(name) ?? 0) + 1;
        reads.set(name, count);
        return count === 1 ? firstValue : laterValue;
      },
    });
    const definition = Object.defineProperties(
      {},
      {
        columnId: property("columnId", "COL_ID_COMPUTED", "COL_ID_changed"),
        headerName: property("headerName", "Computed", ""),
        valueType: property("valueType", "number", "invalid"),
        fields: property("fields", ["price"], []),
        valueGetter: property("valueGetter", valueGetter, "not a function"),
        valueFormatter: property("valueFormatter", valueFormatter, 42),
      },
    );

    const compiled = compileColumns([definition]);

    expect(Object.fromEntries(reads)).toEqual({
      columnId: 1,
      headerName: 1,
      valueType: 1,
      fields: 1,
      valueGetter: 1,
      valueFormatter: 1,
    });
    expect(compiled[0]).toEqual({
      kind: "computed",
      columnId: "COL_ID_COMPUTED",
      headerName: "Computed",
      valueType: "number",
      enableFilter: false,
      enableSorting: false,
      fields: ["price"],
      valueGetter,
      valueFormatter,
      semantics: expect.objectContaining({
        codecId: "@bruno/table/number",
        filterFamily: "numeric",
        editorFamily: "number",
        cellAlign: "end",
        editorLayout: "inline",
        width: 120,
      }),
    });

    let fieldReads = 0;
    let editableReads = 0;
    let enableFilterReads = 0;
    let enableSortingReads = 0;
    const fieldDefinition = Object.defineProperties(
      {
        columnId: "COL_ID_PRICE",
        headerName: "Price",
        valueType: "number",
      },
      {
        field: {
          enumerable: true,
          get() {
            fieldReads += 1;
            return fieldReads === 1 ? "price" : 42;
          },
        },
        isEditable: {
          enumerable: true,
          get() {
            editableReads += 1;
            return editableReads === 1;
          },
        },
        enableFilter: {
          enumerable: true,
          get() {
            enableFilterReads += 1;
            return enableFilterReads === 1 ? false : "invalid";
          },
        },
        enableSorting: {
          enumerable: true,
          get() {
            enableSortingReads += 1;
            return enableSortingReads === 1 ? true : "invalid";
          },
        },
      },
    );

    const [compiledField] = compileColumns([fieldDefinition]);

    expect({ fieldReads, editableReads, enableFilterReads, enableSortingReads }).toEqual({
      fieldReads: 1,
      editableReads: 1,
      enableFilterReads: 1,
      enableSortingReads: 1,
    });
    expect(compiledField).toEqual({
      kind: "field",
      columnId: "COL_ID_PRICE",
      headerName: "Price",
      valueType: "number",
      field: "price",
      groupBy: false,
      enableFilter: false,
      enableSorting: true,
      isEditable: true,
      semantics: expect.objectContaining({
        codecId: "@bruno/table/number",
        cellAlign: "end",
        editorLayout: "inline",
        width: 120,
      }),
    });
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
      "COL_ID_A B",
      "COL_ID_A\tB",
      "COL_ID_A\nB",
      "COL_ID_A\u00a0B",
      "COL_ID_A\u3000B",
      "COL_ID_BRUNO_TABLE_ROWS",
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
          columnId: "COL_ID_BRUNO_TABLE_ROWS",
          field: "price",
          headerName: "Rows",
          valueType: "number",
        },
      ]);
    }).toThrow("BrunoTable columnId is reserved for the Rows System Column");

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

    const hostileColumnId = {
      [Symbol.toPrimitive]() {
        throw new Error("must not coerce an invalid Column Identity");
      },
    };

    expect(() => {
      compileColumns([
        {
          columnId: hostileColumnId,
          field: "price",
          headerName: "Price",
          valueType: "number",
        },
      ]);
    }).toThrow(ColumnConfigurationError);
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
        enableFilter: "yes",
      },
      {
        columnId: "COL_ID_PRICE",
        headerName: "Price",
        valueType: "number",
        field: "price",
        enableSorting: 1,
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
        groupBy: false,
        groupKeyValueFormatter: () => "Price",
      },
      {
        columnId: "COL_ID_PRICE",
        headerName: "Price",
        valueType: "number",
        field: "price",
        aggregateValueFormatter: () => "Price",
      },
      {
        columnId: "COL_ID_PRICE",
        headerName: "Price",
        valueType: "number",
        field: "price",
        aggFunc: "sum",
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
      {
        columnId: "COL_ID_NOTIONAL",
        headerName: "Notional",
        valueType: "number",
        fields: ["price"],
        valueGetter: () => 1,
        enableFilter: false,
      },
      {
        columnId: "COL_ID_NOTIONAL",
        headerName: "Notional",
        valueType: "number",
        fields: ["price"],
        valueGetter: () => 1,
        enableSorting: false,
      },
      {
        columnId: "COL_ID_NOTIONAL",
        headerName: "Notional",
        valueType: "number",
        fields: ["price"],
        valueGetter: () => 1,
        groupBy: true,
      },
    ]) {
      expect(() => compileColumns([column])).toThrow(ColumnConfigurationError);
    }
  });
});
