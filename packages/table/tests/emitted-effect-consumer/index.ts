import * as BigDecimal from "effect/BigDecimal";

import { BrunoTableBigDecimalColumn, BrunoTableBigDecimalValueType } from "@bruno/table/effect";
import type {
  BrunoTableColumnValue,
  BrunoTableColumns,
  BrunoTableFieldColumnDefinition,
  BrunoTableFilterExpressions,
  BrunoTableGroupKeyValues,
  BrunoTableValueType,
  BrunoTableValueTypeValue,
} from "@bruno/table";

type Equal<TLeft, TRight> =
  (<TValue>() => TValue extends TLeft ? 1 : 2) extends <TValue>() => TValue extends TRight ? 1 : 2
    ? true
    : false;
type Expect<TValue extends true> = TValue;

type EmittedPriceRow = {
  readonly price: BigDecimal.BigDecimal;
  readonly quantity: bigint;
};

const emittedPriceColumn = BrunoTableBigDecimalColumn.withDefaults({
  headerName: "Price",
  width: 120,
});

const emittedColumns = [
  emittedPriceColumn({
    columnId: "COL_ID_PRICE",
    field: "price",
    valueFormatter: ({ value }) => BigDecimal.format(value),
  }),
  BrunoTableBigDecimalColumn({
    columnId: "COL_ID_DOUBLE_PRICE",
    headerName: "Double price",
    fields: ["price"],
    valueGetter: ({ row }) => row.price,
  }),
] satisfies BrunoTableColumns<EmittedPriceRow>;

type EmittedPrice = BrunoTableColumnValue<EmittedPriceRow, typeof emittedColumns, "COL_ID_PRICE">;
type EmittedDoublePrice = BrunoTableColumnValue<
  EmittedPriceRow,
  typeof emittedColumns,
  "COL_ID_DOUBLE_PRICE"
>;
type EmittedPriceRemainsExact = Expect<Equal<EmittedPrice, BigDecimal.BigDecimal>>;
type EmittedDoublePriceRemainsExact = Expect<Equal<EmittedDoublePrice, BigDecimal.BigDecimal>>;
type EmittedBigDecimalCodecValueRemainsExact = Expect<
  Equal<BrunoTableValueTypeValue<typeof BrunoTableBigDecimalValueType>, BigDecimal.BigDecimal>
>;
const emittedPrice: EmittedPrice = BigDecimal.make(125n, 2);
const emittedPriceRemainsExact: EmittedPriceRemainsExact = true;
const emittedDoublePriceRemainsExact: EmittedDoublePriceRemainsExact = true;
const emittedBigDecimalCodecValueRemainsExact: EmittedBigDecimalCodecValueRemainsExact = true;
void emittedPrice;
void emittedPriceRemainsExact;
void emittedDoublePriceRemainsExact;
void emittedBigDecimalCodecValueRemainsExact;

const emittedFilters = [
  {
    columnId: "COL_ID_PRICE",
    type: "lessThan",
    filter: BigDecimal.make(200n, 2),
  },
] satisfies BrunoTableFilterExpressions<EmittedPriceRow, typeof emittedColumns>;
void emittedFilters;
void BrunoTableBigDecimalValueType;

const invalidEmittedFilters: BrunoTableFilterExpressions<EmittedPriceRow, typeof emittedColumns> = [
  // @ts-expect-error Emitted BigDecimal filters reject JavaScript numbers.
  { columnId: "COL_ID_PRICE", type: "equals", filter: 1 },
];
void invalidEmittedFilters;

type EmittedGroupedPriceRow = {
  readonly price: BigDecimal.BigDecimal;
  readonly optionalPrice?: BigDecimal.BigDecimal;
  readonly nullablePrice: BigDecimal.BigDecimal | null;
};

const emittedGroupedColumns = [
  BrunoTableBigDecimalColumn({
    columnId: "COL_ID_TOTAL_PRICE",
    field: "price",
    headerName: "Total price",
    aggFunc: "sum",
    aggregateValueFormatter: (parameters) => {
      const { aggFunc, columnId, value, rowCount } = parameters;
      aggFunc satisfies "sum";
      columnId satisfies "COL_ID_TOTAL_PRICE";
      rowCount satisfies bigint;
      // @ts-expect-error Emitted aggregate contexts never expose a fabricated raw row.
      void parameters.row;
      return BigDecimal.format(value);
    },
  }),
  BrunoTableBigDecimalColumn({
    columnId: "COL_ID_DISTINCT_PRICE",
    field: "price",
    headerName: "Distinct prices",
    aggFunc: "countDistinct",
    aggregateValueFormatter: ({ value }) => value.toString(),
  }),
  BrunoTableBigDecimalColumn({
    columnId: "COL_ID_OPTIONAL_MIN_PRICE",
    field: "optionalPrice",
    headerName: "Optional minimum price",
    aggFunc: "min",
    aggregateValueFormatter: ({ value }) => (value === undefined ? "" : BigDecimal.format(value)),
  }),
  BrunoTableBigDecimalColumn({
    columnId: "COL_ID_NULLABLE_MIN_PRICE",
    field: "nullablePrice",
    headerName: "Nullable minimum price",
    aggFunc: "min",
    aggregateValueFormatter: ({ value }) => (value === null ? "" : BigDecimal.format(value)),
  }),
] satisfies BrunoTableColumns<EmittedGroupedPriceRow>;
void emittedGroupedColumns;

const emittedGroupEvidenceColumns = [
  BrunoTableBigDecimalColumn({
    columnId: "COL_ID_PRIMARY_PRICE_GROUP",
    field: "price",
    headerName: "Primary price group",
    groupBy: true,
  }),
  BrunoTableBigDecimalColumn({
    columnId: "COL_ID_SECONDARY_PRICE_GROUP",
    field: "price",
    headerName: "Secondary price group",
    groupBy: true,
  }),
  BrunoTableBigDecimalColumn({
    columnId: "COL_ID_NOT_GROUPABLE_PRICE",
    field: "price",
    headerName: "Not groupable price",
  }),
] satisfies BrunoTableColumns<EmittedGroupedPriceRow>;
const emittedGroupKeyValues: BrunoTableGroupKeyValues<
  EmittedGroupedPriceRow,
  typeof emittedGroupEvidenceColumns
> = [
  {
    columnId: "COL_ID_PRIMARY_PRICE_GROUP",
    field: "price",
    value: BigDecimal.make(1n, 0),
  },
  {
    columnId: "COL_ID_SECONDARY_PRICE_GROUP",
    field: "price",
    value: BigDecimal.make(2n, 0),
  },
];
void emittedGroupKeyValues;

const emittedRawGroupedPrice = {
  columnId: "COL_ID_RAW_GROUP_PRICE",
  field: "price",
  headerName: "Raw grouped price",
  valueType: BrunoTableBigDecimalValueType,
  groupBy: true,
  aggFunc: "max",
  aggregateValueFormatter: ({ value }) => BigDecimal.format(value),
} satisfies BrunoTableFieldColumnDefinition<
  EmittedGroupedPriceRow,
  "price",
  typeof BrunoTableBigDecimalValueType,
  { readonly groupBy: true; readonly aggFunc: "max" },
  "COL_ID_RAW_GROUP_PRICE"
>;
[emittedRawGroupedPrice] satisfies BrunoTableColumns<EmittedGroupedPriceRow>;

const { aggregateResults: emittedIgnoredAggregateResults, ...emittedNoAggregateValueType } =
  BrunoTableBigDecimalValueType;
void emittedIgnoredAggregateResults;
emittedNoAggregateValueType satisfies BrunoTableValueType<
  BigDecimal.BigDecimal,
  "numeric",
  "bigdecimal"
>;
const invalidEmittedRawAggregate = [
  {
    columnId: "COL_ID_INVALID_RAW_AGGREGATE",
    field: "price",
    headerName: "Invalid raw aggregate",
    valueType: emittedNoAggregateValueType,
    // @ts-expect-error Emitted raw Value Types must declare the selected aggregate capability.
    aggFunc: "sum",
  },
] satisfies BrunoTableColumns<EmittedGroupedPriceRow>;
void invalidEmittedRawAggregate;

const invalidEmittedOptionalSum = BrunoTableBigDecimalColumn({
  columnId: "COL_ID_INVALID_OPTIONAL_SUM",
  // @ts-expect-error Emitted sum and avg reject optional or nullish fields.
  field: "optionalPrice",
  headerName: "Invalid optional sum",
  aggFunc: "sum",
});
void invalidEmittedOptionalSum;

const invalidEmittedNullableAverage = BrunoTableBigDecimalColumn({
  columnId: "COL_ID_INVALID_NULLABLE_AVERAGE",
  // @ts-expect-error Emitted sum and avg reject optional or nullish fields.
  field: "nullablePrice",
  headerName: "Invalid nullable average",
  aggFunc: "avg",
});
void invalidEmittedNullableAverage;

const emittedAggregatePreset = BrunoTableBigDecimalColumn.withDefaults({
  headerName: "Total price",
  aggFunc: "sum",
  aggregateValueFormatter: ({ value }) => BigDecimal.format(value),
});
const [emittedDistinctFromPreset] = [
  emittedAggregatePreset({
    columnId: "COL_ID_PRESET_DISTINCT",
    field: "price",
    aggFunc: "countDistinct",
  }),
] satisfies BrunoTableColumns<EmittedGroupedPriceRow>;
// @ts-expect-error Changing aggFunc removes the emitted preset formatter capability.
emittedDistinctFromPreset.aggregateValueFormatter({});

const invalidEmittedOptionalAggregatePreset = [
  emittedAggregatePreset({
    columnId: "COL_ID_INVALID_OPTIONAL_PRESET",
    // @ts-expect-error Emitted capability-bearing presets reject optional fields.
    field: "optionalPrice",
  }),
] satisfies BrunoTableColumns<EmittedGroupedPriceRow>;
void invalidEmittedOptionalAggregatePreset;

const emittedNullableMinPreset = BrunoTableBigDecimalColumn.withDefaults({
  headerName: "Nullable minimum",
  aggFunc: "min",
});
const emittedNullableMinFromPreset = [
  emittedNullableMinPreset({
    columnId: "COL_ID_NULLABLE_MIN_PRESET",
    field: "nullablePrice",
  }),
] satisfies BrunoTableColumns<EmittedGroupedPriceRow>;
void emittedNullableMinFromPreset;

const emittedUnsafeNullableMinPreset = BrunoTableBigDecimalColumn.withDefaults({
  headerName: "Unsafe nullable minimum",
  aggFunc: "min",
  aggregateValueFormatter: ({ value }) => BigDecimal.format(value),
});
const invalidEmittedUnsafeNullableMinPreset = [
  emittedUnsafeNullableMinPreset({
    columnId: "COL_ID_INVALID_NULLABLE_MIN_PRESET",
    // @ts-expect-error Inherited emitted min presentation must be replaced for nullable fields.
    field: "nullablePrice",
  }),
] satisfies BrunoTableColumns<EmittedGroupedPriceRow>;
void invalidEmittedUnsafeNullableMinPreset;
const emittedGroupPreset = BrunoTableBigDecimalColumn.withDefaults({
  headerName: "Grouped price",
  groupBy: true,
  groupKeyValueFormatter: ({ value }) => BigDecimal.format(value),
});
const [emittedUngroupedFromPreset] = [
  emittedGroupPreset({
    columnId: "COL_ID_PRESET_UNGROUPED",
    field: "price",
    groupBy: false,
  }),
] satisfies BrunoTableColumns<EmittedGroupedPriceRow>;
// @ts-expect-error Disabling groupBy removes emitted inherited group presentation.
emittedUngroupedFromPreset.groupKeyValueFormatter({});

const invalidEmittedNullableGroupPreset = [
  emittedGroupPreset({
    columnId: "COL_ID_INVALID_NULLABLE_GROUP_PRESET",
    // @ts-expect-error Emitted capability-bearing presets reject nullable fields.
    field: "nullablePrice",
  }),
] satisfies BrunoTableColumns<EmittedGroupedPriceRow>;
void invalidEmittedNullableGroupPreset;

const emittedPresentationFreeGroupPreset = BrunoTableBigDecimalColumn.withDefaults({
  headerName: "Nullable group",
  groupBy: true,
});
const emittedNullableGroupFromPreset = [
  emittedPresentationFreeGroupPreset({
    columnId: "COL_ID_NULLABLE_GROUP_PRESET",
    field: "nullablePrice",
  }),
] satisfies BrunoTableColumns<EmittedGroupedPriceRow>;
void emittedNullableGroupFromPreset;
