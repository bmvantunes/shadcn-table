import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { cleanup, render } from "vitest-browser-react";
import { useEffect } from "react";

import { BrunoTableClient, BrunoTableToolbar } from "./index";
import type { BrunoTableColumns, BrunoTableValueType } from "./public-types";
import {
  BRUNO_TABLE_MAX_PHYSICAL_ROW_HEIGHT,
  BRUNO_TABLE_ROW_HEIGHT,
} from "./internal/virtual-viewport";
import {
  installBrunoTableClientGridSurfaceRenderListener,
  installBrunoTableClientViewRenderListener,
} from "./internal/render-instrumentation";
import {
  BrunoTableToolbarStore,
  BrunoTableView,
  type BrunoTableLogicalRowSpace,
  type BrunoTableRowPipelineProps,
} from "./internal/bruno-table-view";
import { compileColumns } from "./internal/compile-columns";
import {
  BrunoTableGridRuntime,
  type BrunoTableRowPipelineRuntimeView,
} from "./internal/grid-runtime";

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

type SparseRowPipelineAdapter = Readonly<{
  readonly rowSpace: BrunoTableLogicalRowSpace;
  readonly queryGeneration: number;
}>;

function SparseRowPipeline({
  children,
  rowPipelineAdapter,
}: BrunoTableRowPipelineProps<BrunoTableRowPipelineRuntimeView, SparseRowPipelineAdapter>) {
  return children({
    rowSpace: rowPipelineAdapter.rowSpace,
    queryGeneration: rowPipelineAdapter.queryGeneration,
  });
}

function TrackedRowAction({
  row,
  onMount,
  onUnmount,
}: {
  readonly row: Row;
  readonly onMount: (rowId: string) => void;
  readonly onUnmount: (rowId: string) => void;
}) {
  useEffect(() => {
    onMount(row.id);
    return () => onUnmount(row.id);
  }, [onMount, onUnmount, row.id]);
  return (
    <>
      <button disabled type="button">
        Unavailable {row.name}
      </button>
      <button type="button">Open {row.name}</button>
    </>
  );
}

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
  vi.restoreAllMocks();
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

  test("keeps narrow header and body cells on identical fixed column geometry", async () => {
    const screen = await render(<BrunoTableClient {...props} clientSource={readySource()} />);
    const header = screen.getByRole("columnheader", { name: "Name" }).element();
    const bodyCell = screen.getByRole("gridcell", { name: "Grace" }).element();
    const headerBounds = header.getBoundingClientRect();
    const bodyBounds = bodyCell.getBoundingClientRect();

    expect(Math.abs(headerBounds.left - bodyBounds.left)).toBeLessThanOrEqual(2);
    expect(Math.abs(headerBounds.width - bodyBounds.width)).toBeLessThanOrEqual(2);
    expect(header.closest("table")?.style.minWidth).toBe("");
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

  test("routes undefined and null sorting through BrunoTable value semantics", async () => {
    type OptionalRow = {
      readonly id: string;
      readonly name: string;
      readonly score?: number | null;
    };
    const optionalColumns = [
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
    const optionalRows = [
      { id: "z-undefined", name: "Undefined" },
      { id: "a-null", name: "Null", score: null },
      { id: "m-number", name: "Number", score: 1 },
    ] satisfies readonly OptionalRow[];
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_OPTIONAL"
        getRowId={(row: OptionalRow) => row.id}
        columns={optionalColumns}
        initialOrderBy={[{ columnId: "COL_ID_SCORE", direction: "asc" }]}
        clientSource={{
          rows: optionalRows,
          totalRows: optionalRows.length,
          version: 1,
          status: "ready",
        }}
      />,
    );

    await expect
      .element(screen.getByRole("row").nth(1).getByRole("gridcell").nth(0))
      .toHaveTextContent("Null");
    await expect
      .element(screen.getByRole("row").nth(2).getByRole("gridcell").nth(0))
      .toHaveTextContent("Undefined");
    await expect
      .element(screen.getByRole("row").nth(3).getByRole("gridcell").nth(0))
      .toHaveTextContent("Number");
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
        clientSource={{ rows: [], totalRows: 0, version: 2, status: "loading" }}
      />,
    );
    await expect
      .element(screen.getByRole("grid", { name: "Loading table rows" }))
      .toBeInTheDocument();

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={{ rows, totalRows: rows.length, version: 2, status: "loading" }}
      />,
    );
    await expect
      .element(screen.getByRole("grid", { name: "Loading table rows" }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByRole("gridcell", { name: "Grace" })).toBeInTheDocument();

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={{ rows: [rows[0]!], totalRows: 2, version: 3, status: "ready" }}
      />,
    );
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Expected 2 rows but received 1");

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={{ rows: [], totalRows: 0, version: 4, status: "stale", message: "Delayed" }}
      />,
    );
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Live data delayed");
  });

  test("presents invalid source values without letting semantic rendering throw", async () => {
    const invalidRows = [
      { id: "invalid", name: "Invalid", score: Number.NaN },
    ] satisfies readonly Row[];
    const screen = await render(
      <BrunoTableClient {...props} clientSource={readySource(invalidRows)} />,
    );

    await expect.element(screen.getByRole("alert")).toHaveTextContent("Invalid source value");
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Source row 1, column COL_ID_SCORE: Expected a finite number value.");
    await expect
      .element(screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" }))
      .not.toBeInTheDocument();
  });

  test("renders, sorts, and filters with canonical runtime-decoder values", async () => {
    const canonicalText: BrunoTableValueType<string, "text", "text"> = {
      codecId: "test/canonical-text",
      codecVersion: 1,
      filterFamily: "text",
      editorFamily: "text",
      cellAlign: "start",
      editorLayout: "inline",
      defaultWidth: 120,
      decodeRuntime: (input) =>
        typeof input === "string"
          ? { _tag: "Success", value: input.trim().toUpperCase() }
          : { _tag: "Failure", message: "Expected text." },
      equivalent: (left, right) => left === right,
      compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
      formatCanonicalText: (value) => value,
      parseCanonicalText: (text) => ({ _tag: "Success", value: text.trim().toUpperCase() }),
      formatDisplay: (value) => value,
      encodePersisted: (value) => value,
      decodePersisted: (input) =>
        typeof input === "string"
          ? { _tag: "Success", value: input.trim().toUpperCase() }
          : { _tag: "Failure", message: "Expected persisted text." },
    };
    const canonicalColumns = [
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: canonicalText,
      },
    ] as const satisfies BrunoTableColumns<Row>;
    const canonicalRows = [
      { id: "canonical-a", name: "a", score: 1 },
      { id: "canonical-b", name: "B", score: 2 },
    ] satisfies readonly Row[];
    const screen = await render(
      <>
        <BrunoTableClient
          tableId="TABLE_ID_CANONICAL_SORT"
          getRowId={(row: Row) => row.id}
          columns={canonicalColumns}
          initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
          clientSource={readySource(canonicalRows)}
        />
        <BrunoTableClient
          tableId="TABLE_ID_CANONICAL_FILTER"
          getRowId={(row: Row) => row.id}
          columns={canonicalColumns}
          initialFilters={[
            {
              columnId: "COL_ID_NAME",
              type: "contains",
              filter: " a ",
              caseSensitive: true,
            },
          ]}
          initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
          clientSource={readySource(canonicalRows)}
        />
      </>,
    );

    const sortGrid = screen.getByRole("grid", { name: "Data for TABLE_ID_CANONICAL_SORT" });
    await expect
      .element(sortGrid.getByRole("row").nth(1).getByRole("gridcell", { name: "A", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(sortGrid.getByRole("row").nth(2).getByRole("gridcell", { name: "B", exact: true }))
      .toBeInTheDocument();
    const filterGrid = screen.getByRole("grid", { name: "Data for TABLE_ID_CANONICAL_FILTER" });
    await expect
      .element(filterGrid.getByRole("gridcell", { name: "A", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(filterGrid.getByRole("gridcell", { name: "B", exact: true }))
      .not.toBeInTheDocument();
  });

  test("retains coherent rows for a terminal publication after rejecting ready data", async () => {
    const retry = vi.fn();
    const screen = await render(<BrunoTableClient {...props} clientSource={readySource()} />);

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={{
          rows: [{ id: "invalid", name: "Invalid", score: Number.NaN }],
          totalRows: 1,
          version: 2,
          status: "ready",
        }}
      />,
    );
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Invalid source value");

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={{
          rows: [],
          totalRows: 0,
          version: 3,
          status: "error",
          retry: { run: retry, pending: false },
        }}
      />,
    );
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Live data error");
    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).toBeInTheDocument();
    await screen.getByRole("button", { name: "Retry" }).click();
    expect(retry).toHaveBeenCalledOnce();
  });

  test("keeps terminal lifecycle and Retry authoritative for malformed terminal rows", async () => {
    const retry = vi.fn();
    const invalidRows = [
      { id: "invalid", name: "Invalid", score: Number.POSITIVE_INFINITY },
    ] satisfies readonly Row[];
    const screen = await render(
      <BrunoTableClient
        {...props}
        tableId="TABLE_ID_INVALID_TERMINAL"
        clientSource={{
          rows: invalidRows,
          totalRows: invalidRows.length,
          version: 1,
          status: "error",
          retry: { run: retry, pending: false },
        }}
      />,
    );

    await expect.element(screen.getByRole("alert")).toHaveTextContent("Live data error");
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Expected a finite number value.");
    await screen.getByRole("button", { name: "Retry" }).click();
    expect(retry).toHaveBeenCalledOnce();
  });

  test("renders and navigates a sparse row space while publishing required ranges", async () => {
    const compiledColumns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const setRequiredRange = vi.fn();
    const rowSpace: BrunoTableLogicalRowSpace = Object.freeze({
      totalRows: 100,
      getRowId: () => undefined,
      findRowIndex: () => undefined,
      setRequiredRange,
    });
    const runtime = new BrunoTableGridRuntime<never>(
      Object.freeze({
        status: "loading" as const,
        totalRows: 100,
        version: 1,
        rowSpace: Object.freeze({
          totalRows: 100,
          loadedRows: 0,
          getRowId: () => undefined,
          getRow: () => undefined,
          getCellValue: () => undefined,
        }),
        hasCoherentRows: false,
      }),
      compiledColumns,
      Object.freeze({
        baselineFilters: Object.freeze([]),
        baselineOrderBy: Object.freeze([
          Object.freeze({ columnId: "COL_ID_NAME", direction: "asc" as const }),
        ]),
      }),
    );
    const toolbar = new BrunoTableToolbarStore(undefined);
    const renderSparseTable = (adapter: SparseRowPipelineAdapter) => (
      <BrunoTableView
        runtime={runtime.getView()}
        tableId="TABLE_ID_SPARSE"
        compiledColumns={compiledColumns}
        toolbar={toolbar}
        rowPipeline={SparseRowPipeline}
        rowPipelineAdapter={adapter}
      />
    );
    const screen = await render(renderSparseTable({ rowSpace, queryGeneration: 0 }));
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SPARSE" });
    await expect.element(grid).toHaveAttribute("aria-rowcount", "101");
    await vi.waitFor(() => expect(setRequiredRange).toHaveBeenCalled());
    const loadingCells = screen.getByRole("gridcell", { name: "Loading row" }).all();
    expect(loadingCells.some((cell) => cell.element().parentElement?.style.height === "36px")).toBe(
      true,
    );

    grid.element().focus();
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).toContain(
        "bruno-table-loading-cell",
      ),
    );
    const firstActiveId = grid.element().getAttribute("aria-activedescendant");
    expect(
      screen
        .getByRole("gridcell", { name: "Loading row" })
        .all()
        .some((cell) => cell.element().id === firstActiveId),
    ).toBe(true);

    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).not.toBe(firstActiveId),
    );
    const secondActiveId = grid.element().getAttribute("aria-activedescendant");
    expect(
      screen
        .getByRole("gridcell", { name: "Loading row" })
        .all()
        .some((cell) => cell.element().id === secondActiveId),
    ).toBe(true);

    await grid.wheel({ delta: { y: 1200 } });
    await vi.waitFor(() =>
      expect(
        setRequiredRange.mock.calls.some(([start]) => typeof start === "number" && start > 0),
      ).toBe(true),
    );

    const replacementRequiredRange = vi.fn();
    const replacementRowSpace: BrunoTableLogicalRowSpace = Object.freeze({
      ...rowSpace,
      totalRows: 2,
      setRequiredRange: replacementRequiredRange,
    });
    await screen.rerender(renderSparseTable({ rowSpace: replacementRowSpace, queryGeneration: 1 }));
    await vi.waitFor(() => expect(replacementRequiredRange).toHaveBeenCalled());
    expect(replacementRequiredRange.mock.calls[0]?.[0]).toBe(0);
    expect(replacementRequiredRange.mock.calls.some(([start]) => start > 0)).toBe(false);
    expect(
      replacementRequiredRange.mock.calls.every(([, end]) => typeof end === "number" && end <= 2),
    ).toBe(true);
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

    const tableRegion = screen.getByRole("region", { name: "TABLE_ID_PEOPLE", exact: true });
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
    await vi.waitFor(() => expect(document.activeElement).toBe(tableRegion.element()));
  });

  test("preserves focus when an empty-state Retry disappears after recovery", async () => {
    const run = vi.fn();
    const screen = await render(
      <BrunoTableClient
        {...props}
        clientSource={{
          rows: [],
          totalRows: 0,
          version: 1,
          status: "error",
          message: "Connection lost",
          retry: { run, pending: false },
        }}
      />,
    );
    const tableRegion = screen.getByRole("region", { name: "TABLE_ID_PEOPLE", exact: true });
    const retry = screen.getByRole("button", { name: "Retry" });
    await retry.click();
    expect(run).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(retry.element());

    await screen.rerender(<BrunoTableClient {...props} clientSource={readySource()} />);

    await vi.waitFor(() => expect(document.activeElement).toBe(tableRegion.element()));
    await expect.element(retry).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" }))
      .toBeInTheDocument();
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

  test("announces an initially closed empty source as status", async () => {
    const screen = await render(
      <BrunoTableClient
        {...props}
        clientSource={{
          rows: [],
          totalRows: 0,
          version: 1,
          status: "closed",
          message: "Socket closed",
        }}
      />,
    );

    await expect.element(screen.getByRole("status")).toHaveTextContent("Live updates stopped");
    await expect.element(screen.getByRole("status")).toHaveTextContent("Socket closed");
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

  test(
    "reports logical aria row indexes after physical scroll-space compression",
    { timeout: 30_000 },
    async () => {
      const rowCount = Math.floor(BRUNO_TABLE_MAX_PHYSICAL_ROW_HEIGHT / BRUNO_TABLE_ROW_HEIGHT + 2);
      const compressedRows = Array.from({ length: rowCount }, (_, index) => ({
        id: `row-${String(index).padStart(6, "0")}`,
        name: `Row ${index}`,
        score: index,
      })) satisfies readonly Row[];
      const screen = await render(
        <BrunoTableClient {...props} clientSource={readySource(compressedRows)} />,
      );
      const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" });

      grid.element().scrollTop = grid.element().scrollHeight;
      grid.element().dispatchEvent(new Event("scroll"));
      const suffixCell = screen.getByRole("gridcell", { name: `Row ${rowCount - 1}` });
      await expect.element(suffixCell).toBeInTheDocument();

      expect(suffixCell.element().closest('[role="row"]')?.getAttribute("aria-rowindex")).toBe(
        String(rowCount + 1),
      );
      const mountedRows = screen.getByRole("row").all();
      const penultimate = mountedRows.find(
        (row) => row.element().getAttribute("aria-rowindex") === String(rowCount),
      );
      const last = mountedRows.find(
        (row) => row.element().getAttribute("aria-rowindex") === String(rowCount + 1),
      );
      expect(
        Math.abs(
          last!.element().getBoundingClientRect().top -
            penultimate!.element().getBoundingClientRect().top,
        ),
      ).toBe(BRUNO_TABLE_ROW_HEIGHT);
    },
  );

  test("bounds mounted centre columns for a wide resident source", async () => {
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_WIDE"
        getRowId={(row: Row) => row.id}
        columns={wideColumns}
        initialFilters={[{ columnId: "COL_ID_WIDE_01", type: "notBlank" }]}
        initialOrderBy={[{ columnId: "COL_ID_WIDE_01", direction: "asc" as const }]}
        clientSource={readySource()}
      />,
    );

    await expect.element(screen.getByRole("columnheader", { name: "Wide 01" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader").all().length).toBeLessThan(wideColumns.length);

    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_WIDE" });
    grid.element().focus();
    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    await grid.wheel({ delta: { x: 1200 } });
    await vi.waitFor(() => expect(grid.element().scrollLeft).toBeGreaterThan(0));

    const proxy = screen.getByRole("columnheader", {
      name: "Wide 01, sorted ascending, priority 1",
    });
    await expect.element(proxy).toHaveAttribute("aria-sort", "ascending");
    await expect.element(proxy).toHaveAttribute("aria-keyshortcuts", "Alt+Enter");
  });

  test("bounds mounted cells across a 150-column resident source", async () => {
    const stressColumns = Array.from({ length: 150 }, (_, index) => ({
      columnId: `COL_ID_STRESS_${String(index).padStart(3, "0")}`,
      field: "name" as const,
      headerName: `Stress ${String(index).padStart(3, "0")}`,
      valueType: "text" as const,
      width: 120,
      ...(index === 0 ? { pinned: "start" as const } : {}),
      ...(index === 149 ? { pinned: "end" as const } : {}),
    })) as BrunoTableColumns<Row>;
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_150_COLUMNS"
        getRowId={(row: Row) => row.id}
        columns={stressColumns}
        initialOrderBy={[{ columnId: "COL_ID_STRESS_000", direction: "asc" }]}
        clientSource={readySource()}
      />,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_150_COLUMNS" });
    await expect
      .element(screen.getByRole("columnheader", { name: "Stress 000" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("columnheader", { name: "Stress 149" }))
      .toBeInTheDocument();
    expect(screen.getByRole("columnheader").all().length).toBeLessThan(20);
    expect(screen.getByRole("gridcell").all().length).toBeLessThan(40);
    await expect
      .element(screen.getByRole("columnheader", { name: "Stress 075" }))
      .not.toBeInTheDocument();

    await grid.wheel({ delta: { x: 9_000 } });
    await expect
      .element(screen.getByRole("columnheader", { name: "Stress 075" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("columnheader", { name: "Stress 000" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("columnheader", { name: "Stress 149" }))
      .toBeInTheDocument();
    expect(screen.getByRole("columnheader").all().length).toBeLessThan(20);
    expect(screen.getByRole("gridcell").all().length).toBeLessThan(40);
  });

  test("reveals oversized columns with only the minimum geometry delta", async () => {
    const oversizedColumns = [
      {
        columnId: "COL_ID_BEFORE_OVERSIZED",
        field: "name",
        headerName: "Before oversized",
        valueType: "text",
        width: 1200,
      },
      {
        columnId: "COL_ID_OVERSIZED",
        field: "name",
        headerName: "Oversized",
        valueType: "text",
        width: 2000,
      },
      {
        columnId: "COL_ID_AFTER_OVERSIZED",
        field: "name",
        headerName: "After oversized",
        valueType: "text",
        width: 2000,
      },
    ] as const;
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_OVERSIZED"
        getRowId={(row: Row) => row.id}
        columns={oversizedColumns}
        initialOrderBy={[{ columnId: "COL_ID_BEFORE_OVERSIZED", direction: "asc" }]}
        clientSource={readySource()}
      />,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_OVERSIZED" });
    expect(grid.element().clientWidth).toBeLessThan(2000);
    expect(grid.element().scrollLeft).toBe(0);

    grid.element().focus();
    grid
      .element()
      .dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));

    await vi.waitFor(() => expect(grid.element().scrollLeft).toBe(1200));
    const rightApproachCell = screen.getByRole("gridcell", { name: "Grace" }).nth(1).element();
    expect(rightApproachCell.getBoundingClientRect().right).toBeGreaterThan(
      grid.element().getBoundingClientRect().left,
    );

    grid.element().scrollLeft = 4000;
    grid.element().dispatchEvent(new Event("scroll"));
    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));

    await vi.waitFor(() =>
      expect(grid.element().scrollLeft).toBe(Math.max(3200 - grid.element().clientWidth, 0)),
    );
    const leftApproachCell = screen.getByRole("gridcell", { name: "Grace" }).nth(1).element();
    expect(leftApproachCell.getBoundingClientRect().left).toBeLessThan(
      grid.element().getBoundingClientRect().right,
    );
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
    expect(screen.getByRole("columnheader").all().length).toBeLessThan(wideColumns.length + 1);
  });

  test("moves Page Up and Page Down through viewport-relative logical rows", async () => {
    const manyRows = Array.from({ length: 100 }, (_, index) => ({
      id: `page-row-${index}`,
      name: `Page row ${String(index).padStart(3, "0")}`,
      score: index,
    })) satisfies readonly Row[];
    const pageColumns = [columns[0]] as const;
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_PAGE_KEYS"
        getRowId={(row: Row) => row.id}
        columns={pageColumns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource(manyRows)}
      />,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_PAGE_KEYS" });
    const pageSize = Math.max(
      1,
      Math.floor((grid.element().clientHeight - BRUNO_TABLE_ROW_HEIGHT) / BRUNO_TABLE_ROW_HEIGHT),
    );
    grid.element().focus();

    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "PageUp" }));
    const firstCell = screen.getByRole("gridcell", { name: "Page row 000" });
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(firstCell.element().id),
    );

    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "PageDown" }));
    const pageDestination = screen.getByRole("gridcell", {
      name: `Page row ${String(pageSize).padStart(3, "0")}`,
    });
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(
        pageDestination.element().id,
      ),
    );

    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "PageUp" }));
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(firstCell.element().id),
    );

    for (let index = 0; index < manyRows.length; index += pageSize) {
      grid
        .element()
        .dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "PageDown" }));
    }
    const lastCell = screen.getByRole("gridcell", { name: "Page row 099" });
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(lastCell.element().id),
    );
    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "PageDown" }));
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(lastCell.element().id);
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
    const centerBounds = screen
      .getByRole("columnheader", { name: "Score" })
      .element()
      .getBoundingClientRect();
    expect(Math.abs(gridBounds.right - endBounds.right)).toBeLessThanOrEqual(2);
    expect(endBounds.height).toBe(36);
    expect(centerBounds.height).toBe(36);
    const headerLayer = screen
      .getByRole("columnheader", { name: "Pinned end" })
      .element()
      .closest("thead");
    const bodyPinnedLayer = screen
      .getByRole("gridcell", { name: "Grace" })
      .nth(0)
      .element()
      .closest('[data-pinned-region="start"]');
    expect(Number(headerLayer?.style.zIndex)).toBeGreaterThan(
      Number((bodyPinnedLayer as HTMLElement | null)?.style.zIndex),
    );
  });

  test("renders boolean values as read-only checkbox semantics", async () => {
    type BooleanRow = { readonly id: string; readonly active: boolean };
    const booleanRows = [
      { id: "enabled", active: true },
      { id: "disabled", active: false },
    ] satisfies readonly BooleanRow[];
    const booleanColumns = [
      {
        columnId: "COL_ID_ACTIVE",
        field: "active",
        headerName: "Active",
        valueType: "boolean",
      },
    ] as const;
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_BOOLEAN"
        getRowId={(row: BooleanRow) => row.id}
        columns={booleanColumns}
        initialOrderBy={[{ columnId: "COL_ID_ACTIVE", direction: "desc" }]}
        clientSource={{
          rows: booleanRows,
          totalRows: booleanRows.length,
          version: 1,
          status: "ready",
        }}
      />,
    );

    const checked = screen.getByRole("checkbox", { name: "Active" }).nth(0);
    await expect.element(checked).toBeChecked();
    await expect.element(checked).toBeDisabled();
    checked.element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await expect.element(checked).toBeChecked();
    await expect.element(screen.getByRole("checkbox", { name: "Active" }).nth(1)).not.toBeChecked();

    const formattedBooleanColumns = [
      {
        ...booleanColumns[0],
        valueFormatter: ({ value }: { readonly value: boolean }) => (value ? "Yes" : "No"),
      },
    ] as const;
    await screen.rerender(
      <BrunoTableClient
        tableId="TABLE_ID_BOOLEAN"
        getRowId={(row: BooleanRow) => row.id}
        columns={formattedBooleanColumns}
        initialOrderBy={[{ columnId: "COL_ID_ACTIVE", direction: "desc" }]}
        clientSource={{
          rows: booleanRows,
          totalRows: booleanRows.length,
          version: 1,
          status: "ready",
        }}
      />,
    );
    await expect.element(screen.getByRole("gridcell", { name: "Yes" })).toBeInTheDocument();
    await expect.element(screen.getByRole("gridcell", { name: "No" })).toBeInTheDocument();
    await expect.element(screen.getByRole("checkbox")).not.toBeInTheDocument();

    const customBooleanColumns = [
      {
        ...booleanColumns[0],
        cellRenderer: ({ value }: { readonly value: boolean }) => (
          <span role="status">{value ? "Enabled" : "Disabled"}</span>
        ),
      },
    ] as const;
    await screen.rerender(
      <BrunoTableClient
        tableId="TABLE_ID_BOOLEAN"
        getRowId={(row: BooleanRow) => row.id}
        columns={customBooleanColumns}
        initialOrderBy={[{ columnId: "COL_ID_ACTIVE", direction: "desc" }]}
        clientSource={{
          rows: booleanRows,
          totalRows: booleanRows.length,
          version: 1,
          status: "ready",
        }}
      />,
    );
    await expect.element(screen.getByRole("status").nth(0)).toHaveTextContent("Enabled");
    await expect.element(screen.getByRole("checkbox")).not.toBeInTheDocument();
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
          <>
            <button disabled type="button">
              Unavailable {row.name}
            </button>
            <button type="button" onClick={() => activate(row.id)}>
              Open {row.name}
            </button>
            <input aria-label={`Edit ${row.name}`} defaultValue={row.name} />
          </>
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

    const action = screen.getByRole("button", { name: "Open Grace" });
    const input = screen.getByRole("textbox", { name: "Edit Grace" });
    await vi.waitFor(() => {
      expect(action.element().tabIndex).toBe(-1);
      expect(input.element().tabIndex).toBe(-1);
    });
    await action.click();
    expect(activate).toHaveBeenCalledWith("grace");
    await expect.element(screen.getByRole("columnheader", { name: "Action" })).toBeInTheDocument();

    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_ACTIONS" });
    grid.element().focus();
    grid
      .element()
      .dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await vi.waitFor(() => expect(document.activeElement).toBe(action.element()));
    action
      .element()
      .dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
      );
    expect(document.activeElement).toBe(grid.element());

    input.element().focus();
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).not.toBeNull(),
    );
    const activeId = grid.element().getAttribute("aria-activedescendant");
    const arrow = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowLeft",
    });
    input.element().dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(false);
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(activeId);
  });

  test("enters native summary controls only through the grid interaction command", async () => {
    const summaryColumns = [
      {
        ...columns[0],
        cellRenderer: ({ row }: { readonly row: Row }) => (
          <details>
            <summary role="button">Details {row.name}</summary>
            <span>{row.score}</span>
          </details>
        ),
      },
    ] as const;
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_SUMMARY_ACTIONS"
        getRowId={(row: Row) => row.id}
        columns={summaryColumns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource()}
      />,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SUMMARY_ACTIONS" });
    const summary = screen.getByRole("button", { name: "Details Ada" });
    await vi.waitFor(() => expect(summary.element().tabIndex).toBe(-1));

    grid.element().focus();
    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await vi.waitFor(() => expect(document.activeElement).toBe(summary.element()));
    summary
      .element()
      .dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
      );
    expect(document.activeElement).toBe(grid.element());
  });

  test("suppresses embedded contexts without auto-entering their browsing context", async () => {
    const embeddedColumns = [
      {
        ...columns[0],
        cellRenderer: ({ row }: { readonly row: Row }) => (
          <>
            <iframe
              aria-label={`Embedded ${row.name}`}
              contentEditable
              role="document"
              srcDoc="<!doctype html><button>Inside</button>"
            />
            <button type="button">Open {row.name}</button>
          </>
        ),
      },
    ] as const;
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_EMBEDDED_ACTIONS"
        getRowId={(row: Row) => row.id}
        columns={embeddedColumns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource()}
      />,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_EMBEDDED_ACTIONS" });
    const embedded = screen.getByRole("document", { name: "Embedded Ada" });
    const action = screen.getByRole("button", { name: "Open Ada" });
    await vi.waitFor(() => {
      expect(embedded.element().tabIndex).toBe(-1);
      expect(action.element().tabIndex).toBe(-1);
    });

    grid.element().focus();
    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "F2" }));
    await vi.waitFor(() => expect(document.activeElement).toBe(action.element()));
    expect(document.activeElement).not.toBe(embedded.element());
    action
      .element()
      .dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
      );
    expect(document.activeElement).toBe(grid.element());
  });

  test("restores detached custom controls while replacements remain outside the tab order", async () => {
    const replacementColumns = [
      {
        ...columns[0],
        cellRenderer: ({ row }: { readonly row: Row }) => (
          <button key={row.name} tabIndex={2} type="button">
            Open {row.name}
          </button>
        ),
      },
    ] as const;
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_REPLACED_ACTIONS"
        getRowId={(row: Row) => row.id}
        columns={replacementColumns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource([{ id: "stable", name: "First", score: 1 }])}
      />,
    );
    const detached: HTMLButtonElement[] = [];
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_REPLACED_ACTIONS" });
    grid.element().focus();
    const initialAction = screen.getByRole("button", { name: "Open First" });
    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await vi.waitFor(() => expect(document.activeElement).toBe(initialAction.element()));
    const activeId = grid.element().getAttribute("aria-activedescendant");
    for (const name of ["Second", "Third", "Fourth"]) {
      const current = screen.getByRole("button", { name: /Open/u }).element();
      expect(current.tabIndex).toBe(-1);
      detached.push(current as HTMLButtonElement);
      await screen.rerender(
        <BrunoTableClient
          tableId="TABLE_ID_REPLACED_ACTIONS"
          getRowId={(row: Row) => row.id}
          columns={replacementColumns}
          initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
          clientSource={readySource([{ id: "stable", name, score: 1 }])}
        />,
      );
      await vi.waitFor(() => {
        expect(screen.getByRole("button", { name: `Open ${name}` }).element().tabIndex).toBe(-1);
        expect(detached.every((candidate) => candidate.tabIndex === 2)).toBe(true);
      });
      expect(document.activeElement).toBe(grid.element());
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(activeId);
    }
  });

  test("returns focus to the grid when a focused custom control becomes disabled", async () => {
    const disablingColumns = [
      {
        ...columns[0],
        cellRenderer: ({ row }: { readonly row: Row }) => (
          <button disabled={row.score === 0} type="button">
            Open {row.name}
          </button>
        ),
      },
    ] as const;
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_DISABLED_ACTION"
        getRowId={(row: Row) => row.id}
        columns={disablingColumns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource([{ id: "stable", name: "Stable", score: 1 }])}
      />,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_DISABLED_ACTION" });
    const action = screen.getByRole("button", { name: "Open Stable" });
    grid.element().focus();
    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await vi.waitFor(() => expect(document.activeElement).toBe(action.element()));
    const activeId = grid.element().getAttribute("aria-activedescendant");

    await screen.rerender(
      <BrunoTableClient
        tableId="TABLE_ID_DISABLED_ACTION"
        getRowId={(row: Row) => row.id}
        columns={disablingColumns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource([{ id: "stable", name: "Stable", score: 0 }])}
      />,
    );
    await vi.waitFor(() => expect(document.activeElement).toBe(grid.element()));
    await expect.element(action).toBeDisabled();
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(activeId);
  });

  test.each([
    ["aria-hidden", 0],
    ["inert", -1],
  ] as const)(
    "returns focus to the grid when a focused custom control becomes %s",
    async (hiddenState, hiddenScore) => {
      const hidingColumns = [
        {
          ...columns[0],
          cellRenderer: ({ row }: { readonly row: Row }) => (
            <span
              aria-hidden={hiddenState === "aria-hidden" && row.score === hiddenScore}
              inert={hiddenState === "inert" && row.score === hiddenScore}
            >
              <button type="button">Open {row.name}</button>
            </span>
          ),
        },
      ] as const;
      const tableId = `TABLE_ID_${hiddenState.toUpperCase().replace("-", "_")}_ACTION`;
      const screen = await render(
        <BrunoTableClient
          tableId={tableId}
          getRowId={(row: Row) => row.id}
          columns={hidingColumns}
          initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
          clientSource={readySource([{ id: "stable", name: "Stable", score: 1 }])}
        />,
      );
      const grid = screen.getByRole("grid", { name: `Data for ${tableId}` });
      const action = screen.getByRole("button", { name: "Open Stable" });
      grid.element().focus();
      grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await vi.waitFor(() => expect(document.activeElement).toBe(action.element()));
      const activeId = grid.element().getAttribute("aria-activedescendant");

      await screen.rerender(
        <BrunoTableClient
          tableId={tableId}
          getRowId={(row: Row) => row.id}
          columns={hidingColumns}
          initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
          clientSource={readySource([{ id: "stable", name: "Stable", score: hiddenScore }])}
        />,
      );
      await vi.waitFor(() => expect(document.activeElement).toBe(grid.element()));
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(activeId);
    },
  );

  test("restores the latest author-owned tab index when a custom control is replaced", async () => {
    const changingTabIndexColumns = [
      {
        ...columns[0],
        cellRenderer: ({ row }: { readonly row: Row }) => (
          <button key={row.name} tabIndex={row.score} type="button">
            Open {row.name}
          </button>
        ),
      },
    ] as const;
    const renderTable = (sourceRows: readonly Row[]) => (
      <BrunoTableClient
        tableId="TABLE_ID_LATEST_TAB_INDEX"
        getRowId={(row: Row) => row.id}
        columns={changingTabIndexColumns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource(sourceRows)}
      />
    );
    const screen = await render(renderTable([{ id: "stable", name: "First", score: 1 }]));
    const initialAction = screen.getByRole("button", { name: "Open First" }).element();
    await vi.waitFor(() => expect(initialAction.tabIndex).toBe(-1));

    initialAction.setAttribute("tabindex", "3");
    await vi.waitFor(() => expect(initialAction.tabIndex).toBe(-1));
    await screen.rerender(renderTable([{ id: "stable", name: "Second", score: 4 }]));

    await vi.waitFor(() => expect(initialAction.tabIndex).toBe(3));
    expect(screen.getByRole("button", { name: "Open Second" }).element().tabIndex).toBe(-1);
  });

  test("returns focus to the grid when virtualization removes a focused SVG control", async () => {
    const largeRows = Array.from({ length: 100 }, (_, index) => ({
      id: `row-${index}`,
      name: `Row ${index}`,
      score: index,
    })) satisfies readonly Row[];
    const svgColumns = [
      {
        ...columns[0],
        cellRenderer: ({ row }: { readonly row: Row }) => (
          <svg aria-label={`Actions for ${row.name}`}>
            <circle aria-label={`Open ${row.name}`} role="button" tabIndex={0} />
          </svg>
        ),
      },
    ] as const;
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_SVG_ACTION"
        getRowId={(row: Row) => row.id}
        columns={svgColumns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource(largeRows)}
      />,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SVG_ACTION" });
    const action = screen.getByRole("button", { name: "Open Row 0" });
    await vi.waitFor(() => expect(action.element().getAttribute("tabindex")).toBe("-1"));
    grid.element().focus();
    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "F2" }));
    await vi.waitFor(() => expect(document.activeElement).toBe(action.element()));
    const activeId = grid.element().getAttribute("aria-activedescendant");

    await grid.wheel({ delta: { y: 1200 } });
    await vi.waitFor(() => expect(document.activeElement).toBe(grid.element()));
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(activeId);
    await expect.element(action).not.toBeInTheDocument();
  });

  test("preserves focus authority when source teardown removes a focused SVG control", async () => {
    const svgColumns = [
      {
        ...columns[0],
        cellRenderer: ({ row }: { readonly row: Row }) => (
          <svg aria-label={`Actions for ${row.name}`}>
            <circle aria-label={`Open ${row.name}`} role="button" tabIndex={0} />
          </svg>
        ),
      },
    ] as const;
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_SVG_TEARDOWN"
        getRowId={(row: Row) => row.id}
        columns={svgColumns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource([{ id: "stable", name: "Stable", score: 1 }])}
      />,
    );
    const region = screen.getByRole("region", { name: "TABLE_ID_SVG_TEARDOWN", exact: true });
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SVG_TEARDOWN" });
    const action = screen.getByRole("button", { name: "Open Stable" });
    grid.element().focus();
    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "F2" }));
    await vi.waitFor(() => expect(document.activeElement).toBe(action.element()));

    await screen.rerender(
      <BrunoTableClient
        tableId="TABLE_ID_SVG_TEARDOWN"
        getRowId={(row: Row) => row.id}
        columns={svgColumns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource([])}
      />,
    );

    await vi.waitFor(() => expect(document.activeElement).toBe(region.element()));
    await expect
      .element(screen.getByRole("grid", { name: "Data for TABLE_ID_SVG_TEARDOWN" }))
      .not.toBeInTheDocument();
    await expect.element(action).not.toBeInTheDocument();
  });

  test("moves one logical active cell across the body with arrow keys", async () => {
    const screen = await render(<BrunoTableClient {...props} clientSource={readySource()} />);
    const region = screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" });
    region.element().focus();
    const graceRow = screen.getByRole("row").nth(1);
    const graceNameId = graceRow.getByRole("gridcell").nth(0).element().id;
    const graceScoreId = graceRow.getByRole("gridcell").nth(1).element().id;
    const adaScoreId = screen.getByRole("row").nth(2).getByRole("gridcell").nth(1).element().id;
    await vi.waitFor(() =>
      expect(region.element().getAttribute("aria-activedescendant")).toBe(graceNameId),
    );
    const firstActiveId = region.element().getAttribute("aria-activedescendant");
    expect(firstActiveId).toBe(graceNameId);

    region
      .element()
      .dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    await vi.waitFor(() => {
      expect(region.element().getAttribute("aria-activedescendant")).toBe(graceScoreId);
    });
    region
      .element()
      .dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    await vi.waitFor(() => {
      expect(region.element().getAttribute("aria-activedescendant")).toBe(adaScoreId);
    });
  });

  test("uses a clamped display-position fallback when an active Row Identity disappears", async () => {
    const screen = await render(<BrunoTableClient {...props} clientSource={readySource()} />);
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" });
    grid.element().focus();
    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    await vi.waitFor(() => {
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(
        screen.getByRole("gridcell", { name: "Ada" }).element().id,
      );
    });

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={readySource([{ id: "grace", name: "Grace", score: 2 }])}
      />,
    );
    await vi.waitFor(() => {
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(
        screen.getByRole("gridcell", { name: "Grace" }).element().id,
      );
    });
    expect(document.activeElement).toBe(grid.element());

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={readySource([
          { id: "grace", name: "Grace", score: 2 },
          { id: "linus", name: "Linus", score: 3 },
        ])}
      />,
    );
    await vi.waitFor(() => {
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(
        screen.getByRole("gridcell", { name: "Grace" }).element().id,
      );
    });

    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    await vi.waitFor(() => {
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(
        screen.getByRole("gridcell", { name: "Linus" }).element().id,
      );
    });
  });

  test("rekeys the logical projection when getRowId changes over the same row array", async () => {
    const source = readySource(rows);
    const screen = await render(
      <BrunoTableClient {...props} getRowId={(row: Row) => row.id} clientSource={source} />,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" });
    grid.element().focus();
    const initialCellId = screen.getByRole("gridcell", { name: "Grace" }).element().id;
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(initialCellId),
    );

    await screen.rerender(
      <BrunoTableClient
        {...props}
        getRowId={(row: Row) => `next:${row.id}`}
        clientSource={source}
      />,
    );

    const rekeyedCellId = screen.getByRole("gridcell", { name: "Grace" }).element().id;
    expect(rekeyedCellId).not.toBe(initialCellId);
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(rekeyedCellId),
    );
  });

  test("preserves focus authority across an empty source and replacement rows", async () => {
    const screen = await render(<BrunoTableClient {...props} clientSource={readySource()} />);
    const tableRegion = screen.getByRole("region", { name: "TABLE_ID_PEOPLE", exact: true });
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" });
    grid.element().focus();
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).not.toBeNull(),
    );

    await screen.rerender(<BrunoTableClient {...props} clientSource={readySource([])} />);
    await expect.element(grid).not.toBeInTheDocument();
    await vi.waitFor(() => expect(document.activeElement).toBe(tableRegion.element()));

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={readySource([{ id: "linus", name: "Linus", score: 3 }])}
      />,
    );
    const replacementGrid = screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" });
    await expect.element(replacementGrid).toBeInTheDocument();
    expect(replacementGrid.element().getAttribute("aria-activedescendant")).toBeNull();
    expect(document.activeElement).toBe(tableRegion.element());

    replacementGrid.element().focus();
    await vi.waitFor(() =>
      expect(replacementGrid.element().getAttribute("aria-activedescendant")).not.toBeNull(),
    );
    const activeId = replacementGrid.element().getAttribute("aria-activedescendant");
    expect(activeId).toBe(screen.getByRole("gridcell", { name: "Linus" }).element().id);
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
    await vi.waitFor(() => {
      expect(grids[0]!.element().getAttribute("aria-activedescendant")).not.toBeNull();
      expect(grids[1]!.element().getAttribute("aria-activedescendant")).not.toBeNull();
    });
    const firstId = grids[0]!.element().getAttribute("aria-activedescendant");
    const secondId = grids[1]!.element().getAttribute("aria-activedescendant");
    expect(firstId).not.toBe(secondId);
  });

  test("builds total DOM identities for lone UTF-16 surrogates", async () => {
    const unsafe = "\ud800";
    const screen = await render(
      <BrunoTableClient
        tableId={`TABLE_ID_${unsafe}`}
        getRowId={() => unsafe}
        columns={columns}
        initialOrderBy={[{ columnId: "COL_ID_SCORE", direction: "asc" }]}
        clientSource={readySource([{ id: unsafe, name: "Surrogate", score: 1 }])}
      />,
    );
    const grid = screen.getByRole("grid");
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).not.toBeNull(),
    );
    const activeId = grid.element().getAttribute("aria-activedescendant");

    expect(activeId).toMatch(/^[a-z0-9-]+$/u);
    expect(activeId).toBe(screen.getByRole("gridcell", { name: "Surrogate" }).element().id);
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

  test("makes interactive custom-renderer proxies inert while retaining a cell name", async () => {
    const largeRows = Array.from({ length: 100 }, (_, index) => ({
      id: `row-${index}`,
      name: `Row ${index}`,
      score: index,
    })) satisfies readonly Row[];
    const onMount = vi.fn();
    const onUnmount = vi.fn();
    const interactiveColumns = [
      {
        ...columns[0],
        cellRenderer: ({ row }: { readonly row: Row }) => (
          <TrackedRowAction row={row} onMount={onMount} onUnmount={onUnmount} />
        ),
      },
    ] as const;
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_PROXY_ACTION"
        getRowId={(row: Row) => row.id}
        columns={interactiveColumns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource(largeRows)}
      />,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_PROXY_ACTION" });
    grid.element().focus();
    await vi.waitFor(() => expect(onMount).toHaveBeenCalledWith("row-0"));
    await grid.wheel({ delta: { y: 1200 } });

    await expect.element(screen.getByRole("gridcell", { name: "Row 0" })).toBeInTheDocument();
    await vi.waitFor(() => expect(onUnmount).toHaveBeenCalledWith("row-0"));
    await expect
      .element(screen.getByRole("button", { name: "Open Row 0" }))
      .not.toBeInTheDocument();
    expect(onMount.mock.calls.filter(([rowId]) => rowId === "row-0")).toHaveLength(1);

    const staleActiveId = grid.element().getAttribute("aria-activedescendant");
    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "F2" }));
    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    expect(grid.element().getAttribute("aria-activedescendant")).not.toBe(staleActiveId);
    expect(document.activeElement).toBe(grid.element());

    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "F2" }));
    const mountedAction = screen.getByRole("button", { name: "Open Row 0" });
    await vi.waitFor(() => expect(document.activeElement).toBe(mountedAction.element()));
    expect(onMount.mock.calls.filter(([rowId]) => rowId === "row-0")).toHaveLength(2);
    mountedAction
      .element()
      .dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
      );
    expect(document.activeElement).toBe(grid.element());

    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "F2" }));
    await vi.waitFor(() => expect(document.activeElement).toBe(mountedAction.element()));
    const activeIdBeforeUnmount = grid.element().getAttribute("aria-activedescendant");
    await grid.wheel({ delta: { y: 1200 } });
    await vi.waitFor(() => expect(document.activeElement).toBe(grid.element()));
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(activeIdBeforeUnmount);
    const restoredProxy = screen.getByRole("gridcell", { name: "Row 0" });
    expect(restoredProxy.element().id).toBe(activeIdBeforeUnmount);
  });

  test("preserves boolean checkbox semantics in a virtualized active-cell proxy", async () => {
    type BooleanRow = { readonly id: string; readonly active: boolean };
    const booleanRows = Array.from({ length: 100 }, (_, index) => ({
      id: `row-${String(index).padStart(3, "0")}`,
      active: true,
    })) satisfies readonly BooleanRow[];
    const booleanColumns = [
      {
        columnId: "COL_ID_ACTIVE",
        field: "active",
        headerName: "Active",
        valueType: "boolean",
      },
    ] as const;
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_BOOLEAN_PROXY"
        getRowId={(row: BooleanRow) => row.id}
        columns={booleanColumns}
        initialOrderBy={[{ columnId: "COL_ID_ACTIVE", direction: "desc" }]}
        clientSource={{
          rows: booleanRows,
          totalRows: booleanRows.length,
          version: 1,
          status: "ready",
        }}
      />,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_BOOLEAN_PROXY" });
    grid.element().focus();
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).not.toBeNull(),
    );
    const activeId = grid.element().getAttribute("aria-activedescendant");

    await grid.wheel({ delta: { y: 1200 } });

    await vi.waitFor(() => {
      const activeCheckboxes = screen
        .getByRole("checkbox", { name: "Active" })
        .all()
        .filter((checkbox) => checkbox.element().closest('[role="gridcell"]')?.id === activeId);
      expect(activeCheckboxes).toHaveLength(1);
      expect(activeCheckboxes[0]!.element()).toBeDisabled();
    });
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

    expect(screen.getByRole("button", { name: "Clear filter for Name" }).element().tabIndex).toBe(
      -1,
    );
    await expect
      .element(screen.getByRole("columnheader", { name: "Name" }))
      .toHaveAttribute("aria-keyshortcuts", "Alt+Enter");
    expect(
      screen
        .getByRole("button", { name: "Sort by Score, currently ascending, priority 1" })
        .element().tabIndex,
    ).toBe(-1);

    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" });
    grid.element().focus();
    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    const filterHeaderId = grid.element().getAttribute("aria-activedescendant");
    grid
      .element()
      .dispatchEvent(new KeyboardEvent("keydown", { altKey: true, bubbles: true, key: "Enter" }));
    await expect.element(screen.getByRole("gridcell", { name: "Grace" })).toBeInTheDocument();
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(filterHeaderId);
    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    grid
      .element()
      .dispatchEvent(new KeyboardEvent("keydown", { altKey: true, bubbles: true, key: "Enter" }));
    await expect.element(screen.getByRole("gridcell", { name: "Grace" })).not.toBeInTheDocument();
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(filterHeaderId);
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
    await expect
      .element(screen.getByRole("columnheader", { name: "Score" }))
      .toHaveTextContent("↓1");

    screen
      .getByRole("button", { name: "Sort by Name" })
      .element()
      .dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    await expect
      .element(screen.getByRole("columnheader", { name: "Score" }))
      .toHaveAttribute("aria-sort", "descending");
    await expect
      .element(screen.getByRole("columnheader", { name: "Name" }))
      .not.toHaveAttribute("aria-sort");
    await expect
      .element(screen.getByRole("columnheader", { name: "Name" }))
      .toHaveTextContent("↑2");
  });

  test("navigates and activates headers using only the keyboard with zero result rows", async () => {
    const screen = await render(
      <BrunoTableClient
        {...props}
        initialFilters={[{ columnId: "COL_ID_NAME", type: "equals", filter: "Missing" }]}
        clientSource={readySource()}
      />,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" });
    grid.element().focus();
    const nameHeaderId = screen.getByRole("columnheader", { name: "Name" }).element().id;
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(nameHeaderId),
    );

    grid
      .element()
      .dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    const scoreHeaderId = screen.getByRole("columnheader", { name: "Score" }).element().id;
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(scoreHeaderId);
    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await expect
      .element(screen.getByRole("columnheader", { name: "Score" }))
      .toHaveAttribute("aria-sort", "descending");
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(scoreHeaderId);

    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" }));
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(nameHeaderId);
    grid
      .element()
      .dispatchEvent(new KeyboardEvent("keydown", { altKey: true, bubbles: true, key: "Enter" }));

    await expect.element(screen.getByRole("gridcell", { name: "Grace" })).toBeInTheDocument();
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(nameHeaderId);
  });

  test("rejects a widened sort-free column replacement", async () => {
    const widenedColumns: BrunoTableColumns<Row> = columns;
    const screen = await render(
      <BrunoTableClient
        {...props}
        columns={widenedColumns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource()}
      />,
    );
    const sortFreeColumns: BrunoTableColumns<Row> = [
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
        enableSorting: false,
      },
    ];

    await expect(
      screen.rerender(
        <BrunoTableClient
          {...props}
          columns={sortFreeColumns}
          initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
          clientSource={readySource()}
        />,
      ),
    ).rejects.toThrow(/requires at least one sortable column/u);
  });

  test("activates the logical header with Enter and preserves sticky-header scroll", async () => {
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
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).not.toBeNull(),
    );
    grid.element().scrollTop = 720;
    grid.element().dispatchEvent(new Event("scroll"));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const scrollTop = grid.element().scrollTop;

    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    grid
      .element()
      .dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(grid.element().scrollTop).toBe(scrollTop);
    const headerId = grid.element().getAttribute("aria-activedescendant");

    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await expect
      .element(screen.getByRole("row").nth(1).getByRole("gridcell").nth(0))
      .toHaveTextContent("Row 99");
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(headerId);
  });

  test("keeps composite focus and activates the clicked header after a pointer query", async () => {
    const screen = await render(
      <BrunoTableClient {...props} clientSource={readySource([rows[0]!])} />,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" });
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).not.toBeNull(),
    );

    await screen
      .getByRole("button", { name: "Sort by Score, currently ascending, priority 1" })
      .click();

    const scoreHeader = screen.getByRole("columnheader", { name: "Score" });
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(grid.element());
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(scoreHeader.element().id);
    });

    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" }));
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("columnheader", { name: "Name" }).element().id,
    );
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
    const activeBeforePublication = grid.element().getAttribute("aria-activedescendant");
    const nextRows = largeRows.map((row) =>
      row.id === "row-50" ? { ...row, name: "Updated row 50" } : row,
    );
    await screen.rerender(<BrunoTableClient {...props} clientSource={readySource(nextRows)} />);
    expect(grid.element().scrollTop).toBe(scrollBeforePublication);
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(activeBeforePublication);

    await screen
      .getByRole("button", { name: "Sort by Score, currently ascending, priority 1" })
      .click();
    await vi.waitFor(() => expect(grid.element().scrollTop).toBe(0));
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("columnheader", { name: "Score" }).element().id,
    );
  });

  test("rebases a queued keyboard reveal through a same-frame live reorder", async () => {
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
    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "PageDown" }));

    const reorderedRows = largeRows.map((row) =>
      row.id === "row-12" ? { ...row, score: 1_000 } : row,
    );
    await screen.rerender(
      <BrunoTableClient {...props} clientSource={readySource(reorderedRows)} />,
    );

    await vi.waitFor(() => expect(grid.element().scrollTop).toBeGreaterThan(2_000));
    const activeId = grid.element().getAttribute("aria-activedescendant");
    const destination = screen.getByRole("gridcell", { name: "Row 12", exact: true });
    expect(activeId).toBe(destination.element().id);
    expect(destination.element()).not.toHaveAttribute("data-bruno-active-proxy");
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
    const gridSurfaceRenders = vi.fn();
    const removeRenderListener =
      installBrunoTableClientGridSurfaceRenderListener(gridSurfaceRenders);
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
    try {
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
      const structuralRenderCount = gridSurfaceRenders.mock.calls.length;
      const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" });
      grid.element().focus();
      const activeBefore = grid.element().getAttribute("aria-activedescendant");
      grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
      await vi.waitFor(() =>
        expect(grid.element().getAttribute("aria-activedescendant")).not.toBe(activeBefore),
      );
      expect(gridSurfaceRenders).toHaveBeenCalledTimes(structuralRenderCount);
      expect(renderCounts).toEqual(
        new Map([
          ["ada", 1],
          ["grace", 1],
        ]),
      );
      await expect
        .element(screen.getByRole("region", { name: "Table toolbar" }))
        .not.toBeInTheDocument();

      await screen.rerender(
        <BrunoTableClient
          {...instrumentedProps}
          clientSource={{ ...readySource(), version: 2, status: "stale", message: "Delayed" }}
        />,
      );
      await expect.element(screen.getByRole("alert")).toHaveTextContent("Live data delayed");
      expect(gridSurfaceRenders).toHaveBeenCalledTimes(structuralRenderCount);
      expect(renderCounts).toEqual(
        new Map([
          ["ada", 1],
          ["grace", 1],
        ]),
      );

      const nextRows = [rows[0]!, { ...rows[1]!, name: "Grace Hopper" }] satisfies readonly Row[];
      await screen.rerender(
        <BrunoTableClient {...instrumentedProps} clientSource={readySource(nextRows)} />,
      );
      await expect
        .element(screen.getByRole("gridcell", { name: "Grace Hopper" }))
        .toBeInTheDocument();
      expect(gridSurfaceRenders).toHaveBeenCalledTimes(structuralRenderCount);
      expect(renderCounts).toEqual(
        new Map([
          ["ada", 1],
          ["grace", 2],
        ]),
      );
    } finally {
      removeRenderListener();
    }
  });

  test("exposes non-empty toolbar children through the accessible toolbar region", async () => {
    const screen = await render(
      <BrunoTableClient {...props} clientSource={readySource()}>
        <BrunoTableToolbar>
          <button type="button">Refresh view</button>
        </BrunoTableToolbar>
      </BrunoTableClient>,
    );

    await expect.element(screen.getByRole("region", { name: "Table toolbar" })).toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Refresh view" })).toBeInTheDocument();
    expect(
      getComputedStyle(screen.getByRole("toolbar", { name: "Table controls" }).element()).display,
    ).toBe("flex");
  });

  test("does not expose a toolbar landmark for an empty BrunoTableToolbar", async () => {
    const screen = await render(
      <BrunoTableClient {...props} clientSource={readySource()}>
        <BrunoTableToolbar />
      </BrunoTableClient>,
    );

    await expect
      .element(screen.getByRole("region", { name: "Table toolbar" }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("toolbar", { name: "Table controls" }))
      .not.toBeInTheDocument();
  });

  test("diagnoses incompatible concurrent reuse of one Table Identity", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const incompatibleColumns = [
      {
        columnId: "COL_ID_NAME",
        field: "score",
        headerName: "Score as name",
        valueType: "number",
      },
    ] as const;
    const screen = await render(
      <>
        <BrunoTableClient {...props} tableId="TABLE_ID_CONFLICT" clientSource={readySource()} />
        <BrunoTableClient
          tableId="TABLE_ID_CONFLICT"
          getRowId={(row: Row) => row.id}
          columns={incompatibleColumns}
          initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
          clientSource={readySource()}
        />
      </>,
    );

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledOnce());
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('simultaneous use of tableId "TABLE_ID_CONFLICT"'),
    );
    expect(screen.getByRole("grid", { name: "Data for TABLE_ID_CONFLICT" }).all()).toHaveLength(2);
  });

  test("isolates root, toolbar, and unchanged cells during sustained 20 Hz publications", async () => {
    const viewRenders = vi.fn();
    const gridSurfaceRenders = vi.fn();
    const removeViewListener = installBrunoTableClientViewRenderListener(viewRenders);
    const removeGridListener = installBrunoTableClientGridSurfaceRenderListener(gridSurfaceRenders);
    const toolbarCommits = vi.fn();
    const cellRenders = new Map<string, number>();
    function ToolbarProbe() {
      useEffect(() => {
        toolbarCommits();
      });
      return <button type="button">Stable command</button>;
    }
    const instrumentedColumns = [
      {
        ...columns[0],
        cellRenderer: ({ row }: { readonly row: Row }) => {
          cellRenders.set(row.id, (cellRenders.get(row.id) ?? 0) + 1);
          return row.name;
        },
      },
      columns[1],
    ] as const;
    const instrumentedProps = { ...props, columns: instrumentedColumns } as const;
    try {
      const screen = await render(
        <BrunoTableClient {...instrumentedProps} clientSource={readySource()}>
          <BrunoTableToolbar>
            <ToolbarProbe />
          </BrunoTableToolbar>
        </BrunoTableClient>,
      );
      await expect
        .element(screen.getByRole("toolbar", { name: "Table controls" }))
        .toBeInTheDocument();
      expect(toolbarCommits).toHaveBeenCalledOnce();
      const initialViewRenders = viewRenders.mock.calls.length;
      const initialGridRenders = gridSurfaceRenders.mock.calls.length;

      for (let publication = 1; publication <= 20; publication += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        await screen.rerender(
          <BrunoTableClient
            {...instrumentedProps}
            clientSource={readySource([rows[0]!, { ...rows[1]!, name: `Grace ${publication}` }])}
          >
            <BrunoTableToolbar>
              <ToolbarProbe />
            </BrunoTableToolbar>
          </BrunoTableClient>,
        );
      }

      await expect.element(screen.getByRole("gridcell", { name: "Grace 20" })).toBeInTheDocument();
      expect(viewRenders).toHaveBeenCalledTimes(initialViewRenders);
      expect(gridSurfaceRenders).toHaveBeenCalledTimes(initialGridRenders);
      expect(toolbarCommits).toHaveBeenCalledOnce();
      expect(cellRenders.get("ada")).toBe(1);
      expect(cellRenders.get("grace")).toBe(21);
    } finally {
      removeGridListener();
      removeViewListener();
    }
  });
});
