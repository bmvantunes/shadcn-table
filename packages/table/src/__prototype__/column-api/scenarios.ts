// PROTOTYPE — representative consumer code for the column API experiment.

import {
  BrunoTablePrototypeBigIntColumn,
  BrunoTablePrototypeBooleanColumn,
  BrunoTablePrototypeClient,
  BrunoTablePrototypeCompileColumns,
  BrunoTablePrototypeNumberColumn,
  BrunoTablePrototypeTextColumn,
  type BrunoTablePrototypeColumns,
  type BrunoTablePrototypeSaveChangeSet,
} from "./api.ts";

export type BrunoTablePrototypeOrder = {
  readonly id: string;
  readonly revision: bigint;
  readonly symbol: string;
  readonly price: number;
  readonly quantity: bigint;
  readonly multiplier: number;
  readonly status: "closed" | "open";
  readonly urgent: boolean;
};

export const BrunoTablePrototypePriceColumn = BrunoTablePrototypeNumberColumn.withDefaults({
  headerName: "Price",
  width: 112,
  format: {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  },
});

export const BrunoTablePrototypeOrderColumns = [
  BrunoTablePrototypeTextColumn({
    columnId: "COL_ID_SYMBOL",
    field: "symbol",
    headerName: "Symbol",
  }),
  BrunoTablePrototypePriceColumn({
    columnId: "COL_ID_PRICE",
    field: "price",
    isEditable: ({ row, value }) => row.status === "open" && value >= 0,
    valueFormatter: ({ value }) => value.toFixed(2),
  }),
  BrunoTablePrototypeBigIntColumn({
    columnId: "COL_ID_QUANTITY",
    field: "quantity",
    headerName: "Quantity",
    isEditable: true,
    valueFormatter: ({ value }) => value.toString(),
  }),
  BrunoTablePrototypeBooleanColumn({
    columnId: "COL_ID_URGENT",
    field: "urgent",
    headerName: "Urgent",
  }),
  BrunoTablePrototypeNumberColumn({
    columnId: "COL_ID_WEIGHTED_PRICE",
    fields: ["price", "multiplier"],
    headerName: "Weighted price",
    valueGetter: ({ row }) => row.price * row.multiplier,
    valueFormatter: ({ value }) => value.toFixed(2),
  }),
] satisfies BrunoTablePrototypeColumns<BrunoTablePrototypeOrder>;

export const BrunoTablePrototypeSampleOrder: BrunoTablePrototypeOrder = {
  id: "order-1",
  revision: 7n,
  symbol: "EURUSD",
  price: 1.0845,
  quantity: 5_000_000n,
  multiplier: 2,
  status: "open",
  urgent: false,
};

export const BrunoTablePrototypeCompiledOrderColumns = BrunoTablePrototypeCompileColumns(
  BrunoTablePrototypeOrderColumns,
);

export const BrunoTablePrototypeOverrideColumns = [
  BrunoTablePrototypePriceColumn({
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Market price",
    width: 144,
    cellAlign: "start",
    format: { maximumFractionDigits: 4 },
  }),
] satisfies BrunoTablePrototypeColumns<BrunoTablePrototypeOrder>;

export const BrunoTablePrototypeCompiledOverrideColumns = BrunoTablePrototypeCompileColumns(
  BrunoTablePrototypeOverrideColumns,
);

export const BrunoTablePrototypeSampleSave = [
  {
    rowId: "order-1",
    baseRow: BrunoTablePrototypeSampleOrder,
    expectedVersion: 7n,
    changes: [
      {
        columnId: "COL_ID_PRICE",
        field: "price",
        before: 1.0845,
        after: 1.085,
      },
      {
        columnId: "COL_ID_QUANTITY",
        field: "quantity",
        before: 5_000_000n,
        after: 6_000_000n,
      },
    ],
  },
] satisfies BrunoTablePrototypeSaveChangeSet<
  BrunoTablePrototypeOrder,
  typeof BrunoTablePrototypeOrderColumns,
  bigint
>;

export const BrunoTablePrototypeClientConfig = BrunoTablePrototypeClient({
  tableId: "orders",
  columns: BrunoTablePrototypeOrderColumns,
  clientSource: { rows: [BrunoTablePrototypeSampleOrder] },
  getRowId: (row) => row.id,
  editable: true,
  getRowVersion: (row) => row.revision,
  onSaveEdits: (changes) => {
    void changes;
    return Promise.resolve();
  },
});
