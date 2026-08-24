import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { BrunoTableServer } from "./bruno-table-server";
import type { BrunoTableColumns } from "./public-types";

type Row = Readonly<{ readonly desk: string; readonly price: number; readonly symbol: string }>;

const columns = [
  {
    columnId: "COL_ID_DESK",
    field: "desk",
    headerName: "Desk",
    valueType: "text",
    groupBy: true,
  },
  {
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Price",
    valueType: "number",
    aggFunc: "max",
  },
  {
    columnId: "COL_ID_SYMBOL",
    field: "symbol",
    headerName: "Symbol",
    valueType: "text",
  },
] as const satisfies BrunoTableColumns<Row>;

type ServerRenderTestProps = Readonly<{
  tableId: string;
  columns: readonly unknown[];
  initialOrderBy: readonly unknown[];
  initialPersistedState: unknown;
  viewportSource: unknown;
}>;

const ServerRenderTestTable = BrunoTableServer as unknown as (
  props: ServerRenderTestProps,
) => ReactNode;

describe("BrunoTableServer server rendering", () => {
  it("installs restored grouped presentation before rendering without replacing the source", () => {
    const replace = vi.fn(() => {
      throw new Error("Server rendering must not start a viewport generation.");
    });
    const tableId = "TABLE_ID_SERVER_SSR_GROUPING";
    const markup = renderToStaticMarkup(
      <ServerRenderTestTable
        tableId={tableId}
        columns={columns}
        initialOrderBy={[{ columnId: "COL_ID_DESK", direction: "asc" }]}
        initialPersistedState={{
          version: 1,
          tableId,
          filters: [],
          orderBy: [{ columnId: "COL_ID_DESK", direction: "asc" }],
          groupBy: ["COL_ID_DESK"],
          groupOrderBy: [{ columnId: "COL_ID_DESK", direction: "asc" }],
          columnOrder: ["COL_ID_SYMBOL", "COL_ID_PRICE", "COL_ID_DESK"],
          columnVisibility: {},
          columnWidths: { COL_ID_DESK: 211, COL_ID_PRICE: 277 },
          columnPinning: { start: [], end: [] },
        }}
        viewportSource={{
          viewport: {
            semanticKey: (query: unknown) => query,
            replace,
          },
          useWholeResult: () => ({
            rows: [],
            totalRows: 0,
            version: 1,
            status: "ready" as const,
          }),
          completeRawSelect: ["desk", "price", "symbol"],
          totalRows: 1,
          version: 1,
          status: "ready" as const,
        }}
      />,
    );

    expect(replace).not.toHaveBeenCalled();
    expect(markup).toContain('aria-label="Loading Desk"');
    expect(markup).toContain('aria-label="Loading Rows"');
    expect(markup).toContain('aria-label="Loading Price"');
    expect(markup).not.toContain('aria-label="Loading Symbol"');
    expect(markup).toContain("--bruno-table-column-width-_43_4f_4c_5f_49_44_5f_44_45_53_4b, 211px");
    expect(markup).toContain(
      "--bruno-table-column-width-_43_4f_4c_5f_49_44_5f_50_52_49_43_45, 277px",
    );
  });
});
