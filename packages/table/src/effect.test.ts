import * as BigDecimal from "effect/BigDecimal";
import { compareTrustedWireSafeBigDecimal } from "effect-view-server/value-semantics";
import { describe, expect, it } from "vitest";

import { BrunoTableBigDecimalColumn, BrunoTableBigDecimalValueType } from "./effect";
import type { BrunoTableColumns } from "./public-types";

const decimal = BigDecimal.fromStringUnsafe;

describe("Effect BigDecimal Value Type", () => {
  it("round-trips exact canonical text and tagged persistence without number coercion", () => {
    const exact = decimal("-9007199254740993123456789.0000000000000000001");

    expect(BrunoTableBigDecimalValueType.formatCanonicalText(exact)).toBe(
      "-9.0071992547409931234567890000000000000000001e+24",
    );
    const parsed = BrunoTableBigDecimalValueType.parseCanonicalText(
      "-9.0071992547409931234567890000000000000000001e+24",
    );
    expect(parsed._tag).toBe("Success");
    if (parsed._tag === "Success") {
      expect(BrunoTableBigDecimalValueType.equivalent(parsed.value, exact)).toBe(true);
    }

    const persisted = BrunoTableBigDecimalValueType.encodePersisted(exact);
    expect(persisted).toEqual({
      $brunoTableValue: "effect-bigdecimal",
      version: 1,
      value: "-9.0071992547409931234567890000000000000000001e+24",
    });
    const restored = BrunoTableBigDecimalValueType.decodePersisted(persisted);
    expect(restored._tag).toBe("Success");
    if (restored._tag === "Success") {
      expect(BrunoTableBigDecimalValueType.equivalent(restored.value, exact)).toBe(true);
    }
  });

  it("uses allocation-safe semantic equality and order for scale variants and extreme scales", () => {
    const onePointFive = decimal("1.5");
    const onePointFiveScaled = BigDecimal.make(1500n, 3);
    const tiny = BigDecimal.make(1n, Number.MAX_SAFE_INTEGER);
    const lessTiny = BigDecimal.make(1n, Number.MAX_SAFE_INTEGER - 1);
    const huge = BigDecimal.make(1n, Number.MIN_SAFE_INTEGER);

    expect(BrunoTableBigDecimalValueType.equivalent(onePointFive, onePointFiveScaled)).toBe(true);
    expect(BrunoTableBigDecimalValueType.compare(onePointFive, onePointFiveScaled)).toBe(0);
    expect(BrunoTableBigDecimalValueType.compare(tiny, lessTiny)).toBe(-1);
    expect(BrunoTableBigDecimalValueType.compare(huge, lessTiny)).toBe(1);
    expect(
      BrunoTableBigDecimalValueType.compare(BigDecimal.make(-1n, Number.MIN_SAFE_INTEGER), huge),
    ).toBe(-1);

    const parityValues = [
      decimal("-999999999999999999999.5"),
      BigDecimal.make(-1n, Number.MAX_SAFE_INTEGER),
      decimal("0"),
      BigDecimal.make(1n, Number.MAX_SAFE_INTEGER),
      decimal("1.5"),
      decimal("999999999999999999999.5"),
      BigDecimal.make(1n, Number.MIN_SAFE_INTEGER),
    ];
    for (const left of parityValues) {
      for (const right of parityValues) {
        expect(BrunoTableBigDecimalValueType.compare(left, right)).toBe(
          compareTrustedWireSafeBigDecimal(left, right),
        );
      }
    }
  });

  it("rejects blank, invalid, lookalike, and non-injective BigDecimal inputs", () => {
    for (const invalid of ["", " ", "NaN", "Infinity", "0x10", "1_000"]) {
      expect(BrunoTableBigDecimalValueType.parseCanonicalText(invalid)._tag).toBe("Failure");
    }

    expect(BrunoTableBigDecimalValueType.decodeRuntime({ value: 15n, scale: 1 })).toMatchObject({
      _tag: "Failure",
    });
    expect(() =>
      BrunoTableBigDecimalValueType.compare(
        { value: 15n, scale: 1 } as BigDecimal.BigDecimal,
        decimal("1.5"),
      ),
    ).toThrow("invalid value");
    expect(
      BrunoTableBigDecimalValueType.decodeRuntime(BigDecimal.make(10n, Number.MIN_SAFE_INTEGER)),
    ).toMatchObject({ _tag: "Failure" });
    expect(
      BrunoTableBigDecimalValueType.decodePersisted({
        $brunoTableValue: "effect-bigdecimal",
        version: 1,
        value: "10e9007199254740991",
      }),
    ).toMatchObject({ _tag: "Failure" });
    expect(
      BrunoTableBigDecimalValueType.decodePersisted({
        $brunoTableValue: "effect-bigdecimal",
        version: 2,
        value: "1.5",
      }),
    ).toMatchObject({ _tag: "Failure" });
  });

  it("bounds canonical and persisted BigDecimal text before parsing", () => {
    const maximumLengthText = "1".repeat(4_096);
    const overBudgetText = `${maximumLengthText}1`;

    expect(BrunoTableBigDecimalValueType.parseCanonicalText(maximumLengthText)._tag).toBe(
      "Success",
    );
    expect(BrunoTableBigDecimalValueType.parseCanonicalText(overBudgetText)).toEqual({
      _tag: "Failure",
      message: "BigDecimal text must not exceed 4096 UTF-16 code units.",
    });
    expect(
      BrunoTableBigDecimalValueType.decodePersisted({
        $brunoTableValue: "effect-bigdecimal",
        version: 1,
        value: overBudgetText,
      }),
    ).toEqual({
      _tag: "Failure",
      message: "BigDecimal text must not exceed 4096 UTF-16 code units.",
    });
  });

  it("turns admitted cross-bundle wire values into owned local BigDecimals", () => {
    const foreignPrototype = Object.create(null, {
      "~effect/BigDecimal": { value: "~effect/BigDecimal" },
    });
    const foreignValue = Object.create(foreignPrototype, {
      value: { value: 150n, enumerable: true },
      scale: { value: 2, enumerable: true },
    });

    const decoded = BrunoTableBigDecimalValueType.decodeRuntime(foreignValue);

    expect(decoded._tag).toBe("Success");
    if (decoded._tag === "Success") {
      expect(decoded.value).not.toBe(foreignValue);
      expect(BigDecimal.isBigDecimal(decoded.value)).toBe(true);
      expect(BigDecimal.format(decoded.value)).toBe("1.5");
    }
  });

  it("freezes admitted values so later mutation cannot bypass exact validation", () => {
    const mutable = BigDecimal.make(15n, 1);
    const decoded = BrunoTableBigDecimalValueType.decodeRuntime(mutable);
    const decodedAgain = BrunoTableBigDecimalValueType.decodeRuntime(mutable);

    expect(decoded._tag).toBe("Success");
    if (decoded._tag === "Success") {
      expect(decoded.value).not.toBe(mutable);
      expect(decodedAgain._tag).toBe("Success");
      if (decodedAgain._tag === "Success") {
        expect(decodedAgain.value).toBe(decoded.value);
      }
      expect(Object.isFrozen(decoded.value)).toBe(true);
      expect(Reflect.set(decoded.value, "scale", Number.NaN)).toBe(false);
      Reflect.set(mutable, "scale", Number.NaN);
      expect(BrunoTableBigDecimalValueType.formatCanonicalText(decoded.value)).toBe("1.5");
    }
  });

  it("decodes persisted descriptors once without invoking hostile property access", () => {
    const target = {
      $brunoTableValue: "effect-bigdecimal",
      version: 1,
      value: "1.5",
    };
    const hostile = new Proxy(target, {
      get() {
        throw new Error("persisted property access escaped");
      },
    });

    expect(BrunoTableBigDecimalValueType.decodePersisted(hostile)).toMatchObject({
      _tag: "Success",
    });

    const throwingDescriptor = new Proxy(target, {
      getOwnPropertyDescriptor(_target, key) {
        if (key === "value") throw new Error("descriptor trap escaped");
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    expect(BrunoTableBigDecimalValueType.decodePersisted(throwingDescriptor)).toMatchObject({
      _tag: "Failure",
    });

    const accessor = Object.defineProperties(
      {},
      {
        $brunoTableValue: { enumerable: true, value: "effect-bigdecimal" },
        version: { enumerable: true, value: 1 },
        value: {
          enumerable: true,
          get(): never {
            throw new Error("accessor escaped");
          },
        },
      },
    );
    expect(BrunoTableBigDecimalValueType.decodePersisted(accessor)).toMatchObject({
      _tag: "Failure",
    });
  });
});

describe("BrunoTableBigDecimalColumn", () => {
  it("applies exact numeric defaults and preset then column override precedence", () => {
    const priceColumn = BrunoTableBigDecimalColumn.withDefaults({
      headerName: "Price",
      width: 112,
      cellClassName: "tabular-nums",
    });

    type PriceRow = { readonly price: BigDecimal.BigDecimal };
    const [column] = [
      priceColumn({
        columnId: "COL_ID_PRICE",
        field: "price",
        width: 144,
        valueFormatter: ({ value }) => `GBP ${BigDecimal.format(value)}`,
      }),
    ] satisfies BrunoTableColumns<PriceRow>;

    expect(column).toMatchObject({
      columnId: "COL_ID_PRICE",
      field: "price",
      headerName: "Price",
      valueType: BrunoTableBigDecimalValueType,
      cellAlign: "end",
      editorLayout: "inline",
      width: 144,
      cellClassName: "tabular-nums",
    });
    expect(
      column!.valueFormatter?.({ row: { price: decimal("1.25") }, value: decimal("1.25") }),
    ).toBe("GBP 1.25");
  });

  it("preserves capability-valid grouped presentation through presets", () => {
    const totalPriceColumn = BrunoTableBigDecimalColumn.withDefaults({
      headerName: "Total price",
      aggFunc: "sum",
      aggregateCellClassName: ({ value }) => (value.value < 0n ? "text-destructive" : undefined),
      aggregateValueFormatter: ({ value }) => `GBP ${BigDecimal.format(value)}`,
    });
    type PriceRow = { readonly price: BigDecimal.BigDecimal };
    const [column] = [
      totalPriceColumn({
        columnId: "COL_ID_TOTAL_PRICE",
        field: "price",
      }),
    ] satisfies BrunoTableColumns<PriceRow>;

    expect(column).toMatchObject({
      columnId: "COL_ID_TOTAL_PRICE",
      field: "price",
      aggFunc: "sum",
    });
    if (column === undefined) throw new Error("Expected the aggregate column.");
    expect(
      column.aggregateValueFormatter?.({
        columnId: "COL_ID_TOTAL_PRICE",
        aggFunc: "sum",
        value: decimal("12.5"),
        rowCount: 2n,
      }),
    ).toBe("GBP 12.5");
  });

  it("drops incompatible preset presentation when a capability is overridden", () => {
    const aggregatePreset = BrunoTableBigDecimalColumn.withDefaults({
      headerName: "Total price",
      aggFunc: "sum",
      aggregateValueFormatter: ({ value }) => BigDecimal.format(value),
    });
    type PriceRow = { readonly price: BigDecimal.BigDecimal };
    const [distinctColumn] = [
      aggregatePreset({
        columnId: "COL_ID_DISTINCT_PRICE",
        field: "price",
        aggFunc: "countDistinct",
      }),
    ] satisfies BrunoTableColumns<PriceRow>;

    expect(distinctColumn).toMatchObject({ aggFunc: "countDistinct" });
    expect(Object.hasOwn(distinctColumn!, "aggregateValueFormatter")).toBe(false);
  });

  it("rejects grouped presentation without its capability at runtime", () => {
    expect(() =>
      BrunoTableBigDecimalColumn({
        columnId: "COL_ID_PRICE",
        field: "price",
        headerName: "Price",
        aggregateValueFormatter: () => "invalid",
      } as never),
    ).toThrow("requires aggFunc");
    expect(() =>
      BrunoTableBigDecimalColumn({
        columnId: "COL_ID_PRICE",
        field: "price",
        headerName: "Price",
        groupKeyValueFormatter: () => "invalid",
      } as never),
    ).toThrow("requires groupBy: true");
  });
});
