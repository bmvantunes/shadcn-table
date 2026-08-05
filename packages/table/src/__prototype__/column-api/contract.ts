// PROTOTYPE — compiler-only evidence. This is deliberately not a production test suite.

import {
  BrunoTablePrototypeNumberColumn,
  type BrunoTablePrototypeColumnValue,
  type BrunoTablePrototypeColumns,
  type BrunoTablePrototypeEditableColumnId,
  type BrunoTablePrototypeSaveChangeSet,
} from "./api.ts";
import {
  BrunoTablePrototypeOrderColumns,
  BrunoTablePrototypePriceColumn,
  type BrunoTablePrototypeOrder,
} from "./scenarios.ts";

type BrunoTablePrototypeEqual<TLeft, TRight> =
  (<TValue>() => TValue extends TLeft ? 1 : 2) extends <TValue>() => TValue extends TRight ? 1 : 2
    ? true
    : false;

type BrunoTablePrototypeExpect<TValue extends true> = TValue;

export type BrunoTablePrototypePriceValueProof = BrunoTablePrototypeExpect<
  BrunoTablePrototypeEqual<
    BrunoTablePrototypeColumnValue<
      BrunoTablePrototypeOrder,
      typeof BrunoTablePrototypeOrderColumns,
      "COL_ID_PRICE"
    >,
    number
  >
>;

export type BrunoTablePrototypeComputedValueProof = BrunoTablePrototypeExpect<
  BrunoTablePrototypeEqual<
    BrunoTablePrototypeColumnValue<
      BrunoTablePrototypeOrder,
      typeof BrunoTablePrototypeOrderColumns,
      "COL_ID_WEIGHTED_PRICE"
    >,
    number
  >
>;

export type BrunoTablePrototypeEditableIdentityProof = BrunoTablePrototypeExpect<
  BrunoTablePrototypeEqual<
    BrunoTablePrototypeEditableColumnId<typeof BrunoTablePrototypeOrderColumns>,
    "COL_ID_PRICE" | "COL_ID_QUANTITY"
  >
>;

const BrunoTablePrototypeInvalidNumberField = [
  // @ts-expect-error the rejected helper result cannot enter the typed column tuple.
  BrunoTablePrototypeNumberColumn({
    columnId: "COL_ID_SYMBOL",
    // @ts-expect-error the number helper cannot target a string field.
    field: "symbol",
    headerName: "Symbol",
  }),
] satisfies BrunoTablePrototypeColumns<BrunoTablePrototypeOrder>;

const BrunoTablePrototypeInvalidColumnIdentity = [
  {
    // @ts-expect-error Column Identity must use the uppercase COL_ID_ grammar.
    columnId: "COL_ID_price",
    field: "price",
    headerName: "Price",
    valueType: "number",
  },
] satisfies BrunoTablePrototypeColumns<BrunoTablePrototypeOrder>;

const BrunoTablePrototypeInvalidComputedDependency = [
  BrunoTablePrototypeNumberColumn({
    columnId: "COL_ID_WEIGHTED_PRICE",
    fields: ["price", "multiplier"],
    headerName: "Weighted price",
    valueGetter: ({ row }) => {
      // @ts-expect-error an undeclared dependency is absent from the getter row.
      void row.status;
      return row.price * row.multiplier;
    },
  }),
] satisfies BrunoTablePrototypeColumns<BrunoTablePrototypeOrder>;

const BrunoTablePrototypeInvalidEmptyComputedFields = [
  // @ts-expect-error the rejected helper result cannot enter the typed column tuple.
  BrunoTablePrototypeNumberColumn({
    columnId: "COL_ID_WEIGHTED_PRICE",
    // @ts-expect-error a Computed Column requires at least one declared field dependency.
    fields: [],
    headerName: "Weighted price",
    valueGetter: () => 0,
  }),
] satisfies BrunoTablePrototypeColumns<BrunoTablePrototypeOrder>;

const BrunoTablePrototypeInvalidComputedEdit = [
  // @ts-expect-error the rejected helper result cannot enter the typed column tuple.
  BrunoTablePrototypeNumberColumn({
    columnId: "COL_ID_WEIGHTED_PRICE",
    fields: ["price", "multiplier"],
    headerName: "Weighted price",
    // @ts-expect-error Computed Columns are never editable in V1.
    isEditable: true,
    valueGetter: ({ row }) => row.price * row.multiplier,
  }),
] satisfies BrunoTablePrototypeColumns<BrunoTablePrototypeOrder>;

const BrunoTablePrototypePresetStillChecksField = [
  // @ts-expect-error the rejected preset result cannot enter the typed column tuple.
  BrunoTablePrototypePriceColumn({
    columnId: "COL_ID_SYMBOL",
    // @ts-expect-error the preset retains the number helper's field correlation.
    field: "symbol",
  }),
] satisfies BrunoTablePrototypeColumns<BrunoTablePrototypeOrder>;

const BrunoTablePrototypeInvalidSaveField = [
  {
    rowId: "order-1",
    baseRow: {
      id: "order-1",
      revision: 7n,
      symbol: "EURUSD",
      price: 1.0845,
      quantity: 5_000_000n,
      multiplier: 2,
      status: "open",
      urgent: false,
    },
    expectedVersion: 7n,
    changes: [
      // @ts-expect-error Column Identity and source field remain correlated.
      {
        columnId: "COL_ID_PRICE",
        field: "quantity",
        before: 1.0845,
        after: 1.085,
      },
    ],
  },
] satisfies BrunoTablePrototypeSaveChangeSet<
  BrunoTablePrototypeOrder,
  typeof BrunoTablePrototypeOrderColumns,
  bigint
>;

void BrunoTablePrototypeInvalidNumberField;
void BrunoTablePrototypeInvalidColumnIdentity;
void BrunoTablePrototypeInvalidComputedDependency;
void BrunoTablePrototypeInvalidEmptyComputedFields;
void BrunoTablePrototypeInvalidComputedEdit;
void BrunoTablePrototypePresetStillChecksField;
void BrunoTablePrototypeInvalidSaveField;
