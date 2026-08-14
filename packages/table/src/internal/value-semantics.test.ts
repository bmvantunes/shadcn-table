import { describe, expect, it } from "vitest";

import {
  BrunoTableBigIntColumn,
  BrunoTableBooleanColumn,
  BrunoTableNumberColumn,
  BrunoTableSelectColumn,
  BrunoTableTextColumn,
} from "../column-helpers";
import type { BrunoTableColumns, BrunoTableJsonValue, BrunoTableValueType } from "../public-types";
import { ColumnConfigurationError, compileColumns } from "./compile-columns";
import { brunoTableComputedColumnMarker } from "./computed-column-marker";

type SemanticRow = {
  readonly symbol: string;
  readonly price: number;
  readonly quantity: bigint;
  readonly active: boolean;
  readonly status: "open" | "closed";
  readonly code: string;
};

describe("compiled Column Value Semantics", () => {
  it("retains the private marker on helper-created computed columns", () => {
    const column = BrunoTableNumberColumn({
      columnId: "COL_ID_COMPUTED_MARKER",
      fields: ["price"],
      headerName: "Computed Price",
      valueGetter: ({ row }: { readonly row: Pick<SemanticRow, "price"> }) => row.price * 2,
    });

    expect(Object.getOwnPropertySymbols(column)).toContain(brunoTableComputedColumnMarker);
  });

  it("compiles one immutable direct plan per normalized column", () => {
    const columns = [
      BrunoTableTextColumn({
        columnId: "COL_ID_SYMBOL",
        field: "symbol",
        headerName: "Symbol",
        pinned: "start",
      }),
      BrunoTableNumberColumn({
        columnId: "COL_ID_PRICE",
        field: "price",
        headerName: "Price",
      }),
      BrunoTableBigIntColumn({
        columnId: "COL_ID_QUANTITY",
        field: "quantity",
        headerName: "Quantity",
      }),
      BrunoTableBooleanColumn({
        columnId: "COL_ID_ACTIVE",
        field: "active",
        headerName: "Active",
      }),
    ] satisfies BrunoTableColumns<SemanticRow>;

    const compiled = compileColumns(columns);
    const semantics = compiled.map((column) => column.semantics);

    expect(semantics.map((plan) => Object.isFrozen(plan))).toEqual([true, true, true, true]);
    expect(new Set(semantics).size).toBe(4);
    expect(compiled[0]?.pinned).toBe("start");
    expect(
      semantics.map((plan) => ({
        codecId: plan.codecId,
        filterFamily: plan.filterFamily,
        editorFamily: plan.editorFamily,
        cellAlign: plan.cellAlign,
        editorLayout: plan.editorLayout,
        width: plan.width,
      })),
    ).toEqual([
      {
        codecId: "@bruno/table/text",
        filterFamily: "text",
        editorFamily: "text",
        cellAlign: "start",
        editorLayout: "inline",
        width: 160,
      },
      {
        codecId: "@bruno/table/number",
        filterFamily: "numeric",
        editorFamily: "number",
        cellAlign: "end",
        editorLayout: "inline",
        width: 120,
      },
      {
        codecId: "@bruno/table/bigint",
        filterFamily: "numeric",
        editorFamily: "bigint",
        cellAlign: "end",
        editorLayout: "inline",
        width: 140,
      },
      {
        codecId: "@bruno/table/boolean",
        filterFamily: "boolean",
        editorFamily: "boolean",
        cellAlign: "center",
        editorLayout: "center",
        width: 88,
      },
    ]);
  });

  it("keeps number and bigint exact, separate, and round-trippable", () => {
    const definitions = [
      BrunoTableNumberColumn({
        columnId: "COL_ID_PRICE",
        field: "price",
        headerName: "Price",
      }),
      BrunoTableBigIntColumn({
        columnId: "COL_ID_QUANTITY",
        field: "quantity",
        headerName: "Quantity",
      }),
    ] satisfies BrunoTableColumns<SemanticRow>;
    const [numberColumn, bigIntColumn] = compileColumns(definitions);
    const number = numberColumn!.semantics;
    const bigint = bigIntColumn!.semantics;
    const exact = 9_007_199_254_740_993_123_456_789n;

    expect(number.decodeRuntime(1n)).toEqual({
      _tag: "Failure",
      message: "Expected a finite number value.",
    });
    expect(bigint.decodeRuntime(1)).toEqual({
      _tag: "Failure",
      message: "Expected a bigint value.",
    });
    expect(number.formatCanonicalText(1.25)).toBe("1.25");
    expect(number.parseCanonicalText("1.25e2")).toEqual({ _tag: "Success", value: 125 });
    expect(number.parseCanonicalText("Infinity")._tag).toBe("Failure");
    // @ts-expect-error Runtime validation intentionally supplies a non-text parser input.
    expect(number.parseCanonicalText(125)).toEqual({
      _tag: "Failure",
      message: "Expected canonical text input.",
    });
    expect(bigint.formatCanonicalText(exact)).toBe("9007199254740993123456789");
    expect(bigint.parseCanonicalText("9007199254740993123456789")).toEqual({
      _tag: "Success",
      value: exact,
    });
    for (const invalid of ["+1", "1.0", "1e3", " 1", "1_000"]) {
      expect(bigint.parseCanonicalText(invalid)._tag).toBe("Failure");
    }
    expect(bigint.compare(exact, exact - 1n)).toBe(1);

    const persisted = bigint.encodePersisted(exact);
    expect(JSON.stringify(persisted)).toContain("9007199254740993123456789");
    expect(bigint.decodePersisted(persisted)).toEqual({ _tag: "Success", value: exact });
    expect(number.decodePersisted(persisted)._tag).toBe("Failure");
  });

  it("keeps display formatting separate from canonical exchange semantics", () => {
    const formatter = ({ value }: { readonly value: number }) =>
      value < 0 ? `(${Math.abs(value).toFixed(1)})` : value.toFixed(1);
    const priceColumn = BrunoTableNumberColumn.withDefaults({
      headerName: "Price",
      width: 112,
      format: {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        useGrouping: false,
      },
    });
    const definitions = [
      priceColumn({
        columnId: "COL_ID_PRICE",
        field: "price",
        width: 144,
        format: { maximumFractionDigits: 4 },
        valueFormatter: formatter,
        cellClassName: ({ value }) => (value < 0 ? "text-destructive" : undefined),
        cellRenderer: ({ value }) => `P&L ${value}`,
      }),
    ] satisfies BrunoTableColumns<SemanticRow>;
    const definition = definitions[0]!;
    const [compiled] = compileColumns([definition]);
    const semantics = compiled!.semantics;

    expect(definition).toMatchObject({
      headerName: "Price",
      width: 144,
      cellAlign: "end",
      editorLayout: "inline",
      format: {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
        useGrouping: false,
      },
    });
    expect(compiled!.valueFormatter).toBe(formatter);
    expect(semantics.formatCanonicalText(-5.5)).toBe("-5.5");
    expect(semantics.parseCanonicalText("-5.5")).toEqual({ _tag: "Success", value: -5.5 });
    expect(semantics.formatDisplay(-5.5)).toBe(
      new Intl.NumberFormat("en-US", definition.format).format(-5.5),
    );
  });

  it("compiles Select options into exact equality, option order, and full-width editing", () => {
    const mutableOptions: ["open", "closed"] = ["open", "closed"];
    const definitions = [
      BrunoTableSelectColumn({
        columnId: "COL_ID_STATUS",
        field: "status",
        headerName: "Status",
        options: mutableOptions,
      }),
    ] satisfies BrunoTableColumns<SemanticRow>;
    const definition = definitions[0]!;
    mutableOptions.reverse();

    const [compiled] = compileColumns([definition]);
    const semantics = compiled!.semantics;

    expect(definition.options).toEqual(["open", "closed"]);
    expect(Object.isFrozen(definition.options)).toBe(true);
    expect(semantics).toMatchObject({
      filterFamily: "select",
      editorFamily: "select",
      cellAlign: "start",
      editorLayout: "fullWidth",
      width: 160,
    });
    expect(semantics.compare("open", "closed")).toBe(-1);
    expect(semantics.parseCanonicalText("closed")).toEqual({
      _tag: "Success",
      value: "closed",
    });
    expect(semantics.parseCanonicalText("cancelled")._tag).toBe("Failure");
    const persisted = semantics.encodePersisted("open");
    expect(semantics.decodePersisted(persisted)).toEqual({ _tag: "Success", value: "open" });
    expect(() => semantics.encodePersisted("cancelled")).toThrow(
      "not one of the configured Select options",
    );
  });

  it("keeps field-only preset defaults out of computed columns", () => {
    const preset = BrunoTableNumberColumn.withDefaults({
      headerName: "Price",
      enableFilter: true,
      enableSorting: true,
      isEditable: true,
    });
    const fieldColumn = preset<
      SemanticRow,
      "price",
      "COL_ID_PRICE",
      { readonly columnId: "COL_ID_PRICE"; readonly field: "price" }
    >({ columnId: "COL_ID_PRICE", field: "price" });
    const computedColumn = preset<
      SemanticRow,
      ["price", "quantity"],
      { readonly columnId: "COL_ID_NOTIONAL" }
    >({
      columnId: "COL_ID_NOTIONAL",
      fields: ["price", "quantity"],
      valueGetter: ({ row }) => row.price * Number(row.quantity),
    });

    expect(fieldColumn).toMatchObject({
      enableFilter: true,
      enableSorting: true,
      isEditable: true,
    });
    expect(computedColumn).not.toHaveProperty("enableFilter");
    expect(computedColumn).not.toHaveProperty("enableSorting");
    expect(computedColumn).not.toHaveProperty("isEditable");
    expect(() => compileColumns([computedColumn])).not.toThrow();
  });

  it("snapshots custom Value Type methods and validates their boundary results", () => {
    const custom: BrunoTableValueType<string, "equality", "text"> = {
      codecId: "example/upper-text",
      codecVersion: 1,
      filterFamily: "equality",
      editorFamily: "text",
      cellAlign: "start",
      editorLayout: "inline",
      defaultWidth: 100,
      decodeRuntime: (input) =>
        typeof input === "string"
          ? { _tag: "Success", value: input }
          : { _tag: "Failure", message: "Expected text." },
      equivalent: (left, right) => left === right,
      compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
      formatCanonicalText: (value) => value.toUpperCase(),
      parseCanonicalText: (text) => ({ _tag: "Success", value: text.toLowerCase() }),
      formatDisplay: (value) => value,
      encodePersisted: (value) => ({ value }),
      decodePersisted: (input) =>
        typeof input === "object" && input !== null && "value" in input
          ? { _tag: "Success", value: String(input.value) }
          : { _tag: "Failure", message: "Invalid persisted text." },
    };
    const mutableAggregateResults = { min: "self" as const };
    const mutableCustom = { ...custom, aggregateResults: mutableAggregateResults };
    const aggregateValueFormatter = () => "minimum";
    const [compiled] = compileColumns([
      {
        columnId: "COL_ID_CODE",
        field: "code",
        headerName: "Code",
        valueType: mutableCustom,
        groupBy: true,
        aggFunc: "min",
        aggregateValueFormatter,
      },
    ]);
    const semantics = compiled!.semantics;
    mutableCustom.formatCanonicalText = () => "mutated";
    Reflect.set(mutableAggregateResults, "min", "bigint");

    expect(semantics.formatCanonicalText("abc")).toBe("ABC");
    expect(semantics.parseCanonicalText("ABC")).toEqual({ _tag: "Success", value: "abc" });
    expect(semantics.aggregateResults).toEqual({ min: "self" });
    expect(Object.isFrozen(semantics.aggregateResults)).toBe(true);
    expect(compiled).toMatchObject({
      kind: "field",
      groupBy: true,
      aggFunc: "min",
      aggregateValueFormatter,
    });

    expect(() =>
      compileColumns([
        {
          columnId: "COL_ID_UNSUPPORTED_SUM",
          field: "code",
          headerName: "Unsupported sum",
          valueType: custom,
          aggFunc: "sum",
        },
      ]),
    ).toThrow("does not support sum aggregation");

    expect(() =>
      compileColumns([
        {
          columnId: "COL_ID_UNKNOWN_AGGREGATE",
          field: "code",
          headerName: "Unknown aggregate",
          valueType: { ...custom, aggregateResults: { median: "self" } },
        },
      ]),
    ).toThrow("aggregateResults does not accept median");

    const accessorAggregateResults = {};
    Object.defineProperty(accessorAggregateResults, "min", {
      enumerable: true,
      get: () => "self",
    });
    expect(() =>
      compileColumns([
        {
          columnId: "COL_ID_ACCESSOR_AGGREGATE",
          field: "code",
          headerName: "Accessor aggregate",
          valueType: { ...custom, aggregateResults: accessorAggregateResults },
        },
      ]),
    ).toThrow("aggregateResults must contain enumerable data properties");

    expect(() =>
      compileColumns([
        {
          columnId: "COL_ID_INVALID_AGGREGATE_RESULT",
          field: "code",
          headerName: "Invalid aggregate result",
          valueType: { ...custom, aggregateResults: { min: "number" } },
        },
      ]),
    ).toThrow("aggregateResults.min is invalid");

    const sparseCustom = {
      ...custom,
      encodePersisted: () => {
        const sparse: BrunoTableJsonValue[] = [];
        sparse.length = 1;
        return sparse;
      },
    };
    const [sparseCompiled] = compileColumns([
      {
        columnId: "COL_ID_SPARSE",
        field: "code",
        headerName: "Sparse",
        valueType: sparseCustom,
      },
    ]);
    expect(() => sparseCompiled!.semantics.encodePersisted("abc")).toThrow(
      "persisted output must be JSON-safe",
    );

    const malformed = { ...custom, codecId: "" };
    expect(() =>
      compileColumns([
        {
          columnId: "COL_ID_BAD",
          field: "code",
          headerName: "Bad",
          valueType: malformed,
        },
      ]),
    ).toThrow(ColumnConfigurationError);
  });

  it("rejects malformed equality and normalizes custom decoder failures", () => {
    const custom = {
      codecId: "example/hostile-text",
      codecVersion: 1,
      filterFamily: "equality",
      editorFamily: "text",
      cellAlign: "start",
      editorLayout: "inline",
      defaultWidth: 100,
      decodeRuntime: () => {
        throw new Error("hostile runtime decoder");
      },
      equivalent: () => "false",
      compare: () => 0,
      formatCanonicalText: () => "invalid",
      parseCanonicalText: () => ({ unexpected: true }),
      formatDisplay: () => "invalid",
      encodePersisted: () => ({ value: "invalid" }),
      decodePersisted: () => {
        throw new Error("hostile persistence decoder");
      },
    };
    const [compiled] = compileColumns([
      {
        columnId: "COL_ID_CODE",
        field: "code",
        headerName: "Code",
        valueType: custom,
      },
    ]);
    const semantics = compiled!.semantics;

    expect(() => semantics.equivalent("left", "right")).toThrow("equivalent must return a boolean");
    expect(semantics.decodeRuntime("code")).toEqual({
      _tag: "Failure",
      message: "BrunoTable Value Type decodeRuntime failed.",
    });
    expect(semantics.parseCanonicalText("code")).toEqual({
      _tag: "Failure",
      message: "BrunoTable Value Type parseCanonicalText failed.",
    });
    expect(semantics.decodePersisted({ value: "code" })).toEqual({
      _tag: "Failure",
      message: "BrunoTable Value Type decodePersisted failed.",
    });
  });

  it("rejects malformed helper and presentation configuration", () => {
    const emptySelectColumn = {
      columnId: "COL_ID_STATUS",
      field: "status",
      headerName: "Status",
      options: [],
    } as const;
    expect(() => {
      // @ts-expect-error Runtime validation intentionally receives an empty select domain.
      BrunoTableSelectColumn(emptySelectColumn);
    }).toThrow("options must be a non-empty array");

    const mixedSelectColumn = {
      columnId: "COL_ID_STATUS",
      field: "status",
      headerName: "Status",
      options: ["open", 1],
    } as const;
    expect(() => {
      // @ts-expect-error Runtime validation intentionally receives mixed select values.
      BrunoTableSelectColumn(mixedSelectColumn);
    }).toThrow("one homogeneous");

    const invalidPresetDefaults = { headerName: "Price", columnId: "COL_ID_PRICE" } as const;
    expect(() => {
      // @ts-expect-error Runtime validation intentionally supplies a forbidden preset key.
      BrunoTableNumberColumn.withDefaults(invalidPresetDefaults);
    }).toThrow("preset does not accept columnId");

    const invalidValueTypeColumn = {
      columnId: "COL_ID_PRICE",
      field: "price",
      headerName: "Price",
      valueType: "text",
    } as const;
    expect(() => {
      // @ts-expect-error Runtime validation intentionally supplies a forbidden valueType key.
      BrunoTableNumberColumn(invalidValueTypeColumn);
    }).toThrow("do not accept a valueType override");

    const invalidFormatColumn = {
      columnId: "COL_ID_PRICE",
      field: "price",
      headerName: "Price",
      format: "invalid",
    } as const;
    expect(() => {
      // @ts-expect-error Runtime validation intentionally supplies a malformed format value.
      BrunoTableNumberColumn(invalidFormatColumn);
    }).toThrow("format must be an object");

    const invalidFormatKeyColumn = {
      columnId: "COL_ID_PRICE",
      field: "price",
      headerName: "Price",
      format: { maximumFractionDigit: 2 },
    } as const;
    expect(() => {
      // @ts-expect-error Runtime validation intentionally supplies an unknown format key.
      BrunoTableNumberColumn(invalidFormatKeyColumn);
    }).toThrow("does not accept maximumFractionDigit");

    const invalidPresetFormat = { headerName: "Price", format: "invalid" } as const;
    expect(() => {
      // @ts-expect-error Runtime validation intentionally supplies a malformed preset format.
      BrunoTableNumberColumn.withDefaults(invalidPresetFormat);
    }).toThrow("format must be an object");

    const unknownNumberColumnKey = {
      columnId: "COL_ID_PRICE",
      field: "price",
      headerName: "Price",
      mysteryOption: true,
    } as const;
    expect(() => {
      // @ts-expect-error Runtime validation intentionally supplies an unknown helper key.
      BrunoTableNumberColumn(unknownNumberColumnKey);
    }).toThrow("does not accept mysteryOption");

    const unknownSelectColumnKey = {
      columnId: "COL_ID_STATUS",
      field: "status",
      headerName: "Status",
      options: ["open", "closed"],
      mysteryOption: true,
    } as const;
    expect(() => {
      // @ts-expect-error Runtime validation intentionally supplies an unknown helper key.
      BrunoTableSelectColumn(unknownSelectColumnKey);
    }).toThrow("does not accept mysteryOption");
    const statusPreset = BrunoTableSelectColumn.withDefaults({
      headerName: "Status",
      options: ["open", "closed"],
    });
    const overriddenPresetOptions = {
      columnId: "COL_ID_STATUS",
      field: "status",
      options: ["open"],
    } as const;
    expect(() => {
      // @ts-expect-error Runtime validation intentionally overrides preset options.
      statusPreset(overriddenPresetOptions);
    }).toThrow("preset options cannot be overridden");
    for (const [key, message] of [
      ["cellAlign", "cellAlign must be"],
      ["editorLayout", "editorLayout must be"],
      ["width", "width must be"],
    ] as const) {
      expect(() =>
        compileColumns([
          {
            columnId: "COL_ID_SYMBOL",
            field: "symbol",
            headerName: "Symbol",
            valueType: "text",
            [key]: null,
          },
        ]),
      ).toThrow(message);
    }
    expect(() =>
      compileColumns([
        {
          columnId: "COL_ID_SYMBOL",
          field: "symbol",
          headerName: "Symbol",
          valueType: "text",
          format: { maximumFractionDigits: 2 },
        },
      ]),
    ).toThrow("format is supported only");
    expect(() =>
      compileColumns([
        {
          columnId: "COL_ID_SYMBOL",
          field: "symbol",
          headerName: "Symbol",
          valueType: "text",
          cellRenderer: "not a function",
        },
      ]),
    ).toThrow("cellRenderer must be a function");
  });

  it("snapshots reusable preset defaults before later caller mutation", () => {
    const numberDefaults = {
      headerName: "Price",
      width: 112,
      format: { minimumFractionDigits: 2 },
    };
    const numberPreset = BrunoTableNumberColumn.withDefaults(numberDefaults);
    numberDefaults.headerName = "Mutated";
    numberDefaults.width = 999;
    numberDefaults.format.minimumFractionDigits = 9;
    Object.assign(numberDefaults, { columnId: "COL_ID_HIDDEN", field: "price" });

    const numberColumn = numberPreset<
      SemanticRow,
      "price",
      "COL_ID_PRICE",
      { readonly columnId: "COL_ID_PRICE"; readonly field: "price" }
    >({
      columnId: "COL_ID_PRICE",
      field: "price",
    });
    expect(numberColumn).toMatchObject({
      columnId: "COL_ID_PRICE",
      field: "price",
      headerName: "Price",
      width: 112,
      format: { minimumFractionDigits: 2 },
    });
    const numberColumnWithoutIdentity = (() => {
      const missingIdentity = { field: "price" } as const;
      // @ts-expect-error This runtime test deliberately omits the required public identity.
      return numberPreset(missingIdentity);
    })();
    expect(numberColumnWithoutIdentity).not.toHaveProperty("columnId");

    const selectOptions: ["open", "closed"] = ["open", "closed"];
    const selectDefaults = { headerName: "Status", options: selectOptions };
    const selectPreset = BrunoTableSelectColumn.withDefaults(selectDefaults);
    selectOptions.reverse();
    Object.assign(selectDefaults, { valueType: "text" });

    const selectColumn = selectPreset<
      SemanticRow,
      "status",
      "COL_ID_STATUS",
      { readonly columnId: "COL_ID_STATUS"; readonly field: "status" }
    >({
      columnId: "COL_ID_STATUS",
      field: "status",
    });
    expect(selectColumn).toMatchObject({
      columnId: "COL_ID_STATUS",
      field: "status",
      headerName: "Status",
      options: ["open", "closed"],
    });
  });
});
