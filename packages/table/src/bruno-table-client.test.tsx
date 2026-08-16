import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BrunoTableClient } from "./bruno-table-client";
import { installBrunoTableClientRowOrderPlanningListener } from "./internal/render-instrumentation";

describe("BrunoTableClient server rendering", () => {
  it.each([undefined, null, 42, ""])(
    "rejects malformed table identity %j before constructing the table",
    (tableId) => {
      const rows = [{ id: "ada", name: "Ada" }] as const;
      const columns = [
        {
          columnId: "COL_ID_NAME",
          field: "name",
          headerName: "Name",
          valueType: "text",
        },
      ] as const;

      expect(() =>
        renderToStaticMarkup(
          <BrunoTableClient
            tableId={tableId as string}
            getRowId={(row) => row.id}
            columns={columns}
            clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
            initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
          />,
        ),
      ).toThrowError("BrunoTable tableId must be a non-empty string.");
    },
  );

  it("rejects an over-budget initial filter instead of silently broadening the result", () => {
    const rows = [{ id: "ada", name: "Ada" }] as const;
    const columns = [
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ] as const;
    const leaf = Object.freeze({ columnId: "COL_ID_NAME", filter: "Ada", type: "equals" });
    const initialFilters = [
      { conditions: Array.from({ length: 16_385 }, () => leaf), type: "AND" },
    ];

    expect(() =>
      renderToStaticMarkup(
        <BrunoTableClient
          tableId="TABLE_ID_FILTER_BUDGET"
          getRowId={(row) => row.id}
          columns={columns}
          clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
          initialFilters={initialFilters as never}
          initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        />,
      ),
    ).toThrowError(
      "BrunoTable initialFilters may contain at most 16384 nodes, 16384 operands, 1048576 UTF-16 text units, and nesting depth 64.",
    );
  });

  it("rejects an over-budget aggregate in operand at the public construction boundary", () => {
    const rows = [{ id: "ada", score: 1 }] as const;
    const columns = [
      {
        columnId: "COL_ID_SCORE",
        field: "score",
        headerName: "Score",
        valueType: "number",
      },
    ] as const;

    expect(() =>
      renderToStaticMarkup(
        <BrunoTableClient
          tableId="TABLE_ID_FILTER_OPERAND_BUDGET"
          getRowId={(row) => row.id}
          columns={columns}
          clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
          initialFilters={
            [
              {
                columnId: "COL_ID_SCORE",
                filter: Array.from({ length: 16_385 }, (_, index) => index),
                type: "in",
              },
            ] as never
          }
          initialOrderBy={[{ columnId: "COL_ID_SCORE", direction: "asc" }]}
        />,
      ),
    ).toThrowError(
      "BrunoTable initialFilters may contain at most 16384 nodes, 16384 operands, 1048576 UTF-16 text units, and nesting depth 64.",
    );
  });

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
