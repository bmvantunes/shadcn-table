import { ViewServerId, defineViewServerConfig } from "effect-view-server/config";
import { createViewServerReact } from "effect-view-server/react";
import { SourceAdapter } from "effect-view-server/source-adapter";
import { Schema } from "effect";

const RoutedOrder = Schema.Struct({
  id: ViewServerId,
  region: Schema.String,
  desk: Schema.String,
  price: Schema.Number,
});

const sourceAdapter = SourceAdapter.make({
  identity: { name: "bruno-table-route-contract" },
  failure: Schema.Never,
  materialized: undefined,
  leased: {
    metrics: Schema.Struct({ observed: Schema.BigInt }),
    rejectionLocation: Schema.Struct({ offset: Schema.BigInt }),
    definitionOptions: SourceAdapter.definitionOptions<undefined>(),
  },
});

const routedConfig = defineViewServerConfig({
  topics: {
    routedOrders: {
      schema: RoutedOrder,
      source: sourceAdapter.leasedSource(["region", "desk"], undefined),
    },
  },
});

const routedReact = createViewServerReact(routedConfig);

// This function is never executed. The ordinary package check proves that the
// source-owned route tuple requires all and only its exact row fields.
export function proveRouteByContract(): void {
  const viewport = routedReact.useLiveQueryViewport("routedOrders").viewport;
  const sink = { setRowCount: () => undefined, setRowData: () => undefined };

  viewport.replace({
    window: { firstRow: 0, lastRow: 19 },
    query: {
      routeBy: { region: "eu", desk: "Delta" },
      select: ["id", "price"],
      where: [],
      orderBy: [{ field: "price", direction: "desc" }],
    },
    sink,
  });

  viewport.replace({
    window: { firstRow: 0, lastRow: 19 },
    // @ts-expect-error leased viewport queries require the complete source-owned route.
    query: { routeBy: { region: "eu" }, select: ["id"], where: [], orderBy: [] },
    sink,
  });

  viewport.replace({
    window: { firstRow: 0, lastRow: 19 },
    // @ts-expect-error leased viewport routes reject extra keys.
    query: {
      routeBy: { region: "eu", desk: "Delta", tenant: "extra" },
      select: ["id"],
      where: [],
      orderBy: [],
    },
    sink,
  });
}
