import type { Where } from "effect-view-server/config/query";

import { ORDER_STATUSES, type Order, type OrderRegion, type OrderStatus } from "./view-server";

export type StatusSetIntent =
  | {
      readonly mode: "all-except";
      readonly excluded: ReadonlyArray<OrderStatus>;
    }
  | {
      readonly mode: "only";
      readonly included: ReadonlyArray<OrderStatus>;
    };

export interface FilterModel {
  readonly externalRegion: "all" | OrderRegion;
  readonly minimumPrice: number | null;
  readonly quickFilter: string;
  readonly status: StatusSetIntent;
  readonly symbolContains: string;
}

export const initialFilterModel: FilterModel = {
  externalRegion: "all",
  minimumPrice: null,
  quickFilter: "",
  status: { mode: "all-except", excluded: [] },
  symbolContains: "",
};

function asNonEmpty<T>(values: ReadonlyArray<T>): readonly [T, ...Array<T>] | null {
  const first = values[0];
  return first === undefined ? null : [first, ...values.slice(1)];
}

function statusCondition(intent: StatusSetIntent): Where<Order>[number] | null {
  if (intent.mode === "all-except") {
    const excluded = asNonEmpty(intent.excluded);
    return excluded === null
      ? null
      : {
          type: "NOT",
          condition: { field: "status", type: "in", filter: excluded },
        };
  }

  const included = asNonEmpty(intent.included);
  if (included !== null) {
    return { field: "status", type: "in", filter: included };
  }

  return {
    type: "NOT",
    condition: {
      field: "status",
      type: "in",
      filter: [...ORDER_STATUSES],
    },
  };
}

export function compileWhere(
  filters: FilterModel,
  options: { readonly excludeStatus?: boolean } = {},
): Where<Order> {
  const where: Array<Where<Order>[number]> = [];

  if (filters.externalRegion !== "all") {
    where.push({ field: "region", type: "equals", filter: filters.externalRegion });
  }

  if (filters.minimumPrice !== null) {
    where.push({
      field: "price",
      type: "greaterThanOrEqual",
      filter: filters.minimumPrice,
    });
  }

  const symbolContains = filters.symbolContains.trim();
  if (symbolContains !== "") {
    where.push({ field: "symbol", type: "contains", filter: symbolContains });
  }

  const quickFilter = filters.quickFilter.trim();
  if (quickFilter !== "") {
    where.push({
      type: "OR",
      conditions: [
        { field: "symbol", type: "contains", filter: quickFilter },
        { field: "desk", type: "contains", filter: quickFilter },
      ],
    });
  }

  if (!options.excludeStatus) {
    const status = statusCondition(filters.status);
    if (status !== null) where.push(status);
  }

  return where;
}

export function isStatusSelected(intent: StatusSetIntent, status: OrderStatus): boolean {
  return intent.mode === "all-except"
    ? !intent.excluded.includes(status)
    : intent.included.includes(status);
}

export function toggleStatus(intent: StatusSetIntent, status: OrderStatus): StatusSetIntent {
  if (intent.mode === "all-except") {
    if (intent.excluded.includes(status)) {
      return {
        mode: "all-except",
        excluded: intent.excluded.filter((candidate) => candidate !== status),
      };
    }
    return { mode: "all-except", excluded: [...intent.excluded, status] };
  }

  const included = intent.included.includes(status)
    ? intent.included.filter((candidate) => candidate !== status)
    : [...intent.included, status];

  return included.length === ORDER_STATUSES.length
    ? { mode: "all-except", excluded: [] }
    : { mode: "only", included };
}
