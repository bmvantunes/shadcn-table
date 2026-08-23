import { afterEach, expect, test } from "vite-plus/test";
import { cleanup, render } from "vitest-browser-react";
import { Schema } from "effect";
import { ViewServerId, defineViewServerConfig } from "effect-view-server/config";
import { createViewServerReact } from "effect-view-server/react";

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
  "destroy" | "replace"
> &
  Readonly<{
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
  },
] satisfies BrunoTableColumns<Row>;

afterEach(async () => cleanup());

test("renders authoritative sparse slots from the emitted Server package", async () => {
  let sink: EmittedSink | undefined;
  const viewport: EmittedBrowserViewport = {
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
