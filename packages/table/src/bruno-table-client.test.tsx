import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BrunoTableClient } from "./bruno-table-client";
import { installBrunoTableClientRowOrderPlanningListener } from "./internal/render-instrumentation";

describe("BrunoTableClient server rendering", () => {
  it("renders the initial sorted rows without waiting for effects", () => {
    const rows = [
      { id: "ada", name: "Ada", score: 4 },
      { id: "grace", name: "Grace", score: 2 },
    ] as const;
    const columns = [
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
      {
        columnId: "COL_ID_SCORE",
        field: "score",
        headerName: "Score",
        valueType: "number",
      },
    ] as const;

    const rowOrderPlans = vi.fn();
    const removePlanningListener = installBrunoTableClientRowOrderPlanningListener(rowOrderPlans);
    try {
      const html = renderToStaticMarkup(
        <BrunoTableClient
          tableId="TABLE_ID_SERVER_RENDER"
          getRowId={(row) => row.id}
          columns={columns}
          clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
          initialOrderBy={[{ columnId: "COL_ID_SCORE", direction: "asc" }]}
        />,
      );

      expect(html).toContain("Grace");
      expect(html).toContain("Ada");
      expect(html.indexOf("Grace")).toBeLessThan(html.indexOf("Ada"));
      expect(rowOrderPlans).not.toHaveBeenCalled();
    } finally {
      removePlanningListener();
    }
  });

  it("keeps custom renderer controls inert before hydration", () => {
    const rows = [{ id: "ada", name: "Ada" }] as const;
    const columns = [
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
        cellRenderer: ({ value }: { readonly value: string }) => <button>{value}</button>,
      },
    ] as const;

    const html = renderToStaticMarkup(
      <BrunoTableClient
        tableId="TABLE_ID_SERVER_RENDERER"
        getRowId={(row) => row.id}
        columns={columns}
        clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      />,
    );

    expect(html).toContain('inert=""');
    expect(html).toContain("<button>Ada</button>");
  });
});
