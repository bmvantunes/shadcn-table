import {
  cellSelectionFeature,
  columnPinningFeature,
  columnSizingFeature,
  createColumnHelper,
  tableFeatures,
} from "@tanstack/react-table";

export const COLUMN_COUNT = 150;
export const ROW_COUNT = 5_000;

export interface MechanicsRow {
  readonly id: string;
  readonly values: ReadonlyArray<number | string>;
}

export interface MechanicsColumnMeta {
  readonly id: string;
  readonly index: number;
  readonly label: string;
  readonly width: number;
}

function columnId(index: number): string {
  if (index === 0) return "COL_ID_SYMBOL";
  if (index === 1) return "COL_ID_DESK";
  if (index === COLUMN_COUNT - 1) return "COL_ID_ACTIONS";
  return `COL_ID_METRIC_${String(index - 1).padStart(3, "0")}`;
}

export const mechanicsColumnMeta: ReadonlyArray<MechanicsColumnMeta> = Array.from(
  { length: COLUMN_COUNT },
  (_, index) => ({
    id: columnId(index),
    index,
    label:
      index === 0
        ? "Symbol"
        : index === 1
          ? "Desk"
          : index === COLUMN_COUNT - 1
            ? "Actions"
            : `Metric ${String(index - 1).padStart(3, "0")}`,
    width: index < 2 ? 108 : index === COLUMN_COUNT - 1 ? 112 : 92 + (index % 4) * 16,
  }),
);

const desks = ["London", "New York", "Singapore", "Tokyo"] as const;

export const mechanicsRows: ReadonlyArray<MechanicsRow> = Array.from(
  { length: ROW_COUNT },
  (_, rowIndex) => ({
    id: `ROW_${String(rowIndex + 1).padStart(5, "0")}`,
    values: mechanicsColumnMeta.map((column) => {
      if (column.index === 0) return `SYM-${String(rowIndex + 1).padStart(5, "0")}`;
      if (column.index === 1) return desks[rowIndex % desks.length] ?? "London";
      if (column.index === COLUMN_COUNT - 1) return "Inspect";
      return ((rowIndex + 1) * (column.index + 7)) % 100_000;
    }),
  }),
);

export const mechanicsFeatures = tableFeatures({
  cellSelectionFeature,
  columnPinningFeature,
  columnSizingFeature,
});

const columnHelper = createColumnHelper<typeof mechanicsFeatures, MechanicsRow>();

export const mechanicsColumns = columnHelper.columns(
  mechanicsColumnMeta.map((meta) =>
    columnHelper.accessor((row) => row.values[meta.index], {
      id: meta.id,
      header: meta.label,
      size: meta.width,
      minSize: meta.width,
      maxSize: meta.width,
    }),
  ),
);

export const START_COLUMN_IDS = ["COL_ID_SYMBOL", "COL_ID_DESK"] as const;
export const END_COLUMN_IDS = ["COL_ID_ACTIONS"] as const;
