import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { cdp, page, userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import type { CDPSession as PlaywrightCDPSession } from "@vitest/browser-playwright";
import { act, Suspense, useEffect } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";

import {
  BrunoTableClient,
  BrunoTableComputedColumn,
  BrunoTableQuickFilter,
  BrunoTableSelectColumn,
  BrunoTableToolbar,
} from "./index";
import type {
  BrunoTableColumns,
  BrunoTableFilterExpressions,
  BrunoTableValueType,
} from "./public-types";
import {
  BRUNO_TABLE_MAX_PHYSICAL_ROW_HEIGHT,
  BRUNO_TABLE_ROW_HEIGHT,
} from "./internal/virtual-viewport";
import {
  installBrunoTableClientCellRenderListener,
  installBrunoTableClientCellRenderListenerForTable,
  installBrunoTableClientColumnFilterRenderListener,
  installBrunoTableClientGridSurfaceRenderListener,
  installBrunoTableClientHeaderRenderListener,
  installBrunoTableClientQueryTransitionListener,
  installBrunoTableClientRowOrderPlanningListener,
  installBrunoTableClientQuickFilterRenderListener,
  installBrunoTableClientRowRenderListenerForTable,
  installBrunoTableClientViewRenderListener,
  installBrunoTableClientViewRenderListenerForTable,
} from "./internal/render-instrumentation";
import {
  BrunoTableToolbarStore,
  BrunoTableView,
  type BrunoTableLogicalRowSpace,
  type BrunoTableRowPipelineProps,
} from "./internal/bruno-table-view";
import { compileColumns } from "./internal/compile-columns";
import { installBrunoTableClientQueryValueReadListener } from "./internal/client-adapter";
import { BrunoTableClientRowPipeline } from "./internal/client-row-pipeline";
import { BrunoTableClientRowPipelineAdapter } from "./internal/client-source-adapter";
import { BRUNO_TABLE_MAX_FILTER_OPERAND_LENGTH } from "./internal/client-filter";
import { installBrunoTableGridCommandListener } from "./internal/grid-command-instrumentation";
import { installBrunoTableColumnFilterSubscriptionListener } from "./internal/grid-subscription-instrumentation";
import type { BrunoTableGridCommand } from "./internal/column-management";
import {
  BrunoTableGridRuntime,
  type BrunoTableRowPipelineRuntimeView,
} from "./internal/grid-runtime";

type Row = {
  readonly id: string;
  readonly name: string;
  readonly score: number;
};

type FilterRow = {
  readonly id: string;
  readonly name: string;
  readonly score: number;
  readonly quantity: bigint;
  readonly active: boolean;
  readonly status: "open" | "closed";
  readonly symbol: string;
  readonly description: string;
};

const filterColumns = [
  {
    columnId: "COL_ID_FILTER_NAME",
    field: "name",
    headerName: "Name",
    valueType: "text",
  },
  {
    columnId: "COL_ID_FILTER_SCORE",
    field: "score",
    headerName: "Score",
    valueType: "number",
  },
  {
    columnId: "COL_ID_FILTER_QUANTITY",
    field: "quantity",
    headerName: "Quantity",
    valueType: "bigint",
  },
  {
    columnId: "COL_ID_FILTER_ACTIVE",
    field: "active",
    headerName: "Active",
    valueType: "boolean",
  },
  BrunoTableSelectColumn({
    columnId: "COL_ID_FILTER_STATUS",
    field: "status",
    headerName: "Status",
    options: ["open", "closed"],
  }),
] satisfies BrunoTableColumns<FilterRow>;

const filterRows = [
  {
    id: "ada",
    name: "Ada",
    score: 4,
    quantity: 9_007_199_254_740_993n,
    active: true,
    status: "open",
    symbol: "AAPL",
    description: "Apple Inc.",
  },
  {
    id: "grace",
    name: "Grace",
    score: 2,
    quantity: 9_007_199_254_740_994n,
    active: false,
    status: "closed",
    symbol: "MSFT",
    description: "Microsoft",
  },
] satisfies readonly [FilterRow, FilterRow];

const oversizedQuantity = BigInt(`1${"0".repeat(1_024)}`);
const oversizedFilterRows = [
  ...filterRows,
  {
    id: "oversized",
    name: "Oversized",
    score: 1,
    quantity: oversizedQuantity,
    active: true,
    status: "open",
    symbol: "BIG",
    description: "Oversized exact integer",
  },
] satisfies readonly FilterRow[];

const duplicateHeaderFilterColumns = [
  {
    columnId: "COL_ID_DUPLICATE_NAME",
    field: "name",
    headerName: "Value",
    valueType: "text",
  },
  {
    columnId: "COL_ID_DUPLICATE_QUANTITY",
    field: "quantity",
    headerName: "Value",
    valueType: "bigint",
  },
] satisfies BrunoTableColumns<FilterRow>;

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

const readyFilterSource = (nextRows: readonly FilterRow[] = filterRows) => ({
  rows: nextRows,
  totalRows: nextRows.length,
  version: 1,
  status: "ready" as const,
});

const encodeExpectedDomIdSegment = (value: string): string =>
  Array.from(value, (character) => character.charCodeAt(0).toString(16).padStart(4, "0")).join("");

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
  columns,
  rowPipelineAdapter,
}: BrunoTableRowPipelineProps<BrunoTableRowPipelineRuntimeView, SparseRowPipelineAdapter>) {
  return children({
    kind: "rows",
    columns,
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

  test("opens each built-in filter overlay and applies a debounced text candidate", async () => {
    const commands: BrunoTableGridCommand[] = [];
    const removeCommandListener = installBrunoTableGridCommandListener(
      "TABLE_ID_FILTER_OVERLAYS",
      (command) => commands.push(command),
    );

    try {
      const screen = await render(
        <BrunoTableClient<FilterRow, typeof filterColumns>
          tableId="TABLE_ID_FILTER_OVERLAYS"
          columns={filterColumns}
          initialOrderBy={[{ columnId: "COL_ID_FILTER_NAME", direction: "asc" }]}
          getRowId={(row) => row.id}
          clientSource={{
            rows: filterRows,
            totalRows: filterRows.length,
            version: 1,
            status: "ready",
          }}
          quickFilterFields={["symbol", "description"]}
        >
          <BrunoTableToolbar>
            <BrunoTableQuickFilter />
          </BrunoTableToolbar>
        </BrunoTableClient>,
      );

      const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_FILTER_OVERLAYS" });
      grid.element().focus();
      grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
      grid
        .element()
        .dispatchEvent(new KeyboardEvent("keydown", { altKey: true, bubbles: true, key: "Enter" }));
      await expect.element(screen.getByRole("dialog", { name: "Filter Name" })).toBeInTheDocument();
      await userEvent.keyboard("{Escape}");
      await expect.element(grid).toHaveFocus();

      for (const headerName of ["Name", "Score", "Quantity", "Active", "Status"]) {
        await userEvent.click(screen.getByRole("button", { name: `Filter ${headerName}` }));
        await expect
          .element(screen.getByRole("dialog", { name: `Filter ${headerName}` }))
          .toBeInTheDocument();
        await userEvent.keyboard("{Escape}");
        await expect.element(grid).toHaveFocus();
      }

      await userEvent.click(screen.getByRole("button", { name: "Filter Name" }));
      const nameDialog = screen.getByRole("dialog", { name: "Filter Name" });
      await userEvent.fill(
        nameDialog.getByRole("textbox", { name: "Filter value for Name" }),
        "Grace",
      );
      await expect
        .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
        .toBeInTheDocument();
      await expect
        .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
        .not.toBeInTheDocument();
      expect(commands.filter((command) => command.type === "column.filter.replace")).toHaveLength(
        1,
      );
    } finally {
      removeCommandListener();
    }
  });

  test("uses a trailing 150 ms Pacer commit and cancels pending filter drafts", async () => {
    const commands: BrunoTableGridCommand[] = [];
    const removeCommandListener = installBrunoTableGridCommandListener(
      "TABLE_ID_FILTER_PACER",
      (command) => commands.push(command),
    );

    try {
      const screen = await render(
        <BrunoTableClient<FilterRow, typeof filterColumns>
          tableId="TABLE_ID_FILTER_PACER"
          columns={filterColumns}
          initialFilters={[{ columnId: "COL_ID_FILTER_NAME", type: "equals", filter: "Ada" }]}
          initialOrderBy={[{ columnId: "COL_ID_FILTER_NAME", direction: "asc" }]}
          getRowId={(row) => row.id}
          clientSource={readyFilterSource()}
          quickFilterFields={["name"]}
        >
          <BrunoTableToolbar>
            <BrunoTableQuickFilter />
          </BrunoTableToolbar>
        </BrunoTableClient>,
      );

      await userEvent.click(screen.getByRole("button", { name: "Filter Name (active)" }));
      const dialog = screen.getByRole("dialog", { name: "Filter Name" });
      const input = dialog.getByRole("textbox", { name: "Filter value for Name" });
      const startedAt = performance.now();
      await userEvent.fill(input, "x".repeat(BRUNO_TABLE_MAX_FILTER_OPERAND_LENGTH + 100));
      await expect.element(input).toHaveValue("x".repeat(BRUNO_TABLE_MAX_FILTER_OPERAND_LENGTH));
      await userEvent.fill(input, "G");
      await userEvent.fill(input, "Grace");
      expect(commands.filter((command) => command.type === "column.filter.replace")).toHaveLength(
        0,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(commands.filter((command) => command.type === "column.filter.replace")).toHaveLength(
        0,
      );
      await vi.waitFor(() =>
        expect(commands.filter((command) => command.type === "column.filter.replace")).toHaveLength(
          1,
        ),
      );
      expect(performance.now() - startedAt).toBeGreaterThanOrEqual(140);
      expect(commands.at(-1)).toMatchObject({
        type: "column.filter.replace",
        columnId: "COL_ID_FILTER_NAME",
        filter: { columnId: "COL_ID_FILTER_NAME", type: "equals", filter: "Grace" },
      });

      await userEvent.fill(input, "Ada");
      await userEvent.keyboard("{Escape}");
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(commands.filter((command) => command.type === "column.filter.replace")).toHaveLength(
        1,
      );
      await expect
        .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
        .toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Filter Name (active)" }));
      const outsideDialog = screen.getByRole("dialog", { name: "Filter Name" });
      await userEvent.fill(
        outsideDialog.getByRole("textbox", { name: "Filter value for Name" }),
        "Ada",
      );
      await userEvent.click(screen.getByRole("searchbox", { name: "Quick Filter" }));
      await expect
        .element(screen.getByRole("dialog", { name: "Filter Name" }))
        .not.toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(commands.filter((command) => command.type === "column.filter.replace")).toHaveLength(
        1,
      );
      await expect
        .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
        .toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Filter Name (active)" }));
      await userEvent.fill(
        screen.getByRole("dialog", { name: "Filter Name" }).getByRole("textbox", {
          name: "Filter value for Name",
        }),
        "Ada",
      );
      await screen.getByRole("button", { name: "Clear filter for Name" }).click();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(commands.filter((command) => command.type === "column.filter.replace")).toHaveLength(
        1,
      );

      await userEvent.click(screen.getByRole("button", { name: "Filter Name" }));
      await userEvent.fill(
        screen.getByRole("dialog", { name: "Filter Name" }).getByRole("textbox", {
          name: "Filter value for Name",
        }),
        "Grace",
      );
      await screen.getByRole("button", { name: "Reset filter for Name" }).click();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(commands.filter((command) => command.type === "column.filter.replace")).toHaveLength(
        1,
      );
      await expect
        .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
        .toBeInTheDocument();
    } finally {
      removeCommandListener();
    }
  });

  test("isolates Client column filter subscriptions and local drafts", async () => {
    const tableId = "TABLE_ID_FILTER_SUBSCRIPTIONS";
    const filterSubscriptions: Array<{
      readonly columnId: string;
      readonly listenerCount: number;
      readonly phase: "subscribe" | "unsubscribe" | "notify";
    }> = [];
    const filterRenders = vi.fn();
    const viewRenders = vi.fn();
    const rowRenders = vi.fn();
    const removeFilterSubscriptionListener = installBrunoTableColumnFilterSubscriptionListener(
      tableId,
      (event) => filterSubscriptions.push(event),
    );
    const removeFilterRenderListener = installBrunoTableClientColumnFilterRenderListener(
      (columnId) => filterRenders(columnId),
    );
    const removeViewRenderListener = installBrunoTableClientViewRenderListenerForTable(
      tableId,
      viewRenders,
    );
    const removeRowRenderListener = installBrunoTableClientRowRenderListenerForTable(
      tableId,
      rowRenders,
    );

    try {
      const screen = await render(
        <BrunoTableClient<FilterRow, typeof filterColumns>
          tableId={tableId}
          columns={filterColumns}
          initialFilters={[{ columnId: "COL_ID_FILTER_NAME", type: "equals", filter: "Ada" }]}
          initialOrderBy={[{ columnId: "COL_ID_FILTER_NAME", direction: "asc" }]}
          getRowId={(row) => row.id}
          clientSource={readyFilterSource()}
        />,
      );
      await expect
        .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
        .toBeInTheDocument();

      filterSubscriptions.length = 0;
      filterRenders.mockClear();
      viewRenders.mockClear();
      rowRenders.mockClear();

      await userEvent.click(screen.getByRole("button", { name: "Filter Name" }));
      const dialog = screen.getByRole("dialog", { name: "Filter Name" });
      expect(filterRenders).toHaveBeenCalledWith("COL_ID_FILTER_NAME");
      expect(filterSubscriptions).toContainEqual({
        tableId,
        columnId: "COL_ID_FILTER_NAME",
        listenerCount: 1,
        phase: "subscribe",
      });
      const rendersAfterOpen = filterRenders.mock.calls.length;
      filterSubscriptions.length = 0;
      viewRenders.mockClear();
      rowRenders.mockClear();

      await userEvent.fill(dialog.getByRole("textbox", { name: "Filter value for Name" }), "Grace");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(viewRenders).not.toHaveBeenCalled();
      expect(rowRenders).not.toHaveBeenCalled();
      expect(filterSubscriptions).toHaveLength(0);
      expect(filterRenders.mock.calls.length).toBe(rendersAfterOpen);

      await expect
        .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
        .toBeInTheDocument();
      expect(
        filterSubscriptions.filter((event) => event.phase === "notify" && event.listenerCount > 0),
      ).toEqual([{ tableId, columnId: "COL_ID_FILTER_NAME", listenerCount: 1, phase: "notify" }]);
      expect(
        filterSubscriptions.some(
          (event) => event.columnId === "COL_ID_FILTER_SCORE" && event.phase === "notify",
        ),
      ).toBe(false);

      await userEvent.keyboard("{Escape}");
      await expect
        .element(screen.getByRole("dialog", { name: "Filter Name" }))
        .not.toBeInTheDocument();
      expect(filterSubscriptions).toContainEqual({
        tableId,
        columnId: "COL_ID_FILTER_NAME",
        listenerCount: 0,
        phase: "unsubscribe",
      });
      filterSubscriptions.length = 0;
      filterRenders.mockClear();

      await userEvent.click(screen.getByRole("button", { name: "Clear filter for Name" }));
      await expect
        .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
        .toBeInTheDocument();
      expect(
        filterSubscriptions.some(
          (event) =>
            event.columnId === "COL_ID_FILTER_NAME" &&
            event.listenerCount === 0 &&
            event.phase === "notify",
        ),
      ).toBe(true);
      expect(filterRenders).not.toHaveBeenCalled();
    } finally {
      removeRowRenderListener();
      removeViewRenderListener();
      removeFilterRenderListener();
      removeFilterSubscriptionListener();
    }
  });

  test("plans one query transition and row recomputation for one Grid Filter commit", async () => {
    const tableId = "TABLE_ID_FILTER_PLAN";
    const queryTransitions = vi.fn();
    const rowOrderPlans = vi.fn();
    const removeQueryTransitionListener =
      installBrunoTableClientQueryTransitionListener(queryTransitions);
    const removePlanningListener = installBrunoTableClientRowOrderPlanningListener(rowOrderPlans);

    try {
      const screen = await render(
        <BrunoTableClient<FilterRow, typeof filterColumns>
          tableId={tableId}
          columns={filterColumns}
          initialFilters={[{ columnId: "COL_ID_FILTER_NAME", type: "equals", filter: "Ada" }]}
          initialOrderBy={[{ columnId: "COL_ID_FILTER_NAME", direction: "asc" }]}
          getRowId={(row) => row.id}
          clientSource={readyFilterSource()}
        />,
      );
      await expect
        .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
        .toBeInTheDocument();
      queryTransitions.mockClear();
      rowOrderPlans.mockClear();

      await userEvent.click(screen.getByRole("button", { name: "Filter Name (active)" }));
      await userEvent.fill(
        screen
          .getByRole("dialog", { name: "Filter Name" })
          .getByRole("textbox", { name: "Filter value for Name" }),
        "Grace",
      );
      await expect
        .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
        .toBeInTheDocument();

      expect(queryTransitions).toHaveBeenCalledTimes(1);
      expect(queryTransitions).toHaveBeenLastCalledWith(tableId, 1);
      expect(rowOrderPlans).toHaveBeenCalledOnce();
    } finally {
      removePlanningListener();
      removeQueryTransitionListener();
    }
  });

  test("opens the filter overlay with the owning RTL direction", async () => {
    const screen = await render(
      <div dir="rtl">
        <BrunoTableClient<FilterRow, typeof filterColumns>
          tableId="TABLE_ID_FILTER_RTL"
          columns={filterColumns}
          initialOrderBy={[{ columnId: "COL_ID_FILTER_NAME", direction: "asc" }]}
          getRowId={(row) => row.id}
          clientSource={{
            rows: filterRows,
            totalRows: filterRows.length,
            version: 1,
            status: "ready",
          }}
        />
      </div>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Filter Name" }));
    const dialog = screen.getByRole("dialog", { name: "Filter Name" });
    await expect.element(dialog).toBeInTheDocument();
    expect(getComputedStyle(dialog.element()).direction).toBe("rtl");
    await userEvent.keyboard("{Escape}");
    await expect
      .element(screen.getByRole("grid", { name: "Data for TABLE_ID_FILTER_RTL" }))
      .toHaveFocus();
  });

  test("keeps invalid numeric drafts local and preserves Clear versus Reset", async () => {
    const screen = await render(
      <BrunoTableClient<FilterRow, typeof filterColumns>
        tableId="TABLE_ID_FILTER_VALIDATION"
        columns={filterColumns}
        initialFilters={[{ columnId: "COL_ID_FILTER_NAME", type: "equals", filter: "Ada" }]}
        initialOrderBy={[{ columnId: "COL_ID_FILTER_NAME", direction: "asc" }]}
        getRowId={(row) => row.id}
        quickFilterFields={["symbol", "description"]}
        clientSource={{
          rows: filterRows,
          totalRows: filterRows.length,
          version: 1,
          status: "ready",
        }}
      >
        <BrunoTableToolbar>
          <BrunoTableQuickFilter />
        </BrunoTableToolbar>
      </BrunoTableClient>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Filter Score" }));
    const scoreDialog = screen.getByRole("dialog", { name: "Filter Score" });
    await userEvent.click(scoreDialog.getByRole("spinbutton", { name: "Filter value for Score" }));
    await userEvent.keyboard("1e");
    await expect.element(scoreDialog.getByRole("alert")).toHaveTextContent("Enter a valid value.");
    await expect
      .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
      .not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    await userEvent.click(screen.getByRole("button", { name: "Filter Quantity" }));
    const quantityDialog = screen.getByRole("dialog", { name: "Filter Quantity" });
    await userEvent.fill(
      quantityDialog.getByRole("textbox", { name: "Filter value for Quantity" }),
      "1.5",
    );
    await expect
      .element(quantityDialog.getByRole("alert"))
      .toHaveTextContent("Expected signed base-10 integer digits.");
    await userEvent.keyboard("{Escape}");

    await screen.getByRole("button", { name: "Clear filter for Name" }).click();
    await expect
      .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
      .toBeInTheDocument();
    await screen.getByRole("button", { name: "Reset filter for Name" }).click();
    await expect
      .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
      .not.toBeInTheDocument();
  });

  test("does not recompute or transition for invalid Number and BigInt drafts", async () => {
    const queryTransitions = vi.fn();
    const rowOrderPlans = vi.fn();
    const commands: BrunoTableGridCommand[] = [];
    const removeQueryTransitionListener =
      installBrunoTableClientQueryTransitionListener(queryTransitions);
    const removePlanningListener = installBrunoTableClientRowOrderPlanningListener(rowOrderPlans);
    const removeCommandListener = installBrunoTableGridCommandListener(
      "TABLE_ID_FILTER_INVALID_INSTRUMENTED",
      (command) => commands.push(command),
    );
    try {
      const screen = await render(
        <BrunoTableClient<FilterRow, typeof filterColumns>
          tableId="TABLE_ID_FILTER_INVALID_INSTRUMENTED"
          columns={filterColumns}
          initialOrderBy={[{ columnId: "COL_ID_FILTER_NAME", direction: "asc" }]}
          getRowId={(row) => row.id}
          clientSource={readyFilterSource()}
        />,
      );
      await expect
        .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
        .toBeInTheDocument();
      queryTransitions.mockClear();
      rowOrderPlans.mockClear();
      commands.length = 0;

      await userEvent.click(screen.getByRole("button", { name: "Filter Score" }));
      const scoreDialog = screen.getByRole("dialog", { name: "Filter Score" });
      const scoreInput = scoreDialog.getByRole("spinbutton", { name: "Filter value for Score" });
      await userEvent.click(scoreInput);
      await userEvent.keyboard("1e");
      await expect
        .element(scoreDialog.getByRole("alert"))
        .toHaveTextContent("Enter a valid value.");
      expect(commands).toHaveLength(0);
      expect(queryTransitions).not.toHaveBeenCalled();
      expect(rowOrderPlans).not.toHaveBeenCalled();
      await userEvent.keyboard("{Escape}");

      queryTransitions.mockClear();
      rowOrderPlans.mockClear();
      commands.length = 0;
      await userEvent.click(screen.getByRole("button", { name: "Filter Quantity" }));
      const quantityDialog = screen.getByRole("dialog", { name: "Filter Quantity" });
      await userEvent.fill(
        quantityDialog.getByRole("textbox", { name: "Filter value for Quantity" }),
        "1.5",
      );
      await expect
        .element(quantityDialog.getByRole("alert"))
        .toHaveTextContent("Expected signed base-10 integer digits.");
      expect(commands).toHaveLength(0);
      expect(queryTransitions).not.toHaveBeenCalled();
      expect(rowOrderPlans).not.toHaveBeenCalled();
    } finally {
      removeCommandListener();
      removePlanningListener();
      removeQueryTransitionListener();
    }
  });

  test("applies exact numeric families, immediate choices, and same-column compounds", async () => {
    const screen = await render(
      <BrunoTableClient<FilterRow, typeof filterColumns>
        tableId="TABLE_ID_FILTER_OPERATORS"
        columns={filterColumns}
        initialOrderBy={[{ columnId: "COL_ID_FILTER_NAME", direction: "asc" }]}
        getRowId={(row) => row.id}
        quickFilterFields={["symbol", "description"]}
        clientSource={{
          rows: filterRows,
          totalRows: filterRows.length,
          version: 1,
          status: "ready",
        }}
      >
        <BrunoTableToolbar>
          <BrunoTableQuickFilter />
        </BrunoTableToolbar>
      </BrunoTableClient>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Filter Score" }));
    let dialog = screen.getByRole("dialog", { name: "Filter Score" });
    await userEvent.selectOptions(
      dialog.getByRole("combobox", { name: "Filter operator for Score" }),
      "inRange",
    );
    dialog = screen.getByRole("dialog", { name: "Filter Score" });
    await expect
      .element(dialog.getByRole("combobox", { name: "Filter operator for Score" }))
      .toHaveValue("inRange");
    await userEvent.fill(dialog.getByRole("spinbutton", { name: "Filter value for Score" }), "2");
    await userEvent.fill(
      dialog.getByRole("spinbutton", { name: "Filter upper bound for Score" }),
      "4",
    );
    await expect
      .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
      .not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Clear filter for Score" }).click();

    await userEvent.click(screen.getByRole("button", { name: "Filter Quantity" }));
    dialog = screen.getByRole("dialog", { name: "Filter Quantity" });
    await userEvent.selectOptions(
      dialog.getByRole("combobox", { name: "Filter operator for Quantity" }),
      "greaterThan",
    );
    dialog = screen.getByRole("dialog", { name: "Filter Quantity" });
    await userEvent.fill(
      dialog.getByRole("textbox", { name: "Filter value for Quantity" }),
      "9007199254740993",
    );
    await expect
      .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
      .not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Clear filter for Quantity" }).click();

    await userEvent.click(screen.getByRole("button", { name: "Filter Active" }));
    dialog = screen.getByRole("dialog", { name: "Filter Active" });
    await expect
      .element(dialog.getByRole("combobox", { name: "Filter value for Active" }))
      .toHaveValue("");
    await userEvent.selectOptions(
      dialog.getByRole("combobox", { name: "Filter operator for Active" }),
      "notEqual",
    );
    dialog = screen.getByRole("dialog", { name: "Filter Active" });
    await expect
      .element(dialog.getByRole("combobox", { name: "Filter operator for Active" }))
      .toHaveValue("notEqual");
    await userEvent.selectOptions(
      dialog.getByRole("combobox", { name: "Filter value for Active" }),
      "false",
    );
    dialog = screen.getByRole("dialog", { name: "Filter Active" });
    await expect
      .element(dialog.getByRole("combobox", { name: "Filter value for Active" }))
      .toHaveValue("false");
    await expect
      .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
      .not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Clear filter for Active" }).click();

    await userEvent.click(screen.getByRole("button", { name: "Filter Status" }));
    dialog = screen.getByRole("dialog", { name: "Filter Status" });
    await userEvent.selectOptions(
      dialog.getByRole("combobox", { name: "Filter value for Status" }),
      "bruno-select-option-1",
    );
    await expect
      .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
      .not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Clear filter for Status" }).click();

    await userEvent.click(screen.getByRole("button", { name: "Filter Name" }));
    dialog = screen.getByRole("dialog", { name: "Filter Name" });
    await userEvent.selectOptions(
      dialog.getByRole("combobox", { name: "Filter expression for Name" }),
      "AND",
    );
    dialog = screen.getByRole("dialog", { name: "Filter Name" });
    await expect
      .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
      .toBeInTheDocument();
    const firstNameValue = dialog.getByRole("textbox", {
      name: "Filter value for Name (condition 1)",
    });
    const secondNameValue = dialog.getByRole("textbox", {
      name: "Filter value for Name (condition 2)",
    });
    await expect
      .element(dialog.getByRole("combobox", { name: "Filter operator for Name (condition 1)" }))
      .toBeInTheDocument();
    await userEvent.fill(firstNameValue, "Ada");
    await userEvent.fill(secondNameValue, "Ada");
    await expect
      .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
      .not.toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Add condition for Name" }));
    await vi.waitFor(() =>
      expect(
        dialog.getByRole("combobox", { name: "Filter expression for Name (condition 3)" }),
      ).toHaveFocus(),
    );
    await userEvent.click(dialog.getByRole("button", { name: "Remove condition 3 for Name" }));
    await userEvent.selectOptions(
      dialog.getByRole("combobox", { name: "Filter operator for Name (condition 1)" }),
      "in",
    );
    await userEvent.click(dialog.getByRole("button", { name: "Add filter value for Name" }));
    await vi.waitFor(() =>
      expect(
        dialog.getByRole("textbox", { name: "Filter value 2 for Name (condition 1)" }),
      ).toHaveFocus(),
    );
    await userEvent.click(dialog.getByRole("button", { name: "Remove filter value 2 for Name" }));
    await vi.waitFor(() => expect(firstNameValue).toHaveFocus());
    await userEvent.click(dialog.getByRole("button", { name: "Remove condition 1 for Name" }));
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("combobox", { name: "Filter expression for Name" }).element(),
      ),
    );
    await userEvent.selectOptions(
      dialog.getByRole("combobox", { name: "Filter expression for Name" }).nth(0),
      "NOT",
    );
    dialog = screen.getByRole("dialog", { name: "Filter Name" });
    await expect
      .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
      .not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("searchbox", { name: "Quick Filter" }));
    await expect
      .element(screen.getByRole("dialog", { name: "Filter Name" }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByRole("searchbox", { name: "Quick Filter" })).toHaveFocus();
  });

  test("preserves oversized native BigInt operands while changing operators", async () => {
    const screen = await render(
      <BrunoTableClient<FilterRow, typeof filterColumns>
        tableId="TABLE_ID_FILTER_OVERSIZED_BIGINT"
        columns={filterColumns}
        initialFilters={[
          {
            columnId: "COL_ID_FILTER_QUANTITY",
            type: "equals",
            filter: oversizedQuantity,
          },
        ]}
        initialOrderBy={[{ columnId: "COL_ID_FILTER_NAME", direction: "asc" }]}
        getRowId={(row) => row.id}
        clientSource={readyFilterSource(oversizedFilterRows)}
      />,
    );

    await expect
      .element(screen.getByRole("gridcell", { name: "Oversized", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
      .not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Filter Quantity (active)" }));
    const dialog = screen.getByRole("dialog", { name: "Filter Quantity" });
    await expect
      .element(dialog.getByRole("textbox", { name: "Filter value for Quantity" }))
      .toHaveValue(oversizedQuantity.toString());
    await userEvent.selectOptions(
      dialog.getByRole("combobox", { name: "Filter operator for Quantity" }),
      "notEqual",
    );

    await expect
      .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Oversized", exact: true }))
      .not.toBeInTheDocument();
  });

  test("applies Quick Filter OR semantics to hidden fields and keeps it independent from Grid Filters", async () => {
    const toolbar = (
      <BrunoTableToolbar>
        <BrunoTableQuickFilter />
      </BrunoTableToolbar>
    );
    const screen = await render(
      <BrunoTableClient<FilterRow, typeof filterColumns>
        tableId="TABLE_ID_QUICK_FILTER_BROWSER"
        columns={filterColumns}
        initialFilters={[{ columnId: "COL_ID_FILTER_NAME", type: "equals", filter: "Ada" }]}
        initialOrderBy={[{ columnId: "COL_ID_FILTER_NAME", direction: "asc" }]}
        getRowId={(row) => row.id}
        clientSource={{
          rows: filterRows,
          totalRows: filterRows.length,
          version: 1,
          status: "ready",
        }}
        quickFilterFields={["symbol", "description"]}
      >
        {toolbar}
      </BrunoTableClient>,
    );
    const quickFilter = screen.getByRole("searchbox", { name: "Quick Filter" });

    await userEvent.fill(quickFilter, "micro");
    await expect
      .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByRole("searchbox", { name: "Quick Filter" })).toHaveFocus();

    await screen.getByRole("button", { name: "Clear Quick Filter" }).click();
    await expect.element(screen.getByRole("searchbox", { name: "Quick Filter" })).toHaveFocus();
    await expect
      .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
      .not.toBeInTheDocument();

    await screen.getByRole("button", { name: "Clear filter for Name" }).click();
    await userEvent.fill(quickFilter, "apple");
    await expect
      .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
      .not.toBeInTheDocument();
    await userEvent.fill(quickFilter, "msft");
    await expect
      .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
      .not.toBeInTheDocument();
  });

  test("reviews and clears Grid Filters and Quick Filter through the active-filter control", async () => {
    const screen = await render(
      <BrunoTableClient<FilterRow, typeof filterColumns>
        tableId="TABLE_ID_ACTIVE_FILTER_REVIEW"
        columns={filterColumns}
        initialFilters={[
          { columnId: "COL_ID_FILTER_NAME", type: "equals", filter: "Ada" },
          { columnId: "COL_ID_FILTER_SCORE", type: "equals", filter: 4 },
        ]}
        initialOrderBy={[{ columnId: "COL_ID_FILTER_NAME", direction: "asc" }]}
        getRowId={(row) => row.id}
        clientSource={readyFilterSource()}
        quickFilterFields={["symbol", "description"]}
      >
        <BrunoTableToolbar>
          <BrunoTableQuickFilter />
        </BrunoTableToolbar>
      </BrunoTableClient>,
    );

    const quickFilter = screen.getByRole("searchbox", { name: "Quick Filter" });
    await userEvent.fill(quickFilter, "apple");
    await expect
      .element(screen.getByRole("button", { name: "Active filters (3)" }))
      .toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Active filters (3)" }));
    const review = screen.getByRole("dialog", { name: "Active filters" });
    await expect
      .element(review.getByRole("button", { name: 'Remove Name: equals "Ada"' }))
      .toBeInTheDocument();
    await userEvent.click(review.getByRole("button", { name: 'Remove Name: equals "Ada"' }));
    await expect
      .element(screen.getByRole("button", { name: "Active filters (2)" }))
      .toBeInTheDocument();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        review.getByRole("button", { name: "Remove Score: equals 4" }).element(),
      ),
    );

    await userEvent.click(review.getByRole("button", { name: "Clear all Grid Filters" }));
    await expect
      .element(screen.getByRole("button", { name: "Active filters (1)" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
      .toBeInTheDocument();

    await userEvent.click(
      review.getByRole("button", { name: 'Remove Quick Filter contains "apple"' }),
    );
    await expect
      .element(screen.getByRole("button", { name: "Active filters (0)" }))
      .toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Active filters (0)" })).toHaveFocus();
    await expect
      .element(screen.getByRole("dialog", { name: "Active filters" }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
      .toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Filter Name" }));
    const nameFilter = screen.getByRole("dialog", { name: "Filter Name" });
    await userEvent.fill(nameFilter.getByRole("textbox", { name: "Filter value for Name" }), "Ada");
    await expect
      .element(screen.getByRole("button", { name: "Active filters (1)" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("dialog", { name: "Active filters" }))
      .not.toBeInTheDocument();
  });

  test("restores grid focus when an open filter owner is removed", async () => {
    const replacementColumns = [
      {
        columnId: "COL_ID_FILTER_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
      {
        columnId: "COL_ID_FILTER_QUANTITY",
        field: "quantity",
        headerName: "Quantity",
        valueType: "bigint",
      },
    ] as const satisfies BrunoTableColumns<FilterRow>;
    const screen = await render(
      <BrunoTableClient<FilterRow, typeof filterColumns>
        tableId="TABLE_ID_FILTER_OWNER_UNMOUNT"
        columns={filterColumns}
        initialOrderBy={[{ columnId: "COL_ID_FILTER_NAME", direction: "asc" }]}
        getRowId={(row) => row.id}
        clientSource={readyFilterSource()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Filter Score" }));
    await expect.element(screen.getByRole("dialog", { name: "Filter Score" })).toBeInTheDocument();

    await screen.rerender(
      <BrunoTableClient<FilterRow, typeof replacementColumns>
        tableId="TABLE_ID_FILTER_OWNER_UNMOUNT"
        columns={replacementColumns}
        initialOrderBy={[{ columnId: "COL_ID_FILTER_NAME", direction: "asc" }]}
        getRowId={(row) => row.id}
        clientSource={readyFilterSource()}
      />,
    );

    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("grid", { name: "Data for TABLE_ID_FILTER_OWNER_UNMOUNT" }).element(),
      ),
    );
    await expect
      .element(screen.getByRole("dialog", { name: "Filter Score" }))
      .not.toBeInTheDocument();
  });

  test("reviews half-open ranges and text sensitivity in the global filter rail", async () => {
    const screen = await render(
      <BrunoTableClient<FilterRow, typeof filterColumns>
        tableId="TABLE_ID_ACTIVE_FILTER_DETAILS"
        columns={filterColumns}
        initialFilters={[
          {
            columnId: "COL_ID_FILTER_NAME",
            type: "equals",
            filter: "Ada",
            caseSensitive: true,
            accentSensitive: true,
          },
          { columnId: "COL_ID_FILTER_SCORE", type: "inRange", filter: 2, filterTo: 4 },
        ]}
        initialOrderBy={[{ columnId: "COL_ID_FILTER_NAME", direction: "asc" }]}
        getRowId={(row) => row.id}
        clientSource={readyFilterSource()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Active filters (2)" }));
    const review = screen.getByRole("dialog", { name: "Active filters" });
    await expect
      .element(
        review.getByRole("button", {
          name: 'Remove Name: equals (case-sensitive, accent-sensitive) "Ada"',
        }),
      )
      .toBeInTheDocument();
    await expect
      .element(
        review.getByRole("button", {
          name: "Remove Score: inRange 2 ≤ value < 4 (upper bound exclusive)",
        }),
      )
      .toBeInTheDocument();
  });

  test("disambiguates active filters when columns share a header", async () => {
    const screen = await render(
      <BrunoTableClient<FilterRow, typeof duplicateHeaderFilterColumns>
        tableId="TABLE_ID_ACTIVE_FILTER_DUPLICATE_HEADERS"
        columns={duplicateHeaderFilterColumns}
        initialFilters={[
          { columnId: "COL_ID_DUPLICATE_NAME", type: "equals", filter: "Ada" },
          {
            columnId: "COL_ID_DUPLICATE_QUANTITY",
            type: "equals",
            filter: filterRows[0]!.quantity,
          },
        ]}
        initialOrderBy={[{ columnId: "COL_ID_DUPLICATE_NAME", direction: "asc" }]}
        getRowId={(row) => row.id}
        clientSource={readyFilterSource()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Active filters (2)" }));
    const review = screen.getByRole("dialog", { name: "Active filters" });
    await expect
      .element(
        review.getByRole("button", {
          name: 'Remove Value (column 1): equals "Ada"',
        }),
      )
      .toBeInTheDocument();
    await expect
      .element(
        review.getByRole("button", {
          name: `Remove Value (column 2): equals ${filterRows[0]!.quantity.toString()}`,
        }),
      )
      .toBeInTheDocument();
  });

  test("keeps the sanitized initial filter baseline when the prop changes later", async () => {
    const clientSource = readyFilterSource();
    const renderTable = (
      initialFilters: BrunoTableFilterExpressions<FilterRow, typeof filterColumns>,
    ) => (
      <BrunoTableClient<FilterRow, typeof filterColumns>
        tableId="TABLE_ID_FILTER_BASELINE_PROPS"
        columns={filterColumns}
        initialFilters={initialFilters}
        initialOrderBy={[{ columnId: "COL_ID_FILTER_NAME", direction: "asc" }]}
        getRowId={(row) => row.id}
        clientSource={clientSource}
      />
    );
    const screen = await render(
      renderTable([{ columnId: "COL_ID_FILTER_NAME", type: "equals", filter: "Ada" }]),
    );

    await expect
      .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
      .toBeInTheDocument();
    await screen.getByRole("button", { name: "Clear filter for Name" }).click();
    await expect
      .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
      .toBeInTheDocument();

    await screen.rerender(
      renderTable([{ columnId: "COL_ID_FILTER_NAME", type: "equals", filter: "Grace" }]),
    );
    await expect
      .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
      .toBeInTheDocument();

    await screen.getByRole("button", { name: "Reset filter for Name" }).click();
    await expect
      .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
      .not.toBeInTheDocument();
  });

  test("keeps editor focus after a debounced filter commit", async () => {
    const screen = await render(
      <BrunoTableClient<FilterRow, typeof filterColumns>
        tableId="TABLE_ID_FILTER_PACER_FOCUS"
        columns={filterColumns}
        initialOrderBy={[{ columnId: "COL_ID_FILTER_NAME", direction: "asc" }]}
        getRowId={(row) => row.id}
        clientSource={readyFilterSource()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Filter Name" }));
    const dialog = screen.getByRole("dialog", { name: "Filter Name" });
    const input = dialog.getByRole("textbox", { name: "Filter value for Name" });
    await userEvent.fill(input, "Ada");
    await expect
      .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
      .toBeInTheDocument();
    await expect.element(input).toHaveFocus();
  });

  test("coalesces rapid Quick Filter input through the trailing 150 ms Pacer commit", async () => {
    const commands: BrunoTableGridCommand[] = [];
    const removeCommandListener = installBrunoTableGridCommandListener(
      "TABLE_ID_QUICK_FILTER_PACER",
      (command) => commands.push(command),
    );
    try {
      const screen = await render(
        <BrunoTableClient<FilterRow, typeof filterColumns>
          tableId="TABLE_ID_QUICK_FILTER_PACER"
          columns={filterColumns}
          initialOrderBy={[{ columnId: "COL_ID_FILTER_NAME", direction: "asc" }]}
          getRowId={(row) => row.id}
          clientSource={readyFilterSource()}
          quickFilterFields={["symbol", "description"]}
        >
          <BrunoTableToolbar>
            <BrunoTableQuickFilter />
          </BrunoTableToolbar>
        </BrunoTableClient>,
      );
      const quickFilter = screen.getByRole("searchbox", { name: "Quick Filter" });
      await userEvent.fill(quickFilter, "m");
      await userEvent.fill(quickFilter, "ms");
      await userEvent.fill(quickFilter, "msft");
      expect(commands.filter((command) => command.type === "quick-filter.replace")).toHaveLength(0);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(commands.filter((command) => command.type === "quick-filter.replace")).toHaveLength(0);
      await vi.waitFor(() =>
        expect(commands.filter((command) => command.type === "quick-filter.replace")).toHaveLength(
          1,
        ),
      );
      expect(commands.at(-1)).toEqual({ type: "quick-filter.replace", text: "msft" });
    } finally {
      removeCommandListener();
    }
  });

  test("plans one row-order recomputation for one committed Quick Filter", async () => {
    const rowOrderPlans = vi.fn();
    const commands: BrunoTableGridCommand[] = [];
    const removePlanningListener = installBrunoTableClientRowOrderPlanningListener(rowOrderPlans);
    const removeCommandListener = installBrunoTableGridCommandListener(
      "TABLE_ID_QUICK_FILTER_PLAN",
      (command) => commands.push(command),
    );
    try {
      const screen = await render(
        <BrunoTableClient<FilterRow, typeof filterColumns>
          tableId="TABLE_ID_QUICK_FILTER_PLAN"
          columns={filterColumns}
          initialOrderBy={[{ columnId: "COL_ID_FILTER_NAME", direction: "asc" }]}
          getRowId={(row) => row.id}
          clientSource={readyFilterSource()}
          quickFilterFields={["symbol", "description"]}
        >
          <BrunoTableToolbar>
            <BrunoTableQuickFilter />
          </BrunoTableToolbar>
        </BrunoTableClient>,
      );

      await expect
        .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
        .toBeInTheDocument();
      rowOrderPlans.mockClear();
      commands.length = 0;

      await userEvent.fill(screen.getByRole("searchbox", { name: "Quick Filter" }), "msft");
      await expect
        .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
        .toBeInTheDocument();
      await expect
        .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
        .not.toBeInTheDocument();
      expect(rowOrderPlans).toHaveBeenCalledOnce();
      expect(commands.filter((command) => command.type === "quick-filter.replace")).toHaveLength(1);
    } finally {
      removeCommandListener();
      removePlanningListener();
    }
  });

  test("does not rerender the mounted Quick Filter for a passive source publication", async () => {
    const quickFilterRenders = vi.fn();
    const removeRenderListener =
      installBrunoTableClientQuickFilterRenderListener(quickFilterRenders);
    const toolbar = (
      <BrunoTableToolbar>
        <BrunoTableQuickFilter />
      </BrunoTableToolbar>
    );
    try {
      const screen = await render(
        <BrunoTableClient<FilterRow, typeof filterColumns>
          tableId="TABLE_ID_QUICK_FILTER_SUBSCRIPTIONS"
          columns={filterColumns}
          initialOrderBy={[{ columnId: "COL_ID_FILTER_NAME", direction: "asc" }]}
          getRowId={(row) => row.id}
          clientSource={{
            rows: filterRows,
            totalRows: filterRows.length,
            version: 1,
            status: "ready",
          }}
          quickFilterFields={["symbol", "description"]}
        >
          {toolbar}
        </BrunoTableClient>,
      );
      const mountedRenders = quickFilterRenders.mock.calls.length;
      await userEvent.fill(screen.getByRole("searchbox", { name: "Quick Filter" }), "apple");
      await expect
        .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
        .toBeInTheDocument();
      await vi.waitFor(() =>
        expect(quickFilterRenders.mock.calls.length).toBeGreaterThan(mountedRenders),
      );
      const committedRenders = quickFilterRenders.mock.calls.length;
      await screen.rerender(
        <BrunoTableClient<FilterRow, typeof filterColumns>
          tableId="TABLE_ID_QUICK_FILTER_SUBSCRIPTIONS"
          columns={filterColumns}
          initialOrderBy={[{ columnId: "COL_ID_FILTER_NAME", direction: "asc" }]}
          getRowId={(row) => row.id}
          clientSource={{
            rows: [filterRows[1], filterRows[0]],
            totalRows: filterRows.length,
            version: 2,
            status: "ready",
          }}
          quickFilterFields={["symbol", "description"]}
        >
          {toolbar}
        </BrunoTableClient>,
      );
      await expect
        .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
        .not.toBeInTheDocument();
      for (let version = 3; version <= 22; version += 1) {
        await screen.rerender(
          <BrunoTableClient<FilterRow, typeof filterColumns>
            tableId="TABLE_ID_QUICK_FILTER_SUBSCRIPTIONS"
            columns={filterColumns}
            initialOrderBy={[{ columnId: "COL_ID_FILTER_NAME", direction: "asc" }]}
            getRowId={(row) => row.id}
            clientSource={{
              rows: [filterRows[0], filterRows[1]],
              totalRows: 2,
              version,
              status: "ready",
            }}
            quickFilterFields={["symbol", "description"]}
          >
            {toolbar}
          </BrunoTableClient>,
        );
      }
      expect(quickFilterRenders).toHaveBeenCalledTimes(committedRenders);
      expect(committedRenders).toBeGreaterThanOrEqual(mountedRenders);
    } finally {
      removeRenderListener();
    }
  });

  test("resets vertical position for a filter query while preserving horizontal scroll", async () => {
    const largeRows = Array.from({ length: 100 }, (_, index) => ({
      id: `row-${index}`,
      name: `Row ${index}`,
      score: index,
    })) satisfies readonly Row[];
    const screen = await render(
      <BrunoTableClient<Row, typeof wideColumns>
        tableId="TABLE_ID_FILTER_SCROLL"
        columns={wideColumns}
        initialOrderBy={[{ columnId: "COL_ID_WIDE_01", direction: "asc" }]}
        getRowId={(row) => row.id}
        quickFilterFields={["name"]}
        clientSource={readySource(largeRows)}
      >
        <BrunoTableToolbar>
          <BrunoTableQuickFilter />
        </BrunoTableToolbar>
      </BrunoTableClient>,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_FILTER_SCROLL" });

    await grid.wheel({ delta: { x: 1200, y: 1200 } });
    await vi.waitFor(() => {
      expect(grid.element().scrollTop).toBeGreaterThan(0);
      expect(grid.element().scrollLeft).toBeGreaterThan(0);
    });
    const horizontalScroll = grid.element().scrollLeft;

    const quickFilter = screen.getByRole("searchbox", { name: "Quick Filter" });
    await userEvent.fill(quickFilter, "Row 0");
    await expect
      .element(screen.getByRole("gridcell", { name: "Row 0", exact: true }).nth(0))
      .toBeInTheDocument();
    await vi.waitFor(() => expect(grid.element().scrollTop).toBe(0));
    expect(grid.element().scrollLeft).toBe(horizontalScroll);
  });

  test("reconciles a hidden active cell when a filter query resets the body", async () => {
    const largeRows = Array.from({ length: 100 }, (_, index) => ({
      id: `active-filter-row-${index}`,
      name: `Row ${index}`,
      score: index,
    })) satisfies readonly Row[];
    const screen = await render(
      <BrunoTableClient<Row, typeof wideColumns>
        tableId="TABLE_ID_FILTER_ACTIVE_CELL"
        columns={wideColumns}
        initialOrderBy={[{ columnId: "COL_ID_WIDE_01", direction: "asc" }]}
        getRowId={(row) => row.id}
        quickFilterFields={["name"]}
        clientSource={readySource(largeRows)}
      >
        <BrunoTableToolbar>
          <BrunoTableQuickFilter />
        </BrunoTableToolbar>
      </BrunoTableClient>,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_FILTER_ACTIVE_CELL" });
    const activeCell = () => {
      const activeId = grid.element().getAttribute("aria-activedescendant");
      return screen
        .getByRole("gridcell")
        .all()
        .find((cell) => cell.element().id === activeId);
    };

    grid.element().focus();
    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "PageDown" }));
    await vi.waitFor(() =>
      expect(activeCell()?.element().textContent).toMatch(/^Row [1-9][0-9]*$/),
    );

    await grid.wheel({ delta: { x: 1200, y: 1200 } });
    await vi.waitFor(() => {
      expect(grid.element().scrollTop).toBeGreaterThan(0);
      expect(grid.element().scrollLeft).toBeGreaterThan(0);
    });
    const horizontalScroll = grid.element().scrollLeft;

    const quickFilter = screen.getByRole("searchbox", { name: "Quick Filter" });
    await userEvent.fill(quickFilter, "Row 0");
    await expect
      .element(screen.getByRole("gridcell", { name: "Row 0", exact: true }).nth(0))
      .toBeInTheDocument();
    await vi.waitFor(() => {
      expect(grid.element().scrollTop).toBe(0);
      const nextActiveCell = activeCell();
      expect(nextActiveCell === undefined || nextActiveCell.element().textContent === "Row 0").toBe(
        true,
      );
    });
    expect(grid.element().scrollLeft).toBe(horizontalScroll);
    expect(document.activeElement).toBe(quickFilter.element());
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

  test("keeps equal descending sort keys in stable source order", async () => {
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
      .toHaveTextContent("Zulu");
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
      .toHaveTextContent("Undefined");
    await expect
      .element(screen.getByRole("row").nth(2).getByRole("gridcell").nth(0))
      .toHaveTextContent("Null");
    await expect
      .element(screen.getByRole("row").nth(3).getByRole("gridcell").nth(0))
      .toHaveTextContent("Number");
    await expect
      .element(screen.getByRole("row").nth(1).getByRole("gridcell").nth(1))
      .toHaveTextContent("");
    await expect
      .element(screen.getByRole("row").nth(2).getByRole("gridcell").nth(1))
      .toHaveTextContent("");

    const nullToValueRows: readonly OptionalRow[] = Object.freeze([
      { id: "z-undefined", name: "Undefined" },
      { id: "a-null", name: "Null becomes two", score: 2 },
      { id: "m-number", name: "Number", score: 1 },
    ]);
    await screen.rerender(
      <BrunoTableClient
        tableId="TABLE_ID_OPTIONAL"
        getRowId={(row: OptionalRow) => row.id}
        columns={optionalColumns}
        initialOrderBy={[{ columnId: "COL_ID_SCORE", direction: "asc" }]}
        clientSource={{
          rows: nullToValueRows,
          totalRows: nullToValueRows.length,
          version: 2,
          status: "ready",
        }}
      />,
    );
    await expect
      .element(screen.getByRole("row").nth(3).getByRole("gridcell").nth(0))
      .toHaveTextContent("Null becomes two");

    const valueToUndefinedRows: readonly OptionalRow[] = Object.freeze([
      { id: "z-undefined", name: "Undefined" },
      { id: "a-null", name: "Two becomes undefined" },
      { id: "m-number", name: "Number", score: 1 },
    ]);
    await screen.rerender(
      <BrunoTableClient
        tableId="TABLE_ID_OPTIONAL"
        getRowId={(row: OptionalRow) => row.id}
        columns={optionalColumns}
        initialOrderBy={[{ columnId: "COL_ID_SCORE", direction: "asc" }]}
        clientSource={{
          rows: valueToUndefinedRows,
          totalRows: valueToUndefinedRows.length,
          version: 3,
          status: "ready",
        }}
      />,
    );
    await expect
      .element(screen.getByRole("row").nth(1).getByRole("gridcell").nth(0))
      .toHaveTextContent("Undefined");
    await expect
      .element(screen.getByRole("row").nth(2).getByRole("gridcell").nth(0))
      .toHaveTextContent("Two becomes undefined");
    await expect
      .element(screen.getByRole("row").nth(3).getByRole("gridcell").nth(1))
      .toHaveTextContent("1");

    const updatedRows = [
      optionalRows[0]!,
      { ...optionalRows[1]!, name: "Still null" },
      optionalRows[2]!,
    ] satisfies readonly OptionalRow[];
    const queryReads = vi.fn();
    const removeQueryReadListener = installBrunoTableClientQueryValueReadListener(
      (rowId, columnId, tableId) => {
        if (tableId === "TABLE_ID_OPTIONAL") queryReads(rowId, columnId);
      },
    );
    try {
      await expect(
        screen.rerender(
          <BrunoTableClient
            tableId="TABLE_ID_OPTIONAL"
            getRowId={(row: OptionalRow) => row.id}
            columns={optionalColumns}
            initialOrderBy={[{ columnId: "COL_ID_SCORE", direction: "asc" }]}
            clientSource={{
              rows: updatedRows,
              totalRows: updatedRows.length,
              version: 4,
              status: "ready",
            }}
          />,
        ),
      ).resolves.toBeUndefined();
      await expect
        .element(screen.getByRole("gridcell", { name: "Still null" }))
        .toBeInTheDocument();
      expect(queryReads).not.toHaveBeenCalled();
    } finally {
      removeQueryReadListener();
    }
  });

  test("renders loading skeletons and rejects an incomplete ready source visibly", async () => {
    const screen = await render(
      <BrunoTableClient
        {...props}
        clientSource={{ rows: [], totalRows: 1_000_000, version: 1, status: "loading" }}
      />,
    );
    const loadingGrid = screen.getByRole("grid", { name: "Loading table rows" });
    await expect.element(loadingGrid).toBeInTheDocument();
    await expect.element(loadingGrid).toHaveAttribute("aria-rowcount", "1000000");
    expect(screen.getByRole("row").all().length).toBeLessThan(100);
    expect(Number.parseFloat(screen.getByRole("rowgroup").element().style.height)).toBe(
      BRUNO_TABLE_MAX_PHYSICAL_ROW_HEIGHT,
    );
    const initialLoadingRow = screen.getByRole("row").nth(2);
    await expect.element(initialLoadingRow).toBeInTheDocument();
    expect(initialLoadingRow.element().style.height).toBe(`${String(BRUNO_TABLE_ROW_HEIGHT)}px`);

    loadingGrid.element().scrollTop = loadingGrid.element().scrollHeight;
    loadingGrid.element().dispatchEvent(new Event("scroll"));
    await vi.waitFor(() =>
      expect(
        screen
          .getByRole("row")
          .all()
          .some((row) => row.element().getAttribute("aria-rowindex") === "1000000"),
      ).toBe(true),
    );
    expect(screen.getByRole("row").all().length).toBeLessThan(100);

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={{ rows: [], totalRows: 0, version: 2, status: "loading" }}
      />,
    );
    await expect
      .element(screen.getByRole("grid", { name: "Loading table rows" }))
      .toBeInTheDocument();
    expect(screen.getByRole("row").nth(0).element().style.height).toBe(
      `${String(BRUNO_TABLE_ROW_HEIGHT)}px`,
    );

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={{
          rows: [],
          totalRows: Number.POSITIVE_INFINITY,
          version: 2,
          status: "loading",
        }}
      />,
    );
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Unreadable Client Source lifecycle field: totalRows.");

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={{ rows: [], totalRows: 1.5, version: 2, status: "loading" }}
      />,
    );
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Unreadable Client Source lifecycle field: totalRows.");

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={{ rows, totalRows: rows.length, version: 2, status: "loading" }}
      />,
    );
    await expect
      .element(screen.getByRole("grid", { name: "Loading table rows" }))
      .toBeInTheDocument();
    await expect.element(screen.getByRole("gridcell", { name: "Grace" })).not.toBeInTheDocument();

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
        clientSource={{
          rows: [rows[0]!],
          totalRows: 2,
          version: 4,
          status: "stale",
          message: "Delayed",
        }}
      />,
    );
    const staleAlert = screen.getByRole("alert");
    await expect.element(staleAlert).toHaveTextContent("Live data delayed");
    await expect.element(staleAlert).toHaveTextContent("Delayed");
    await expect.element(staleAlert).toHaveTextContent("Expected 2 rows but received 1");
  });

  test("preserves compiled column geometry and static presentation while loading", async () => {
    const renderer = vi.fn(({ value }: { readonly value: string }) => value);
    const valueGetter = vi.fn(({ row }: { readonly row: Pick<Row, "score"> }) => row.score * 2);
    const sampledFields: PropertyKey[] = [];
    const unreadableRow = new Proxy(rows[0]!, {
      get(target, property, receiver) {
        sampledFields.push(property);
        return Reflect.get(target, property, receiver);
      },
    });
    const loadingColumns = [
      { ...columns[0], pinned: "start" as const, width: 120, cellRenderer: renderer },
      { ...columns[1], width: 100 },
      BrunoTableComputedColumn({
        columnId: "COL_ID_DOUBLE_SCORE",
        fields: ["score"],
        headerName: "Double score",
        valueGetter,
        valueType: "number",
        width: 110,
      }),
      {
        ...columns[0],
        columnId: "COL_ID_ALIAS",
        headerName: "Alias",
        pinned: "end" as const,
        width: 140,
      },
    ] as const;
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_LOADING_COLUMNS"
        getRowId={(row: Row) => row.id}
        columns={loadingColumns}
        initialOrderBy={[{ columnId: "COL_ID_SCORE", direction: "asc" }]}
        clientSource={{ rows: [unreadableRow], totalRows: 100, version: 1, status: "loading" }}
      />,
    );
    const grid = screen.getByRole("grid", { name: "Loading table rows" });
    await expect.element(grid).toHaveAttribute("aria-colcount", "4");
    const loadingName = screen.getByRole("gridcell", { name: "Loading Name" }).nth(0);
    const loadingScore = screen.getByRole("gridcell", { name: "Loading Score" }).nth(0);
    const loadingDoubleScore = screen
      .getByRole("gridcell", { name: "Loading Double score" })
      .nth(0);
    const loadingAlias = screen.getByRole("gridcell", { name: "Loading Alias" }).nth(0);
    await expect.element(loadingName).toHaveAttribute("aria-colindex", "1");
    await expect.element(loadingScore).toHaveAttribute("aria-colindex", "2");
    await expect.element(loadingDoubleScore).toHaveAttribute("aria-colindex", "3");
    await expect.element(loadingAlias).toHaveAttribute("aria-colindex", "4");
    const loadingStartRegion = loadingName
      .element()
      .closest<HTMLElement>('[data-bruno-pinned-body-region="start"]');
    expect(loadingStartRegion).not.toBeNull();
    expect(loadingAlias.element().closest('[data-bruno-pinned-body-region="end"]')).not.toBeNull();
    const loadingNameOwner = [...grid.element().querySelectorAll<HTMLElement>('[role="row"]')].find(
      (row) => row.getAttribute("aria-owns")?.split(" ").includes(loadingName.element().id),
    );
    const loadingAliasOwner = [
      ...grid.element().querySelectorAll<HTMLElement>('[role="row"]'),
    ].find((row) => row.getAttribute("aria-owns")?.split(" ").includes(loadingAlias.element().id));
    expect(loadingNameOwner).toBe(loadingAliasOwner);
    expect(loadingNameOwner?.getAttribute("aria-rowindex")).toBe("1");
    expect(loadingNameOwner?.getAttribute("aria-owns")?.split(" ")).toEqual([
      loadingName.element().id,
      loadingScore.element().id,
      loadingDoubleScore.element().id,
      loadingAlias.element().id,
    ]);
    const loadingRowLayer = grid.element().querySelector<HTMLElement>("[data-bruno-row-layer]");
    if (loadingStartRegion === null) throw new Error("The loading start region was not mounted.");
    expect(loadingStartRegion.closest("[data-bruno-row-layer]")).toBe(loadingRowLayer);
    expect(loadingStartRegion.style.position).toBe("sticky");
    await vi.waitFor(() => {
      expect(loadingName.element().getBoundingClientRect().width).toBeCloseTo(120, 0);
      expect(loadingScore.element().getBoundingClientRect().width).toBeCloseTo(100, 0);
      expect(loadingDoubleScore.element().getBoundingClientRect().width).toBeCloseTo(110, 0);
      expect(loadingAlias.element().getBoundingClientRect().width).toBeCloseTo(140, 0);
      expect(loadingAlias.element().getBoundingClientRect().right).toBeCloseTo(
        grid.element().getBoundingClientRect().right,
        0,
      );
    });
    expect(
      (loadingName.element().firstElementChild as HTMLElement | null)?.style.marginInlineEnd,
    ).toBe("auto");
    expect(
      (loadingScore.element().firstElementChild as HTMLElement | null)?.style.marginInlineStart,
    ).toBe("auto");
    expect(renderer).not.toHaveBeenCalled();
    expect(valueGetter).not.toHaveBeenCalled();
    expect(sampledFields).toEqual([]);
  });

  test("preserves grid focus across ready, loading, and ready lifecycle transitions", async () => {
    const screen = await render(<BrunoTableClient {...props} clientSource={readySource()} />);
    const readyGrid = screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" });
    readyGrid.element().focus();
    readyGrid
      .element()
      .dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "End" }));
    const activeBeforeLoading = readyGrid.element().getAttribute("aria-activedescendant");
    expect(activeBeforeLoading).toBe(screen.getByRole("gridcell", { name: "4" }).element().id);
    expect(document.activeElement).toBe(readyGrid.element());

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={{ rows: [], totalRows: 2, version: 2, status: "loading" }}
      />,
    );

    const loadingGrid = screen.getByRole("grid", { name: "Loading table rows" });
    await vi.waitFor(() => expect(document.activeElement).toBe(loadingGrid.element()));

    await screen.rerender(
      <BrunoTableClient {...props} clientSource={{ ...readySource(), version: 3 }} />,
    );

    const restoredGrid = screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" });
    await vi.waitFor(() => expect(document.activeElement).toBe(restoredGrid.element()));
    await vi.waitFor(() =>
      expect(restoredGrid.element().getAttribute("aria-activedescendant")).toBe(
        restoredGrid.getByRole("gridcell", { name: "4" }).element().id,
      ),
    );
  });

  test("presents invalid non-query values without letting semantic rendering throw", async () => {
    const invalidRows = [
      { id: "invalid", name: "Invalid", score: Number.NaN },
    ] satisfies readonly Row[];
    const screen = await render(
      <BrunoTableClient
        {...props}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource(invalidRows)}
      />,
    );

    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Source row 1, column COL_ID_SCORE: Expected a finite number value.");
    await expect
      .element(screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" }))
      .toBeInTheDocument();
  });

  test("rejects a newly activated query column after its cell island reported an error", async () => {
    const invalidRows = [
      { id: "valid", name: "Ada", score: 1 },
      { id: "invalid", name: "Grace", score: Number.NaN },
    ] satisfies readonly Row[];
    const screen = await render(
      <BrunoTableClient
        {...props}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource(invalidRows)}
      />,
    );

    await expect
      .element(screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Source row 2, column COL_ID_SCORE: Expected a finite number value.");

    await screen.getByRole("button", { name: "Sort by Score" }).click();
    await vi.waitFor(() =>
      expect(
        screen
          .getByRole("alert")
          .all()
          .some((alert) => alert.element().textContent?.includes("Invalid source value")),
      ).toBe(true),
    );
    await expect
      .element(screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" }))
      .not.toBeInTheDocument();

    const unrelatedUpdate = [
      { ...invalidRows[0]!, name: "Augusta" },
      invalidRows[1]!,
    ] satisfies readonly Row[];
    await screen.rerender(
      <BrunoTableClient
        {...props}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource(unrelatedUpdate)}
      />,
    );
    await vi.waitFor(() =>
      expect(
        screen
          .getByRole("alert")
          .all()
          .some((alert) => alert.element().textContent?.includes("Invalid source value")),
      ).toBe(true),
    );
    await expect
      .element(screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" }))
      .not.toBeInTheDocument();

    await screen.rerender(
      <BrunoTableClient
        {...props}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource([unrelatedUpdate[0]!, { ...unrelatedUpdate[1]!, score: 2 }])}
      />,
    );
    await expect
      .element(screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" }))
      .toBeInTheDocument();
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
              filter: "A",
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

  test("skips full row-model work when fresh canonical filter values keep membership", async () => {
    type Email = Readonly<{ readonly address: string }>;
    type EmailRow = Readonly<{
      readonly id: string;
      readonly email: Email;
      readonly note: string;
    }>;
    const emailValueType: BrunoTableValueType<Email, "text", "text"> = {
      codecId: "test/email-membership",
      codecVersion: 1,
      filterFamily: "text",
      editorFamily: "text",
      cellAlign: "start",
      editorLayout: "inline",
      defaultWidth: 180,
      decodeRuntime: (input) =>
        typeof input === "object" &&
        input !== null &&
        typeof Reflect.get(input, "address") === "string"
          ? { _tag: "Success", value: Object.freeze({ address: Reflect.get(input, "address") }) }
          : { _tag: "Failure", message: "Expected email." },
      equivalent: (left, right) => left.address === right.address,
      compare: (left, right) =>
        left.address === right.address ? 0 : left.address < right.address ? -1 : 1,
      formatCanonicalText: (value) => value.address,
      parseCanonicalText: (text) => ({
        _tag: "Success",
        value: Object.freeze({ address: text }),
      }),
      formatDisplay: (value) => value.address,
      encodePersisted: (value) => value.address,
      decodePersisted: (input) =>
        typeof input === "string"
          ? { _tag: "Success", value: Object.freeze({ address: input }) }
          : { _tag: "Failure", message: "Expected persisted email." },
    };
    const emailColumns = [
      {
        columnId: "COL_ID_EMAIL",
        field: "email",
        headerName: "Email",
        valueType: emailValueType,
      },
      {
        columnId: "COL_ID_NOTE",
        field: "note",
        headerName: "Note",
        valueType: "text",
      },
    ] as const satisfies BrunoTableColumns<EmailRow>;
    const queryReads = vi.fn();
    const removeQueryReadListener = installBrunoTableClientQueryValueReadListener(
      (rowId, columnId, tableId) => {
        if (tableId === "TABLE_ID_EMAIL_MEMBERSHIP") queryReads(rowId, columnId);
      },
    );
    const initial = Object.freeze({
      id: "ada",
      email: Object.freeze({ address: "ada@example.com" }),
      note: "Initial",
    }) satisfies EmailRow;
    const excluded = Object.freeze({
      id: "excluded",
      email: Object.freeze({ address: "z@example.com" }),
      note: "Excluded",
    }) satisfies EmailRow;
    const initialRows: readonly EmailRow[] = Object.freeze([initial, excluded]);
    try {
      const screen = await render(
        <BrunoTableClient
          tableId="TABLE_ID_EMAIL_MEMBERSHIP"
          getRowId={(row: EmailRow) => row.id}
          columns={emailColumns}
          initialFilters={[{ columnId: "COL_ID_EMAIL", type: "contains", filter: "ada@" }]}
          initialOrderBy={[{ columnId: "COL_ID_EMAIL", direction: "asc" }]}
          clientSource={{
            rows: initialRows,
            totalRows: 2,
            version: 1,
            status: "ready",
          }}
        />,
      );
      await expect.element(screen.getByRole("gridcell", { name: "Initial" })).toBeInTheDocument();
      queryReads.mockClear();
      const updated = Object.freeze({
        ...initial,
        email: Object.freeze({ address: initial.email.address }),
        note: "Changed",
      }) satisfies EmailRow;
      const updatedRows: readonly EmailRow[] = Object.freeze([updated, excluded]);

      await screen.rerender(
        <BrunoTableClient
          tableId="TABLE_ID_EMAIL_MEMBERSHIP"
          getRowId={(row: EmailRow) => row.id}
          columns={emailColumns}
          initialFilters={[{ columnId: "COL_ID_EMAIL", type: "contains", filter: "ada@" }]}
          initialOrderBy={[{ columnId: "COL_ID_EMAIL", direction: "asc" }]}
          clientSource={{
            rows: updatedRows,
            totalRows: 2,
            version: 2,
            status: "ready",
          }}
        />,
      );

      await expect.element(screen.getByRole("gridcell", { name: "Changed" })).toBeInTheDocument();
      expect(queryReads).not.toHaveBeenCalled();
      queryReads.mockClear();
      const excludedWithChangedSortKey = Object.freeze({
        ...excluded,
        email: Object.freeze({ address: "b@example.com" }),
      }) satisfies EmailRow;
      const excludedUpdateRows: readonly EmailRow[] = Object.freeze([
        updated,
        excludedWithChangedSortKey,
      ]);

      await screen.rerender(
        <BrunoTableClient
          tableId="TABLE_ID_EMAIL_MEMBERSHIP"
          getRowId={(row: EmailRow) => row.id}
          columns={emailColumns}
          initialFilters={[{ columnId: "COL_ID_EMAIL", type: "contains", filter: "ada@" }]}
          initialOrderBy={[{ columnId: "COL_ID_EMAIL", direction: "asc" }]}
          clientSource={{
            rows: excludedUpdateRows,
            totalRows: 2,
            version: 3,
            status: "ready",
          }}
        />,
      );

      await expect.element(screen.getByRole("gridcell", { name: "Changed" })).toBeInTheDocument();
      expect(queryReads).not.toHaveBeenCalled();
    } finally {
      removeQueryReadListener();
    }
  });

  test("refreshes presentation when domain-equivalent canonical values differ", async () => {
    const casePreservingText: BrunoTableValueType<string, "text", "text"> = {
      codecId: "test/case-preserving-text",
      codecVersion: 1,
      filterFamily: "text",
      editorFamily: "text",
      cellAlign: "start",
      editorLayout: "inline",
      defaultWidth: 120,
      decodeRuntime: (input) =>
        typeof input === "string"
          ? { _tag: "Success", value: input }
          : { _tag: "Failure", message: "Expected text." },
      equivalent: (left, right) => left.toLocaleLowerCase() === right.toLocaleLowerCase(),
      compare: (left, right) => {
        const normalizedLeft = left.toLocaleLowerCase();
        const normalizedRight = right.toLocaleLowerCase();
        return normalizedLeft === normalizedRight ? 0 : normalizedLeft < normalizedRight ? -1 : 1;
      },
      formatCanonicalText: (value) => value,
      parseCanonicalText: (text) => ({ _tag: "Success", value: text }),
      formatDisplay: (value) => value,
      encodePersisted: (value) => value,
      decodePersisted: (input) =>
        typeof input === "string"
          ? { _tag: "Success", value: input }
          : { _tag: "Failure", message: "Expected persisted text." },
    };
    const presentationColumns = [
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: casePreservingText,
      },
    ] as const satisfies BrunoTableColumns<Row>;
    const initialSource = readySource([{ id: "row", name: "a", score: 1 }]);
    const screen = await render(
      <>
        <BrunoTableClient
          tableId="TABLE_ID_PRESENTATION_IDENTITY"
          getRowId={(row: Row) => row.id}
          columns={presentationColumns}
          initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
          clientSource={initialSource}
        />
        <BrunoTableClient
          tableId="TABLE_ID_FILTER_MEMBERSHIP_IDENTITY"
          getRowId={(row: Row) => row.id}
          columns={presentationColumns}
          initialFilters={[
            {
              columnId: "COL_ID_NAME",
              type: "equals",
              filter: "a",
              caseSensitive: true,
            },
          ]}
          initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
          clientSource={initialSource}
        />
      </>,
    );
    const presentationGrid = screen.getByRole("grid", {
      name: "Data for TABLE_ID_PRESENTATION_IDENTITY",
    });
    const sensitiveFilterGrid = screen.getByRole("grid", {
      name: "Data for TABLE_ID_FILTER_MEMBERSHIP_IDENTITY",
    });

    await expect
      .element(presentationGrid.getByRole("gridcell", { name: "a", exact: true }))
      .toBeVisible();
    await expect
      .element(sensitiveFilterGrid.getByRole("gridcell", { name: "a", exact: true }))
      .toBeVisible();

    const updatedSource = readySource([{ id: "row", name: "A", score: 1 }]);
    await screen.rerender(
      <>
        <BrunoTableClient
          tableId="TABLE_ID_PRESENTATION_IDENTITY"
          getRowId={(row: Row) => row.id}
          columns={presentationColumns}
          initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
          clientSource={updatedSource}
        />
        <BrunoTableClient
          tableId="TABLE_ID_FILTER_MEMBERSHIP_IDENTITY"
          getRowId={(row: Row) => row.id}
          columns={presentationColumns}
          initialFilters={[
            {
              columnId: "COL_ID_NAME",
              type: "equals",
              filter: "a",
              caseSensitive: true,
            },
          ]}
          initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
          clientSource={updatedSource}
        />
      </>,
    );

    await expect
      .element(presentationGrid.getByRole("gridcell", { name: "A", exact: true }))
      .toBeVisible();
    await expect
      .element(sensitiveFilterGrid.getByRole("gridcell", { name: "A", exact: true }))
      .not.toBeInTheDocument();
  });

  test("reorders a live publication with ordering semantics broader than equality", async () => {
    const caseInsensitiveEquality: BrunoTableValueType<string, "text", "text"> = {
      codecId: "test/case-insensitive-equality",
      codecVersion: 1,
      filterFamily: "text",
      editorFamily: "text",
      cellAlign: "start",
      editorLayout: "inline",
      defaultWidth: 120,
      decodeRuntime: (input) =>
        typeof input === "string"
          ? { _tag: "Success", value: input }
          : { _tag: "Failure", message: "Expected text." },
      equivalent: (left, right) => left.toLowerCase() === right.toLowerCase(),
      compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
      formatCanonicalText: (value) => value,
      parseCanonicalText: (text) => ({ _tag: "Success", value: text }),
      formatDisplay: (value) => value,
      encodePersisted: (value) => value,
      decodePersisted: (input) =>
        typeof input === "string"
          ? { _tag: "Success", value: input }
          : { _tag: "Failure", message: "Expected persisted text." },
    };
    const orderingColumns = [
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: caseInsensitiveEquality,
      },
    ] as const satisfies BrunoTableColumns<Row>;
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_ORDERING_SEMANTICS"
        getRowId={(row: Row) => row.id}
        columns={orderingColumns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource([
          { id: "changed", name: "a", score: 1 },
          { id: "stable", name: "B", score: 2 },
        ])}
      />,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_ORDERING_SEMANTICS" });
    await expect
      .element(grid.getByRole("row").nth(1).getByRole("gridcell", { name: "B", exact: true }))
      .toBeInTheDocument();

    await screen.rerender(
      <BrunoTableClient
        tableId="TABLE_ID_ORDERING_SEMANTICS"
        getRowId={(row: Row) => row.id}
        columns={orderingColumns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource([
          { id: "changed", name: "A", score: 1 },
          { id: "stable", name: "B", score: 2 },
        ])}
      />,
    );
    await expect
      .element(grid.getByRole("row").nth(1).getByRole("gridcell", { name: "A", exact: true }))
      .toBeInTheDocument();
  });

  test("retains coherent rows for a terminal publication after rejecting ready data", async () => {
    const retry = vi.fn();
    const screen = await render(<BrunoTableClient {...props} clientSource={readySource()} />);
    const acceptedAdaCellId = screen.getByRole("gridcell", { name: "Ada" }).element().id;

    await screen.rerender(
      <BrunoTableClient
        {...props}
        getRowId={(row: Row) => `next:${row.id}`}
        clientSource={{
          rows: [
            { id: "invalid", name: "Invalid", score: Number.NaN },
            { id: "valid", name: "Valid", score: 1 },
          ],
          totalRows: 2,
          version: 2,
          status: "ready",
        }}
      />,
    );
    await vi.waitFor(() =>
      expect(
        screen
          .getByRole("alert")
          .all()
          .some((alert) => alert.element().textContent?.includes("Invalid source value")),
      ).toBe(true),
    );

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
    const rekeyedAdaCell = screen.getByRole("gridcell", { name: "Ada" });
    await expect.element(rekeyedAdaCell).toBeInTheDocument();
    expect(rekeyedAdaCell.element().id).not.toBe(acceptedAdaCellId);
    await screen.getByRole("button", { name: "Retry" }).click();
    expect(retry).toHaveBeenCalledOnce();
  });

  test("re-admits terminal fallback rows through replacement columns", async () => {
    const initialColumns = [columns[0]] as const;
    const replacementColumns = [
      {
        columnId: "COL_ID_ALIAS",
        field: "name",
        headerName: "Alias",
        valueType: "text",
      },
    ] as const;
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_TERMINAL_COLUMN_REPLACEMENT"
        getRowId={(row: Row) => row.id}
        columns={initialColumns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource()}
      />,
    );
    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).toBeInTheDocument();

    await screen.rerender(
      <BrunoTableClient
        tableId="TABLE_ID_TERMINAL_COLUMN_REPLACEMENT"
        getRowId={(row: Row) => row.id}
        columns={replacementColumns}
        initialOrderBy={[{ columnId: "COL_ID_ALIAS", direction: "asc" }]}
        clientSource={{ rows: [], totalRows: 0, version: 2, status: "closed" }}
      />,
    );

    await expect.element(screen.getByRole("alert")).toHaveTextContent("Live updates stopped");
    await expect.element(screen.getByRole("columnheader", { name: "Alias" })).toBeInTheDocument();
    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).toBeInTheDocument();
    await expect.element(screen.getByRole("gridcell", { name: "Grace" })).toBeInTheDocument();
  });

  test("retains the latest accepted live rows for a later empty terminal publication", async () => {
    const latestRows = rows.map((row) => ({ ...row, name: `${row.name} latest` }));
    const loadingRows = rows.map((row) => ({ ...row, name: `${row.name} loading` }));
    const screen = await render(<BrunoTableClient {...props} clientSource={readySource()} />);

    await screen.rerender(
      <BrunoTableClient {...props} clientSource={{ ...readySource(latestRows), version: 2 }} />,
    );
    await expect.element(screen.getByRole("gridcell", { name: "Ada latest" })).toBeInTheDocument();

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={{
          rows: loadingRows,
          totalRows: loadingRows.length,
          version: 3,
          status: "loading",
        }}
      />,
    );
    await expect
      .element(screen.getByRole("grid", { name: "Loading table rows" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Ada latest" }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Ada loading" }))
      .not.toBeInTheDocument();

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={{ rows: [], totalRows: 0, version: 4, status: "error" }}
      />,
    );

    await expect.element(screen.getByRole("alert")).toHaveTextContent("Live data error");
    await expect.element(screen.getByRole("gridcell", { name: "Ada latest" })).toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Grace latest" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Ada loading" }))
      .not.toBeInTheDocument();
  });

  test("preserves replacement identity and ordering across incomplete then terminal sources", async () => {
    const initialColumns = [columns[0]] as const;
    const replacementColumns = [
      {
        columnId: "COL_ID_SCORE_ALIAS",
        field: "score",
        headerName: "Score alias",
        valueType: "number",
      },
    ] as const;
    const replacementGetRowId = (row: Row) => `replacement:${row.id}`;
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_INCOMPLETE_REPLACEMENT"
        getRowId={(row: Row) => row.id}
        columns={initialColumns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource()}
      />,
    );

    await screen.rerender(
      <BrunoTableClient
        tableId="TABLE_ID_INCOMPLETE_REPLACEMENT"
        getRowId={replacementGetRowId}
        columns={replacementColumns}
        initialOrderBy={[{ columnId: "COL_ID_SCORE_ALIAS", direction: "asc" }]}
        clientSource={{ rows: [rows[0]!], totalRows: 2, version: 2, status: "ready" }}
      />,
    );
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Expected 2 rows but received 1");

    await screen.rerender(
      <BrunoTableClient
        tableId="TABLE_ID_INCOMPLETE_REPLACEMENT"
        getRowId={replacementGetRowId}
        columns={replacementColumns}
        initialOrderBy={[{ columnId: "COL_ID_SCORE_ALIAS", direction: "asc" }]}
        clientSource={{ rows: [], totalRows: 0, version: 3, status: "closed" }}
      />,
    );

    await expect.element(screen.getByRole("alert")).toHaveTextContent("Live updates stopped");
    await expect
      .element(screen.getByRole("columnheader", { name: "Score alias" }))
      .toBeInTheDocument();
    const visibleRows = screen.getByRole("row").all();
    await expect.element(visibleRows[1]!.getByRole("gridcell")).toHaveTextContent("2");
    await expect.element(visibleRows[2]!.getByRole("gridcell")).toHaveTextContent("4");
    expect(visibleRows[2]!.getByRole("gridcell").element().id).toContain(
      encodeExpectedDomIdSegment("replacement:ada"),
    );
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

    await vi.waitFor(() =>
      expect(
        screen
          .getByRole("alert")
          .all()
          .some((alert) => alert.element().textContent?.includes("Live data error")),
      ).toBe(true),
    );
    await vi.waitFor(() =>
      expect(
        screen
          .getByRole("alert")
          .all()
          .some((alert) =>
            alert.element().textContent?.includes("Expected a finite number value."),
          ),
      ).toBe(true),
    );
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
      "TABLE_ID_SPARSE",
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
    const loadingCells = screen.getByRole("gridcell", { name: "Loading Name" }).all();
    expect(
      loadingCells.some(
        (cell) =>
          cell.element().parentElement?.style.height === `${String(BRUNO_TABLE_ROW_HEIGHT)}px`,
      ),
    ).toBe(true);

    grid.element().focus();
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).toContain(
        "bruno-table-loading-cell",
      ),
    );
    const firstActiveId = grid.element().getAttribute("aria-activedescendant");
    expect(
      screen
        .getByRole("gridcell", { name: "Loading Name" })
        .all()
        .some((cell) => cell.element().id === firstActiveId),
    ).toBe(true);
    expect(grid.element().querySelectorAll(`[id="${firstActiveId ?? ""}"]`)).toHaveLength(1);

    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).not.toBe(firstActiveId),
    );
    const secondActiveId = grid.element().getAttribute("aria-activedescendant");
    expect(
      screen
        .getByRole("gridcell", { name: "Loading Name" })
        .all()
        .some((cell) => cell.element().id === secondActiveId),
    ).toBe(true);
    expect(grid.element().querySelectorAll(`[id="${secondActiveId ?? ""}"]`)).toHaveLength(1);

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

  test("separates loaded Row Identity keys from unloaded virtual-slot keys", async () => {
    const collisionRows = [
      { id: "unloaded-slot-2", name: "Center sentinel identity", score: 1 },
      { id: "pinned-unloaded-slot-2", name: "Pinned sentinel identity", score: 2 },
    ] satisfies readonly Row[];
    const collisionRowsById = new Map(collisionRows.map((row) => [row.id, row]));
    const compiledColumns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        pinned: "start",
        valueType: "text",
      },
      {
        columnId: "COL_ID_SCORE",
        field: "score",
        headerName: "Score",
        valueType: "number",
      },
    ]);
    const getRowId = (index: number) => collisionRows[index]?.id;
    const rowSpace: BrunoTableLogicalRowSpace = Object.freeze({
      totalRows: 3,
      getRowId,
      findRowIndex: (rowId) => {
        const index = collisionRows.findIndex((row) => row.id === rowId);
        return index < 0 ? undefined : index;
      },
      setRequiredRange: vi.fn(),
    });
    const runtime = new BrunoTableGridRuntime<Row>(
      Object.freeze({
        status: "loading" as const,
        totalRows: 3,
        version: 1,
        rowSpace: Object.freeze({
          totalRows: 3,
          loadedRows: collisionRows.length,
          getRowId,
          getRow: (rowId: string) => collisionRowsById.get(rowId),
          getCellValue: (rowId: string, columnId: string) => {
            const row = collisionRowsById.get(rowId);
            return columnId === "COL_ID_NAME" ? row?.name : row?.score;
          },
        }),
        hasCoherentRows: false,
      }),
      compiledColumns,
      Object.freeze({
        baselineFilters: Object.freeze([]),
        baselineOrderBy: Object.freeze([
          Object.freeze({ columnId: "COL_ID_SCORE", direction: "asc" as const }),
        ]),
      }),
      "TABLE_ID_SPARSE_KEY_NAMESPACE",
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const screen = await render(
        <BrunoTableView
          runtime={runtime.getView()}
          tableId="TABLE_ID_SPARSE_KEY_NAMESPACE"
          compiledColumns={compiledColumns}
          toolbar={new BrunoTableToolbarStore(undefined)}
          rowPipeline={SparseRowPipeline}
          rowPipelineAdapter={{ rowSpace, queryGeneration: 0 }}
        />,
      );
      await expect
        .element(screen.getByRole("gridcell", { name: "Center sentinel identity" }))
        .toBeInTheDocument();
      await expect
        .element(screen.getByRole("gridcell", { name: "Pinned sentinel identity" }))
        .toBeInTheDocument();
      await expect
        .element(screen.getByRole("gridcell", { name: "Loading Name" }))
        .toBeInTheDocument();
      const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SPARSE_KEY_NAMESPACE" });
      const semanticRows = [...grid.element().querySelectorAll<HTMLElement>('[role="row"]')].filter(
        (row) => row.getAttribute("aria-rowindex") !== "1",
      );
      expect(semanticRows.map((row) => row.getAttribute("aria-rowindex"))).toEqual(["2", "3", "4"]);
      for (const row of semanticRows) {
        const ownedIds = row.getAttribute("aria-owns")?.split(" ") ?? [];
        expect(ownedIds).toHaveLength(compiledColumns.length);
        for (const ownedId of ownedIds) {
          expect(grid.element().querySelectorAll(`[id="${ownedId}"]`)).toHaveLength(1);
        }
      }
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
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

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={{
          rows: [],
          totalRows: 0,
          version: 2,
          status: "error",
          message: "Connection lost",
          retry: { run, pending: true },
        }}
      />,
    );
    expect(document.activeElement).toBe(retry.element());
    await expect.element(retry).toHaveAttribute("aria-disabled", "true");
    (retry.element() as HTMLButtonElement).click();
    expect(run).toHaveBeenCalledOnce();

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

  test.each(["stale", "closed", "error"] as const)(
    "falls back to accepted rows when a complete %s candidate fails query decoding",
    async (status) => {
      const screen = await render(<BrunoTableClient {...props} clientSource={readySource()} />);
      await expect.element(screen.getByRole("gridcell", { name: "Ada" })).toBeInTheDocument();

      await screen.rerender(
        <BrunoTableClient
          {...props}
          clientSource={{
            rows: [
              { id: "candidate-invalid", name: "Invalid", score: Number.NaN },
              { id: "candidate-valid", name: "Valid", score: 1 },
            ],
            totalRows: 2,
            version: 2,
            status,
          }}
        />,
      );

      const lifecycleTitle =
        status === "stale"
          ? "Live data delayed"
          : status === "closed"
            ? "Live updates stopped"
            : "Live data error";
      await vi.waitFor(() =>
        expect(
          screen
            .getByRole("alert")
            .all()
            .some((notice) => notice.element().textContent?.includes(lifecycleTitle)),
        ).toBe(true),
      );
      await vi.waitFor(() =>
        expect(
          screen
            .getByRole("alert")
            .all()
            .some((notice) =>
              notice.element().textContent?.includes("Expected a finite number value."),
            ),
        ).toBe(true),
      );
      await expect.element(screen.getByRole("gridcell", { name: "Ada" })).toBeInTheDocument();
      await expect.element(screen.getByRole("gridcell", { name: "Grace" })).toBeInTheDocument();
      await expect
        .element(screen.getByRole("gridcell", { name: "Invalid" }))
        .not.toBeInTheDocument();
    },
  );

  test("retries a retained candidate on query change without rereading its source array", async () => {
    const sourceIndexRead = vi.fn();
    const candidateRows = new Proxy(
      [
        { id: "candidate-invalid", name: "Candidate A", score: Number.NaN },
        { id: "candidate-valid", name: "Candidate B", score: 1 },
      ] satisfies Row[],
      {
        get: (target, property, receiver) => {
          if (typeof property === "string" && /^\d+$/.test(property)) sourceIndexRead(property);
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const screen = await render(
      <BrunoTableClient
        {...props}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource()}
      />,
    );
    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).toBeInTheDocument();

    await screen.rerender(
      <BrunoTableClient
        {...props}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={{
          rows: candidateRows,
          totalRows: candidateRows.length,
          version: 2,
          status: "stale",
        }}
      />,
    );
    await expect.element(screen.getByRole("gridcell", { name: "Candidate A" })).toBeInTheDocument();
    sourceIndexRead.mockClear();

    await screen.getByRole("button", { name: "Sort by Score" }).click();
    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Candidate A" }))
      .not.toBeInTheDocument();
    expect(sourceIndexRead).not.toHaveBeenCalled();

    await screen.getByRole("button", { name: "Sort by Name" }).click();
    await expect.element(screen.getByRole("gridcell", { name: "Candidate A" })).toBeInTheDocument();
    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).not.toBeInTheDocument();
    expect(sourceIndexRead).not.toHaveBeenCalled();
  });

  test("preserves and wakes a quiet lifecycle predecessor after chrome-only updates", async () => {
    const retry = vi.fn();
    const predecessorRows = [{ ...rows[0]!, score: 5 }, rows[1]!] satisfies readonly Row[];
    const candidateRows = [
      predecessorRows[0]!,
      { ...predecessorRows[1]!, score: Number.NaN },
    ] satisfies readonly Row[];
    const screen = await render(
      <BrunoTableClient
        {...props}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource()}
      />,
    );

    await screen.rerender(
      <BrunoTableClient
        {...props}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={{
          rows: predecessorRows,
          totalRows: predecessorRows.length,
          version: 2,
          status: "ready",
        }}
      />,
    );
    await expect.element(screen.getByRole("gridcell", { name: "5" })).toBeInTheDocument();

    await screen.rerender(
      <BrunoTableClient
        {...props}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={{
          rows: candidateRows,
          totalRows: candidateRows.length,
          version: 3,
          status: "stale",
          message: "Initial delay",
          retry: { run: retry, pending: false },
        }}
      />,
    );
    await vi.waitFor(() =>
      expect(
        screen
          .getByRole("alert")
          .all()
          .some((notice) => notice.element().textContent?.includes("Initial delay")),
      ).toBe(true),
    );

    await screen.rerender(
      <BrunoTableClient
        {...props}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={{
          rows: candidateRows,
          totalRows: candidateRows.length,
          version: 3,
          status: "stale",
          message: "Retry pending",
          retry: { run: retry, pending: true },
        }}
      />,
    );
    await vi.waitFor(() =>
      expect(
        screen
          .getByRole("alert")
          .all()
          .some((notice) => notice.element().textContent?.includes("Retry pending")),
      ).toBe(true),
    );

    await screen.getByRole("button", { name: "Sort by Score" }).click();
    await expect.element(screen.getByRole("gridcell", { name: "5" })).toBeInTheDocument();
    await expect.element(screen.getByRole("gridcell", { name: "2" })).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(
        screen
          .getByRole("alert")
          .all()
          .some((notice) =>
            notice.element().textContent?.includes("Expected a finite number value."),
          ),
      ).toBe(true),
    );

    const acceptedAdaCell = screen.getByRole("gridcell", { name: "Ada" }).element();
    const queryReads = vi.fn();
    const cellRenders = vi.fn();
    const gridSurfaceRenders = vi.fn();
    const removeQueryReadListener = installBrunoTableClientQueryValueReadListener(queryReads);
    const removeCellRenderListener = installBrunoTableClientCellRenderListener(cellRenders);
    const removeGridSurfaceRenderListener =
      installBrunoTableClientGridSurfaceRenderListener(gridSurfaceRenders);
    try {
      await screen.rerender(
        <BrunoTableClient
          {...props}
          initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
          clientSource={{
            rows: candidateRows,
            totalRows: candidateRows.length,
            version: 4,
            status: "stale",
            message: "After fallback",
            retry: { run: retry, pending: false },
          }}
        />,
      );
      await vi.waitFor(() =>
        expect(
          screen
            .getByRole("alert")
            .all()
            .some((notice) => notice.element().textContent?.includes("After fallback")),
        ).toBe(true),
      );
      expect(screen.getByRole("gridcell", { name: "Ada" }).element()).toBe(acceptedAdaCell);
      expect(queryReads).not.toHaveBeenCalled();
      expect(cellRenders).not.toHaveBeenCalled();
      expect(gridSurfaceRenders).not.toHaveBeenCalled();

      await screen.rerender(
        <BrunoTableClient
          {...props}
          initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
          clientSource={
            {
              rows: null,
              totalRows: candidateRows.length,
              version: 5,
              status: "stale",
            } as unknown as ReturnType<typeof readySource>
          }
        />,
      );
      await vi.waitFor(() =>
        expect(
          screen
            .getByRole("alert")
            .all()
            .some((notice) =>
              notice.element().textContent?.includes("Invalid Client Source rows: null."),
            ),
        ).toBe(true),
      );
      expect(screen.getByRole("gridcell", { name: "Ada" }).element()).toBe(acceptedAdaCell);
      expect(queryReads).not.toHaveBeenCalled();
      expect(cellRenders).not.toHaveBeenCalled();
      expect(gridSurfaceRenders).not.toHaveBeenCalled();

      await screen.rerender(
        <BrunoTableClient
          {...props}
          initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
          clientSource={
            {
              rows: candidateRows,
              totalRows: candidateRows.length,
              version: 6,
              status: "offline",
            } as unknown as ReturnType<typeof readySource>
          }
        />,
      );
      await vi.waitFor(() =>
        expect(
          screen
            .getByRole("alert")
            .all()
            .some((notice) => notice.element().textContent?.includes("Unsupported source status")),
        ).toBe(true),
      );
      expect(screen.getByRole("gridcell", { name: "Ada" }).element()).toBe(acceptedAdaCell);
      expect(queryReads).not.toHaveBeenCalled();
      expect(cellRenders).not.toHaveBeenCalled();
      expect(gridSurfaceRenders).not.toHaveBeenCalled();
    } finally {
      removeGridSurfaceRenderListener();
      removeCellRenderListener();
      removeQueryReadListener();
    }

    await screen.getByRole("button", { name: "Sort by Name" }).click();
    await expect.element(screen.getByRole("gridcell", { name: "2" })).not.toBeInTheDocument();
  });

  test("uses empty-state chrome when both candidate and predecessor fail the active query", async () => {
    const predecessorRows = [{ ...rows[0]!, score: Number.NaN }, rows[1]!] satisfies readonly Row[];
    const candidateRows = [
      predecessorRows[0]!,
      { ...predecessorRows[1]!, score: Number.POSITIVE_INFINITY },
    ] satisfies readonly Row[];
    const screen = await render(
      <BrunoTableClient
        {...props}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource(predecessorRows)}
      />,
    );
    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).toBeInTheDocument();

    await screen.rerender(
      <BrunoTableClient
        {...props}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={{
          rows: candidateRows,
          totalRows: candidateRows.length,
          version: 2,
          status: "error",
          message: "Both projections are invalid",
        }}
      />,
    );
    await screen.getByRole("button", { name: "Sort by Score" }).click();

    const announcement = screen.getByRole("alert");
    await expect.element(announcement).toHaveTextContent("Both projections are invalid");
    await expect.element(announcement).toHaveTextContent("Expected a finite number value.");
    await expect
      .element(screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" }))
      .not.toBeInTheDocument();

    await screen.rerender(
      <BrunoTableClient
        {...props}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={
          {
            rows: null,
            totalRows: candidateRows.length,
            version: 3,
            status: "error",
          } as unknown as ReturnType<typeof readySource>
        }
      />,
    );
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Invalid Client Source rows: null.");
    await expect
      .element(screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" }))
      .not.toBeInTheDocument();

    await screen.rerender(
      <BrunoTableClient
        {...props}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={
          {
            rows: candidateRows,
            totalRows: candidateRows.length,
            version: 4,
            status: "offline",
          } as unknown as ReturnType<typeof readySource>
        }
      />,
    );
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Unsupported source status");
    await expect
      .element(screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" }))
      .not.toBeInTheDocument();
  });

  test("recovers a retained candidate from empty state on a later private query command", async () => {
    const compiledColumns = compileColumns(columns);
    const predecessorRows = [{ ...rows[0]!, score: Number.NaN }, rows[1]!] satisfies readonly Row[];
    const sourceIndexRead = vi.fn();
    const candidateRows = new Proxy(
      [
        predecessorRows[0]!,
        { ...predecessorRows[1]!, score: Number.POSITIVE_INFINITY },
      ] satisfies Row[],
      {
        get: (target, property, receiver) => {
          if (typeof property === "string" && /^\d+$/.test(property)) sourceIndexRead(property);
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const getRowId = (row: Row) => row.id;
    const adapter = new BrunoTableClientRowPipelineAdapter(
      readySource(predecessorRows),
      getRowId,
      compiledColumns,
      undefined,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const runtime = new BrunoTableGridRuntime(
      adapter.getPublication(),
      compiledColumns,
      adapter.getQueryConfiguration(compiledColumns),
      "TABLE_ID_EMPTY_QUERY_RECOVERY",
    );
    const toolbar = new BrunoTableToolbarStore(undefined);
    const screen = await render(
      <>
        <button type="button" onClick={() => runtime.toggleColumnSort("COL_ID_SCORE", false)}>
          Retry Score
        </button>
        <button type="button" onClick={() => runtime.toggleColumnSort("COL_ID_NAME", false)}>
          Sort by Name
        </button>
        <BrunoTableView
          runtime={runtime.getView()}
          tableId="TABLE_ID_EMPTY_QUERY_RECOVERY"
          compiledColumns={compiledColumns}
          toolbar={toolbar}
          rowPipeline={BrunoTableClientRowPipeline}
          rowPipelineAdapter={adapter}
        />
      </>,
    );
    await expect
      .element(screen.getByRole("grid", { name: "Data for TABLE_ID_EMPTY_QUERY_RECOVERY" }))
      .toBeInTheDocument();

    runtime.publish(
      adapter.publish({
        rows: candidateRows,
        totalRows: candidateRows.length,
        version: 2,
        status: "error",
        message: "Both projections are invalid",
      }),
    );
    await screen.getByRole("button", { name: "Sort by Score" }).click();
    await expect
      .element(screen.getByRole("grid", { name: "Data for TABLE_ID_EMPTY_QUERY_RECOVERY" }))
      .not.toBeInTheDocument();
    sourceIndexRead.mockClear();

    const unsupportedRowsRead = vi.fn();
    const queryReads = vi.fn();
    const gridSurfaceRenders = vi.fn();
    const removeQueryReadListener = installBrunoTableClientQueryValueReadListener(queryReads);
    const removeGridSurfaceRenderListener =
      installBrunoTableClientGridSurfaceRenderListener(gridSurfaceRenders);
    try {
      runtime.publish(
        adapter.publish({
          rows: null,
          totalRows: candidateRows.length,
          version: 3,
          status: "error",
        } as unknown as ReturnType<typeof readySource>),
      );
      await expect
        .element(screen.getByRole("alert"))
        .toHaveTextContent("Invalid Client Source rows: null.");
      await expect
        .element(screen.getByRole("grid", { name: "Data for TABLE_ID_EMPTY_QUERY_RECOVERY" }))
        .not.toBeInTheDocument();
      expect(sourceIndexRead).not.toHaveBeenCalled();
      expect(queryReads).not.toHaveBeenCalled();
      expect(gridSurfaceRenders).not.toHaveBeenCalled();

      await screen.getByRole("button", { name: "Retry Score" }).click();
      await expect
        .element(screen.getByRole("alert"))
        .toHaveTextContent("Invalid Client Source rows: null.");
      await expect
        .element(screen.getByRole("grid", { name: "Data for TABLE_ID_EMPTY_QUERY_RECOVERY" }))
        .not.toBeInTheDocument();
      expect(sourceIndexRead).not.toHaveBeenCalled();
      queryReads.mockClear();
      gridSurfaceRenders.mockClear();

      runtime.publish(
        adapter.publish({
          get rows(): readonly Row[] {
            unsupportedRowsRead();
            throw new Error("Unsupported source rows must stay unread.");
          },
          totalRows: candidateRows.length,
          version: 4,
          status: "offline",
        } as unknown as ReturnType<typeof readySource>),
      );
      await expect
        .element(screen.getByRole("alert"))
        .toHaveTextContent("Unsupported source status");
      await expect
        .element(screen.getByRole("grid", { name: "Data for TABLE_ID_EMPTY_QUERY_RECOVERY" }))
        .not.toBeInTheDocument();
      expect(sourceIndexRead).not.toHaveBeenCalled();
      expect(unsupportedRowsRead).not.toHaveBeenCalled();
      expect(queryReads).not.toHaveBeenCalled();
      expect(gridSurfaceRenders).not.toHaveBeenCalled();
    } finally {
      removeGridSurfaceRenderListener();
      removeQueryReadListener();
    }

    await screen.getByRole("button", { name: "Retry Score" }).click();
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Unsupported source status");
    await expect
      .element(screen.getByRole("grid", { name: "Data for TABLE_ID_EMPTY_QUERY_RECOVERY" }))
      .not.toBeInTheDocument();

    await screen.getByRole("button", { name: "Sort by Name" }).click();
    await expect
      .element(screen.getByRole("grid", { name: "Data for TABLE_ID_EMPTY_QUERY_RECOVERY" }))
      .toBeInTheDocument();
    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).toBeInTheDocument();
    await expect.element(screen.getByRole("gridcell", { name: "Grace" })).toBeInTheDocument();
    expect(sourceIndexRead).not.toHaveBeenCalled();
  });

  test("keeps an initial stale rejection recoverable across a terminal chrome update", async () => {
    const compiledColumns = compileColumns(columns);
    const sourceIndexRead = vi.fn();
    const candidateRows = new Proxy(
      [
        { id: "candidate-invalid", name: "Invalid", score: Number.NaN },
        { id: "candidate-valid", name: "Valid", score: 1 },
      ] satisfies Row[],
      {
        get: (target, property, receiver) => {
          if (typeof property === "string" && /^\d+$/.test(property)) sourceIndexRead(property);
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const getRowId = (row: Row) => row.id;
    const adapter = new BrunoTableClientRowPipelineAdapter(
      {
        rows: candidateRows,
        totalRows: candidateRows.length,
        version: 1,
        status: "stale",
        message: "Initial stale candidate",
      },
      getRowId,
      compiledColumns,
      undefined,
      [{ columnId: "COL_ID_SCORE", direction: "asc" }],
    );
    const runtime = new BrunoTableGridRuntime(
      adapter.getPublication(),
      compiledColumns,
      adapter.getQueryConfiguration(compiledColumns),
      "TABLE_ID_INITIAL_STALE_RECOVERY",
    );
    const screen = await render(
      <>
        <button type="button" onClick={() => runtime.toggleColumnSort("COL_ID_NAME", false)}>
          Recover stale candidate by Name
        </button>
        <BrunoTableView
          runtime={runtime.getView()}
          tableId="TABLE_ID_INITIAL_STALE_RECOVERY"
          compiledColumns={compiledColumns}
          toolbar={new BrunoTableToolbarStore(undefined)}
          rowPipeline={BrunoTableClientRowPipeline}
          rowPipelineAdapter={adapter}
        />
      </>,
    );
    await expect
      .element(screen.getByRole("grid", { name: "Data for TABLE_ID_INITIAL_STALE_RECOVERY" }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Expected a finite number value.");

    const queryReads = vi.fn();
    const gridSurfaceRenders = vi.fn();
    const removeQueryReadListener = installBrunoTableClientQueryValueReadListener(queryReads);
    const removeGridSurfaceRenderListener =
      installBrunoTableClientGridSurfaceRenderListener(gridSurfaceRenders);
    try {
      runtime.publish(
        adapter.publish({
          rows: candidateRows,
          totalRows: candidateRows.length,
          version: 2,
          status: "error",
          message: "Terminal chrome update",
        }),
      );
      await expect.element(screen.getByRole("alert")).toHaveTextContent("Terminal chrome update");
      expect(queryReads).not.toHaveBeenCalled();
      expect(gridSurfaceRenders).not.toHaveBeenCalled();
    } finally {
      removeGridSurfaceRenderListener();
      removeQueryReadListener();
    }

    sourceIndexRead.mockClear();
    await screen.getByRole("button", { name: "Recover stale candidate by Name" }).click();
    await expect
      .element(screen.getByRole("grid", { name: "Data for TABLE_ID_INITIAL_STALE_RECOVERY" }))
      .toBeInTheDocument();
    await expect.element(screen.getByRole("gridcell", { name: "Invalid" })).toBeInTheDocument();
    expect(sourceIndexRead).not.toHaveBeenCalled();
  });

  test.each(["closed", "error"] as const)(
    "reclassifies an empty stale fallback when the same candidate becomes %s",
    async (status) => {
      const retry = vi.fn();
      const compiledColumns = compileColumns(columns);
      const candidateRows = [
        { id: "candidate-invalid", name: "Invalid", score: Number.NaN },
      ] satisfies readonly Row[];
      const getRowId = (row: Row) => row.id;
      const adapter = new BrunoTableClientRowPipelineAdapter(
        readySource([]),
        getRowId,
        compiledColumns,
        undefined,
        [{ columnId: "COL_ID_SCORE", direction: "asc" }],
      );
      const runtime = new BrunoTableGridRuntime(
        adapter.getPublication(),
        compiledColumns,
        adapter.getQueryConfiguration(compiledColumns),
        "TABLE_ID_EMPTY_STALE_FALLBACK",
      );
      const screen = await render(
        <BrunoTableView
          runtime={runtime.getView()}
          tableId="TABLE_ID_EMPTY_STALE_FALLBACK"
          compiledColumns={compiledColumns}
          toolbar={new BrunoTableToolbarStore(undefined)}
          rowPipeline={BrunoTableClientRowPipeline}
          rowPipelineAdapter={adapter}
        />,
      );
      const stalePublication = adapter.publish({
        rows: candidateRows,
        totalRows: candidateRows.length,
        version: 2,
        status: "stale",
        message: "Waiting for a valid projection",
      });
      const rejectedRows = adapter
        .createRowsStore(runtime.getView(), () => () => true)
        .getSnapshot();
      const fallback = adapter.rejectQueryRows(rejectedRows, {
        kind: "invalid-value",
        rowIndex: 0,
        columnId: "COL_ID_SCORE",
        message: "Expected a finite number value.",
      });
      expect(stalePublication.rowSpace).toBeDefined();
      expect(fallback?.rowSpace?.loadedRows).toBe(0);
      if (fallback === undefined) throw new Error("Expected an empty stale fallback.");
      runtime.publish(fallback);
      await expect.element(screen.getByRole("alert")).toHaveTextContent("Live data delayed");
      await expect
        .element(screen.getByRole("region", { name: "No rows" }))
        .toHaveTextContent("Waiting for a valid projection");
      await expect
        .element(screen.getByRole("grid", { name: "Data for TABLE_ID_EMPTY_STALE_FALLBACK" }))
        .not.toBeInTheDocument();

      const queryReads = vi.fn();
      const gridSurfaceRenders = vi.fn();
      const removeQueryReadListener = installBrunoTableClientQueryValueReadListener(queryReads);
      const removeGridSurfaceRenderListener =
        installBrunoTableClientGridSurfaceRenderListener(gridSurfaceRenders);
      try {
        runtime.publish(
          adapter.publish({
            rows: candidateRows,
            totalRows: candidateRows.length,
            version: 3,
            status,
            message: "Terminal without retained rows",
            retry: { run: retry, pending: false },
          }),
        );
        const announcement = screen.getByRole(status === "closed" ? "status" : "alert");
        await expect.element(announcement).toHaveTextContent("Terminal without retained rows");
        expect(screen.getByRole(status === "closed" ? "status" : "alert").all()).toHaveLength(1);
        expect(screen.getByRole("button", { name: "Retry" }).all()).toHaveLength(1);
        expect(queryReads).not.toHaveBeenCalled();
        expect(gridSurfaceRenders).not.toHaveBeenCalled();
      } finally {
        removeGridSurfaceRenderListener();
        removeQueryReadListener();
      }
    },
  );

  test.each(["closed", "error"] as const)(
    "uses empty-state chrome when an initial %s candidate fails query decoding",
    async (status) => {
      const screen = await render(
        <BrunoTableClient
          {...props}
          clientSource={{
            rows: [
              { id: "candidate-invalid", name: "Invalid", score: Number.NaN },
              { id: "candidate-valid", name: "Valid", score: 1 },
            ],
            totalRows: 2,
            version: 1,
            status,
          }}
        />,
      );

      const announcement = screen.getByRole(status === "closed" ? "status" : "alert");
      await expect
        .element(announcement)
        .toHaveTextContent(status === "closed" ? "Live updates stopped" : "Live data error");
      await expect.element(announcement).toHaveTextContent("Expected a finite number value.");
      await expect
        .element(screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" }))
        .not.toBeInTheDocument();
    },
  );

  test("does not fall back from a distinct invalid ready candidate", async () => {
    const screen = await render(<BrunoTableClient {...props} clientSource={readySource()} />);
    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).toBeInTheDocument();

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={{
          rows: [
            { id: "candidate-invalid", name: "Invalid", score: Number.NaN },
            { id: "candidate-valid", name: "Valid", score: 1 },
          ],
          totalRows: 2,
          version: 2,
          status: "ready",
        }}
      />,
    );

    await vi.waitFor(() =>
      expect(
        screen
          .getByRole("alert")
          .all()
          .some((notice) => notice.element().textContent?.includes("Invalid source value")),
      ).toBe(true),
    );
    await expect
      .element(screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).not.toBeInTheDocument();
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

  test("retains a coherent empty result while rejecting an incomplete stale publication", async () => {
    const screen = await render(
      <BrunoTableClient
        {...props}
        clientSource={{ rows: [], totalRows: 0, version: 1, status: "ready" }}
      />,
    );
    await expect.element(screen.getByRole("region", { name: "No rows" })).toBeInTheDocument();

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
    await expect
      .element(screen.getByRole("region", { name: "No rows" }))
      .toHaveTextContent("Partial delivery");
    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).not.toBeInTheDocument();
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

  test("rejects an unsupported runtime source status with visible error chrome", async () => {
    const malformedSource = {
      ...readySource([{ id: "candidate", name: "Untrusted", score: 1 }]),
      status: "offline",
    } as unknown as ReturnType<typeof readySource>;
    const screen = await render(<BrunoTableClient {...props} clientSource={malformedSource} />);

    const alert = screen.getByRole("alert");
    await expect.element(alert).toHaveTextContent("Live data error");
    await expect.element(alert).toHaveTextContent("Unsupported source status: offline.");
    await expect
      .element(screen.getByRole("grid", { name: `Data for ${props.tableId}` }))
      .not.toBeInTheDocument();
  });

  test("omits an unreadable optional lifecycle field and admits ready rows", async () => {
    const screen = await render(<BrunoTableClient {...props} clientSource={readySource()} />);
    const unreadable = readySource([{ id: "candidate", name: "Untrusted", score: 1 }]);
    Object.defineProperty(unreadable, "message", {
      get: () => {
        throw new Error("Unreadable message.");
      },
    });

    await expect(
      screen.rerender(<BrunoTableClient {...props} clientSource={unreadable} />),
    ).resolves.toBeUndefined();

    await expect.element(screen.getByRole("gridcell", { name: "Untrusted" })).toBeInTheDocument();
    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).not.toBeInTheDocument();
    await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  });

  test("preserves loading skeletons when an optional lifecycle field is unreadable", async () => {
    const unreadable = {
      rows: [],
      totalRows: 2,
      version: 1,
      status: "loading" as const,
    };
    Object.defineProperty(unreadable, "retry", {
      get: () => {
        throw new Error("Unreadable Retry.");
      },
    });

    const screen = await render(<BrunoTableClient {...props} clientSource={unreadable} />);

    await expect
      .element(screen.getByRole("grid", { name: "Loading table rows" }))
      .toHaveAttribute("aria-rowcount", "2");
    await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  });

  test("retains accepted rows when a required lifecycle value is invalid", async () => {
    const screen = await render(<BrunoTableClient {...props} clientSource={readySource()} />);
    const acceptedAdaCell = screen.getByRole("gridcell", { name: "Ada" }).element();
    const invalid = {
      ...readySource([{ id: "candidate", name: "Untrusted", score: 1 }]),
      totalRows: "one",
    } as unknown as ReturnType<typeof readySource>;

    await expect(
      screen.rerender(<BrunoTableClient {...props} clientSource={invalid} />),
    ).resolves.toBeUndefined();

    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Unreadable Client Source lifecycle field: totalRows.");
    expect(screen.getByRole("gridcell", { name: "Ada" }).element()).toBe(acceptedAdaCell);
    await expect.element(screen.getByRole("gridcell", { name: "Grace" })).toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Untrusted" }))
      .not.toBeInTheDocument();
  });

  test("rejects a malformed runtime row collection with visible error chrome", async () => {
    const malformedSource = {
      rows: null,
      totalRows: 1,
      version: 1,
      status: "ready",
    } as unknown as ReturnType<typeof readySource>;
    const screen = await render(<BrunoTableClient {...props} clientSource={malformedSource} />);

    const alert = screen.getByRole("alert");
    await expect.element(alert).toHaveTextContent("Live data error");
    await expect.element(alert).toHaveTextContent("Invalid Client Source rows: null.");
    await expect
      .element(screen.getByRole("grid", { name: `Data for ${props.tableId}` }))
      .not.toBeInTheDocument();
  });

  test("rejects a sparse runtime row collection with visible error chrome", async () => {
    const sparseRows = Array<Row>(2);
    sparseRows[1] = rows[1]!;
    const screen = await render(
      <BrunoTableClient
        {...props}
        clientSource={{
          rows: sparseRows,
          totalRows: sparseRows.length,
          version: 1,
          status: "ready",
        }}
      />,
    );

    const alert = screen.getByRole("alert");
    await expect.element(alert).toHaveTextContent("Live data error");
    await expect.element(alert).toHaveTextContent("Invalid Client Source rows: sparse array.");
    await expect
      .element(screen.getByRole("grid", { name: `Data for ${props.tableId}` }))
      .not.toBeInTheDocument();
  });

  test("retains accepted rows when a later row collection is malformed", async () => {
    const screen = await render(<BrunoTableClient {...props} clientSource={readySource()} />);
    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).toBeInTheDocument();

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={
          {
            rows: null,
            totalRows: rows.length,
            version: 2,
            status: "ready",
          } as unknown as ReturnType<typeof readySource>
        }
      />,
    );

    const alert = screen.getByRole("alert");
    await expect.element(alert).toHaveTextContent("Live data error");
    await expect.element(alert).toHaveTextContent("Invalid Client Source rows: null.");
    await expect.element(screen.getByRole("gridcell", { name: "Ada" })).toBeInTheDocument();
    await expect.element(screen.getByRole("gridcell", { name: "Grace" })).toBeInTheDocument();
  });

  test("retains accepted rows when a later row collection is sparse", async () => {
    const screen = await render(<BrunoTableClient {...props} clientSource={readySource()} />);
    const acceptedAdaCell = screen.getByRole("gridcell", { name: "Ada" }).element();
    const sparseRows = Array<Row>(2);
    sparseRows[1] = { id: "candidate", name: "Untrusted", score: 3 };

    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={{
          rows: sparseRows,
          totalRows: sparseRows.length,
          version: 2,
          status: "ready",
        }}
      />,
    );

    const alert = screen.getByRole("alert");
    await expect.element(alert).toHaveTextContent("Invalid Client Source rows: sparse array.");
    expect(screen.getByRole("gridcell", { name: "Ada" }).element()).toBe(acceptedAdaCell);
    await expect.element(screen.getByRole("gridcell", { name: "Grace" })).toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Untrusted" }))
      .not.toBeInTheDocument();
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

  test("keeps source-owned Retry focused and inert while pending", async () => {
    const run = vi.fn();
    const screen = await render(
      <BrunoTableClient
        {...props}
        clientSource={{
          ...readySource(),
          status: "error",
          retry: { run, pending: false },
        }}
      />,
    );

    const retry = screen.getByRole("button", { name: "Retry" });
    retry.element().focus();
    await screen.rerender(
      <BrunoTableClient
        {...props}
        clientSource={{
          ...readySource(),
          status: "error",
          retry: { run, pending: true },
        }}
      />,
    );

    expect(document.activeElement).toBe(retry.element());
    await expect.element(retry).toHaveAttribute("aria-disabled", "true");
    (retry.element() as HTMLButtonElement).click();
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
    await expect.element(proxy).toHaveAttribute("aria-keyshortcuts", "Alt+Enter Alt+Shift+Enter");

    grid
      .element()
      .dispatchEvent(new KeyboardEvent("keydown", { altKey: true, bubbles: true, key: "Enter" }));
    await expect
      .element(screen.getByRole("dialog", { name: "Filter Wide 01" }))
      .toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
  });

  test("bounds mounted cells across a 150-column resident source", async () => {
    const stressRows = Array.from({ length: 5_000 }, (_, index) => ({
      id: `stress-row-${String(index).padStart(4, "0")}`,
      name: `Stress row ${String(index).padStart(4, "0")}`,
      score: index,
    })) satisfies readonly Row[];
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
        clientSource={readySource(stressRows)}
      />,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_150_COLUMNS" });
    await expect.element(grid).toHaveAttribute("aria-rowcount", "5001");
    await expect
      .element(screen.getByRole("columnheader", { name: "Stress 000" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("columnheader", { name: "Stress 149" }))
      .toBeInTheDocument();
    expect(screen.getByRole("columnheader").all().length).toBeLessThan(20);
    expect(screen.getByRole("gridcell").all().length).toBeLessThan(250);
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
    expect(screen.getByRole("gridcell").all().length).toBeLessThan(250);

    const deepRowIndex = 2_500;
    grid.element().scrollTop = deepRowIndex * BRUNO_TABLE_ROW_HEIGHT;
    grid.element().dispatchEvent(new Event("scroll"));
    const deepRowName = `Stress row ${String(deepRowIndex).padStart(4, "0")}`;
    await vi.waitFor(() =>
      expect(screen.getByRole("gridcell", { name: deepRowName }).all().length).toBeGreaterThan(2),
    );
    const deepRowCells = screen.getByRole("gridcell", { name: deepRowName }).all();
    expect(deepRowCells[0]?.element().closest('[role="row"]')?.getAttribute("aria-rowindex")).toBe(
      String(deepRowIndex + 2),
    );

    const headerColumnIndexes = screen
      .getByRole("columnheader")
      .all()
      .map((header) => header.element().getAttribute("aria-colindex"));
    const bodyColumnIndexes = deepRowCells
      .map((cell) => cell.element().getAttribute("aria-colindex"))
      .toSorted((left, right) => Number(left) - Number(right));
    expect(bodyColumnIndexes).toEqual(headerColumnIndexes);
    const pinnedStartCell = deepRowCells.find(
      (cell) => cell.element().getAttribute("aria-colindex") === "1",
    );
    if (pinnedStartCell === undefined) throw new Error("The pinned start cell was not mounted.");
    const pinnedStartRegion = pinnedStartCell
      .element()
      .closest<HTMLElement>('[data-bruno-pinned-body-region="start"]');
    expect(pinnedStartRegion).not.toBeNull();
    const pinnedEndCell = deepRowCells.find(
      (cell) => cell.element().getAttribute("aria-colindex") === "150",
    );
    if (pinnedEndCell === undefined) throw new Error("The pinned end cell was not mounted.");
    expect(pinnedEndCell.element().closest('[data-bruno-pinned-body-region="end"]')).not.toBeNull();
    const pinnedStartOwner = [...grid.element().querySelectorAll<HTMLElement>('[role="row"]')].find(
      (row) => row.getAttribute("aria-owns")?.split(" ").includes(pinnedStartCell.element().id),
    );
    const pinnedEndOwner = [...grid.element().querySelectorAll<HTMLElement>('[role="row"]')].find(
      (row) => row.getAttribute("aria-owns")?.split(" ").includes(pinnedEndCell.element().id),
    );
    expect(pinnedStartOwner).toBe(pinnedEndOwner);
    expect(pinnedStartOwner?.getAttribute("aria-rowindex")).toBe(String(deepRowIndex + 2));
    expect(pinnedStartOwner?.getAttribute("aria-owns")?.split(" ")).toEqual(
      deepRowCells
        .toSorted(
          (left, right) =>
            Number(left.element().getAttribute("aria-colindex")) -
            Number(right.element().getAttribute("aria-colindex")),
        )
        .map((cell) => cell.element().id),
    );
    const rowLayer = grid.element().querySelector<HTMLElement>("[data-bruno-row-layer]");
    if (pinnedStartRegion === null) throw new Error("The pinned start region was not mounted.");
    expect(pinnedStartRegion.closest("[data-bruno-row-layer]")).toBe(rowLayer);
    expect(pinnedStartRegion.style.position).toBe("sticky");
    expect(screen.getByRole("row").all().length).toBeLessThan(30);
    expect(screen.getByRole("columnheader").all().length).toBeLessThan(20);
    expect(screen.getByRole("gridcell").all().length).toBeLessThan(250);
  });

  test("keeps logical pinned regions and horizontal reveal correct in RTL", async () => {
    const rtlColumns = [
      {
        ...columns[0],
        columnId: "COL_ID_RTL_START",
        headerName: "RTL start",
        pinned: "start" as const,
        width: 120,
      },
      ...Array.from({ length: 10 }, (_, index) => ({
        ...columns[0],
        columnId: `COL_ID_RTL_CENTER_${String(index).padStart(2, "0")}`,
        headerName: `RTL center ${String(index).padStart(2, "0")}`,
        width: 160,
      })),
      {
        ...columns[0],
        columnId: "COL_ID_RTL_END",
        headerName: "RTL end",
        pinned: "end" as const,
        width: 120,
      },
    ] as BrunoTableColumns<Row>;
    const screen = await render(
      <div dir="rtl">
        <BrunoTableClient
          tableId="TABLE_ID_RTL"
          getRowId={(row: Row) => row.id}
          columns={rtlColumns}
          initialOrderBy={[{ columnId: "COL_ID_RTL_START", direction: "asc" }]}
          clientSource={readySource()}
        />
      </div>,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_RTL" });
    const gridElement = grid.element() as HTMLElement;
    const startHeader = screen.getByRole("columnheader", { name: "RTL start" }).element();
    const endHeader = screen.getByRole("columnheader", { name: "RTL end" }).element();
    const gridRect = gridElement.getBoundingClientRect();
    const assertPinnedBodyEdges = () => {
      const bodyCells = screen.getByRole("gridcell").all();
      const startCell = bodyCells.find(
        (cell) => cell.element().getAttribute("aria-colindex") === "1",
      );
      const endCell = bodyCells.find(
        (cell) => cell.element().getAttribute("aria-colindex") === "12",
      );
      if (startCell === undefined || endCell === undefined) {
        throw new Error("The RTL pinned body cells were not continuously mounted.");
      }
      expect(startCell.element().getBoundingClientRect().right).toBeCloseTo(gridRect.right, 0);
      expect(endCell.element().getBoundingClientRect().left).toBeCloseTo(gridRect.left, 0);
    };
    expect(getComputedStyle(gridElement).direction).toBe("rtl");
    expect(startHeader.getBoundingClientRect().right).toBeCloseTo(gridRect.right, 0);
    expect(endHeader.getBoundingClientRect().left).toBeCloseTo(gridRect.left, 0);
    assertPinnedBodyEdges();

    const activeCell = () => {
      const activeId = gridElement.getAttribute("aria-activedescendant");
      return screen
        .getByRole("gridcell")
        .all()
        .find((cell) => cell.element().id === activeId);
    };
    gridElement.focus();
    await vi.waitFor(() => expect(activeCell()?.element().getAttribute("aria-colindex")).toBe("1"));
    for (let index = 0; index < 10; index += 1) {
      gridElement.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    }
    await vi.waitFor(() =>
      expect(activeCell()?.element().getAttribute("aria-colindex")).toBe("11"),
    );
    const forwardCellRect = activeCell()!.element().getBoundingClientRect();
    expect(forwardCellRect.left).toBeCloseTo(endHeader.getBoundingClientRect().right, 0);
    expect(startHeader.getBoundingClientRect().right).toBeCloseTo(gridRect.right, 0);
    expect(endHeader.getBoundingClientRect().left).toBeCloseTo(gridRect.left, 0);
    assertPinnedBodyEdges();

    for (let index = 0; index < 9; index += 1) {
      gridElement.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" }));
    }
    await vi.waitFor(() => expect(activeCell()?.element().getAttribute("aria-colindex")).toBe("2"));
    const backwardCellRect = activeCell()!.element().getBoundingClientRect();
    expect(backwardCellRect.right).toBeCloseTo(startHeader.getBoundingClientRect().left, 0);

    gridElement.scrollLeft = -960;
    assertPinnedBodyEdges();
    gridElement.dispatchEvent(new Event("scroll"));
    await expect
      .element(screen.getByRole("columnheader", { name: "RTL center 09" }))
      .toBeInTheDocument();
    const overlay = gridElement.parentElement?.querySelector<HTMLElement>(
      "[data-bruno-scrollbar-overlay]",
    );
    expect(
      Number.parseFloat(
        overlay?.style.getPropertyValue("--bruno-table-scrollbar-horizontal-thumb-offset") ?? "0",
      ),
    ).toBeLessThan(0);
    expect(startHeader.getBoundingClientRect().right).toBeCloseTo(gridRect.right, 0);
    expect(endHeader.getBoundingClientRect().left).toBeCloseTo(gridRect.left, 0);
    assertPinnedBodyEdges();

    const directionOwner = gridElement.closest<HTMLElement>('[dir="rtl"]');
    expect(directionOwner).not.toBeNull();
    directionOwner!.dir = "ltr";
    gridElement.style.width = "720px";
    await vi.waitFor(() => expect(getComputedStyle(gridElement).direction).toBe("ltr"));
    await vi.waitFor(() => expect(gridElement.clientWidth).toBe(720));
    await expect
      .element(screen.getByRole("columnheader", { name: "RTL center 09" }))
      .toBeInTheDocument();
    await vi.waitFor(() => expect(gridElement.scrollLeft).toBeCloseTo(960, 0));
    await vi.waitFor(() =>
      expect(
        Number.parseFloat(
          overlay?.style.getPropertyValue("--bruno-table-scrollbar-horizontal-thumb-offset") ??
            "-1",
        ),
      ).toBeGreaterThanOrEqual(0),
    );
    gridElement.scrollLeft = 0;
    gridElement.dispatchEvent(new Event("scroll"));
    await expect
      .element(screen.getByRole("columnheader", { name: "RTL center 00" }))
      .toBeInTheDocument();
    gridElement.scrollLeft = 960;
    gridElement.dispatchEvent(new Event("scroll"));
    await expect
      .element(screen.getByRole("columnheader", { name: "RTL center 09" }))
      .toBeInTheDocument();
  });

  test("synchronizes CSSOM-only scroll-owner direction changes with decorative chrome", async () => {
    const directionStyle = document.createElement("style");
    document.head.append(directionStyle);
    try {
      const screen = await render(
        <BrunoTableClient
          tableId="TABLE_ID_GRID_ONLY_RTL"
          getRowId={(row: Row) => row.id}
          columns={
            [
              { ...wideColumns[0], columnId: "COL_ID_GRID_RTL_START", pinned: "start" },
              ...wideColumns.slice(1, 10),
              {
                ...wideColumns[0],
                columnId: "COL_ID_GRID_RTL_END",
                headerName: "Grid-only RTL end",
                pinned: "end",
              },
            ] as const
          }
          initialOrderBy={[{ columnId: "COL_ID_GRID_RTL_START", direction: "asc" }]}
          clientSource={readySource()}
        />,
      );
      const grid = screen
        .getByRole("grid", { name: "Data for TABLE_ID_GRID_ONLY_RTL" })
        .element() as HTMLElement;
      const overlay = grid.parentElement?.querySelector<HTMLElement>(
        "[data-bruno-scrollbar-overlay]",
      );
      if (overlay === undefined || overlay === null) {
        throw new Error("The grid-only RTL scrollbar overlay was not mounted.");
      }
      const horizontalTrack = overlay.querySelector<HTMLElement>(
        '[data-bruno-scrollbar-track="horizontal"]',
      );
      const verticalTrack = overlay.querySelector<HTMLElement>(
        '[data-bruno-scrollbar-track="vertical"]',
      );
      if (horizontalTrack === null || verticalTrack === null) {
        throw new Error("The grid-only RTL scrollbar tracks were not mounted.");
      }
      expect(getComputedStyle(grid).direction).toBe("ltr");
      expect(getComputedStyle(overlay).direction).toBe("ltr");
      grid.scrollLeft = 320;
      grid.dispatchEvent(new Event("scroll"));
      await vi.waitFor(() =>
        expect(
          Number.parseFloat(
            overlay.style.getPropertyValue("--bruno-table-scrollbar-horizontal-thumb-offset"),
          ),
        ).toBeGreaterThan(0),
      );

      const stylesheet = directionStyle.sheet;
      if (stylesheet === null) {
        throw new Error("The CSSOM direction stylesheet was not available.");
      }
      stylesheet.insertRule("[data-bruno-scroll-owner] { direction: rtl; }", 0);
      expect(getComputedStyle(grid).direction).toBe("rtl");

      // Chromium uses the negative RTL scroll model. Default and reverse models clamp this write
      // to zero. This first event after CSSStyleSheet.insertRule() carries real input, proving the
      // runtime resolves the CSSOM-only direction change before decoding its native coordinate.
      grid.scrollLeft = -640;
      grid.dispatchEvent(new Event("scroll"));
      await vi.waitFor(() => expect(overlay.style.direction).toBe("rtl"));
      expect(getComputedStyle(grid).direction).toBe("rtl");
      expect(getComputedStyle(overlay).direction).toBe("rtl");
      await vi.waitFor(() =>
        expect(
          Number.parseFloat(
            overlay.style.getPropertyValue("--bruno-table-scrollbar-horizontal-thumb-offset"),
          ),
        ).toBeLessThan(0),
      );
      const pinnedRegionInlineSize = 160;
      const nativeVerticalScrollbarInlineSize = grid.offsetWidth - grid.clientWidth;
      const gridRect = grid.getBoundingClientRect();
      const horizontalTrackRect = horizontalTrack.getBoundingClientRect();
      const verticalTrackRect = verticalTrack.getBoundingClientRect();
      expect(horizontalTrackRect.right).toBeCloseTo(gridRect.right - pinnedRegionInlineSize, 0);
      expect(horizontalTrackRect.left).toBeCloseTo(
        gridRect.left + pinnedRegionInlineSize + nativeVerticalScrollbarInlineSize,
        0,
      );
      expect(verticalTrackRect.left).toBeLessThan(gridRect.left + gridRect.width / 2);
    } finally {
      directionStyle.remove();
    }
  });

  test("keeps scroll-frame geometry out of the table root and observes zoomed resize", async () => {
    const viewRenders = vi.fn();
    const headerRenders = vi.fn();
    const removeViewRenderListener = installBrunoTableClientViewRenderListener(viewRenders);
    const removeHeaderRenderListener = installBrunoTableClientHeaderRenderListener(headerRenders);
    const manyRows = Array.from({ length: 200 }, (_, index) => ({
      id: `scroll-row-${index}`,
      name: `Scroll row ${String(index).padStart(3, "0")}`,
      score: index,
    })) satisfies readonly Row[];
    try {
      const screen = await render(
        <BrunoTableClient
          tableId="TABLE_ID_GEOMETRY"
          getRowId={(row: Row) => row.id}
          columns={wideColumns}
          initialOrderBy={[{ columnId: "COL_ID_WIDE_01", direction: "asc" }]}
          clientSource={readySource(manyRows)}
        />,
      );
      const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_GEOMETRY" });
      const gridElement = grid.element() as HTMLElement;
      const rowLayer = gridElement.querySelector<HTMLElement>("[data-bruno-row-layer]");
      expect(rowLayer).not.toBeNull();
      expect(
        gridElement.closest("[data-bruno-table]")?.querySelectorAll("[data-bruno-scroll-owner]"),
      ).toHaveLength(1);
      expect(gridElement.style.getPropertyValue("--bruno-table-row-layer-offset")).toBe("");
      gridElement.style.width = "800px";
      await vi.waitFor(() => expect(gridElement.clientWidth).toBe(800));
      await expect
        .element(screen.getByRole("columnheader", { name: "Wide 07" }))
        .toBeInTheDocument();
      const expandedHeaderCount = screen.getByRole("columnheader").all().length;
      const expandedColumnIndexes = screen
        .getByRole("columnheader")
        .all()
        .map((header) => header.element().getAttribute("aria-colindex"));
      gridElement.style.zoom = "1.25";
      await vi.waitFor(() =>
        expect(gridElement.getBoundingClientRect().width).toBeCloseTo(1_000, 0),
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      expect(gridElement.clientWidth).toBe(800);
      expect(screen.getByRole("columnheader").all()).toHaveLength(expandedHeaderCount);
      expect(
        screen
          .getByRole("columnheader")
          .all()
          .map((header) => header.element().getAttribute("aria-colindex")),
      ).toEqual(expandedColumnIndexes);

      const headerRendersBeforeResize = headerRenders.mock.calls.length;
      gridElement.style.width = "360px";
      await vi.waitFor(() => expect(gridElement.clientWidth).toBe(360));
      await vi.waitFor(() =>
        expect(screen.getByRole("columnheader").all().length).toBeLessThan(expandedHeaderCount),
      );
      expect(gridElement.getBoundingClientRect().width).toBeCloseTo(450, 0);
      expect(headerRenders.mock.calls.length).toBeGreaterThan(headerRendersBeforeResize);

      const rendersBeforeScroll = viewRenders.mock.calls.length;
      const headerRendersBeforeScroll = headerRenders.mock.calls.length;
      gridElement.scrollTop = 1_200;
      gridElement.dispatchEvent(new Event("scroll"));
      await expect
        .element(screen.getByRole("gridcell", { name: "Scroll row 040" }).nth(0))
        .toBeInTheDocument();
      expect(viewRenders).toHaveBeenCalledTimes(rendersBeforeScroll);
      expect(headerRenders).toHaveBeenCalledTimes(headerRendersBeforeScroll);
      expect(rowLayer?.style.getPropertyValue("--bruno-table-row-layer-offset")).toBe("");
      expect(
        screen
          .getByRole("row")
          .all()
          .some((row) => row.element().style.transform.startsWith("translate3d")),
      ).toBe(true);

      const replacedRows = screen
        .getByRole("row")
        .all()
        .map((row) => row.element())
        .filter((row) => row.style.transform.startsWith("translate3d"));
      expect(replacedRows.length).toBeGreaterThan(0);
      const replacedTransforms = replacedRows.map((row) => row.style.transform);
      const replacementRows = manyRows.map((row, index) => ({
        ...row,
        id: `replacement-row-${index}`,
        name: `Replacement row ${String(index).padStart(3, "0")}`,
      }));
      await screen.rerender(
        <BrunoTableClient
          tableId="TABLE_ID_GEOMETRY"
          getRowId={(row: Row) => row.id}
          columns={wideColumns}
          initialOrderBy={[{ columnId: "COL_ID_WIDE_01", direction: "asc" }]}
          clientSource={{ ...readySource(replacementRows), version: 2 }}
        />,
      );
      await expect
        .element(screen.getByRole("gridcell", { name: "Replacement row 040" }).nth(0))
        .toBeInTheDocument();
      expect(replacedRows.every((row) => !row.isConnected)).toBe(true);

      const replacementGrid = screen
        .getByRole("grid", { name: "Data for TABLE_ID_GEOMETRY" })
        .element() as HTMLElement;
      replacementGrid.scrollTop = 2_400;
      replacementGrid.dispatchEvent(new Event("scroll"));
      await expect
        .element(screen.getByRole("gridcell", { name: "Replacement row 080" }).nth(0))
        .toBeInTheDocument();
      expect(replacedRows.map((row) => row.style.transform)).toEqual(replacedTransforms);
    } finally {
      removeHeaderRenderListener();
      removeViewRenderListener();
    }
  });

  test("keeps exact reveal immediate when reduced motion is preferred", async () => {
    const session: PlaywrightCDPSession = cdp();
    await session.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    try {
      const manyRows = Array.from({ length: 200 }, (_, index) => ({
        id: `reduced-motion-row-${index}`,
        name: `Reduced motion row ${index}`,
        score: index,
      })) satisfies readonly Row[];
      const screen = await render(
        <BrunoTableClient {...props} clientSource={readySource(manyRows)} />,
      );
      const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" });
      const gridElement = grid.element() as HTMLElement;
      expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
      gridElement.style.scrollBehavior = "smooth";
      gridElement.focus();
      gridElement.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "PageDown" }));
      await vi.waitFor(() => expect(gridElement.scrollTop).toBeGreaterThan(0));
      const revealedScrollTop = gridElement.scrollTop;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      expect(gridElement.scrollTop).toBe(revealedScrollTop);
    } finally {
      await session.send("Emulation.setEmulatedMedia", { features: [] });
    }
  });

  test("rejects an offscreen newly active query value until its source row is repaired", async () => {
    const queryReads: string[] = [];
    const mirroredQueryReads: string[] = [];
    const queryTableIds = new Set<string>();
    const restoreQueryReadListener = installBrunoTableClientQueryValueReadListener(
      (_rowId, columnId, tableId) => {
        queryReads.push(columnId);
        queryTableIds.add(tableId);
      },
    );
    const restoreMirroredQueryReadListener = installBrunoTableClientQueryValueReadListener(
      (_rowId, columnId) => mirroredQueryReads.push(columnId),
    );
    const secondaryDecode = vi.fn((input: unknown) =>
      typeof input === "number" && Number.isFinite(input)
        ? ({ _tag: "Success", value: input } as const)
        : ({ _tag: "Failure", message: "Expected a number." } as const),
    );
    const secondaryValueType: BrunoTableValueType<number, "numeric", "number"> = {
      codecId: "test/lazy-secondary-number",
      codecVersion: 1,
      filterFamily: "numeric",
      editorFamily: "number",
      cellAlign: "end",
      editorLayout: "inline",
      defaultWidth: 120,
      decodeRuntime: secondaryDecode,
      equivalent: (left, right) => left === right,
      compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
      formatCanonicalText: String,
      parseCanonicalText: (text) => ({ _tag: "Success", value: Number(text) }),
      formatDisplay: String,
      encodePersisted: String,
      decodePersisted: (input) =>
        typeof input === "string"
          ? { _tag: "Success", value: Number(input) }
          : { _tag: "Failure", message: "Expected persisted text." },
    };
    const lazyColumns = Array.from({ length: 100 }, (_, index) => ({
      columnId: `COL_ID_LAZY_${String(index).padStart(3, "0")}`,
      field: index === 75 ? ("score" as const) : ("name" as const),
      headerName: `Lazy ${String(index).padStart(3, "0")}`,
      valueType: index === 75 ? secondaryValueType : ("text" as const),
      width: 120,
    })) as BrunoTableColumns<Row>;
    const compiledLazyColumns = compileColumns(lazyColumns);
    const getRowId = (row: Row) => row.id;
    let currentSource = readySource([
      { id: "first", name: "Ada", score: 1 },
      { id: "second", name: "Grace", score: 2 },
    ]);
    const rowPipelineAdapter = new BrunoTableClientRowPipelineAdapter(
      currentSource,
      getRowId,
      compiledLazyColumns,
      undefined,
      [{ columnId: "COL_ID_LAZY_000", direction: "asc" }],
    );
    const runtime = new BrunoTableGridRuntime(
      rowPipelineAdapter.getPublication(),
      compiledLazyColumns,
      rowPipelineAdapter.getQueryConfiguration(compiledLazyColumns),
      "TABLE_ID_LAZY_SECONDARY_SORT",
    );
    const runtimeView = runtime.getView();
    const reconcile = () => {
      runtime.reconcile(
        rowPipelineAdapter.reconcile(currentSource, getRowId, compiledLazyColumns),
        compiledLazyColumns,
        rowPipelineAdapter.getQueryConfiguration(compiledLazyColumns),
      );
    };
    reconcile();
    const toolbar = new BrunoTableToolbarStore(undefined);

    try {
      const screen = await render(
        <BrunoTableView
          runtime={runtimeView}
          tableId="TABLE_ID_LAZY_SECONDARY_SORT"
          compiledColumns={compiledLazyColumns}
          toolbar={toolbar}
          rowPipeline={BrunoTableClientRowPipeline}
          rowPipelineAdapter={rowPipelineAdapter}
        />,
      );

      await expect
        .element(screen.getByRole("grid", { name: "Data for TABLE_ID_LAZY_SECONDARY_SORT" }))
        .toBeInTheDocument();
      await expect
        .element(screen.getByRole("columnheader", { name: "Lazy 075" }))
        .not.toBeInTheDocument();
      expect(secondaryDecode).not.toHaveBeenCalled();

      queryReads.length = 0;
      runtime.toggleColumnSort("COL_ID_LAZY_075", false);
      await vi.waitFor(() =>
        expect(secondaryDecode).toHaveBeenCalledTimes(currentSource.rows.length),
      );
      await expect
        .element(screen.getByRole("grid", { name: "Data for TABLE_ID_LAZY_SECONDARY_SORT" }))
        .toBeInTheDocument();
      await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
      await expect
        .element(screen.getByRole("columnheader", { name: "Lazy 075" }))
        .not.toBeInTheDocument();

      runtime.toggleColumnSort("COL_ID_LAZY_000", false);
      currentSource = readySource([
        currentSource.rows[0]!,
        { id: "second", name: "Grace", score: Number.NaN },
      ]);
      reconcile();
      await expect
        .element(screen.getByRole("grid", { name: "Data for TABLE_ID_LAZY_SECONDARY_SORT" }))
        .toBeInTheDocument();
      await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();

      runtime.toggleColumnSort("COL_ID_LAZY_075", false);

      await vi.waitFor(() =>
        expect(
          screen
            .getByRole("alert")
            .all()
            .some((alert) => alert.element().textContent?.includes("Invalid source value")),
        ).toBe(true),
      );
      await expect
        .element(screen.getByRole("grid", { name: "Data for TABLE_ID_LAZY_SECONDARY_SORT" }))
        .not.toBeInTheDocument();
      currentSource = { ...currentSource, version: currentSource.version + 1 };
      reconcile();
      await vi.waitFor(() =>
        expect(
          screen
            .getByRole("alert")
            .all()
            .some((alert) => alert.element().textContent?.includes("Invalid source value")),
        ).toBe(true),
      );
      await expect
        .element(screen.getByRole("grid", { name: "Data for TABLE_ID_LAZY_SECONDARY_SORT" }))
        .not.toBeInTheDocument();

      queryReads.length = 0;
      currentSource = readySource([
        currentSource.rows[0]!,
        { id: "second", name: "Grace", score: 2 },
      ]);
      reconcile();
      await expect
        .element(screen.getByRole("grid", { name: "Data for TABLE_ID_LAZY_SECONDARY_SORT" }))
        .toBeInTheDocument();
      await vi.waitFor(() => expect(queryReads).toContain("COL_ID_LAZY_075"));
      expect(queryReads).not.toContain("COL_ID_LAZY_000");
      expect(mirroredQueryReads).toContain("COL_ID_LAZY_075");
      expect([...queryTableIds]).toEqual(["TABLE_ID_LAZY_SECONDARY_SORT"]);
    } finally {
      restoreMirroredQueryReadListener();
      restoreQueryReadListener();
    }
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
    const gridElement = region.element() as HTMLElement;
    await expect
      .element(screen.getByRole("gridcell", { name: "Row 0" }).nth(0))
      .toBeInTheDocument();
    const overlay = gridElement.parentElement?.querySelector<HTMLElement>(
      "[data-bruno-scrollbar-overlay]",
    );
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    expect(gridElement.contains(overlay!)).toBe(false);
    await vi.waitFor(() => {
      expect(overlay?.style.getPropertyValue("--bruno-table-scrollbar-horizontal-start")).toBe(
        "160px",
      );
      expect(overlay?.style.getPropertyValue("--bruno-table-scrollbar-horizontal-end")).toBe(
        `${160 + gridElement.offsetWidth - gridElement.clientWidth}px`,
      );
    });
    expect(gridElement.style.cssText).not.toContain("scrollbar-horizontal");
    const initialRows = screen.getByRole("row").all().length;

    await region.wheel({ delta: { y: 1200 } });
    await expect
      .element(screen.getByRole("gridcell", { name: "Row 40" }).nth(0))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("gridcell", { name: "Row 0" }).nth(0))
      .toHaveAttribute("aria-colindex", "1");
    expect(screen.getByRole("row").all().length).toBeLessThan(initialRows + 24);
    await vi.waitFor(() =>
      expect(
        Number.parseFloat(
          overlay?.style.getPropertyValue("--bruno-table-scrollbar-vertical-thumb-offset") ?? "0",
        ),
      ).toBeGreaterThan(0),
    );

    await region.wheel({ delta: { x: 1200 } });
    await expect
      .element(screen.getByRole("columnheader", { name: "Scroll end" }))
      .toBeInTheDocument();
    expect(screen.getByRole("columnheader").all().length).toBeLessThan(wideColumns.length + 1);
    await vi.waitFor(() =>
      expect(
        Number.parseFloat(
          overlay?.style.getPropertyValue("--bruno-table-scrollbar-horizontal-thumb-offset") ?? "0",
        ),
      ).toBeGreaterThan(0),
    );
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
    const expectedPageSize = 10;
    grid.element().style.height = "396px";
    grid.element().focus();

    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "PageUp" }));
    const firstCell = screen.getByRole("gridcell", { name: "Page row 000" });
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(firstCell.element().id),
    );

    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "PageDown" }));
    const pageDestination = screen.getByRole("gridcell", {
      name: `Page row ${String(expectedPageSize).padStart(3, "0")}`,
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

    for (let index = 0; index < manyRows.length; index += expectedPageSize) {
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

  test("navigates Home, End, and Ctrl/Cmd arrow boundaries through the logical grid", async () => {
    const screen = await render(<BrunoTableClient {...props} clientSource={readySource()} />);
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" });
    const nameHeader = screen.getByRole("columnheader", { name: "Name" });
    const scoreHeader = screen.getByRole("columnheader", { name: "Score" });
    grid.element().focus();

    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("gridcell", { name: "2" }).element().id,
    );
    grid
      .element()
      .dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "Home" }));
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(nameHeader.element().id);
    grid
      .element()
      .dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, metaKey: true, key: "ArrowRight" }),
      );
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(scoreHeader.element().id);
    grid
      .element()
      .dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "ArrowDown" }),
      );
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("gridcell", { name: "4" }).element().id,
    );
    grid
      .element()
      .dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "ArrowUp" }),
      );
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(scoreHeader.element().id);
    grid
      .element()
      .dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "End" }));
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("gridcell", { name: "4" }).element().id,
    );
  });

  test("keeps pinned columns in separate continuously mounted regions", async () => {
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_PINNED"
        getRowId={(row: Row) => row.id}
        columns={
          [
            columns[1],
            {
              ...columns[0],
              columnId: "COL_ID_PINNED_END",
              headerName: "Pinned end",
              pinned: "end",
            },
            { ...columns[0], columnId: "COL_ID_PINNED_START", pinned: "start" },
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
    expect(
      screen
        .getByRole("columnheader")
        .all()
        .map((header) => header.element().textContent),
    ).toEqual(["Name", "Score↑1", "Pinned end"]);
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
    const startHeader = screen.getByRole("columnheader", { name: "Name" }).element();
    const endHeader = screen.getByRole("columnheader", { name: "Pinned end" }).element();
    expect(startHeader.tagName).toBe("TH");
    expect(startHeader).toHaveAttribute("scope", "col");
    expect(endHeader.tagName).toBe("TH");
    expect(endHeader).toHaveAttribute("scope", "col");
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
      .closest('[data-bruno-pinned-body-region="start"]');
    expect(Number(headerLayer?.style.zIndex)).toBeGreaterThan(
      Number((bodyPinnedLayer as HTMLElement | null)?.style.zIndex),
    );
  });

  test("virtualizes, reveals, and restores a suspended many-column pinned layout", async () => {
    const narrowColumns = [
      ...Array.from({ length: 30 }, (_, index) => ({
        ...columns[0],
        columnId: `COL_ID_NARROW_START_${String(index).padStart(2, "0")}`,
        headerName: `Start ${index}`,
        pinned: "start" as const,
        width: 120,
      })),
      { ...columns[1], columnId: "COL_ID_NARROW_CENTER", width: 120 },
      ...Array.from({ length: 30 }, (_, index) => ({
        ...columns[0],
        columnId: `COL_ID_NARROW_END_${String(index).padStart(2, "0")}`,
        headerName: `End ${index}`,
        pinned: "end" as const,
        width: 120,
      })),
    ] as BrunoTableColumns<Row>;
    const renderAtWidth = (width: number) => (
      <div style={{ width }}>
        <BrunoTableClient
          tableId="TABLE_ID_NARROW_PINNING"
          getRowId={(row: Row) => row.id}
          columns={narrowColumns}
          initialOrderBy={[{ columnId: "COL_ID_NARROW_CENTER", direction: "asc" }]}
          clientSource={readySource()}
        />
      </div>
    );
    const initiallyRenderedColumns = new Set<string>();
    const removeInitialRenderListener = installBrunoTableClientCellRenderListener(
      (_rowId, columnId) => initiallyRenderedColumns.add(columnId),
    );
    const screen = await render(renderAtWidth(240)).finally(removeInitialRenderListener);

    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_NARROW_PINNING" });
    await expect.element(grid).toBeInTheDocument();
    expect(initiallyRenderedColumns.size).toBeLessThan(10);
    await vi.waitFor(() => {
      expect(
        screen
          .getByRole("columnheader")
          .all()
          .every((header) => header.element().closest("[data-pinned-region]") === null),
      ).toBe(true);
    });
    expect(screen.getByRole("columnheader").all().length).toBeLessThan(10);

    const activeCell = () => {
      const activeId = grid.element().getAttribute("aria-activedescendant");
      return screen
        .getByRole("gridcell")
        .all()
        .find((cell) => cell.element().id === activeId);
    };
    const moveHorizontally = (key: "ArrowLeft" | "ArrowRight", count = 1) => {
      for (let step = 0; step < count; step += 1) {
        grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
      }
    };
    grid.element().focus();
    await vi.waitFor(() => expect(activeCell()?.element().getAttribute("aria-colindex")).toBe("1"));

    moveHorizontally("ArrowRight", 29);
    await vi.waitFor(() =>
      expect(activeCell()?.element().getAttribute("aria-colindex")).toBe("30"),
    );
    expect(activeCell()?.element().textContent).toBe("Grace");
    expect(activeCell()?.element().id).toContain(
      encodeExpectedDomIdSegment("COL_ID_NARROW_START_29"),
    );

    moveHorizontally("ArrowRight");
    await vi.waitFor(() =>
      expect(activeCell()?.element().getAttribute("aria-colindex")).toBe("31"),
    );
    expect(activeCell()?.element().textContent).toBe("2");
    expect(activeCell()?.element().id).toContain(
      encodeExpectedDomIdSegment("COL_ID_NARROW_CENTER"),
    );
    expect(
      screen
        .getByRole("columnheader", { name: "Start 29" })
        .element()
        .getAttribute("aria-colindex"),
    ).toBe("30");
    expect(
      screen.getByRole("columnheader", { name: "Score" }).element().getAttribute("aria-colindex"),
    ).toBe("31");
    expect(
      screen.getByRole("columnheader", { name: "End 0" }).element().getAttribute("aria-colindex"),
    ).toBe("32");

    moveHorizontally("ArrowRight");
    await vi.waitFor(() =>
      expect(activeCell()?.element().getAttribute("aria-colindex")).toBe("32"),
    );
    expect(activeCell()?.element().textContent).toBe("Grace");
    expect(activeCell()?.element().id).toContain(
      encodeExpectedDomIdSegment("COL_ID_NARROW_END_00"),
    );

    moveHorizontally("ArrowLeft");
    await vi.waitFor(() =>
      expect(activeCell()?.element().getAttribute("aria-colindex")).toBe("31"),
    );
    expect(activeCell()?.element().textContent).toBe("2");
    expect(activeCell()?.element().id).toContain(
      encodeExpectedDomIdSegment("COL_ID_NARROW_CENTER"),
    );

    moveHorizontally("ArrowLeft");
    await vi.waitFor(() =>
      expect(activeCell()?.element().getAttribute("aria-colindex")).toBe("30"),
    );
    expect(activeCell()?.element().textContent).toBe("Grace");
    expect(activeCell()?.element().id).toContain(
      encodeExpectedDomIdSegment("COL_ID_NARROW_START_29"),
    );

    grid
      .element()
      .dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "ArrowRight" }),
      );
    await vi.waitFor(() =>
      expect(activeCell()?.element().getAttribute("aria-colindex")).toBe("61"),
    );
    await vi.waitFor(() =>
      expect(grid.element().scrollLeft).toBe(7_320 - grid.element().clientWidth),
    );
    expect(screen.getByRole("columnheader").all().length).toBeLessThan(10);

    grid
      .element()
      .dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "ArrowLeft" }),
      );
    await vi.waitFor(() => expect(activeCell()?.element().getAttribute("aria-colindex")).toBe("1"));
    await vi.waitFor(() => expect(grid.element().scrollLeft).toBe(0));

    await screen.rerender(renderAtWidth(8_000));
    const restoredStart = screen.getByRole("columnheader", { name: "Start 0" });
    const restoredEnd = screen.getByRole("columnheader", { name: "End 29" });
    await vi.waitFor(() =>
      expect(restoredStart.element().closest('[data-pinned-region="start"]')).not.toBeNull(),
    );
    expect(restoredEnd.element().closest('[data-pinned-region="end"]')).not.toBeNull();
    expect(
      screen.getByRole("columnheader", { name: "Score" }).element().getAttribute("aria-colindex"),
    ).toBe("31");
    expect(restoredEnd.element().getAttribute("aria-colindex")).toBe("61");
  });

  test("bounds and restores an oversized centreless pinned layout from its first commit", async () => {
    const allPinnedColumns = [
      ...Array.from({ length: 30 }, (_, index) => ({
        ...columns[0],
        columnId: `COL_ID_ALL_PINNED_START_${String(index).padStart(2, "0")}`,
        headerName: `All pinned start ${index}`,
        pinned: "start" as const,
        width: 120,
      })),
      ...Array.from({ length: 30 }, (_, index) => ({
        ...columns[0],
        columnId: `COL_ID_ALL_PINNED_END_${String(index).padStart(2, "0")}`,
        headerName: `All pinned end ${index}`,
        pinned: "end" as const,
        width: 120,
      })),
    ] as BrunoTableColumns<Row>;
    const renderAtWidth = (width: number) => (
      <div style={{ width }}>
        <BrunoTableClient
          tableId="TABLE_ID_ALL_PINNED"
          getRowId={(row: Row) => row.id}
          columns={allPinnedColumns}
          initialOrderBy={[{ columnId: "COL_ID_ALL_PINNED_START_00", direction: "asc" }]}
          clientSource={readySource()}
        />
      </div>
    );
    const initiallyRenderedColumns = new Set<string>();
    const removeInitialRenderListener = installBrunoTableClientCellRenderListener(
      (_rowId, columnId) => initiallyRenderedColumns.add(columnId),
    );
    const screen = await render(renderAtWidth(240)).finally(removeInitialRenderListener);
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_ALL_PINNED" });

    await expect.element(grid).toBeInTheDocument();
    expect(initiallyRenderedColumns.size).toBeLessThan(10);
    expect(screen.getByRole("columnheader").all().length).toBeLessThan(10);
    expect(
      screen
        .getByRole("columnheader")
        .all()
        .every((header) => header.element().closest("[data-pinned-region]") === null),
    ).toBe(true);

    const activeCell = () => {
      const activeId = grid.element().getAttribute("aria-activedescendant");
      return screen
        .getByRole("gridcell")
        .all()
        .find((cell) => cell.element().id === activeId);
    };
    grid.element().focus();
    await vi.waitFor(() => expect(activeCell()?.element().getAttribute("aria-colindex")).toBe("1"));

    grid
      .element()
      .dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "ArrowRight" }),
      );
    await vi.waitFor(() =>
      expect(activeCell()?.element().getAttribute("aria-colindex")).toBe("60"),
    );
    expect(activeCell()?.element().id).toContain(
      encodeExpectedDomIdSegment("COL_ID_ALL_PINNED_END_29"),
    );
    await vi.waitFor(() =>
      expect(grid.element().scrollLeft).toBe(7_200 - grid.element().clientWidth),
    );

    await screen.rerender(renderAtWidth(8_000));
    const restoredStart = screen.getByRole("columnheader", { name: "All pinned start 0" });
    const restoredEnd = screen.getByRole("columnheader", { name: "All pinned end 29" });
    await vi.waitFor(() =>
      expect(restoredStart.element().closest('[data-pinned-region="start"]')).not.toBeNull(),
    );
    expect(restoredEnd.element().closest('[data-pinned-region="end"]')).not.toBeNull();
    expect(restoredStart.element().getAttribute("aria-colindex")).toBe("1");
    expect(restoredEnd.element().getAttribute("aria-colindex")).toBe("60");
    const gridRight = grid.element().getBoundingClientRect().right;
    const endHeaderRegion = restoredEnd.element().closest('[data-pinned-region="end"]');
    expect(endHeaderRegion?.getBoundingClientRect().right).toBeCloseTo(gridRight, 0);
    expect(restoredEnd.element().getBoundingClientRect().right).toBeCloseTo(gridRight, 0);
    expect(restoredEnd.element().getBoundingClientRect().width).toBeCloseTo(120, 0);
    const endBodyCell = screen
      .getByRole("gridcell")
      .all()
      .find((cell) => cell.element().getAttribute("aria-colindex") === "60");
    const endBodyRegion = endBodyCell?.element().closest('[data-bruno-pinned-body-region="end"]');
    expect(endBodyRegion?.getBoundingClientRect().right).toBeCloseTo(gridRight, 0);
    expect(endBodyCell?.element().getBoundingClientRect().right).toBeCloseTo(gridRight, 0);
    expect(endBodyCell?.element().getBoundingClientRect().width).toBeCloseTo(120, 0);
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
      expect(action.element().closest("[inert]")).toBeNull();
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

  test("lets Shift+Tab leave an entered custom renderer through the preceding table control", async () => {
    const interactiveColumns = [
      {
        ...columns[0],
        cellRenderer: ({ row }: { readonly row: Row }) => (
          <button type="button">Open {row.name}</button>
        ),
      },
    ] as const;
    const screen = await render(
      <>
        <button type="button">Before table</button>
        <BrunoTableClient
          tableId="TABLE_ID_BACKWARD_TAB"
          getRowId={(row: Row) => row.id}
          columns={interactiveColumns}
          initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
          clientSource={readySource([rows[0]!])}
        />
        <button type="button">After table</button>
      </>,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_BACKWARD_TAB" });
    const action = screen.getByRole("button", { name: "Open Ada" });
    grid.element().focus();
    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "F2" }));
    await vi.waitFor(() => expect(document.activeElement).toBe(action.element()));

    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Sort rows, 1 active" }).element(),
      ),
    );
    expect(document.activeElement).not.toBe(grid.element());
  });

  test("lets Shift+Tab leave the document when the grid is the first tab stop", async () => {
    const interactiveColumns = [
      {
        ...columns[0],
        cellRenderer: ({ row }: { readonly row: Row }) => (
          <button type="button">Open {row.name}</button>
        ),
      },
    ] as const;
    const screen = await render(
      <>
        <BrunoTableClient
          tableId="TABLE_ID_FIRST_TAB_STOP"
          getRowId={(row: Row) => row.id}
          columns={interactiveColumns}
          initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
          clientSource={readySource([rows[0]!])}
        />
        <button type="button">After table</button>
      </>,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_FIRST_TAB_STOP" });
    const action = screen.getByRole("button", { name: "Open Ada" });
    grid.element().focus();
    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "F2" }));
    await vi.waitFor(() => expect(document.activeElement).toBe(action.element()));

    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await vi.waitFor(() => {
      expect(document.activeElement).not.toBe(action.element());
      expect(document.activeElement).not.toBe(grid.element());
    });
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

  test("preserves held-key intent across both virtual axes without rerendering the table root", async () => {
    const heldRows = Array.from({ length: 180 }, (_, index) => ({
      id: `held-row-${String(index).padStart(3, "0")}`,
      name: `Held row ${String(index).padStart(3, "0")}`,
      score: index,
    })) satisfies readonly Row[];
    const heldCenterColumnIndexes = [
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
      26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
    ] as const;
    const heldColumns = [
      {
        ...columns[0],
        columnId: "COL_ID_HELD_START",
        headerName: "Held start",
        pinned: "start" as const,
        width: 120,
      },
      ...heldCenterColumnIndexes.map((index) => ({
        ...columns[0],
        columnId: `COL_ID_HELD_CENTER_${index}` as const,
        headerName: `Held center ${index}`,
        width: 120,
      })),
      {
        ...columns[0],
        columnId: "COL_ID_HELD_END",
        headerName: "Held end",
        pinned: "end" as const,
        width: 120,
      },
    ] as const satisfies BrunoTableColumns<Row>;
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_HELD_NAVIGATION"
        getRowId={(row: Row) => row.id}
        columns={heldColumns}
        initialOrderBy={[{ columnId: "COL_ID_HELD_START", direction: "asc" }]}
        clientSource={readySource(heldRows)}
      />,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_HELD_NAVIGATION" });
    grid.element().focus();
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).not.toBeNull(),
    );

    let tableRootRenders = 0;
    let gridSurfaceRenders = 0;
    const restoreTableRootListener = installBrunoTableClientViewRenderListener(() => {
      tableRootRenders += 1;
    });
    const restoreGridSurfaceListener = installBrunoTableClientGridSurfaceRenderListener(() => {
      gridSurfaceRenders += 1;
    });
    try {
      for (let index = 0; index < 75; index += 1) {
        grid
          .element()
          .dispatchEvent(
            new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown", repeat: true }),
          );
      }
      for (let index = 0; index < heldColumns.length - 1; index += 1) {
        grid
          .element()
          .dispatchEvent(
            new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight", repeat: true }),
          );
      }

      await vi.waitFor(() => {
        const activeId = grid.element().getAttribute("aria-activedescendant");
        expect(activeId).not.toBeNull();
        const destinations = grid.element().querySelectorAll(`[id="${activeId ?? ""}"]`);
        expect(destinations).toHaveLength(1);
        const destination = destinations.item(0);
        expect(grid.element().querySelectorAll('[role="row"][aria-rowindex="77"]')).toHaveLength(1);
        expect(destination?.getAttribute("aria-colindex")).toBe(String(heldColumns.length));
        expect(destination?.textContent).toBe("Held row 075");
      });
      expect(document.activeElement).toBe(grid.element());
      expect(tableRootRenders).toBe(0);
      expect(gridSurfaceRenders).toBeLessThanOrEqual(2);
    } finally {
      restoreGridSurfaceListener();
      restoreTableRootListener();
    }
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

  test("keeps active descendants unique and interactive across separately hydrated roots", async () => {
    const hydrationColumns = [
      {
        ...columns[0],
        cellRenderer: ({ row }: { readonly row: Row }) => (
          <button type="button">Open {row.name}</button>
        ),
      },
    ] as const;
    const table = (
      <BrunoTableClient
        tableId="TABLE_ID_HYDRATED_SHARED"
        getRowId={(row: Row) => row.id}
        columns={hydrationColumns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={readySource([rows[0]!])}
      />
    );
    const markup = renderToString(table);
    const firstHost = document.createElement("div");
    const secondHost = document.createElement("div");
    firstHost.innerHTML = markup;
    secondHost.innerHTML = markup;
    document.body.append(firstHost, secondHost);
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const firstRecoverableErrors: unknown[] = [];
    const secondRecoverableErrors: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let firstRoot: Root | undefined;
    let secondRoot: Root | undefined;
    try {
      await act(async () => {
        firstRoot = hydrateRoot(firstHost, table, {
          onRecoverableError: (error) => firstRecoverableErrors.push(error),
        });
        secondRoot = hydrateRoot(secondHost, table, {
          onRecoverableError: (error) => secondRecoverableErrors.push(error),
        });
      });
      const grids = page.getByRole("grid", { name: "Data for TABLE_ID_HYDRATED_SHARED" }).all();
      await vi.waitFor(() => expect(grids).toHaveLength(2));
      grids[0]!.element().focus();
      grids[1]!.element().focus();
      await vi.waitFor(() => {
        expect(grids[0]!.element().getAttribute("aria-activedescendant")).not.toBeNull();
        expect(grids[1]!.element().getAttribute("aria-activedescendant")).not.toBeNull();
      });
      const firstId = grids[0]!.element().getAttribute("aria-activedescendant");
      const secondId = grids[1]!.element().getAttribute("aria-activedescendant");
      expect(firstId).not.toBe(secondId);

      const globalLookup = vi.spyOn(document, "getElementById").mockImplementation(() => {
        throw new Error("Interactive lookup must stay inside the owning grid.");
      });
      try {
        grids[1]!
          .element()
          .dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "F2" }));
      } finally {
        globalLookup.mockRestore();
      }
      const actions = page.getByRole("button", { name: "Open Ada" }).all();
      await vi.waitFor(() => expect(document.activeElement).toBe(actions[1]!.element()));
      expect(firstRecoverableErrors).toEqual([]);
      expect(secondRecoverableErrors).toEqual([]);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        firstRoot?.unmount();
        secondRoot?.unmount();
      });
      if (previousActEnvironment === undefined) {
        Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
      } else {
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
      }
      consoleError.mockRestore();
      firstHost.remove();
      secondHost.remove();
    }
  });

  test("keeps loading-cell ownership unique across separately hydrated roots", async () => {
    const hydrationColumns = [
      { ...columns[0], pinned: "start" as const },
      { ...columns[1], pinned: "end" as const },
    ] as const;
    const table = (
      <BrunoTableClient
        tableId="TABLE_ID_HYDRATED_LOADING"
        getRowId={(row: Row) => row.id}
        columns={hydrationColumns}
        initialOrderBy={[{ columnId: "COL_ID_SCORE", direction: "asc" }]}
        clientSource={{ rows: [], totalRows: 20, version: 1, status: "loading" }}
      />
    );
    const markup = renderToString(table);
    const firstHost = document.createElement("div");
    const secondHost = document.createElement("div");
    firstHost.innerHTML = markup;
    secondHost.innerHTML = markup;
    document.body.append(firstHost, secondHost);
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const recoverableErrors: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let firstRoot: Root | undefined;
    let secondRoot: Root | undefined;
    try {
      await act(async () => {
        firstRoot = hydrateRoot(firstHost, table, {
          onRecoverableError: (error) => recoverableErrors.push(error),
        });
        secondRoot = hydrateRoot(secondHost, table, {
          onRecoverableError: (error) => recoverableErrors.push(error),
        });
      });
      const gridLocator = page.getByRole("grid", { name: "Loading table rows" });
      await vi.waitFor(() => expect(gridLocator.all()).toHaveLength(2));
      const grids = gridLocator.all();
      const firstCell = grids[0]!
        .element()
        .querySelector<HTMLElement>('[role="gridcell"][aria-colindex="1"]');
      const secondCell = grids[1]!
        .element()
        .querySelector<HTMLElement>('[role="gridcell"][aria-colindex="1"]');
      if (firstCell === null || secondCell === null) {
        throw new Error("Both hydrated loading grids must mount their pinned start cell.");
      }
      expect(firstCell.id).not.toBe("");
      expect(secondCell.id).not.toBe("");
      expect(firstCell.id).not.toBe(secondCell.id);
      expect(firstCell.closest('[data-bruno-pinned-body-region="start"]')).not.toBeNull();
      expect(secondCell.closest('[data-bruno-pinned-body-region="start"]')).not.toBeNull();
      const ownershipSets = grids.map((grid) => {
        const gridElement = grid.element();
        const owner = gridElement.querySelector<HTMLElement>('[role="row"][aria-rowindex="1"]');
        const ownedIds = owner?.getAttribute("aria-owns")?.split(" ") ?? [];
        const firstRowCellIds = [...gridElement.querySelectorAll<HTMLElement>('[role="gridcell"]')]
          .filter((cell) => ownedIds.includes(cell.id))
          .toSorted(
            (left, right) =>
              Number(left.getAttribute("aria-colindex")) -
              Number(right.getAttribute("aria-colindex")),
          )
          .map((cell) => cell.id);
        expect(ownedIds).toEqual(firstRowCellIds);
        expect(ownedIds).toHaveLength(hydrationColumns.length);
        for (const ownedId of ownedIds) {
          expect(gridElement.querySelectorAll(`[id="${ownedId}"]`)).toHaveLength(1);
        }
        return ownedIds;
      });
      expect(ownershipSets[0]).not.toEqual(ownershipSets[1]);
      expect(ownershipSets[0]!.some((id) => ownershipSets[1]!.includes(id))).toBe(false);
      expect(recoverableErrors).toEqual([]);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        firstRoot?.unmount();
        secondRoot?.unmount();
      });
      if (previousActEnvironment === undefined) {
        Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
      } else {
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
      }
      consoleError.mockRestore();
      firstHost.remove();
      secondHost.remove();
    }
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

  test("indexes active-descendant proxies in pinned-region order", async () => {
    const interleavedColumns = [
      {
        ...columns[1],
        columnId: "COL_ID_INTERLEAVED_CENTER",
        headerName: "Centre score",
      },
      {
        ...columns[1],
        columnId: "COL_ID_INTERLEAVED_END",
        headerName: "End score",
        pinned: "end" as const,
      },
      {
        ...columns[0],
        columnId: "COL_ID_INTERLEAVED_START",
        headerName: "Start name",
        pinned: "start" as const,
      },
    ] as BrunoTableColumns<Row>;
    const largeRows = Array.from({ length: 100 }, (_, index) => ({
      id: `row-${index}`,
      name: `Row ${index}`,
      score: index,
    })) satisfies readonly Row[];
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_INTERLEAVED_PINNING"
        getRowId={(row: Row) => row.id}
        columns={interleavedColumns}
        initialOrderBy={[{ columnId: "COL_ID_INTERLEAVED_CENTER", direction: "asc" }]}
        clientSource={readySource(largeRows)}
      />,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_INTERLEAVED_PINNING" });
    grid.element().focus();

    await grid.wheel({ delta: { y: 1200 } });

    const proxyCell = screen.getByRole("gridcell", { name: "Row 0" });
    await expect.element(proxyCell).toHaveAttribute("data-bruno-active-proxy", "");
    await expect.element(proxyCell).toHaveAttribute("aria-colindex", "1");
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

  test("presents invalid values in a virtualized active-cell proxy without formatting them", async () => {
    type InvalidProxyRow = {
      readonly id: string;
      readonly name: string;
      readonly score: number;
    };
    const validRows = Array.from({ length: 100 }, (_, index) => ({
      id: `row-${String(index).padStart(3, "0")}`,
      name: `Row ${String(index).padStart(3, "0")}`,
      score: index,
    })) satisfies readonly InvalidProxyRow[];
    const invalidProxyColumns = [
      {
        columnId: "COL_ID_SCORE",
        field: "score",
        headerName: "Score",
        valueType: "number",
      },
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ] as const;
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_INVALID_PROXY"
        getRowId={(row: InvalidProxyRow) => row.id}
        columns={invalidProxyColumns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={{
          rows: validRows,
          totalRows: validRows.length,
          version: 1,
          status: "ready",
        }}
      />,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_INVALID_PROXY" });
    grid.element().focus();
    const activeId = grid.element().getAttribute("aria-activedescendant");

    await grid.wheel({ delta: { y: 1200 } });
    await vi.waitFor(() =>
      expect(
        screen
          .getByRole("gridcell", { name: "0" })
          .all()
          .some((cell) => cell.element().id === activeId),
      ).toBe(true),
    );

    const invalidRows = [
      { ...validRows[0]!, score: Number.NaN },
      ...validRows.slice(1),
    ] satisfies readonly InvalidProxyRow[];
    await screen.rerender(
      <BrunoTableClient
        tableId="TABLE_ID_INVALID_PROXY"
        getRowId={(row: InvalidProxyRow) => row.id}
        columns={invalidProxyColumns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={{
          rows: invalidRows,
          totalRows: invalidRows.length,
          version: 2,
          status: "ready",
        }}
      />,
    );

    const invalidProxy = screen.getByRole("gridcell", {
      name: "Source row 1, column COL_ID_SCORE: Expected a finite number value.",
    });
    await expect.element(invalidProxy).toBeInTheDocument();
    await expect.element(invalidProxy).toHaveAttribute("data-bruno-active-proxy", "");
    expect(invalidProxy.element().id).toBe(activeId);
    expect(document.activeElement).toBe(grid.element());
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
      .toHaveAttribute("aria-keyshortcuts", "Alt+Enter Alt+Shift+Enter");
    expect(
      screen
        .getByRole("button", { name: "Sort by Score, currently ascending, priority 1" })
        .element().tabIndex,
    ).toBe(-1);

    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" });
    grid.element().focus();
    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    const filterHeaderId = grid.element().getAttribute("aria-activedescendant");
    grid.element().dispatchEvent(
      new KeyboardEvent("keydown", {
        altKey: true,
        bubbles: true,
        key: "Enter",
        shiftKey: true,
      }),
    );
    await expect.element(screen.getByRole("gridcell", { name: "Grace" })).toBeInTheDocument();
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(filterHeaderId);
    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    grid.element().dispatchEvent(
      new KeyboardEvent("keydown", {
        altKey: true,
        bubbles: true,
        key: "Enter",
        shiftKey: true,
      }),
    );
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

  test("does not revisit resident source rows for a query-only command", async () => {
    const sourceIndexRead = vi.fn();
    const instrumentedRows = new Proxy(Array.from(rows), {
      get: (target, property, receiver) => {
        if (typeof property === "string" && /^\d+$/.test(property)) sourceIndexRead(property);
        return Reflect.get(target, property, receiver);
      },
    });
    const screen = await render(
      <BrunoTableClient {...props} clientSource={readySource(instrumentedRows)} />,
    );
    await expect
      .element(screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" }))
      .toBeInTheDocument();
    sourceIndexRead.mockClear();

    await screen.getByRole("button", { name: "Sort by Name" }).click();

    await expect
      .element(screen.getByRole("columnheader", { name: "Name" }))
      .toHaveAttribute("aria-sort", "ascending");
    expect(sourceIndexRead).not.toHaveBeenCalled();
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
    grid.element().dispatchEvent(
      new KeyboardEvent("keydown", {
        altKey: true,
        bubbles: true,
        key: "Enter",
        shiftKey: true,
      }),
    );

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

  test("reveals an offscreen reconciled boundary cell after a clamped command", async () => {
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
    await vi.waitFor(() => {
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(
        screen.getByRole("gridcell", { name: "Row 12", exact: true }).element().id,
      );
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const reorderedRows = largeRows.map((row) =>
      row.id === "row-12" ? { ...row, score: 1_000 } : row,
    );
    await screen.rerender(
      <BrunoTableClient {...props} clientSource={readySource(reorderedRows)} />,
    );
    const proxy = screen.getByRole("gridcell", { name: "Row 12", exact: true });
    await expect.element(proxy).toHaveAttribute("data-bruno-active-proxy");

    grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));

    await vi.waitFor(() => expect(grid.element().scrollTop).toBeGreaterThan(2_000));
    const destination = screen.getByRole("gridcell", { name: "Row 12", exact: true });
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(destination.element().id);
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

  test("publishes replacement columns with their sanitized query before row evaluation", async () => {
    const numberColumns = [
      {
        columnId: "COL_ID_VALUE",
        field: "score",
        headerName: "Value",
        valueType: "number",
      },
    ] as const;
    const textColumns = [
      {
        columnId: "COL_ID_VALUE",
        field: "name",
        headerName: "Value",
        valueType: "text",
      },
    ] as const;
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_QUERY_REPLACEMENT"
        getRowId={(row: Row) => row.id}
        columns={numberColumns}
        initialFilters={[{ columnId: "COL_ID_VALUE", type: "greaterThan", filter: 3 }]}
        initialOrderBy={[{ columnId: "COL_ID_VALUE", direction: "asc" }]}
        clientSource={readySource()}
      />,
    );
    await expect.element(screen.getByRole("gridcell", { name: "4" })).toBeInTheDocument();
    await expect.element(screen.getByRole("gridcell", { name: "2" })).not.toBeInTheDocument();

    await screen.rerender(
      <BrunoTableClient
        tableId="TABLE_ID_QUERY_REPLACEMENT"
        getRowId={(row: Row) => row.id}
        columns={textColumns}
        initialOrderBy={[{ columnId: "COL_ID_VALUE", direction: "asc" }]}
        clientSource={readySource()}
      />,
    );
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
    const cellRenderCounts = new Map<string, number>();
    const removeCellRenderListener = installBrunoTableClientCellRenderListener(
      (rowId, columnId) => {
        const cellId = `${rowId}:${columnId}`;
        cellRenderCounts.set(cellId, (cellRenderCounts.get(cellId) ?? 0) + 1);
      },
    );
    const renderCounts = new Map<string, number>();
    const instrumentedColumns = [
      {
        ...columns[0],
        cellRenderer: ({ row }: { readonly row: Row }) => {
          renderCounts.set(row.id, (renderCounts.get(row.id) ?? 0) + 1);
          return row.name;
        },
      },
      columns[1],
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
      const initialNameCellRenders = cellRenderCounts.get("grace:COL_ID_NAME") ?? 0;
      const initialScoreCellRenders = cellRenderCounts.get("grace:COL_ID_SCORE") ?? 0;
      expect(initialNameCellRenders).toBeGreaterThan(0);
      expect(initialScoreCellRenders).toBeGreaterThan(0);
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
      expect(cellRenderCounts.get("grace:COL_ID_SCORE")).toBe(initialScoreCellRenders);
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
      expect(cellRenderCounts.get("grace:COL_ID_SCORE")).toBe(initialScoreCellRenders);

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
      expect(cellRenderCounts.get("grace:COL_ID_NAME")).toBe(initialNameCellRenders + 1);
      expect(cellRenderCounts.get("grace:COL_ID_SCORE")).toBe(initialScoreCellRenders);

      await screen.rerender(
        <BrunoTableClient {...instrumentedProps} clientSource={readySource([rows[0]!])} />,
      );
      await expect.element(screen.getByRole("gridcell", { name: "Ada" })).toBeInTheDocument();
      await expect
        .element(screen.getByRole("gridcell", { name: "Grace Hopper" }))
        .not.toBeInTheDocument();
    } finally {
      removeCellRenderListener();
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

  test("plans row-order dependencies once per query across live publications", async () => {
    const rowOrderPlans = vi.fn();
    const removePlanningListener = installBrunoTableClientRowOrderPlanningListener(rowOrderPlans);
    try {
      const screen = await render(<BrunoTableClient {...props} clientSource={readySource()} />);
      await expect
        .element(screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" }))
        .toBeInTheDocument();
      expect(rowOrderPlans).toHaveBeenCalledOnce();
      expect(rowOrderPlans).toHaveBeenLastCalledWith("TABLE_ID_PEOPLE");

      for (let publication = 1; publication <= 3; publication += 1) {
        await screen.rerender(
          <BrunoTableClient
            {...props}
            clientSource={{
              ...readySource([rows[0]!, { ...rows[1]!, name: `Grace ${String(publication)}` }]),
              version: publication + 1,
            }}
          />,
        );
      }
      await expect.element(screen.getByRole("gridcell", { name: "Grace 3" })).toBeInTheDocument();
      expect(rowOrderPlans).toHaveBeenCalledOnce();

      await screen.getByRole("button", { name: "Sort by Name" }).click();
      await expect
        .element(screen.getByRole("columnheader", { name: "Name" }))
        .toHaveAttribute("aria-sort", "ascending");
      expect(rowOrderPlans).toHaveBeenCalledTimes(2);
      expect(rowOrderPlans).toHaveBeenLastCalledWith("TABLE_ID_PEOPLE");
    } finally {
      removePlanningListener();
    }
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

  test("reports committed row and cell probes in the browser development build", async () => {
    const rowRenders = vi.fn();
    const cellRenders = vi.fn();
    const removeRows = installBrunoTableClientRowRenderListenerForTable(props.tableId, rowRenders);
    const removeCells = installBrunoTableClientCellRenderListenerForTable(
      props.tableId,
      cellRenders,
    );
    try {
      const screen = await render(<BrunoTableClient {...props} clientSource={readySource()} />);

      await expect.element(screen.getByRole("gridcell", { name: "Grace" })).toBeInTheDocument();
      expect(rowRenders).toHaveBeenCalledWith("grace");
      expect(cellRenders).toHaveBeenCalledWith("grace", "COL_ID_NAME");
    } finally {
      removeCells();
      removeRows();
    }
  });

  test("reports position-only row commits and column-only cell commits", async () => {
    const rowRenders = vi.fn();
    const cellRenders = vi.fn();
    const removeRows = installBrunoTableClientRowRenderListenerForTable(props.tableId, rowRenders);
    const removeCells = installBrunoTableClientCellRenderListenerForTable(
      props.tableId,
      cellRenders,
    );
    try {
      const screen = await render(<BrunoTableClient {...props} clientSource={readySource()} />);
      await expect.element(screen.getByRole("gridcell", { name: "Grace" })).toBeInTheDocument();

      rowRenders.mockClear();
      cellRenders.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Sort by Name" }));
      await expect
        .element(screen.getByRole("columnheader", { name: "Name" }))
        .toHaveAttribute("aria-sort", "ascending");
      await vi.waitFor(() =>
        expect(rowRenders.mock.calls.map(([rowId]) => rowId)).toEqual(
          expect.arrayContaining(["ada", "grace"]),
        ),
      );

      cellRenders.mockClear();
      const resize = screen.getByRole("separator", { name: "Resize Name" });
      resize.element().focus();
      await userEvent.keyboard("{ArrowRight}");
      await expect.element(resize).toHaveAttribute("aria-valuenow", "170");
      await vi.waitFor(() =>
        expect(cellRenders.mock.calls).toEqual(
          expect.arrayContaining([
            ["ada", "COL_ID_NAME"],
            ["grace", "COL_ID_NAME"],
          ]),
        ),
      );
    } finally {
      removeCells();
      removeRows();
    }
  });

  test("reports row and cell renders only after a suspended tree commits", async () => {
    let releaseSuspension!: () => void;
    let suspended = true;
    const suspension = new Promise<void>((resolve) => {
      releaseSuspension = resolve;
    });
    function SuspendAfterTable() {
      if (suspended) throw suspension;
      return null;
    }

    const rowRenders = vi.fn();
    const cellRenders = vi.fn();
    const removeRows = installBrunoTableClientRowRenderListenerForTable(props.tableId, rowRenders);
    const removeCells = installBrunoTableClientCellRenderListenerForTable(
      props.tableId,
      cellRenders,
    );
    try {
      const screen = await render(
        <Suspense fallback={<div role="status">Waiting to commit</div>}>
          <BrunoTableClient {...props} clientSource={readySource()} />
          <SuspendAfterTable />
        </Suspense>,
      );
      await expect.element(screen.getByRole("status")).toBeInTheDocument();
      expect(rowRenders).not.toHaveBeenCalled();
      expect(cellRenders).not.toHaveBeenCalled();

      suspended = false;
      releaseSuspension();
      await expect
        .element(screen.getByRole("grid", { name: "Data for TABLE_ID_PEOPLE" }))
        .toBeInTheDocument();
      expect(rowRenders).toHaveBeenCalled();
      expect(cellRenders).toHaveBeenCalled();
    } finally {
      removeCells();
      removeRows();
    }
  });
});
