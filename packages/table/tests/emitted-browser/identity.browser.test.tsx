import { afterEach, expect, test, vi } from "vite-plus/test";
import { cleanup, render } from "vitest-browser-react";

import { BrunoTableClient } from "../../dist/index.mjs";

type Row = Readonly<{ id: string; name: string; score: number }>;

const source = Object.freeze({
  rows: Object.freeze([{ id: "row", name: "Ada", score: 1 }]) satisfies readonly Row[],
  totalRows: 1,
  version: 1,
  status: "ready" as const,
});

afterEach(() => cleanup());

test("reports incompatible Table Identity reuse from the emitted browser runtime", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const firstColumns = [
    {
      columnId: "COL_ID_VALUE",
      field: "name",
      headerName: "Name",
      valueType: "text",
    },
  ] as const;
  const incompatibleColumns = [
    {
      columnId: "COL_ID_VALUE",
      field: "score",
      headerName: "Score",
      valueType: "number",
    },
  ] as const;
  const screen = await render(
    <>
      <BrunoTableClient
        tableId="TABLE_ID_EMITTED_CONFLICT"
        getRowId={(row: Row) => row.id}
        columns={firstColumns}
        initialOrderBy={[{ columnId: "COL_ID_VALUE", direction: "asc" }]}
        clientSource={source}
      />
      <BrunoTableClient
        tableId="TABLE_ID_EMITTED_CONFLICT"
        getRowId={(row: Row) => row.id}
        columns={incompatibleColumns}
        initialOrderBy={[{ columnId: "COL_ID_VALUE", direction: "asc" }]}
        clientSource={source}
      />
    </>,
  );

  await vi.waitFor(() => expect(consoleError).toHaveBeenCalledOnce());
  expect(consoleError).toHaveBeenCalledWith(
    expect.stringContaining('simultaneous use of tableId "TABLE_ID_EMITTED_CONFLICT"'),
  );
  expect(
    screen.getByRole("grid", { name: "Data for TABLE_ID_EMITTED_CONFLICT" }).all(),
  ).toHaveLength(2);
});
