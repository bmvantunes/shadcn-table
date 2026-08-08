import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { cleanup, render } from "vitest-browser-react";
import { useEffect } from "react";

import { BrunoTableClient, BrunoTableToolbar } from "./index";

type Row = {
  readonly id: string;
  readonly name: string;
  readonly score: number;
};

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

const rows = [
  { id: "ada", name: "Ada", score: 4 },
  { id: "grace", name: "Grace", score: 2 },
] satisfies readonly Row[];

const readySource = (nextRows: readonly Row[] = rows) => ({
  rows: nextRows,
  totalRows: nextRows.length,
  version: 1,
  status: "ready" as const,
});

const props = {
  tableId: "TABLE_ID_PEOPLE",
  getRowId: (row: Row) => row.id,
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SCORE", direction: "asc" as const }],
} as const;

const wideColumns = [
  {
    columnId: "COL_ID_WIDE_01",
    field: "name",
    headerName: "Wide 01",
    valueType: "text",
    width: 160,
  },
  {
    columnId: "COL_ID_WIDE_02",
    field: "name",
    headerName: "Wide 02",
    valueType: "text",
    width: 160,
  },
  {
    columnId: "COL_ID_WIDE_03",
    field: "name",
    headerName: "Wide 03",
    valueType: "text",
    width: 160,
  },
  {
    columnId: "COL_ID_WIDE_04",
    field: "name",
    headerName: "Wide 04",
    valueType: "text",
    width: 160,
  },
  {
    columnId: "COL_ID_WIDE_05",
    field: "name",
    headerName: "Wide 05",
    valueType: "text",
    width: 160,
  },
  {
    columnId: "COL_ID_WIDE_06",
    field: "name",
    headerName: "Wide 06",
    valueType: "text",
    width: 160,
  },
  {
    columnId: "COL_ID_WIDE_07",
    field: "name",
    headerName: "Wide 07",
    valueType: "text",
    width: 160,
  },
  {
    columnId: "COL_ID_WIDE_08",
    field: "name",
    headerName: "Wide 08",
    valueType: "text",
    width: 160,
  },
  {
    columnId: "COL_ID_WIDE_09",
    field: "name",
    headerName: "Wide 09",
    valueType: "text",
    width: 160,
  },
  {
    columnId: "COL_ID_WIDE_10",
    field: "name",
    headerName: "Wide 10",
    valueType: "text",
    width: 160,
  },
  {
    columnId: "COL_ID_WIDE_11",
    field: "name",
    headerName: "Wide 11",
    valueType: "text",
    width: 160,
  },
  {
    columnId: "COL_ID_WIDE_12",
    field: "name",
    headerName: "Wide 12",
    valueType: "text",
    width: 160,
  },
] as const;

afterEach(async () => {
  await cleanup();
});

describe("BrunoTableClient browser surface", () => {
  test("renders typed headers, sorted rows, and a continuous non-paginated body", async () => {
    const screen = await render(<BrunoTableClient {...props} clientSource={readySource()} />);

    await expect
      .element(screen.getByRole("region", { name: "TABLE_ID_PEOPLE", exact: true }))
      .toBeInTheDocument();
    await expect.element(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    await expect.element(screen.getByRole("columnheader", { name: "Score" })).toBeInTheDocument();
    await expect
      .element(screen.getByRole("row").nth(1).getByRole("gridcell").nth(0))
      .toHaveTextContent("Grace");
    await expect
      .element(screen.getByRole("row").nth(2).getByRole("gridcell").nth(0))
      .toHaveTextContent("Ada");
    await expect.element(screen.getByRole("button", { name: "Next page" })).not.toBeInTheDocument();

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={readySource([
          { id: "ada", name: "Ada", score: 4 },
          { id: "grace", name: "Grace", score: 10 },
        ])}
      />,
    );
    await expect
      .element(screen.getByRole("row").nth(1).getByRole("gridcell").nth(0))
      .toHaveTextContent("Ada");
  });

  test("keeps the canonical row identity tie-break ascending under descending sorts", async () => {
    const tiedRows = [
      { id: "z-row", name: "Zulu", score: 4 },
      { id: "a-row", name: "Alpha", score: 4 },
    ] satisfies readonly Row[];
    const screen = await render(
      <BrunoTableClient
        {...props}
        initialOrderBy={[{ columnId: "COL_ID_SCORE", direction: "desc" }]}
        clientSource={readySource(tiedRows)}
      />,
    );

    await expect
      .element(screen.getByRole("row").nth(1).getByRole("gridcell").nth(0))
      .toHaveTextContent("Alpha");
  });

  test("renders loading skeletons and rejects an incomplete ready source visibly", async () => {
    const screen = await render(
      <BrunoTableClient
        {...props}
        clientSource={{ rows: [], totalRows: 3, version: 1, status: "loading" }}
      />,
    );
    await expect
      .element(screen.getByRole("grid", { name: "Loading table rows" }))
      .toBeInTheDocument();
    await expect.element(screen.getByRole("row").nth(2)).toBeInTheDocument();

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={{ rows: [rows[0]!], totalRows: 2, version: 2, status: "ready" }}
      />,
    );
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Expected 2 rows but received 1");

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={{ rows: [], totalRows: 0, version: 3, status: "stale", message: "Delayed" }}
      />,
    );
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Live data delayed");
  });

  test("retains terminal rows and exposes only source-owned retry", async () => {
    const run = vi.fn();
    const screen = await render(
      <BrunoTableClient
        {...props}
        clientSource={{
          ...readySource(),
          status: "error",
          message: "Connection lost",
          retry: { run, pending: false },
        }}
      />,
    );

    await expect.element(screen.getByRole("alert")).toHaveTextContent("Connection lost");
    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).toBeInTheDocument();
    await screen.getByRole("button", { name: "Retry" }).click();
    expect(run).toHaveBeenCalledOnce();

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={{ ...readySource(), status: "stale", message: "Delayed" }}
      />,
    );
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Live data delayed");
    await expect.element(screen.getByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  test("retains prior coherent rows when a complete terminal publication is empty", async () => {
    const screen = await render(<BrunoTableClient {...props} clientSource={readySource()} />);

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={{
          rows: [],
          totalRows: 0,
          version: 2,
          status: "error",
          message: "Connection lost",
        }}
      />,
    );

    await expect.element(screen.getByRole("alert")).toHaveTextContent("Connection lost");
    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).toBeInTheDocument();
    await expect.element(screen.getByRole("gridcell", { name: "Grace" })).toBeInTheDocument();
  });

  test("retains coherent rows while a live source is stale", async () => {
    const screen = await render(<BrunoTableClient {...props} clientSource={readySource()} />);
    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).toBeInTheDocument();

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={{ ...readySource(), status: "stale", message: "Delayed" }}
      />,
    );
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Live data delayed");
    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).toBeInTheDocument();
  });

  test("retains coherent rows while rejecting an incomplete stale publication", async () => {
    const screen = await render(<BrunoTableClient {...props} clientSource={readySource()} />);

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={{
          rows: [rows[0]!],
          totalRows: 2,
          version: 2,
          status: "stale",
          message: "Partial delivery",
        }}
      />,
    );

    await expect.element(screen.getByRole("alert")).toHaveTextContent("Expected 2 rows");
    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).toBeInTheDocument();
    await expect.element(screen.getByRole("gridcell", { name: "Grace" })).toBeInTheDocument();
  });

  test("applies the typed initial filter without changing source identity", async () => {
    const screen = await render(
      <BrunoTableClient
        {...props}
        initialFilters={[
          {
            type: "OR",
            conditions: [
              {
                columnId: "COL_ID_NAME",
                type: "equals",
                filter: "ada",
                caseSensitive: false,
              },
              { columnId: "COL_ID_NAME", type: "startsWith", filter: "Z" },
            ],
          },
        ]}
        clientSource={readySource()}
      />,
    );

    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).toBeInTheDocument();
    await expect.element(screen.getByRole("gridcell", { name: "Grace" })).not.toBeInTheDocument();
  });

  test("updates an empty terminal message through the body subscription", async () => {
    const screen = await render(
      <BrunoTableClient
        {...props}
        clientSource={{ rows: [], totalRows: 0, version: 1, status: "error", message: "First" }}
      />,
    );
    await expect.element(screen.getByRole("alert")).toHaveTextContent("First");

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={{ rows: [], totalRows: 0, version: 2, status: "error", message: "Second" }}
      />,
    );
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Second");
  });

  test("keeps closed rows visible and exposes the explicit closed-source retry", async () => {
    const run = vi.fn();
    const screen = await render(
      <BrunoTableClient
        {...props}
        clientSource={{
          ...readySource(),
          status: "closed",
          retry: { run, pending: false },
        }}
      />,
    );

    await expect.element(screen.getByRole("alert")).toHaveTextContent("Live updates stopped");
    await screen.getByRole("button", { name: "Retry" }).click();
    expect(run).toHaveBeenCalledOnce();
    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).toBeInTheDocument();
  });

  test("disables source-owned Retry and exposes pending progress", async () => {
    const run = vi.fn();
    const screen = await render(
      <BrunoTableClient
        {...props}
        clientSource={{
          ...readySource(),
          status: "error",
          retry: { run, pending: true },
        }}
      />,
    );

    await expect.element(screen.getByRole("button", { name: "Retry" })).toBeDisabled();
    await expect.element(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });

  test("bounds mounted rows for a large resident source", async () => {
    const largeRows = Array.from({ length: 100 }, (_, index) => ({
      id: `row-${index}`,
      name: `Row ${index}`,
      score: index,
    })) satisfies readonly Row[];
    const screen = await render(
      <BrunoTableClient {...props} clientSource={readySource(largeRows)} />,
    );

    await expect.element(screen.getByRole("gridcell", { name: "Row 0" })).toBeInTheDocument();
    expect(screen.getByRole("row").all().length).toBeLessThan(30);
  });

  test("bounds mounted centre columns for a wide resident source", async () => {
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_WIDE"
        getRowId={(row: Row) => row.id}
        columns={wideColumns}
        initialOrderBy={[{ columnId: "COL_ID_WIDE_01", direction: "asc" as const }]}
        clientSource={readySource()}
      />,
    );

    await expect.element(screen.getByRole("columnheader", { name: "Wide 01" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader").all().length).toBeLessThan(wideColumns.length);
  });

  test("virtualizes both axes after scrolling while pinned columns remain mounted", async () => {
    const manyRows = Array.from({ length: 100 }, (_, index) => ({
      id: `row-${index}`,
      name: `Row ${index}`,
      score: index,
    })) satisfies readonly Row[];
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_SCROLL"
        getRowId={(row: Row) => row.id}
        columns={
          [
            { ...wideColumns[0], columnId: "COL_ID_SCROLL_START", pinned: "start" },
            ...wideColumns.slice(1),
            {
              ...wideColumns[0],
              columnId: "COL_ID_SCROLL_END",
              headerName: "Scroll end",
              pinned: "end",
            },
          ] as const
        }
        initialOrderBy={[{ columnId: "COL_ID_SCROLL_START", direction: "asc" as const }]}
        clientSource={{ rows: manyRows, totalRows: manyRows.length, version: 1, status: "ready" }}
      />,
    );
    const region = screen.getByRole("grid", { name: "Data for TABLE_ID_SCROLL" });
    await expect
      .element(screen.getByRole("gridcell", { name: "Row 0" }).nth(0))
      .toBeInTheDocument();
    const initialRows = screen.getByRole("row").all().length;

    await region.wheel({ delta: { y: 1200 } });
    await expect
      .element(screen.getByRole("gridcell", { name: "Row 40" }).nth(0))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Row 0" }).nth(0))
      .toHaveAttribute("aria-colindex", "1");
    expect(screen.getByRole("row").all().length).toBeLessThan(initialRows + 24);

    await region.wheel({ delta: { x: 1200 } });
    await expect
      .element(screen.getByRole("columnheader", { name: "Scroll end" }))
      .toBeInTheDocument();
    expect(screen.getByRole("columnheader").all().length).toBeLessThan(wideColumns.length + 2);
  });

  test("keeps pinned columns in separate continuously mounted regions", async () => {
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_PINNED"
        getRowId={(row: Row) => row.id}
        columns={
          [
            { ...columns[0], columnId: "COL_ID_PINNED_START", pinned: "start" },
            columns[1],
            {
              ...columns[0],
              columnId: "COL_ID_PINNED_END",
              headerName: "Pinned end",
              pinned: "end",
            },
          ] as const
        }
        initialOrderBy={[{ columnId: "COL_ID_SCORE", direction: "asc" as const }]}
        clientSource={readySource()}
      />,
    );

    await expect
      .element(screen.getByRole("columnheader", { name: "Pinned end" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("grid", { name: "Data for TABLE_ID_PINNED" }))
      .toBeInTheDocument();
    const gridBounds = screen
      .getByRole("grid", { name: "Data for TABLE_ID_PINNED" })
      .element()
      .getBoundingClientRect();
    const endBounds = screen
      .getByRole("columnheader", { name: "Pinned end" })
      .element()
      .getBoundingClientRect();
    expect(Math.abs(gridBounds.right - endBounds.right)).toBeLessThanOrEqual(2);
  });

  test("keeps pinned custom renderers semantic and interactive", async () => {
    const activate = vi.fn();
    const interactiveColumns = [
      columns[1],
      {
        ...columns[0],
        columnId: "COL_ID_ACTION",
        headerName: "Action",
        pinned: "end" as const,
        cellRenderer: ({ row }: { readonly row: Row }) => (
          <button type="button" onClick={() => activate(row.id)}>
            Open {row.name}
          </button>
        ),
      },
    ] as const;
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_ACTIONS"
        getRowId={(row: Row) => row.id}
        columns={interactiveColumns}
        initialOrderBy={[{ columnId: "COL_ID_SCORE", direction: "asc" }]}
        clientSource={readySource()}
      />,
    );

    await screen.getByRole("button", { name: "Open Grace" }).click();
    expect(activate).toHaveBeenCalledWith("grace");
    await expect.element(screen.getByRole("columnheader", { name: "Action" })).toBeInTheDocument();
  });

  test("moves one logical active cell across the body with arrow keys", async () => {
    const screen = await render(<BrunoTableClient {...props} clientSource={readySource()} />);
    const region = screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" });
    region.element().focus();
    const firstActiveId = region.element().getAttribute("aria-activedescendant");
    expect(firstActiveId).toContain("TABLE_ID_PEOPLE-grace-COL_ID_NAME");

    region
      .element()
      .dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    await vi.waitFor(() => {
      expect(region.element().getAttribute("aria-activedescendant")).toContain(
        "TABLE_ID_PEOPLE-grace-COL_ID_SCORE",
      );
    });
    region
      .element()
      .dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    await vi.waitFor(() => {
      expect(region.element().getAttribute("aria-activedescendant")).toContain(
        "TABLE_ID_PEOPLE-ada-COL_ID_SCORE",
      );
    });
  });

  test("scopes active descendants to each mounted table instance", async () => {
    const screen = await render(
      <>
        <BrunoTableClient {...props} clientSource={readySource()} />
        <BrunoTableClient {...props} clientSource={readySource()} />
      </>,
    );
    const grids = screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" }).all();
    expect(grids).toHaveLength(2);
    const firstId = grids[0]!.element().getAttribute("aria-activedescendant");
    const secondId = grids[1]!.element().getAttribute("aria-activedescendant");
    expect(firstId).not.toBe(secondId);
  });

  test("preserves complete active-cell semantics after virtualization unmounts it", async () => {
    const largeRows = Array.from({ length: 100 }, (_, index) => ({
      id: `row-${index}`,
      name: `Row ${index}`,
      score: index,
    })) satisfies readonly Row[];
    const screen = await render(
      <BrunoTableClient {...props} clientSource={readySource(largeRows)} />,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" });
    grid.element().focus();

    await grid.wheel({ delta: { y: 1200 } });

    const proxyCell = screen.getByRole("gridcell", { name: "Row 0" });
    await expect.element(proxyCell).toHaveAttribute("aria-colindex", "1");
    expect(proxyCell.element().parentElement?.getAttribute("aria-rowindex")).toBe("2");
  });

  test("updates live sort and filter state through accessible header commands", async () => {
    const screen = await render(
      <BrunoTableClient
        {...props}
        initialFilters={[{ columnId: "COL_ID_NAME", type: "equals", filter: "Ada" }]}
        clientSource={readySource()}
      />,
    );
    await expect.element(screen.getByRole("gridcell", { name: "Grace" })).not.toBeInTheDocument();

    await screen.getByRole("button", { name: "Clear filter for Name" }).click();
    await expect.element(screen.getByRole("gridcell", { name: "Grace" })).toBeInTheDocument();
    await screen.getByRole("button", { name: "Reset filter for Name" }).click();
    await expect.element(screen.getByRole("gridcell", { name: "Grace" })).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Clear filter for Name" }).click();

    await screen
      .getByRole("button", { name: "Sort by Score, currently ascending, priority 1" })
      .click();
    await expect
      .element(screen.getByRole("row").nth(1).getByRole("gridcell").nth(0))
      .toHaveTextContent("Ada");
    await expect
      .element(screen.getByRole("columnheader", { name: "Score" }))
      .toHaveAttribute("aria-sort", "descending");
  });

  test("resets vertical projection only for query commands, not live row publications", async () => {
    const largeRows = Array.from({ length: 100 }, (_, index) => ({
      id: `row-${index}`,
      name: `Row ${index}`,
      score: index,
    })) satisfies readonly Row[];
    const screen = await render(
      <BrunoTableClient {...props} clientSource={readySource(largeRows)} />,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" });

    await grid.wheel({ delta: { y: 1200 } });
    await vi.waitFor(() => expect(grid.element().scrollTop).toBeGreaterThan(0));
    const scrollBeforePublication = grid.element().scrollTop;
    const nextRows = largeRows.map((row) =>
      row.id === "row-50" ? { ...row, name: "Updated row 50" } : row,
    );
    await screen.rerender(<BrunoTableClient {...props} clientSource={readySource(nextRows)} />);
    expect(grid.element().scrollTop).toBe(scrollBeforePublication);

    await screen
      .getByRole("button", { name: "Sort by Score, currently ascending, priority 1" })
      .click();
    await vi.waitFor(() => expect(grid.element().scrollTop).toBe(0));
    expect(grid.element().getAttribute("aria-activedescendant")).toContain(
      "TABLE_ID_PEOPLE-row-99-COL_ID_NAME",
    );
  });

  test("re-sanitizes filters and ordering after replacing the column definitions", async () => {
    const screen = await render(
      <BrunoTableClient
        {...props}
        initialFilters={[{ columnId: "COL_ID_NAME", type: "equals", filter: "Grace" }]}
        clientSource={readySource()}
      />,
    );
    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).not.toBeInTheDocument();

    const aliasColumns = [
      {
        columnId: "COL_ID_ALIAS",
        field: "name",
        headerName: "Alias",
        valueType: "text",
      },
    ] as const;
    await screen.rerender(
      <BrunoTableClient
        tableId="TABLE_ID_PEOPLE"
        getRowId={(row: Row) => row.id}
        columns={aliasColumns}
        initialOrderBy={[{ columnId: "COL_ID_ALIAS", direction: "asc" }]}
        clientSource={readySource()}
      />,
    );

    await expect.element(screen.getByRole("columnheader", { name: "Alias" })).toBeInTheDocument();
    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).toBeInTheDocument();
    await expect.element(screen.getByRole("gridcell", { name: "Grace" })).toBeInTheDocument();
  });

  test("preserves intentional null custom-renderer output", async () => {
    const nullColumns = [
      {
        ...columns[0],
        cellRenderer: () => null,
      },
    ] as const;
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_NULL_RENDERER"
        getRowId={(row: Row) => row.id}
        columns={nullColumns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource()}
      />,
    );

    await expect
      .element(screen.getByRole("row").nth(1).getByRole("gridcell"))
      .toHaveTextContent("");
    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).not.toBeInTheDocument();
  });

  test("does not mount an empty toolbar and isolates unchanged cell islands", async () => {
    const renderCounts = new Map<string, number>();
    const instrumentedColumns = [
      {
        ...columns[0],
        cellRenderer: ({ row }: { readonly row: Row }) => {
          renderCounts.set(row.id, (renderCounts.get(row.id) ?? 0) + 1);
          return row.name;
        },
      },
    ] as const;
    const instrumentedProps = {
      ...props,
      columns: instrumentedColumns,
      initialOrderBy: [{ columnId: "COL_ID_NAME", direction: "asc" as const }],
    } as const;
    const screen = await render(
      <BrunoTableClient {...instrumentedProps} clientSource={readySource()} />,
    );
    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).toBeInTheDocument();
    expect(renderCounts).toEqual(
      new Map([
        ["ada", 1],
        ["grace", 1],
      ]),
    );
    await expect
      .element(screen.getByRole("region", { name: "Table toolbar" }))
      .not.toBeInTheDocument();

    const nextRows = [rows[0]!, { ...rows[1]!, name: "Grace Hopper" }] satisfies readonly Row[];
    await screen.rerender(
      <BrunoTableClient {...instrumentedProps} clientSource={readySource(nextRows)} />,
    );
    await expect
      .element(screen.getByRole("gridcell", { name: "Grace Hopper" }))
      .toBeInTheDocument();
    expect(renderCounts).toEqual(
      new Map([
        ["ada", 1],
        ["grace", 2],
      ]),
    );
  });

  test("exposes non-empty toolbar children through the accessible toolbar region", async () => {
    const screen = await render(
      <BrunoTableClient {...props} clientSource={readySource()}>
        <button type="button">Refresh view</button>
      </BrunoTableClient>,
    );

    await expect.element(screen.getByRole("region", { name: "Table toolbar" })).toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Refresh view" })).toBeInTheDocument();
  });

  test("exports the toolbar primitive and isolates stable toolbar children from source renders", async () => {
    const toolbarCommits = vi.fn();
    function ToolbarProbe() {
      useEffect(() => {
        toolbarCommits();
      });
      return <button type="button">Stable command</button>;
    }
    const screen = await render(
      <BrunoTableClient {...props} clientSource={readySource()}>
        <BrunoTableToolbar>
          <ToolbarProbe />
        </BrunoTableToolbar>
      </BrunoTableClient>,
    );
    await expect
      .element(screen.getByRole("toolbar", { name: "Table controls" }))
      .toBeInTheDocument();
    expect(toolbarCommits).toHaveBeenCalledOnce();

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={readySource([rows[0]!, { ...rows[1]!, score: 9 }])}
      >
        <BrunoTableToolbar>
          <ToolbarProbe />
        </BrunoTableToolbar>
      </BrunoTableClient>,
    );
    await expect.element(screen.getByRole("gridcell", { name: "Grace" })).toBeInTheDocument();
    expect(toolbarCommits).toHaveBeenCalledOnce();
  });
});
