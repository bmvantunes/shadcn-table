import { ViewServerId, defineViewServerConfig } from "effect-view-server/config";
import { createViewServerReact } from "effect-view-server/react";
import { createInMemoryViewServerReact } from "effect-view-server/react/testing";
import { Effect, Schema } from "effect";

export const ORDER_STATUSES = ["open", "closed", "cancelled"] as const;
export const ORDER_REGIONS = ["eu", "us", "apac"] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type OrderRegion = (typeof ORDER_REGIONS)[number];

export const OrderSchema = Schema.Struct({
  id: ViewServerId,
  revision: Schema.Number,
  symbol: Schema.String,
  desk: Schema.String,
  status: Schema.Literals(ORDER_STATUSES),
  region: Schema.Literals(ORDER_REGIONS),
  price: Schema.Number,
  quantity: Schema.BigInt,
  updatedAt: Schema.Number,
});

export type Order = typeof OrderSchema.Type;

export const viewServer = defineViewServerConfig({
  topics: {
    orders: {
      schema: OrderSchema,
    },
  },
});

export const viewServerReact = createViewServerReact(viewServer);
export const { useLiveQuery, useLiveQueryViewport } = viewServerReact;

export const inMemoryViewServer = createInMemoryViewServerReact(viewServerReact);

const symbols = ["AAPL", "MSFT", "NVDA", "SAP", "BP", "VOD"] as const;
const desks = ["Alpha", "Delta", "Macro", "Rates"] as const;

export function makeOrder(index: number): Order {
  const ordinal = index + 1;
  return {
    id: `ORDER_${String(ordinal).padStart(5, "0")}`,
    revision: 1,
    symbol: symbols[index % symbols.length] ?? "AAPL",
    desk: desks[index % desks.length] ?? "Alpha",
    status: ORDER_STATUSES[index % ORDER_STATUSES.length] ?? "open",
    region: ORDER_REGIONS[Math.floor(index / ORDER_STATUSES.length) % ORDER_REGIONS.length] ?? "eu",
    price: 25 + (index % 90) * 2.5,
    quantity: BigInt(100 + index * 3),
    updatedAt: 1_800_000_000 + index,
  };
}

export async function seedOrders(count: number): Promise<void> {
  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      Effect.runPromise(inMemoryViewServer.client.publish("orders", makeOrder(index))),
    ),
  );
}

let liveOrderIndex = 10_000;

export async function publishLiveOrder(): Promise<Order> {
  const index = liveOrderIndex;
  liveOrderIndex += 1;
  const row: Order = {
    ...makeOrder(index),
    id: `LIVE_${String(index).padStart(5, "0")}`,
    revision: 1,
    price: 1_000 + index,
    updatedAt: 1_900_000_000 + index,
  };
  await Effect.runPromise(inMemoryViewServer.client.publish("orders", row));
  return row;
}
