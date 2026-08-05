export type BrunoTableEditMode = "immediate" | "batch";

export type BrunoTableOrderRow = {
  readonly id: string;
  readonly revision: bigint;
  readonly symbol: string;
  readonly desk: string;
  readonly price: number;
  readonly quantity: bigint;
  readonly status: "Working" | "Held" | "Filled";
};

export type BrunoTableEditableField = "price" | "quantity" | "status";

export type BrunoTableCellValue = bigint | number | string;

export type BrunoTableChange = {
  readonly rowId: string;
  readonly symbol: string;
  readonly field: BrunoTableEditableField;
  readonly columnTitle: string;
  readonly baseValue: BrunoTableCellValue;
  readonly value: BrunoTableCellValue;
};

export type BrunoTableConflict = BrunoTableChange & {
  readonly serverValue: BrunoTableCellValue;
};

export type BrunoTableConflictResolution = "mine" | "theirs";

export const orderRows = [
  {
    id: "ORD-1042",
    revision: 18n,
    symbol: "AAPL",
    desk: "New York",
    price: 232.48,
    quantity: 1_250n,
    status: "Working",
  },
  {
    id: "ORD-1043",
    revision: 7n,
    symbol: "MSFT",
    desk: "London",
    price: 417.62,
    quantity: 600n,
    status: "Held",
  },
  {
    id: "ORD-1044",
    revision: 22n,
    symbol: "NVDA",
    desk: "New York",
    price: 143.16,
    quantity: 3_400n,
    status: "Working",
  },
  {
    id: "ORD-1045",
    revision: 4n,
    symbol: "TSLA",
    desk: "Singapore",
    price: 318.74,
    quantity: 900n,
    status: "Filled",
  },
  {
    id: "ORD-1046",
    revision: 13n,
    symbol: "AMZN",
    desk: "London",
    price: 225.94,
    quantity: 2_100n,
    status: "Working",
  },
  {
    id: "ORD-1047",
    revision: 9n,
    symbol: "META",
    desk: "New York",
    price: 692.31,
    quantity: 425n,
    status: "Held",
  },
  {
    id: "ORD-1048",
    revision: 31n,
    symbol: "GOOGL",
    desk: "Singapore",
    price: 196.72,
    quantity: 775n,
    status: "Working",
  },
] satisfies readonly BrunoTableOrderRow[];

export const initialChanges = [
  {
    rowId: "ORD-1042",
    symbol: "AAPL",
    field: "price",
    columnTitle: "Limit price",
    baseValue: 231.9,
    value: 232.48,
  },
  {
    rowId: "ORD-1043",
    symbol: "MSFT",
    field: "quantity",
    columnTitle: "Quantity",
    baseValue: 500n,
    value: 600n,
  },
  {
    rowId: "ORD-1044",
    symbol: "NVDA",
    field: "status",
    columnTitle: "Status",
    baseValue: "Held",
    value: "Working",
  },
  {
    rowId: "ORD-1046",
    symbol: "AMZN",
    field: "price",
    columnTitle: "Limit price",
    baseValue: 226.42,
    value: 225.94,
  },
  {
    rowId: "ORD-1047",
    symbol: "META",
    field: "quantity",
    columnTitle: "Quantity",
    baseValue: 400n,
    value: 425n,
  },
] satisfies readonly BrunoTableChange[];

export const initialConflicts = [
  {
    rowId: "ORD-1042",
    symbol: "AAPL",
    field: "price",
    columnTitle: "Limit price",
    baseValue: 231.9,
    value: 232.48,
    serverValue: 233.04,
  },
  {
    rowId: "ORD-1047",
    symbol: "META",
    field: "quantity",
    columnTitle: "Quantity",
    baseValue: 400n,
    value: 425n,
    serverValue: 450n,
  },
] satisfies readonly BrunoTableConflict[];

export function cellKey(rowId: string, field: BrunoTableEditableField): string {
  return `${rowId}:${field}`;
}

export function formatCellValue(value: BrunoTableCellValue): string {
  if (typeof value === "bigint") return new Intl.NumberFormat("en-GB").format(value);
  if (typeof value === "number") {
    return new Intl.NumberFormat("en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
  return value;
}
