import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { StrictMode } from "react";
import { Effect, Schema } from "effect";
import { ViewServerId, defineViewServerConfig } from "effect-view-server/config";
import { createViewServerReact } from "effect-view-server/react";
import { createInMemoryViewServerReact } from "effect-view-server/react/testing";
import { detectPlatform } from "@tanstack/react-hotkeys";

import {
  BrunoTableActiveFilterCount,
  BrunoTableActiveSortCount,
  BrunoTableLoadedRowCount,
  BrunoTableComputedColumn,
  BrunoTableQuickFilter,
  BrunoTableResultRowCount,
  BrunoTableServer,
  BrunoTableToolbar,
} from "./index";
import type { BrunoTableColumns, BrunoTableQuickFilterFields } from "./index";
import { settleBrunoTableBrowserFrames } from "./internal/browser-test-helpers";
import { createBrunoTableInvalidCellValue } from "./internal/grid-runtime";
import {
  installBrunoTableClientCellRenderListenerForTable,
  installBrunoTableClientGridSurfaceRenderListenerForTable,
  installBrunoTableClientRowRenderListenerForTable,
  installBrunoTableClientViewRenderListenerForTable,
} from "./internal/render-instrumentation";
import { installBrunoTableToolbarSubscriptionListener } from "./internal/toolbar-instrumentation";

type Row = Readonly<{
  readonly id: string;
  readonly symbol: string;
  readonly price: number;
  readonly desk: string;
}>;
type QuickRow = Row;
type ProjectionRow = Row;

const columns = [
  {
    columnId: "COL_ID_SYMBOL",
    field: "symbol",
    headerName: "Symbol",
    valueType: "text",
    pinned: "start",
  },
  {
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Price",
    valueType: "number",
    pinned: "end",
  },
] as const satisfies BrunoTableColumns<Row>;
const rawRowPresentationColumns = [
  {
    ...columns[0],
    valueFormatter: ({ row, value }: { readonly row: Row; readonly value: string }) =>
      `${value} (${row.desk})`,
    cellClassName: ({ row }: { readonly row: Row }) => `source-${row.id}`,
  },
  {
    ...columns[1],
    cellRenderer: ({ row, value }: { readonly row: Row; readonly value: number }) =>
      `${String(value)} · ${row.id} · ${row.desk}`,
  },
] as const satisfies BrunoTableColumns<Row>;
const remappedColumns = [
  columns[0],
  {
    columnId: "COL_ID_PRICE",
    field: "symbol",
    headerName: "Symbol mirror",
    valueType: "text",
    pinned: "end",
  },
] as const satisfies BrunoTableColumns<Row>;
const serverFilterColumns = [
  {
    ...columns[0],
    enableFilter: true,
    enableSetFilter: true,
  },
  columns[1],
] as const satisfies BrunoTableColumns<Row>;

const wideCenterIndexes = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
] as const;
const wideServerColumns = [
  { ...columns[0], columnId: "COL_ID_START", headerName: "Pinned start", width: 120 },
  ...wideCenterIndexes.map((index) => ({
    columnId: `COL_ID_CENTER_${index}` as const,
    field: "symbol" as const,
    headerName: `Center ${String(index).padStart(2, "0")}`,
    valueType: "text" as const,
    width: 160,
  })),
  { ...columns[1], columnId: "COL_ID_END", headerName: "Pinned end", width: 120 },
] as const satisfies BrunoTableColumns<Row>;

const actualViewportConfig = defineViewServerConfig({
  topics: {
    orders: {
      schema: Schema.Struct({
        id: ViewServerId,
        symbol: Schema.String,
        price: Schema.Number,
        desk: Schema.String,
      }),
    },
  },
});
const actualViewportReact = createViewServerReact(actualViewportConfig);
type ActualViewportSource = ReturnType<typeof actualViewportReact.useLiveQueryViewport>;
const browserCompleteRawSelect = Object.freeze([
  "id",
  "symbol",
  "price",
  "desk",
]) as unknown as ActualViewportSource["completeRawSelect"];
type BrowserViewport = Omit<
  ReturnType<typeof actualViewportReact.useLiveQueryViewport>["viewport"],
  "destroy" | "replace"
> &
  Readonly<{
    readonly replace: (
      request: Readonly<{ readonly query: unknown; readonly sink: Sink }>,
    ) => Readonly<{
      readonly setWindow: (window: Readonly<{ firstRow: number; lastRow: number }>) => void;
      readonly release: () => void;
    }>;
  }>;

type Sink<TRow = Row> = Readonly<{
  readonly setRowCount: (count: number, keepRenderedRows?: boolean) => void;
  readonly setRowData: (
    rows: Readonly<Record<number, Partial<TRow>>>,
    keys: Readonly<Record<number, string>>,
  ) => void;
}>;

function makeViewport(totalRows = 100, publishCount = true) {
  const requests: Array<Readonly<{ readonly query: unknown; readonly sink: Sink }>> = [];
  const windows: Array<Readonly<{ readonly firstRow: number; readonly lastRow: number }>> = [];
  const releases = vi.fn();
  const viewport: BrowserViewport = {
    replace(request: Readonly<{ readonly query: unknown; readonly sink: Sink }>) {
      requests.push(request);
      if (publishCount) request.sink.setRowCount(totalRows, true);
      return {
        setWindow(window: Readonly<{ readonly firstRow: number; readonly lastRow: number }>) {
          windows.push(window);
        },
        release: releases,
      };
    },
  };
  return {
    viewport,
    requests,
    windows,
    releases,
  };
}

function serverProps(
  viewport: BrowserViewport,
  status: "loading" | "ready" | "stale" | "closed" | "error" = "loading",
  tableId = "TABLE_ID_SERVER",
) {
  return {
    tableId,
    columns,
    initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" as const }] as const,
    viewportSource: {
      viewport,
      completeRawSelect: browserCompleteRawSelect,
      totalRows: 100,
      version: 1,
      status,
    },
  } as const;
}

afterEach(async () => cleanup());

describe("BrunoTableServer", () => {
  test("keeps Server condition editing without synthesizing Set Filter facet choices", async () => {
    const transport = makeViewport();
    const screen = await render(
      <BrunoTableServer
        tableId="TABLE_ID_SERVER_FILTERS"
        columns={serverFilterColumns}
        initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
        viewportSource={{
          viewport: transport.viewport,
          completeRawSelect: browserCompleteRawSelect,
          totalRows: 100,
          version: 1,
          status: "ready",
        }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Filter Symbol" }));
    const dialog = screen.getByRole("dialog", { name: "Filter Symbol" });
    await expect
      .element(dialog.getByRole("combobox", { name: "Filter operator for Symbol" }))
      .toBeVisible();
    expect(dialog.getByRole("searchbox", { name: "Search values for Symbol" }).query()).toBeNull();
    expect(dialog.getByRole("button", { name: "Select All" }).query()).toBeNull();
    expect(dialog.getByRole("button", { name: "Clear All" }).query()).toBeNull();
  });

  test("keeps fixed-height loading geometry when activation publishes a non-authoritative zero hint", async () => {
    const transport = makeViewport(100, false);
    const screen = await render(<BrunoTableServer {...serverProps(transport.viewport)} />);
    transport.requests[0]?.sink.setRowCount(0, false);

    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SERVER" });
    await expect.element(grid).toHaveAttribute("aria-rowcount", "19");
    await expect.element(grid).toHaveAttribute("aria-busy", "true");
    const bodyRows = grid.element().querySelectorAll<HTMLElement>('[role="row"][aria-rowindex]');
    expect(bodyRows.length).toBeGreaterThan(1);
    expect([...bodyRows].some((row) => row.style.height === "36px")).toBe(true);

    transport.requests[0]?.sink.setRowCount(0, true);
    await expect.element(grid).toHaveAttribute("aria-rowcount", "19");
    await expect.element(grid).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("region", { name: "No rows" }).query()).toBeNull();
    const authoritativeZeroRows = grid
      .element()
      .querySelectorAll<HTMLElement>('[role="row"][aria-rowindex]');
    expect(authoritativeZeroRows.length).toBeGreaterThan(1);
    expect([...authoritativeZeroRows].some((row) => row.style.height === "36px")).toBe(true);
    await screen.rerender(<BrunoTableServer {...serverProps(transport.viewport, "ready")} />);
    await expect.element(screen.getByRole("region", { name: "No rows" })).toBeInTheDocument();
  });

  test("keeps loading slots connected to sparse window movement and preserves logical scroll", async () => {
    const transport = makeViewport(1_000);
    const source = {
      ...serverProps(transport.viewport).viewportSource,
      totalRows: 1_000,
    };
    const screen = await render(
      <BrunoTableServer {...serverProps(transport.viewport)} viewportSource={source} />,
    );
    const grid = screen.getByRole("grid");
    await expect.element(grid).toHaveAttribute("aria-rowcount", "1001");
    await expect.element(grid).toHaveAttribute("aria-busy", "true");

    const windowCountBeforeScroll = transport.windows.length;
    grid.element().scrollTop = 50 * 36;
    grid.element().dispatchEvent(new Event("scroll"));
    await settleBrunoTableBrowserFrames();
    expect(transport.windows).toHaveLength(windowCountBeforeScroll + 1);
    expect(transport.windows.at(-1)?.firstRow).toBeLessThanOrEqual(50);
    expect(transport.windows.at(-1)?.lastRow).toBeGreaterThanOrEqual(50);
    const loadingScrollTop = grid.element().scrollTop;

    await screen.rerender(
      <BrunoTableServer
        {...serverProps(transport.viewport, "ready")}
        viewportSource={{ ...source, status: "ready", version: 2 }}
      />,
    );
    await settleBrunoTableBrowserFrames();
    expect(screen.getByRole("grid").element()).toBe(grid.element());
    expect(grid.element().scrollTop).toBe(loadingScrollTop);
    expect(transport.requests).toHaveLength(1);
  });

  test("copies only a loaded Server Active Cell through canonical value semantics", async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    try {
      const transport = makeViewport();
      const invalidPrice = createBrunoTableInvalidCellValue({
        kind: "invalid-value",
        rowIndex: 1,
        columnId: "COL_ID_PRICE",
        message: "Expected a finite number.",
      });
      const screen = await render(
        <BrunoTableServer
          {...serverProps(transport.viewport, "ready")}
          columns={rawRowPresentationColumns}
        />,
      );
      transport.requests[0]?.sink.setRowData(
        {
          0: { id: "actual-1", symbol: "AAPL", price: 240, desk: "LDN" },
          1: { id: "invalid-1", symbol: "INVALID", price: invalidPrice as never, desk: "NYC" },
        },
        { 0: "row-aapl", 1: "row-invalid" },
      );
      const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SERVER" });
      grid.element().focus();
      await vi.waitFor(() =>
        expect(grid.element().getAttribute("aria-activedescendant")).toBe(
          screen.getByRole("gridcell", { name: "AAPL (LDN)" }).element().id,
        ),
      );
      const copyLoaded = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "c",
        [detectPlatform() === "mac" ? "metaKey" : "ctrlKey"]: true,
      });
      grid.element().dispatchEvent(copyLoaded);
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("AAPL"));
      expect(copyLoaded.defaultPrevented).toBe(true);

      grid
        .element()
        .dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown" }),
        );
      grid
        .element()
        .dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowRight" }),
        );
      const copyInvalid = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "c",
        [detectPlatform() === "mac" ? "metaKey" : "ctrlKey"]: true,
      });
      grid.element().dispatchEvent(copyInvalid);
      await settleBrunoTableBrowserFrames();
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(copyInvalid.defaultPrevented).toBe(false);

      grid
        .element()
        .dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown" }),
        );
      const copyLoading = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "c",
        [detectPlatform() === "mac" ? "metaKey" : "ctrlKey"]: true,
      });
      grid.element().dispatchEvent(copyLoading);
      await settleBrunoTableBrowserFrames();
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(copyLoading.defaultPrevented).toBe(false);
    } finally {
      if (clipboardDescriptor === undefined)
        delete (navigator as { clipboard?: Clipboard }).clipboard;
      else Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    }
  });

  test("renders fixed-height sparse slots and writes authoritative rows into absolute indexes", async () => {
    const transport = makeViewport();
    const screen = await render(<BrunoTableServer {...serverProps(transport.viewport, "ready")} />);

    await expect
      .element(screen.getByRole("grid", { name: "Data for TABLE_ID_SERVER" }))
      .toHaveAttribute("aria-rowcount", "101");
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.query).toEqual({
      select: ["symbol", "price"],
      where: [],
      orderBy: [{ field: "symbol", direction: "asc" }],
    });

    transport.requests[0]?.sink.setRowData(
      { 12: { symbol: "AAPL", price: 240 } },
      { 12: "server-row-aapl" },
    );
    await screen.rerender(<BrunoTableServer {...serverProps(transport.viewport, "ready")} />);
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SERVER" });
    grid.element().scrollTop = 12 * 36;
    grid.element().dispatchEvent(new Event("scroll"));
    await expect.element(screen.getByRole("gridcell", { name: "AAPL" })).toBeInTheDocument();
    const aapl = screen.getByRole("gridcell", { name: "AAPL" }).element();
    const owningRow = [...grid.element().querySelectorAll<HTMLElement>('[role="row"]')].find(
      (row) => row.getAttribute("aria-owns")?.split(" ").includes(aapl.id),
    );
    expect(owningRow?.getAttribute("aria-rowindex")).toBe("14");
  });

  test("updates same-key sparse cells without rerendering Server viewport structure", async () => {
    const transport = makeViewport();
    const viewRenders = vi.fn();
    const gridRenders = vi.fn();
    const rowRenders = vi.fn();
    const cellRenders = vi.fn();
    const restoreView = installBrunoTableClientViewRenderListenerForTable(
      "TABLE_ID_SERVER",
      viewRenders,
    );
    const restoreGrid = installBrunoTableClientGridSurfaceRenderListenerForTable(
      "TABLE_ID_SERVER",
      gridRenders,
    );
    const restoreRows = installBrunoTableClientRowRenderListenerForTable(
      "TABLE_ID_SERVER",
      rowRenders,
    );
    const restoreCells = installBrunoTableClientCellRenderListenerForTable(
      "TABLE_ID_SERVER",
      cellRenders,
    );
    try {
      const screen = await render(
        <BrunoTableServer {...serverProps(transport.viewport, "ready")} />,
      );
      transport.requests[0]?.sink.setRowData({ 0: { symbol: "AAPL", price: 240 } }, { 0: "row-a" });
      await expect.element(screen.getByRole("gridcell", { name: "AAPL" })).toBeInTheDocument();
      await settleBrunoTableBrowserFrames();
      viewRenders.mockClear();
      gridRenders.mockClear();
      rowRenders.mockClear();
      cellRenders.mockClear();

      transport.requests[0]?.sink.setRowData(
        { 0: { symbol: "APPLE", price: 241 } },
        { 0: "row-a" },
      );

      await expect.element(screen.getByRole("gridcell", { name: "APPLE" })).toBeInTheDocument();
      await expect.element(screen.getByRole("gridcell", { name: "241" })).toBeInTheDocument();
      expect(viewRenders).not.toHaveBeenCalled();
      expect(gridRenders).not.toHaveBeenCalled();
      expect(rowRenders).not.toHaveBeenCalled();
      expect(cellRenders.mock.calls).toEqual(
        expect.arrayContaining([
          ["row-a", "COL_ID_SYMBOL"],
          ["row-a", "COL_ID_PRICE"],
        ]),
      );
    } finally {
      restoreCells();
      restoreRows();
      restoreGrid();
      restoreView();
    }
  });

  test("clears conflicting Server identity without treating sparse eviction as deletion", async () => {
    const transport = makeViewport(1_000);
    const screen = await render(<BrunoTableServer {...serverProps(transport.viewport, "ready")} />);
    transport.requests[0]?.sink.setRowData(
      {
        0: { symbol: "FIRST", price: 1 },
        1: { symbol: "SECOND", price: 2 },
      },
      { 0: "first", 1: "second" },
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SERVER" });
    grid.element().focus();
    grid
      .element()
      .dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown" }),
      );
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(
        screen.getByRole("gridcell", { name: "SECOND" }).element().id,
      ),
    );

    transport.requests[0]?.sink.setRowData(
      { 1: { symbol: "REPLACEMENT", price: 3 } },
      { 1: "replacement" },
    );
    await expect.element(screen.getByRole("gridcell", { name: "REPLACEMENT" })).toBeInTheDocument();
    await vi.waitFor(() => expect(grid.element().getAttribute("aria-activedescendant")).toBeNull());

    grid.element().blur();
    grid.element().focus();
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(
        screen.getByRole("gridcell", { name: "FIRST" }).element().id,
      ),
    );
    grid.element().scrollTop = 100 * 36;
    grid.element().dispatchEvent(new Event("scroll"));
    await settleBrunoTableBrowserFrames();
    grid.element().scrollTop = 0;
    grid.element().dispatchEvent(new Event("scroll"));
    await settleBrunoTableBrowserFrames();
    transport.requests[0]?.sink.setRowData({ 0: { symbol: "FIRST", price: 1 } }, { 0: "first" });
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(
        screen.getByRole("gridcell", { name: "FIRST" }).element().id,
      ),
    );
  });

  test("retains an evicted Server identity through horizontal movement and later arrival", async () => {
    const transport = makeViewport(1_000);
    const screen = await render(<BrunoTableServer {...serverProps(transport.viewport, "ready")} />);
    transport.requests[0]?.sink.setRowData(
      {
        0: { symbol: "FIRST", price: 1 },
        1: { symbol: "SECOND", price: 2 },
      },
      { 0: "first", 1: "second" },
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SERVER" });
    grid.element().focus();
    grid
      .element()
      .dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown" }),
      );
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(
        screen.getByRole("gridcell", { name: "SECOND" }).element().id,
      ),
    );

    grid.element().scrollTop = 100 * 36;
    grid.element().dispatchEvent(new Event("scroll"));
    await settleBrunoTableBrowserFrames();
    await vi.waitFor(() => {
      const activeId = grid.element().getAttribute("aria-activedescendant");
      expect(activeId).toContain("bruno-table-loading-cell-");
      const activeProxy = grid.element().ownerDocument.getElementById(activeId ?? "missing");
      expect(activeProxy).not.toBeNull();
      expect(activeProxy).toHaveAttribute("data-bruno-active-proxy", "");
    });
    grid
      .element()
      .dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowRight" }),
      );
    await settleBrunoTableBrowserFrames();
    expect(transport.windows.at(-1)?.firstRow).toBeLessThanOrEqual(1);
    await vi.waitFor(() => {
      const activeId = grid.element().getAttribute("aria-activedescendant");
      expect(activeId).toContain("bruno-table-loading-cell-");
      expect(grid.element().ownerDocument.getElementById(activeId ?? "missing")).not.toBeNull();
    });

    transport.requests[0]?.sink.setRowData(
      {
        1: { symbol: "REPLACEMENT", price: 3 },
        2: { symbol: "SECOND", price: 2 },
      },
      { 1: "replacement", 2: "second" },
    );
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(
        screen.getByRole("gridcell", { name: "2" }).element().id,
      ),
    );
  });

  test("keeps an offscreen Active Descendant proxy narrow and value-free while loading", async () => {
    const transport = makeViewport(1_000);
    const renderServer = (status: "ready" | "loading") => (
      <BrunoTableServer
        tableId="TABLE_ID_SERVER_PROXY_LOADING"
        columns={wideServerColumns}
        initialOrderBy={[{ columnId: "COL_ID_START", direction: "asc" }]}
        viewportSource={{
          viewport: transport.viewport,
          completeRawSelect: browserCompleteRawSelect,
          totalRows: 1_000,
          version: 1,
          status,
        }}
      />
    );
    const screen = await render(renderServer("ready"));
    transport.requests[0]?.sink.setRowData(
      { 0: { id: "first", symbol: "RETAINED", price: 1, desk: "LDN" } },
      { 0: "first" },
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SERVER_PROXY_LOADING" });
    grid.element().focus();
    grid
      .element()
      .dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowRight" }),
      );
    await settleBrunoTableBrowserFrames();
    grid.element().scrollLeft = 2_000;
    grid.element().dispatchEvent(new Event("scroll"));
    await settleBrunoTableBrowserFrames();
    let readyProxy: HTMLElement | null = null;
    await vi.waitFor(() => {
      const activeId = grid.element().getAttribute("aria-activedescendant");
      readyProxy = grid.element().ownerDocument.getElementById(activeId ?? "missing");
      expect(readyProxy).not.toBeNull();
      expect(readyProxy).toHaveAttribute("data-bruno-active-proxy", "");
      expect(readyProxy).toHaveTextContent("RETAINED");
    });

    transport.requests[0]?.sink.setRowData(
      { 1: { id: "second", symbol: "UNRELATED", price: 2, desk: "NYC" } },
      { 1: "second" },
    );
    await settleBrunoTableBrowserFrames();
    expect(
      grid
        .element()
        .ownerDocument.getElementById(
          grid.element().getAttribute("aria-activedescendant") ?? "missing",
        ),
    ).toBe(readyProxy);

    await screen.rerender(renderServer("loading"));
    await vi.waitFor(() => {
      const activeId = grid.element().getAttribute("aria-activedescendant");
      expect(activeId).toContain("bruno-table-loading-cell-");
      const loadingProxy = grid.element().ownerDocument.getElementById(activeId ?? "missing");
      expect(loadingProxy).not.toBeNull();
      expect(loadingProxy).toHaveAttribute("data-bruno-active-proxy", "");
      expect(loadingProxy).toHaveTextContent("Loading row");
      expect(loadingProxy).not.toHaveTextContent("RETAINED");
    });
  });

  test("reconciles changed Server Quick Filter fields without a remount", async () => {
    const transport = makeViewport();
    const renderServer = (
      quickFilterFields: BrunoTableQuickFilterFields<QuickRow> | undefined,
      showQuickFilter: boolean,
    ) => (
      <BrunoTableServer
        {...serverProps(transport.viewport, "ready")}
        {...(quickFilterFields === undefined ? {} : { quickFilterFields })}
      >
        {showQuickFilter ? (
          <BrunoTableToolbar>
            <BrunoTableQuickFilter />
            <BrunoTableActiveFilterCount />
          </BrunoTableToolbar>
        ) : null}
      </BrunoTableServer>
    );
    const screen = await render(renderServer(undefined, false));
    expect(transport.requests).toHaveLength(1);

    await screen.rerender(renderServer(["desk"], true));
    await vi.waitFor(() => expect(transport.requests).toHaveLength(2));
    await expect.element(screen.getByRole("searchbox", { name: "Quick Filter" })).toBeVisible();
    await userEvent.fill(screen.getByRole("searchbox", { name: "Quick Filter" }), "desk");
    await vi.waitFor(() => expect(transport.requests).toHaveLength(3));
    await expect
      .element(screen.getByRole("status", { name: "Active filters" }))
      .toHaveTextContent("1 active filter");
    expect(transport.requests.at(-1)?.query).toMatchObject({
      select: ["symbol", "price", "desk"],
      where: [
        {
          type: "OR",
          conditions: [{ field: "desk", type: "contains", filter: "desk" }],
        },
      ],
    });

    await screen.rerender(renderServer(["symbol", "desk"], true));
    await vi.waitFor(() => expect(transport.requests).toHaveLength(4));
    expect(transport.requests.at(-1)?.query).toMatchObject({
      select: ["symbol", "price", "desk"],
      where: [
        {
          type: "OR",
          conditions: [
            { field: "desk", type: "contains", filter: "desk" },
            { field: "symbol", type: "contains", filter: "desk" },
          ],
        },
      ],
    });

    await screen.rerender(renderServer(undefined, false));
    await vi.waitFor(() => expect(transport.requests).toHaveLength(5));
    expect(screen.getByRole("searchbox", { name: "Quick Filter" }).query()).toBeNull();
    expect(transport.requests.at(-1)?.query).toEqual({
      select: ["symbol", "price"],
      where: [],
      orderBy: [{ field: "symbol", direction: "asc" }],
    });

    await screen.rerender(renderServer(undefined, false));
    await settleBrunoTableBrowserFrames();
    expect(transport.requests).toHaveLength(5);

    await screen.rerender(renderServer(["desk"], true));
    await vi.waitFor(() => expect(transport.requests).toHaveLength(6));
    await expect.element(screen.getByRole("searchbox", { name: "Quick Filter" })).toHaveValue("");
    await expect
      .element(screen.getByRole("status", { name: "Active filters" }))
      .toHaveTextContent("0 active filters");
    expect(transport.requests.at(-1)?.query).toEqual({
      select: ["symbol", "price", "desk"],
      where: [],
      orderBy: [{ field: "symbol", direction: "asc" }],
    });
  });

  test("replaces semantic generations, releases old controllers, and rejects late writes", async () => {
    const first = makeViewport(25);
    const second = makeViewport(30);
    const screen = await render(<BrunoTableServer {...serverProps(first.viewport, "ready")} />);
    first.requests[0]?.sink.setRowData({ 0: { symbol: "OLD", price: 1 } }, { 0: "old" });
    await expect.element(screen.getByRole("gridcell", { name: "OLD" })).toBeInTheDocument();

    await screen.rerender(<BrunoTableServer {...serverProps(second.viewport, "ready")} />);
    expect(first.releases).toHaveBeenCalledTimes(1);
    expect(second.requests).toHaveLength(1);
    await expect
      .element(screen.getByRole("grid", { name: "Data for TABLE_ID_SERVER" }))
      .toHaveAttribute("aria-rowcount", "31");
    expect(screen.getByRole("gridcell", { name: "OLD" }).query()).toBeNull();
    first.requests[0]?.sink.setRowData({ 0: { symbol: "LATE", price: 2 } }, { 0: "late" });
    second.requests[0]?.sink.setRowData({ 0: { symbol: "NEW", price: 3 } }, { 0: "new" });
    await expect.element(screen.getByRole("gridcell", { name: "NEW" })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "LATE" }).query()).toBeNull();
  });

  test("resets Active Cell instead of reconciling its display index across sources", async () => {
    const first = makeViewport(2);
    const second = makeViewport(2);
    const screen = await render(<BrunoTableServer {...serverProps(first.viewport, "ready")} />);
    first.requests[0]?.sink.setRowData(
      { 0: { symbol: "OLD ZERO", price: 0 }, 1: { symbol: "OLD ONE", price: 1 } },
      { 0: "old-zero", 1: "old-one" },
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SERVER" });
    grid.element().focus();
    grid
      .element()
      .dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown" }),
      );
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(
        screen.getByRole("gridcell", { name: "OLD ONE" }).element().id,
      ),
    );

    await screen.rerender(<BrunoTableServer {...serverProps(second.viewport, "ready")} />);
    second.requests[0]?.sink.setRowData(
      { 0: { symbol: "NEW ZERO", price: 2 }, 1: { symbol: "NEW ONE", price: 3 } },
      { 0: "new-zero", 1: "new-one" },
    );

    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(
        screen.getByRole("gridcell", { name: "NEW ZERO" }).element().id,
      ),
    );
  });

  test("resets Active Cell when source-owned complete projection changes on one viewport", async () => {
    const transport = makeViewport(2);
    const source = {
      viewport: transport.viewport,
      completeRawSelect: browserCompleteRawSelect,
      totalRows: 2,
      version: 1,
      status: "ready" as const,
    };
    const screen = await render(
      <BrunoTableServer
        tableId="TABLE_ID_SERVER_SOURCE_PROJECTION"
        columns={rawRowPresentationColumns}
        initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
        viewportSource={source}
      />,
    );
    transport.requests[0]?.sink.setRowData(
      {
        0: { id: "old-zero", symbol: "OLD ZERO", price: 0, desk: "LDN" },
        1: { id: "old-one", symbol: "OLD ONE", price: 1, desk: "LDN" },
      },
      { 0: "old-zero", 1: "old-one" },
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SERVER_SOURCE_PROJECTION" });
    grid.element().focus();
    grid
      .element()
      .dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown" }),
      );
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(
        screen.getByRole("gridcell", { name: "OLD ONE (LDN)" }).element().id,
      ),
    );

    const extendedCompleteRawSelect = Object.freeze([
      "id",
      "symbol",
      "price",
      "desk",
      "region",
    ]) as unknown as ActualViewportSource["completeRawSelect"];
    await screen.rerender(
      <BrunoTableServer
        tableId="TABLE_ID_SERVER_SOURCE_PROJECTION"
        columns={rawRowPresentationColumns}
        initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
        viewportSource={{ ...source, completeRawSelect: extendedCompleteRawSelect, version: 2 }}
      />,
    );
    expect(transport.requests).toHaveLength(2);
    transport.requests[1]?.sink.setRowData(
      {
        0: { id: "new-zero", symbol: "NEW ZERO", price: 2, desk: "NYC" },
        1: { id: "new-one", symbol: "NEW ONE", price: 3, desk: "NYC" },
      },
      { 0: "new-zero", 1: "new-one" },
    );
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(
        screen.getByRole("gridcell", { name: "NEW ZERO (NYC)" }).element().id,
      ),
    );
  });

  test("uses one replacement for a semantic sort and resets vertical position", async () => {
    const transport = makeViewport(1_000);
    const screen = await render(
      <BrunoTableServer {...serverProps(transport.viewport, "ready")}>
        <BrunoTableToolbar>
          <BrunoTableResultRowCount />
          <BrunoTableLoadedRowCount />
          <BrunoTableActiveFilterCount />
          <BrunoTableActiveSortCount />
        </BrunoTableToolbar>
      </BrunoTableServer>,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SERVER" });
    grid.element().scrollTop = 360;
    grid.element().dispatchEvent(new Event("scroll"));
    await userEvent.click(
      screen.getByRole("button", {
        name: "Sort by Symbol, currently ascending, priority 1",
      }),
    );
    await vi.waitFor(() => expect(transport.requests).toHaveLength(2));
    expect(transport.requests[1]?.query).toEqual({
      select: ["symbol", "price"],
      where: [],
      orderBy: [{ field: "symbol", direction: "desc" }],
    });
    expect(transport.releases).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(grid.element().scrollTop).toBe(0));
  });

  test("replaces exactly once when Column field mapping changes the projection", async () => {
    const transport = makeViewport(1_000);
    const screen = await render(<BrunoTableServer {...serverProps(transport.viewport, "ready")} />);
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SERVER" });
    grid.element().scrollTop = 360;
    grid.element().dispatchEvent(new Event("scroll"));

    await screen.rerender(
      <BrunoTableServer
        tableId="TABLE_ID_SERVER"
        columns={remappedColumns}
        initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
        viewportSource={{
          viewport: transport.viewport,
          completeRawSelect: browserCompleteRawSelect,
          totalRows: 1_000,
          version: 1,
          status: "ready",
        }}
      />,
    );
    await vi.waitFor(() => expect(transport.requests).toHaveLength(2));
    expect(transport.requests[1]?.query).toEqual({
      select: ["symbol"],
      where: [],
      orderBy: [{ field: "symbol", direction: "asc" }],
    });
    expect(transport.releases).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(grid.element().scrollTop).toBe(0));
  });

  test("invalidates old payloads before installing a new computed projection", async () => {
    const transport = makeViewport();
    const projectionGetter = vi.fn(({ row }: { readonly row: Pick<ProjectionRow, "desk"> }) => {
      if (row.desk === undefined) throw new TypeError("desk was not projected");
      return row.desk.toUpperCase();
    });
    const initialColumns = columns satisfies BrunoTableColumns<ProjectionRow>;
    const projectedColumns = [
      ...columns,
      BrunoTableComputedColumn({
        columnId: "COL_ID_DESK_LABEL",
        fields: ["desk"],
        headerName: "Desk",
        valueType: "text",
        valueGetter: projectionGetter,
      }),
    ] as const satisfies BrunoTableColumns<ProjectionRow>;
    const presentedColumns = [
      ...columns,
      { ...projectedColumns[2], headerName: "Desk label" },
    ] as const satisfies BrunoTableColumns<ProjectionRow>;
    const source = {
      viewport: transport.viewport,
      completeRawSelect: browserCompleteRawSelect,
      totalRows: 100,
      version: 1,
      status: "ready" as const,
    };
    const screen = await render(
      <BrunoTableServer
        tableId="TABLE_ID_SERVER_PROJECTION_ORDER"
        columns={initialColumns}
        initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
        viewportSource={source}
      />,
    );
    transport.requests[0]?.sink.setRowData({ 0: { symbol: "OLD", price: 1 } }, { 0: "old" });
    await expect.element(screen.getByRole("gridcell", { name: "OLD" })).toBeInTheDocument();

    await screen.rerender(
      <BrunoTableServer
        tableId="TABLE_ID_SERVER_PROJECTION_ORDER"
        columns={projectedColumns}
        initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
        viewportSource={source}
      />,
    );
    await vi.waitFor(() => expect(transport.requests).toHaveLength(2));
    expect(transport.releases).toHaveBeenCalledTimes(1);
    expect(projectionGetter).not.toHaveBeenCalled();
    expect(screen.getByRole("gridcell", { name: "OLD" }).query()).toBeNull();

    transport.requests[1]?.sink.setRowData(
      { 0: { symbol: "NEW", price: 2, desk: "ldn" } },
      { 0: "new" },
    );
    await expect.element(screen.getByRole("gridcell", { name: "LDN" })).toBeInTheDocument();
    projectionGetter.mockClear();

    await screen.rerender(
      <BrunoTableServer
        tableId="TABLE_ID_SERVER_PROJECTION_ORDER"
        columns={presentedColumns}
        initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
        viewportSource={source}
      />,
    );
    await settleBrunoTableBrowserFrames();
    expect(transport.requests).toHaveLength(2);
    expect(transport.releases).toHaveBeenCalledTimes(1);
    await expect.element(screen.getByRole("gridcell", { name: "LDN" })).toBeInTheDocument();
    expect(projectionGetter).toHaveBeenCalled();
  });

  test("retains coherent rows through stale, closed, and error chrome and delegates Retry exactly once", async () => {
    const transport = makeViewport();
    const retry = vi.fn();
    const screen = await render(<BrunoTableServer {...serverProps(transport.viewport, "ready")} />);
    transport.requests[0]?.sink.setRowData(
      { 0: { symbol: "RETAINED", price: 7 } },
      { 0: "retained" },
    );
    await expect.element(screen.getByRole("gridcell", { name: "RETAINED" })).toBeInTheDocument();
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SERVER" });
    grid.element().focus();
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(
        screen.getByRole("gridcell", { name: "RETAINED" }).element().id,
      ),
    );

    await screen.rerender(
      <BrunoTableServer
        {...serverProps(transport.viewport, "loading")}
        viewportSource={{
          viewport: transport.viewport,
          completeRawSelect: browserCompleteRawSelect,
          totalRows: 100,
          version: 2,
          status: "loading",
        }}
      />,
    );
    await expect
      .element(screen.getByRole("grid", { name: "Data for TABLE_ID_SERVER" }))
      .toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "RETAINED" }).query()).toBeNull();
    expect(screen.getByRole("row").nth(1).element().style.height).toBe("36px");
    await vi.waitFor(() => {
      const activeId = grid.element().getAttribute("aria-activedescendant");
      expect(activeId).toContain("bruno-table-loading-cell-");
      expect(grid.element().ownerDocument.getElementById(activeId ?? "missing")).not.toBeNull();
    });

    for (const status of ["stale", "closed"] as const) {
      await screen.rerender(
        <BrunoTableServer
          {...serverProps(transport.viewport, status)}
          viewportSource={{
            viewport: transport.viewport,
            completeRawSelect: browserCompleteRawSelect,
            totalRows: 100,
            version: 2,
            status,
            message: `Source ${status}`,
          }}
        />,
      );
      await expect.element(screen.getByRole("gridcell", { name: "RETAINED" })).toBeInTheDocument();
      await vi.waitFor(() =>
        expect(grid.element().getAttribute("aria-activedescendant")).toBe(
          screen.getByRole("gridcell", { name: "RETAINED" }).element().id,
        ),
      );
    }
    await screen.rerender(
      <BrunoTableServer
        {...serverProps(transport.viewport, "error")}
        viewportSource={{
          viewport: transport.viewport,
          completeRawSelect: browserCompleteRawSelect,
          totalRows: 100,
          version: 3,
          status: "error",
          message: "Source unavailable",
          retry: { pending: false, run: retry },
        }}
      />,
    );
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Source unavailable");
    await expect.element(screen.getByRole("gridcell", { name: "RETAINED" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(transport.requests).toHaveLength(1);
  });

  test.each(["stale", "closed", "error"] as const)(
    "renders initial %s lifecycle instead of provisional slots",
    async (status) => {
      const transport = makeViewport();
      const retry = vi.fn();
      const screen = await render(
        <BrunoTableServer
          {...serverProps(transport.viewport, status)}
          viewportSource={{
            viewport: transport.viewport,
            completeRawSelect: browserCompleteRawSelect,
            totalRows: 100,
            version: 1,
            status,
            message: "Source unavailable",
            retry: { pending: false, run: retry },
          }}
        />,
      );

      const announcement = screen.getByRole(status === "closed" ? "status" : "alert");
      const title =
        status === "stale"
          ? "Live data delayed"
          : status === "closed"
            ? "Live updates stopped"
            : "Live data error";
      await expect.element(announcement).toHaveTextContent(title);
      await expect.element(announcement).toHaveTextContent("Source unavailable");
      expect(screen.getByRole("grid", { name: "Loading table rows" }).query()).toBeNull();
      if (status === "stale") {
        expect(screen.getByRole("button", { name: "Retry" }).query()).toBeNull();
      } else {
        await userEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(retry).toHaveBeenCalledTimes(1);
      }
      expect(transport.requests).toHaveLength(1);
    },
  );

  test("keeps successive held-arrow destinations revealing sparse windows without feedback", async () => {
    const transport = makeViewport(1_000);
    const screen = await render(<BrunoTableServer {...serverProps(transport.viewport, "ready")} />);
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SERVER" });
    grid.element().focus();
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).not.toBeNull(),
    );
    const unrelatedToolbarNotifications = vi.fn();
    const restoreToolbarListener = installBrunoTableToolbarSubscriptionListener((event) => {
      if (
        event.tableId === "TABLE_ID_SERVER" &&
        event.phase === "notify" &&
        event.projection !== "loaded-row-count"
      ) {
        unrelatedToolbarNotifications(event);
      }
    });
    try {
      const destinations: number[] = [];
      const windowCountBeforeGesture = transport.windows.length;
      for (let batch = 0; batch < 4; batch += 1) {
        for (let index = 0; index < 25; index += 1) {
          grid.element().dispatchEvent(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              key: "ArrowDown",
              repeat: batch > 0 || index > 0,
            }),
          );
        }
        await settleBrunoTableBrowserFrames();
        const active = grid.element().getAttribute("aria-activedescendant");
        const destination = (batch + 1) * 25;
        expect(active).toContain(`-${String(destination)}-`);
        expect(transport.windows).toHaveLength(windowCountBeforeGesture + batch + 1);
        expect(transport.windows.at(-1)?.firstRow).toBeLessThanOrEqual(destination);
        expect(transport.windows.at(-1)?.lastRow).toBeGreaterThanOrEqual(destination);
        destinations.push(transport.windows.at(-1)?.lastRow ?? -1);
      }
      await vi.waitFor(() => expect(transport.windows.length).toBeGreaterThan(0));
      expect(transport.requests).toHaveLength(1);
      expect(destinations).toEqual([...destinations].sort((left, right) => left - right));
      expect(transport.windows.at(-1)?.lastRow).toBeGreaterThanOrEqual(99);

      const windowCountAtDestination = transport.windows.length;
      const activeAtDestination = grid.element().getAttribute("aria-activedescendant");
      const scrollTopAtDestination = grid.element().scrollTop;
      transport.requests[0]?.sink.setRowData(
        { 100: { symbol: "ARRIVED", price: 100 } },
        { 100: "row-arrived" },
      );
      await settleBrunoTableBrowserFrames();
      const arrived = screen.getByRole("gridcell", { name: "ARRIVED" });
      await expect.element(arrived).toBeInTheDocument();
      expect(grid.element().getAttribute("aria-activedescendant")).not.toBe(activeAtDestination);
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(arrived.element().id);
      const arrivedRow = [...grid.element().querySelectorAll<HTMLElement>('[role="row"]')].find(
        (row) => row.getAttribute("aria-owns")?.split(" ").includes(arrived.element().id),
      );
      expect(arrivedRow?.getAttribute("aria-rowindex")).toBe("102");
      expect(grid.element().scrollTop).toBe(scrollTopAtDestination);
      expect(transport.windows).toHaveLength(windowCountAtDestination);
      expect(unrelatedToolbarNotifications).not.toHaveBeenCalled();
    } finally {
      restoreToolbarListener();
    }
    await screen.unmount();
    expect(transport.releases).toHaveBeenCalledTimes(1);
  });

  test("clamps repeated Server navigation at the authoritative row boundary", async () => {
    const transport = makeViewport(3);
    const screen = await render(<BrunoTableServer {...serverProps(transport.viewport, "ready")} />);
    transport.requests[0]?.sink.setRowData(
      {
        0: { symbol: "ZERO", price: 0 },
        1: { symbol: "ONE", price: 1 },
        2: { symbol: "TWO", price: 2 },
      },
      { 0: "zero", 1: "one", 2: "two" },
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SERVER" });
    grid.element().focus();
    for (let index = 0; index < 20; index += 1) {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "ArrowDown",
        repeat: index > 0,
      });
      grid.element().dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    await vi.waitFor(() => {
      const active = grid.element().getAttribute("aria-activedescendant");
      expect(active).toBe(screen.getByRole("gridcell", { name: "TWO" }).element().id);
    });
    expect(transport.requests).toHaveLength(1);
  });

  test("installs and releases one controller per Strict Mode lifetime", async () => {
    const transport = makeViewport();
    const screen = await render(
      <StrictMode>
        <BrunoTableServer {...serverProps(transport.viewport, "ready")} />
      </StrictMode>,
    );
    expect(transport.requests).toHaveLength(2);
    expect(transport.releases).toHaveBeenCalledTimes(1);
    await screen.unmount();
    expect(transport.releases).toHaveBeenCalledTimes(2);
  });

  test("uses the published effect-view-server hook without insertion-cleanup sink updates", async () => {
    const firstInMemory = createInMemoryViewServerReact(actualViewportReact);
    const consoleError = vi.spyOn(console, "error");
    function ActualServerTable() {
      const viewportSource = actualViewportReact.useLiveQueryViewport("orders");
      return (
        <BrunoTableServer
          tableId="TABLE_ID_ACTUAL_VIEWPORT"
          columns={rawRowPresentationColumns}
          initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
          viewportSource={viewportSource}
        />
      );
    }

    try {
      const screen = await render(
        <StrictMode>
          <firstInMemory.ViewServerInMemoryProvider>
            <ActualServerTable />
          </firstInMemory.ViewServerInMemoryProvider>
        </StrictMode>,
      );
      await Effect.runPromise(
        firstInMemory.client.publish("orders", {
          id: "actual-1",
          symbol: "ACTUAL",
          price: 42,
          desk: "LDN",
        }),
      );
      const actualSymbol = screen.getByRole("gridcell", { name: "ACTUAL (LDN)" });
      await expect.element(actualSymbol).toBeInTheDocument();
      expect(actualSymbol.element().classList.contains("source-actual-1")).toBe(true);
      await expect
        .element(screen.getByRole("gridcell", { name: "42 · actual-1 · LDN" }))
        .toBeInTheDocument();
      await screen.unmount();
      await Effect.runPromise(firstInMemory.close);

      const remountedInMemory = createInMemoryViewServerReact(actualViewportReact);
      const remounted = await render(
        <remountedInMemory.ViewServerInMemoryProvider>
          <ActualServerTable />
        </remountedInMemory.ViewServerInMemoryProvider>,
      );
      await Effect.runPromise(
        remountedInMemory.client.publish("orders", {
          id: "actual-2",
          symbol: "REMOUNTED",
          price: 43,
          desk: "NYC",
        }),
      );
      await expect
        .element(remounted.getByRole("gridcell", { name: "REMOUNTED (NYC)" }))
        .toBeInTheDocument();
      await expect
        .element(remounted.getByRole("gridcell", { name: "43 · actual-2 · NYC" }))
        .toBeInTheDocument();
      await remounted.unmount();
      await Effect.runPromise(remountedInMemory.close);
      expect(
        consoleError.mock.calls.some((call) =>
          call.some(
            (value) =>
              typeof value === "string" &&
              value.includes("useInsertionEffect must not schedule updates"),
          ),
        ),
      ).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });

  test("keeps nested Server hotkeys and sparse windows with the nearest Table", async () => {
    const outer = makeViewport(1_000);
    const inner = makeViewport(1_000);
    const screen = await render(
      <BrunoTableServer {...serverProps(outer.viewport, "ready", "TABLE_ID_SERVER_OUTER")}>
        <BrunoTableServer {...serverProps(inner.viewport, "ready", "TABLE_ID_SERVER_INNER")} />
      </BrunoTableServer>,
    );
    const innerGrid = screen.getByRole("grid", { name: "Data for TABLE_ID_SERVER_INNER" });
    const outerWindowCount = outer.windows.length;
    const innerWindowCount = inner.windows.length;
    innerGrid.element().focus();
    for (let index = 0; index < 80; index += 1) {
      innerGrid.element().dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "ArrowDown",
          repeat: index > 0,
        }),
      );
      if (index % 10 === 9) {
        await settleBrunoTableBrowserFrames(1);
      }
    }
    await vi.waitFor(() => expect(inner.windows.length).toBeGreaterThan(innerWindowCount));
    expect(outer.windows).toHaveLength(outerWindowCount);
    expect(inner.requests).toHaveLength(1);
    expect(outer.requests).toHaveLength(1);
    expect(document.activeElement).toBe(innerGrid.element());
  });

  test("virtualizes both axes while retaining pinned start and end columns", async () => {
    const transport = makeViewport(1_000);
    const screen = await render(
      <BrunoTableServer
        tableId="TABLE_ID_SERVER_TWO_AXIS"
        columns={wideServerColumns}
        initialOrderBy={[{ columnId: "COL_ID_START", direction: "asc" }]}
        viewportSource={{
          viewport: transport.viewport,
          completeRawSelect: browserCompleteRawSelect,
          totalRows: 1_000,
          version: 1,
          status: "ready",
        }}
      />,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SERVER_TWO_AXIS" });
    grid.element().scrollTop = 50 * 36;
    grid.element().scrollLeft = 1_600;
    grid.element().dispatchEvent(new Event("scroll"));
    await vi.waitFor(() => expect(transport.windows.at(-1)?.lastRow).toBeGreaterThanOrEqual(50));
    transport.requests[0]?.sink.setRowData(
      { 50: { symbol: "ROW_050", price: 50 } },
      { 50: "row-050" },
    );

    await expect
      .element(screen.getByRole("gridcell", { name: "ROW_050" }).first())
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("columnheader", { name: /Pinned start/u }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("columnheader", { name: /Pinned end/u }))
      .toBeInTheDocument();
    const mountedHeaders = grid.element().querySelectorAll('[role="columnheader"]');
    expect(mountedHeaders.length).toBeLessThan(wideServerColumns.length);
    expect(mountedHeaders.length).toBeGreaterThanOrEqual(3);
    expect(transport.windows.at(-1)?.firstRow).toBeGreaterThan(0);
    expect(transport.windows.at(-1)?.firstRow).toBeLessThanOrEqual(50);
    expect(transport.windows.at(-1)?.lastRow).toBeGreaterThanOrEqual(50);
  });
});
