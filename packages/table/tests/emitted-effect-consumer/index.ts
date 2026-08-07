import * as BigDecimal from "effect/BigDecimal";

import { BrunoTableBigDecimalColumn, BrunoTableBigDecimalValueType } from "@bruno/table/effect";
import type {
  BrunoTableColumnValue,
  BrunoTableColumns,
  BrunoTableFilterExpressions,
} from "@bruno/table";

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
const emittedPrice: EmittedPrice = BigDecimal.make(125n, 2);
void emittedPrice;

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
