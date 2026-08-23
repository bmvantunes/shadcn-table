import { afterEach, expect, test } from "vite-plus/test";
import { userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { Effect, Schema } from "effect";
import { ViewServerId, defineViewServerConfig } from "effect-view-server/config";
import { createViewServerReact } from "effect-view-server/react";
import { createInMemoryViewServerReact } from "effect-view-server/react/testing";

import { BrunoTableServer } from "../../dist/index.mjs";
import type { BrunoTableColumns } from "../../dist/index.mjs";

type Row = Readonly<{ id: string; symbol: string }>;

const viewportConfig = defineViewServerConfig({
  topics: {
    orders: {
      schema: Schema.Struct({ id: ViewServerId, symbol: Schema.String }),
    },
  },
});
const viewportReact = createViewServerReact(viewportConfig);
type EmittedViewportSource = ReturnType<typeof viewportReact.useLiveQueryViewport>;
const completeRawSelect = Object.freeze([
  "id",
  "symbol",
]) as unknown as EmittedViewportSource["completeRawSelect"];
type EmittedSink = Readonly<{
  readonly setRowCount: (count: number, keepRenderedRows?: boolean) => void;
  readonly setRowData: (
    rows: Readonly<Record<number, Partial<Row>>>,
    keys: Readonly<Record<number, string>>,
  ) => void;
}>;
type EmittedBrowserViewport = Omit<
  ReturnType<typeof viewportReact.useLiveQueryViewport>["viewport"],
  "destroy" | "replace" | "semanticKey"
> &
  Readonly<{
    readonly semanticKey: (query: unknown) => unknown;
    readonly replace: (
      request: Readonly<{ readonly sink: EmittedSink }>,
    ) => Readonly<{ readonly setWindow: () => void; readonly release: () => void }>;
  }>;

const columns = [
  {
    columnId: "COL_ID_EMITTED_SERVER_SYMBOL",
    field: "symbol",
    headerName: "Symbol",
    valueType: "text",
    enableFilter: true,
    enableSetFilter: true,
  },
] satisfies BrunoTableColumns<Row>;

afterEach(async () => cleanup());

test("renders authoritative sparse slots from the emitted Server package", async () => {
  let sink: EmittedSink | undefined;
  const viewport: EmittedBrowserViewport = {
    semanticKey: (query) => JSON.stringify(query),
    replace(request: Readonly<{ readonly sink: NonNullable<typeof sink> }>) {
      sink = request.sink;
      sink.setRowCount(1_000, true);
      return { setWindow: () => undefined, release: () => undefined };
    },
  };
  const screen = await render(
    <BrunoTableServer
      tableId="TABLE_ID_EMITTED_SERVER"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_EMITTED_SERVER_SYMBOL", direction: "asc" }]}
      viewportSource={{
        viewport,
        useWholeResult: () => ({ rows: [], totalRows: 0, version: 1, status: "ready" }),
        completeRawSelect,
        totalRows: 1_000,
        version: 1,
        status: "ready",
      }}
    />,
  );
  sink?.setRowData({ 0: { symbol: "EMITTED" } }, { 0: "emitted-row" });
  await expect.element(screen.getByRole("gridcell", { name: "EMITTED" })).toBeInTheDocument();
  await expect
    .element(screen.getByRole("grid", { name: "Data for TABLE_ID_EMITTED_SERVER" }))
    .toHaveAttribute("aria-rowcount", "1001");
  expect(screen.getByRole("checkbox", { name: /Select (all )?rows?/ }).query()).toBeNull();
});

test("renders and releases a live whole-result facet from the emitted package", async () => {
  const inMemory = createInMemoryViewServerReact(viewportReact);
  await Effect.runPromise(
    inMemory.client.publishMany("orders", [
      { id: "emitted-facet-1", symbol: "AAA" },
      { id: "emitted-facet-2", symbol: "BBB" },
    ]),
  );

  function EmittedFacetTable() {
    const source = viewportReact.useLiveQueryViewport("orders");
    return (
      <BrunoTableServer
        tableId="TABLE_ID_EMITTED_SERVER_FACET"
        columns={columns}
        initialOrderBy={[{ columnId: "COL_ID_EMITTED_SERVER_SYMBOL", direction: "asc" }]}
        viewportSource={source}
      />
    );
  }

  try {
    const screen = await render(
      <inMemory.ViewServerInMemoryProvider>
        <EmittedFacetTable />
      </inMemory.ViewServerInMemoryProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Filter Symbol" }));
    const dialog = screen.getByRole("dialog", { name: "Filter Symbol" });
    await expect.element(dialog.getByRole("checkbox", { name: "Select AAA, 1" })).toBeVisible();

    await Effect.runPromise(
      inMemory.client.publish("orders", { id: "emitted-facet-3", symbol: "AAA" }),
    );
    await expect.element(dialog.getByRole("checkbox", { name: "Select AAA, 2" })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Filter Symbol" }));
    await expect.element(dialog).not.toBeInTheDocument();
    await expect
      .poll(
        async () =>
          (await Effect.runPromise(inMemory.client.health())).engine.topics.orders
            .activeSubscriptions,
      )
      .toBe(1);
  } finally {
    await Effect.runPromise(inMemory.close);
  }
});
