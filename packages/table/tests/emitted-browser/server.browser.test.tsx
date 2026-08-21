import { afterEach, expect, test } from "vite-plus/test";
import { cleanup, render } from "vitest-browser-react";

import { BrunoTableServer } from "../../dist/index.mjs";
import type { BrunoTableColumns } from "../../dist/index.mjs";

type Row = Readonly<{ symbol: string }>;

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
  let sink:
    | Readonly<{
        readonly setRowCount: (count: number, keepRenderedRows?: boolean) => void;
        readonly setRowData: (
          rows: Readonly<Record<number, Row>>,
          keys: Readonly<Record<number, string>>,
        ) => void;
      }>
    | undefined;
  const viewport = {
    replace(request: Readonly<{ readonly sink: NonNullable<typeof sink> }>) {
      sink = request.sink;
      sink.setRowCount(1_000, true);
      return { setWindow: () => undefined, release: () => undefined };
    },
  };
  const screen = await render(
    <BrunoTableServer<Row, typeof columns>
      tableId="TABLE_ID_EMITTED_SERVER"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_EMITTED_SERVER_SYMBOL", direction: "asc" }]}
      viewportSource={{ viewport, totalRows: 1_000, version: 1, status: "ready" }}
    />,
  );
  sink?.setRowData({ 0: { symbol: "EMITTED" } }, { 0: "emitted-row" });
  await expect.element(screen.getByRole("gridcell", { name: "EMITTED" })).toBeInTheDocument();
  await expect
    .element(screen.getByRole("grid", { name: "Data for TABLE_ID_EMITTED_SERVER" }))
    .toHaveAttribute("aria-rowcount", "1001");
});
