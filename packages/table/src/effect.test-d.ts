import * as BigDecimal from "effect/BigDecimal";

import { BrunoTableBigDecimalColumn, BrunoTableBigDecimalValueType } from "@bruno/table/effect";
import type {
  BrunoTableColumnValue,
  BrunoTableColumns,
  BrunoTableFilterExpressions,
} from "@bruno/table";

type PriceRow = {
  readonly price: BigDecimal.BigDecimal;
  readonly referencePrice?: BigDecimal.BigDecimal;
  readonly symbol: string;
};

const priceColumn = BrunoTableBigDecimalColumn.withDefaults({
  headerName: "Price",
  width: 128,
  cellClassName: "tabular-nums",
});

const columns = [
  priceColumn({
    columnId: "COL_ID_PRICE",
    field: "price",
    valueFormatter: ({ row, value }) =>
      `${row.symbol}: ${value === undefined ? "" : BigDecimal.format(value)}`,
    cellClassName: ({ value }) =>
      value !== undefined && value.value < 0n ? "text-destructive" : undefined,
  }),
  BrunoTableBigDecimalColumn({
    columnId: "COL_ID_REFERENCE_PRICE",
    field: "referencePrice",
    headerName: "Reference price",
  }),
  BrunoTableBigDecimalColumn({
    columnId: "COL_ID_SPREAD",
    headerName: "Spread",
    fields: ["price", "referencePrice"],
    valueGetter: ({ row }) => row.referencePrice ?? row.price,
  }),
] satisfies BrunoTableColumns<PriceRow>;

const rawColumns = [
  {
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Price",
    valueType: BrunoTableBigDecimalValueType,
  },
] satisfies BrunoTableColumns<PriceRow>;

type PriceValue = BrunoTableColumnValue<PriceRow, typeof columns, "COL_ID_PRICE">;
const exactPrice: PriceValue = BigDecimal.make(123n, 2);
void exactPrice;
void rawColumns;

const filters = [
  {
    columnId: "COL_ID_PRICE",
    type: "greaterThanOrEqual",
    filter: BigDecimal.make(100n, 2),
  },
  {
    columnId: "COL_ID_REFERENCE_PRICE",
    type: "inRange",
    filter: BigDecimal.make(100n, 2),
    filterTo: BigDecimal.make(200n, 2),
  },
] satisfies BrunoTableFilterExpressions<PriceRow, typeof columns>;
void filters;

const invalidFilter: BrunoTableFilterExpressions<PriceRow, typeof columns> = [
  // @ts-expect-error BigDecimal numeric filters never accept JavaScript number operands.
  { columnId: "COL_ID_PRICE", type: "greaterThan", filter: 1 },
];
void invalidFilter;

const invalidComputed = [
  BrunoTableBigDecimalColumn({
    columnId: "COL_ID_INVALID_SPREAD",
    headerName: "Invalid spread",
    fields: ["price"],
    valueGetter: ({ row }) => {
      // @ts-expect-error Computed getters may read only their declared fields.
      void row.symbol;
      return row.price;
    },
  }),
] satisfies BrunoTableColumns<PriceRow>;
void invalidComputed;

// @ts-expect-error BigDecimal helpers reject fields from another value domain.
const invalidField = BrunoTableBigDecimalColumn<PriceRow, "symbol">({
  columnId: "COL_ID_SYMBOL",
  field: "symbol",
  headerName: "Symbol",
});
void invalidField;

// @ts-expect-error Effect-specific exports are isolated from the root package.
import { BrunoTableBigDecimalColumn as InvalidRootImport } from "@bruno/table";
void InvalidRootImport;
