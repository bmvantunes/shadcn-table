import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { StrictMode } from "react";
import { Effect, Schema } from "effect";
import { ViewServerId, defineViewServerConfig } from "effect-view-server/config";
import { createViewServerReact } from "effect-view-server/react";
import { createInMemoryViewServerReact } from "effect-view-server/react/testing";

import {
  BrunoTableActiveFilterCount,
  BrunoTableActiveSortCount,
  BrunoTableLoadedRowCount,
  BrunoTableResultRowCount,
  BrunoTableServer,
  BrunoTableToolbar,
} from "./index";
import { installBrunoTableToolbarSubscriptionListener } from "./internal/toolbar-instrumentation";

type Row = Readonly<{ readonly symbol: string; readonly price: number }>;

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
] as const;
const remappedColumns = [
  columns[0],
  {
    columnId: "COL_ID_PRICE",
    field: "symbol",
    headerName: "Symbol mirror",
    valueType: "text",
    pinned: "end",
  },
] as const;

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
] as const;

const actualViewportConfig = defineViewServerConfig({
  topics: {
    orders: {
      schema: Schema.Struct({
        id: ViewServerId,
        symbol: Schema.String,
        price: Schema.Number,
      }),
    },
  },
});
const actualViewportReact = createViewServerReact(actualViewportConfig);

type Sink = Readonly<{
  readonly setRowCount: (count: number, keepRenderedRows?: boolean) => void;
  readonly setRowData: (
    rows: Readonly<Record<number, Row>>,
    keys: Readonly<Record<number, string>>,
  ) => void;
}>;

function makeViewport(totalRows = 100, publishCount = true) {
  const requests: Array<Readonly<{ readonly query: unknown; readonly sink: Sink }>> = [];
  const windows: Array<Readonly<{ readonly firstRow: number; readonly lastRow: number }>> = [];
  const releases = vi.fn();
  return {
    viewport: {
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
    },
    requests,
    windows,
    releases,
  };
}

function serverProps(
  viewport: ReturnType<typeof makeViewport>["viewport"],
  status: "loading" | "ready" | "stale" | "closed" | "error" = "loading",
  tableId = "TABLE_ID_SERVER",
) {
  return {
    tableId,
    columns,
    initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" as const }] as const,
    viewportSource: { viewport, totalRows: 100, version: 1, status },
  } as const;
}

afterEach(async () => cleanup());

describe("BrunoTableServer", () => {
  test("keeps fixed-height loading geometry when activation publishes a non-authoritative zero hint", async () => {
    const transport = makeViewport(100, false);
    const screen = await render(
      <BrunoTableServer<Row, typeof columns> {...serverProps(transport.viewport)} />,
    );
    transport.requests[0]?.sink.setRowCount(0, false);

    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SERVER" });
    await expect.element(grid).toHaveAttribute("aria-rowcount", "19");
    const bodyRows = grid.element().querySelectorAll<HTMLElement>('[role="row"][aria-rowindex]');
    expect(bodyRows.length).toBeGreaterThan(1);
    expect([...bodyRows].some((row) => row.style.height === "36px")).toBe(true);

    transport.requests[0]?.sink.setRowCount(0, true);
    await expect.element(screen.getByRole("region", { name: "No rows" })).toBeInTheDocument();
  });

  test("renders fixed-height sparse slots and writes authoritative rows into absolute indexes", async () => {
    const transport = makeViewport();
    const screen = await render(
      <BrunoTableServer<Row, typeof columns> {...serverProps(transport.viewport)} />,
    );

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
    await screen.rerender(
      <BrunoTableServer<Row, typeof columns> {...serverProps(transport.viewport, "ready")} />,
    );
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

  test("replaces semantic generations, releases old controllers, and rejects late writes", async () => {
    const first = makeViewport(25);
    const second = makeViewport(30);
    const screen = await render(
      <BrunoTableServer<Row, typeof columns> {...serverProps(first.viewport, "ready")} />,
    );
    first.requests[0]?.sink.setRowData({ 0: { symbol: "OLD", price: 1 } }, { 0: "old" });
    await expect.element(screen.getByRole("gridcell", { name: "OLD" })).toBeInTheDocument();

    await screen.rerender(
      <BrunoTableServer<Row, typeof columns> {...serverProps(second.viewport, "ready")} />,
    );
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

  test("uses one replacement for a semantic sort and resets vertical position", async () => {
    const transport = makeViewport(1_000);
    const screen = await render(
      <BrunoTableServer<Row, typeof columns> {...serverProps(transport.viewport, "ready")}>
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
    const screen = await render(
      <BrunoTableServer<Row, typeof columns> {...serverProps(transport.viewport, "ready")} />,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SERVER" });
    grid.element().scrollTop = 360;
    grid.element().dispatchEvent(new Event("scroll"));

    await screen.rerender(
      <BrunoTableServer<Row, typeof remappedColumns>
        tableId="TABLE_ID_SERVER"
        columns={remappedColumns}
        initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
        viewportSource={{
          viewport: transport.viewport,
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

  test("retains coherent rows through stale, closed, and error chrome and delegates Retry exactly once", async () => {
    const transport = makeViewport();
    const retry = vi.fn();
    const screen = await render(
      <BrunoTableServer<Row, typeof columns> {...serverProps(transport.viewport, "ready")} />,
    );
    transport.requests[0]?.sink.setRowData(
      { 0: { symbol: "RETAINED", price: 7 } },
      { 0: "retained" },
    );
    await expect.element(screen.getByRole("gridcell", { name: "RETAINED" })).toBeInTheDocument();

    for (const status of ["stale", "closed"] as const) {
      await screen.rerender(
        <BrunoTableServer<Row, typeof columns>
          {...serverProps(transport.viewport, status)}
          viewportSource={{
            viewport: transport.viewport,
            totalRows: 100,
            version: 2,
            status,
            message: `Source ${status}`,
          }}
        />,
      );
      await expect.element(screen.getByRole("gridcell", { name: "RETAINED" })).toBeInTheDocument();
    }
    await screen.rerender(
      <BrunoTableServer<Row, typeof columns>
        {...serverProps(transport.viewport, "error")}
        viewportSource={{
          viewport: transport.viewport,
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

  test("keeps successive held-arrow destinations revealing sparse windows without feedback", async () => {
    const transport = makeViewport(1_000);
    const screen = await render(
      <BrunoTableServer<Row, typeof columns> {...serverProps(transport.viewport, "ready")} />,
    );
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
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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
    const screen = await render(
      <BrunoTableServer<Row, typeof columns> {...serverProps(transport.viewport, "ready")} />,
    );
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
      grid
        .element()
        .dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown", repeat: index > 0 }),
        );
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
        <BrunoTableServer<Row, typeof columns> {...serverProps(transport.viewport, "ready")} />
      </StrictMode>,
    );
    expect(transport.requests).toHaveLength(2);
    expect(transport.releases).toHaveBeenCalledTimes(1);
    await screen.unmount();
    expect(transport.releases).toHaveBeenCalledTimes(2);
  });

  test("uses the published effect-view-server hook without insertion-cleanup sink updates", async () => {
    const firstInMemory = createInMemoryViewServerReact(actualViewportReact);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    function ActualServerTable() {
      const viewportSource = actualViewportReact.useLiveQueryViewport("orders");
      return (
        <BrunoTableServer<Row, typeof columns>
          tableId="TABLE_ID_ACTUAL_VIEWPORT"
          columns={columns}
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
        firstInMemory.client.publish("orders", { id: "actual-1", symbol: "ACTUAL", price: 42 }),
      );
      await expect.element(screen.getByRole("gridcell", { name: "ACTUAL" })).toBeInTheDocument();
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
        }),
      );
      await expect
        .element(remounted.getByRole("gridcell", { name: "REMOUNTED" }))
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
      <BrunoTableServer<Row, typeof columns>
        {...serverProps(outer.viewport, "ready", "TABLE_ID_SERVER_OUTER")}
      >
        <BrunoTableServer<Row, typeof columns>
          {...serverProps(inner.viewport, "ready", "TABLE_ID_SERVER_INNER")}
        />
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
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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
      <BrunoTableServer<Row, typeof wideServerColumns>
        tableId="TABLE_ID_SERVER_TWO_AXIS"
        columns={wideServerColumns}
        initialOrderBy={[{ columnId: "COL_ID_START", direction: "asc" }]}
        viewportSource={{
          viewport: transport.viewport,
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
    expect(transport.windows.at(-1)).toMatchObject({ firstRow: expect.any(Number) });
  });
});
