import * as BigDecimal from "effect/BigDecimal";
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
});
