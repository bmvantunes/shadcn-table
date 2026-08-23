import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { StrictMode, useEffect } from "react";
import { Effect, Schema } from "effect";
import { ViewServerId, defineViewServerConfig } from "effect-view-server/config";
import { createViewServerReact } from "effect-view-server/react";
import { createInMemoryViewServerReact } from "effect-view-server/react/testing";
import { SourceAdapter } from "effect-view-server/source-adapter";
import { detectPlatform, getHotkeyManager } from "@tanstack/react-hotkeys";

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
import type { BrunoTableColumns, BrunoTableQuickFilterFields, BrunoTableValueType } from "./index";
import { settleBrunoTableBrowserFrames } from "./internal/browser-test-helpers";
import { BrunoTableGridRuntime, createBrunoTableInvalidCellValue } from "./internal/grid-runtime";
import { brunoTableTestSemanticQueryKey } from "./internal/server-semantic-key.test-support";
import {
  installBrunoTableClientCellRenderListenerForTable,
  installBrunoTableClientColumnFilterTriggerRenderListener,
  installBrunoTableClientGridSurfaceRenderListenerForTable,
  installBrunoTableClientHeaderRenderListenerForTable,
  installBrunoTableClientRowRenderListenerForTable,
  installBrunoTableClientViewRenderListenerForTable,
} from "./internal/render-instrumentation";
import {
  installBrunoTableToolbarLifetimeListener,
  installBrunoTableToolbarSubscriptionListener,
} from "./internal/toolbar-instrumentation";

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
const throwingCopyTextValueType = {
  codecId: "browser/throwing-copy-text",
  codecVersion: 1,
  filterFamily: "text",
  editorFamily: "text",
  cellAlign: "start",
  editorLayout: "inline",
  defaultWidth: 120,
  decodeRuntime: (input: unknown) =>
    typeof input === "string"
      ? ({ _tag: "Success", value: input } as const)
      : ({ _tag: "Failure", message: "Expected text." } as const),
  equivalent: (left: string, right: string) => left === right,
  compare: (left: string, right: string) => (left === right ? 0 : left < right ? -1 : 1),
  formatCanonicalText: (value: string) => {
    if (value === "THROW") throw new Error("copy formatter failure");
    return value;
  },
  parseCanonicalText: (text: string) => ({ _tag: "Success", value: text }) as const,
  formatDisplay: (value: string) => value,
  encodePersisted: (value: string) => value,
  decodePersisted: (input: unknown) =>
    typeof input === "string"
      ? ({ _tag: "Success", value: input } as const)
      : ({ _tag: "Failure", message: "Expected text." } as const),
} as const satisfies BrunoTableValueType<string, "text", "text">;
const rawRowPresentationColumns = [
  {
    ...columns[0],
    valueType: throwingCopyTextValueType,
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
const serverRangeColumns = [
  columns[0],
  { ...columns[1], enableFilter: true },
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
const browserLeasedSourceAdapter = SourceAdapter.make({
  identity: { name: "bruno-table-browser-route-tests" },
  failure: Schema.Never,
  materialized: undefined,
  leased: {
    metrics: Schema.Struct({ observed: Schema.BigInt }),
    rejectionLocation: Schema.Struct({ offset: Schema.BigInt }),
    definitionOptions: SourceAdapter.definitionOptions<undefined>(),
  },
});
const actualLeasedViewportConfig = defineViewServerConfig({
  topics: {
    orders: {
      schema: actualViewportConfig.topics.orders.schema,
      source: browserLeasedSourceAdapter.leasedSource(["desk"], undefined),
    },
  },
});
const actualLeasedViewportReact = createViewServerReact(actualLeasedViewportConfig);
type ActualLeasedViewportSource = ReturnType<typeof actualLeasedViewportReact.useLiveQueryViewport>;
const browserCompleteRawSelect = Object.freeze([
  "id",
  "symbol",
  "price",
  "desk",
]) as unknown as ActualViewportSource["completeRawSelect"];
const browserLeasedCompleteRawSelect = Object.freeze([
  "id",
  "symbol",
  "price",
  "desk",
]) as unknown as ActualLeasedViewportSource["completeRawSelect"];
type BrowserViewportMethods = Readonly<{
  readonly semanticKey: (query: unknown) => unknown;
  readonly replace: (
    request: Readonly<{ readonly query: unknown; readonly sink: Sink }>,
  ) => Readonly<{
    readonly setWindow: (window: Readonly<{ firstRow: number; lastRow: number }>) => void;
    readonly release: () => void;
  }>;
}>;
type BrowserViewportFor<TViewport> = Omit<TViewport, "destroy" | "replace" | "semanticKey"> &
  BrowserViewportMethods;
type BrowserViewport = BrowserViewportFor<ActualViewportSource["viewport"]>;
type BrowserLeasedViewport = BrowserViewportFor<ActualLeasedViewportSource["viewport"]>;

type Sink<TRow = Row> = Readonly<{
  readonly setRowCount: (count: number, keepRenderedRows?: boolean) => void;
  readonly setRowData: (
    rows: Readonly<Record<number, Partial<TRow>>>,
    keys: Readonly<Record<number, string>>,
  ) => void;
}>;

const browserWholeResult = () => ({
  rows: [],
  totalRows: 0,
  version: 1,
  status: "ready" as const,
});

function createBrowserWholeResultSpy() {
  const subscriptions: unknown[] = [];
  const releases: unknown[] = [];
  const useWholeResult = vi.fn(function useWholeResult(query: unknown) {
    useEffect(() => {
      subscriptions.push(query);
      return () => {
        releases.push(query);
      };
    }, [query]);
    return browserWholeResult();
  });
  return { useWholeResult, subscriptions, releases };
}

function makeViewport(totalRows = 100, publishCount = true) {
  const requests: Array<Readonly<{ readonly query: unknown; readonly sink: Sink }>> = [];
  const windows: Array<Readonly<{ readonly firstRow: number; readonly lastRow: number }>> = [];
  const releases = vi.fn();
  const semanticKey = vi.fn(brunoTableTestSemanticQueryKey);
  const viewport: BrowserViewport = {
    semanticKey,
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
    semanticKey,
  };
}

function makeLeasedViewport(totalRows = 100) {
  const requests: Array<Readonly<{ readonly query: unknown; readonly sink: Sink }>> = [];
  const windows: Array<Readonly<{ readonly firstRow: number; readonly lastRow: number }>> = [];
  const releases = vi.fn();
  const semanticKey = vi.fn(brunoTableTestSemanticQueryKey);
  const viewport: BrowserLeasedViewport = {
    semanticKey,
    replace(request: Readonly<{ readonly query: unknown; readonly sink: Sink }>) {
      requests.push(request);
      request.sink.setRowCount(totalRows, true);
      return {
        setWindow(window: Readonly<{ readonly firstRow: number; readonly lastRow: number }>) {
          windows.push(window);
        },
        release: releases,
      };
    },
  };
  return { viewport, requests, windows, releases, semanticKey };
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
      useWholeResult: browserWholeResult,
      completeRawSelect: browserCompleteRawSelect,
      totalRows: 100,
      version: 1,
      status,
    },
  } as const;
}

afterEach(async () => cleanup());

describe("BrunoTableServer", () => {
  test("installs no ordinary Row Selection UI or dormant checkbox surface", async () => {
    const transport = makeViewport(1);
    const screen = await render(
      <BrunoTableServer
        {...serverProps(transport.viewport, "ready", "TABLE_ID_SERVER_NO_SELECTION")}
      />,
    );
    await vi.waitFor(() => expect(transport.requests).toHaveLength(1));
    transport.requests[0]!.sink.setRowData(
      { 0: { id: "order-1", symbol: "AAA", price: 10, desk: "LDN" } },
      { 0: "order-1" },
    );
    await settleBrunoTableBrowserFrames();
    expect(screen.getByRole("checkbox", { name: /Select (all )?rows?/ }).query()).toBeNull();
    const grid = screen
      .getByRole("grid", { name: "Data for TABLE_ID_SERVER_NO_SELECTION" })
      .element();
    expect(
      [...getHotkeyManager().registrations.state.values()].filter(
        (registration) => registration.target === grid && registration.hotkey === "Mod+A",
      ),
    ).toHaveLength(0);
  });

  test("mounts Server Set Filter facet work only while its overlay is open", async () => {
    const transport = makeViewport();
    const useWholeResult = vi.fn(() => ({
      rows: [{ symbol: "AAA", __bruno_table_facet_count: 2n }],
      totalRows: 1,
      version: 1,
      status: "ready" as const,
    }));
    const screen = await render(
      <BrunoTableServer
        tableId="TABLE_ID_SERVER_FILTERS"
        columns={serverFilterColumns}
        initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
        viewportSource={{
          viewport: transport.viewport,
          useWholeResult,
          completeRawSelect: browserCompleteRawSelect,
          totalRows: 100,
          version: 1,
          status: "ready",
        }}
      />,
    );

    expect(useWholeResult).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Filter Symbol" }));
    const dialog = screen.getByRole("dialog", { name: "Filter Symbol" });
    await expect
      .element(dialog.getByRole("combobox", { name: "Filter operator for Symbol" }))
      .toBeVisible();
    await expect
      .element(dialog.getByRole("searchbox", { name: "Search values for Symbol" }))
      .toBeVisible();
    await expect.element(dialog.getByRole("button", { name: "Select All" })).toBeVisible();
    await expect.element(dialog.getByRole("button", { name: "Clear All" })).toBeVisible();
    expect(useWholeResult).toHaveBeenCalledOnce();
  });

  test("presents every live Server facet lifecycle through an accessible status", async () => {
    const cases = [
      { status: "ready", label: "" },
      { status: "loading", label: "Loading filter values." },
      {
        status: "stale",
        message: "Using cached values.",
        label: "Filter values may be delayed. Using cached values.",
      },
      {
        status: "error",
        message: "Connection failed.",
        label: "Live filter values unavailable. Connection failed.",
      },
      { status: "closed", label: "Live filter values stopped." },
    ] as const;

    for (const lifecycle of cases) {
      const transport = makeViewport();
      const screen = await render(
        <BrunoTableServer
          tableId={`TABLE_ID_SERVER_FILTER_${lifecycle.status.toUpperCase()}`}
          columns={serverFilterColumns}
          initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
          viewportSource={{
            viewport: transport.viewport,
            useWholeResult: () => ({
              rows: [],
              totalRows: 0,
              version: 1,
              status: lifecycle.status,
              ...("message" in lifecycle ? { message: lifecycle.message } : {}),
            }),
            completeRawSelect: browserCompleteRawSelect,
            totalRows: 100,
            version: 1,
            status: "ready",
          }}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: "Filter Symbol" }));
      const dialog = screen.getByRole("dialog", { name: "Filter Symbol" });
      const facetStatus = dialog.getByRole("status").nth(0);
      if (lifecycle.status === "ready") {
        await expect.element(facetStatus).toBeEmptyDOMElement();
      } else {
        await expect.element(facetStatus).toHaveTextContent(lifecycle.label);
      }
      if (
        lifecycle.status === "loading" ||
        lifecycle.status === "error" ||
        lifecycle.status === "closed"
      ) {
        await expect
          .element(dialog.getByRole("heading", { name: "No values found" }))
          .not.toBeInTheDocument();
      }
      await cleanup();
    }
  });

  test("reconciles an open Server facet from one atomic column and query snapshot", async () => {
    const transport = makeViewport();
    const wholeResult = createBrowserWholeResultSpy();
    const source = {
      viewport: transport.viewport,
      useWholeResult: wholeResult.useWholeResult,
      completeRawSelect: browserCompleteRawSelect,
      totalRows: 100,
      version: 1,
      status: "ready" as const,
    };
    const initialColumns = [
      serverFilterColumns[0],
      { ...serverFilterColumns[1], enableFilter: true },
    ] as const satisfies BrunoTableColumns<Row>;
    const reconciledColumns = [serverFilterColumns[0]] as const satisfies BrunoTableColumns<Row>;
    let runtime: BrunoTableGridRuntime<Row> | undefined;
    const removeLifetime = installBrunoTableToolbarLifetimeListener((event) => {
      if (
        event.tableId === "TABLE_ID_SERVER_FACET_COLUMNS" &&
        event.kind === "runtime-create" &&
        event.identity instanceof BrunoTableGridRuntime
      ) {
        runtime = event.identity;
      }
    });
    try {
      const screen = await render(
        <BrunoTableServer
          tableId="TABLE_ID_SERVER_FACET_COLUMNS"
          columns={initialColumns}
          initialFilters={[{ columnId: "COL_ID_PRICE", type: "greaterThan", filter: 10 }]}
          initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
          viewportSource={source}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: "Filter Symbol" }));
      const dialog = screen.getByRole("dialog", { name: "Filter Symbol" });
      await expect.element(dialog).toBeInTheDocument();
      await vi.waitFor(() => expect(wholeResult.subscriptions).toHaveLength(1));
      expect(wholeResult.subscriptions[0]).toEqual({
        groupBy: ["symbol"],
        aggregates: { __bruno_table_facet_count: { aggFunc: "count" } },
        where: [{ field: "price", type: "greaterThan", filter: 10 }],
        orderBy: [{ field: "symbol", direction: "asc" }],
      });
      expect(runtime).toBeDefined();
      wholeResult.useWholeResult.mockClear();

      expect(
        runtime?.dispatchGridCommand({
          type: "column.reorder.commit",
          columnId: "COL_ID_PRICE",
          targetIndex: 0,
          pinned: undefined,
        }),
      ).toBe(true);
      await settleBrunoTableBrowserFrames();
      expect(wholeResult.useWholeResult).not.toHaveBeenCalled();
      expect(wholeResult.subscriptions).toHaveLength(1);
      expect(wholeResult.releases).toHaveLength(0);

      expect(
        runtime?.dispatchGridCommand({
          type: "column.visibility.commit",
          columnId: "COL_ID_PRICE",
          visible: false,
        }),
      ).toBe(true);
      await settleBrunoTableBrowserFrames();
      await expect
        .element(screen.getByRole("columnheader", { name: "Price" }))
        .not.toBeInTheDocument();
      await expect.element(dialog).toBeInTheDocument();
      expect(wholeResult.useWholeResult).not.toHaveBeenCalled();
      expect(wholeResult.subscriptions).toHaveLength(1);
      expect(wholeResult.releases).toHaveLength(0);

      await screen.rerender(
        <BrunoTableServer
          tableId="TABLE_ID_SERVER_FACET_COLUMNS"
          columns={reconciledColumns}
          initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
          viewportSource={source}
        />,
      );

      await vi.waitFor(() => expect(wholeResult.subscriptions).toHaveLength(2));
      expect(wholeResult.releases).toHaveLength(1);
      expect(wholeResult.useWholeResult).toHaveBeenCalled();
      for (const [query] of wholeResult.useWholeResult.mock.calls) {
        expect(query).toEqual({
          groupBy: ["symbol"],
          aggregates: { __bruno_table_facet_count: { aggFunc: "count" } },
          where: [],
          orderBy: [{ field: "symbol", direction: "asc" }],
        });
      }
      expect(transport.requests.at(-1)?.query).toEqual({
        select: ["symbol"],
        where: [],
        orderBy: [{ field: "symbol", direction: "asc" }],
      });
      await expect.element(dialog).toBeInTheDocument();
    } finally {
      removeLifetime();
    }
  });

  test("publishes one atomic open-facet snapshot for combined Server semantic props", async () => {
    const firstTransport = makeLeasedViewport();
    const secondTransport = makeLeasedViewport();
    const firstWholeResult = createBrowserWholeResultSpy();
    const secondWholeResult = createBrowserWholeResultSpy();
    const initialColumns = [
      serverFilterColumns[0],
      { ...serverFilterColumns[1], enableFilter: true },
    ] as const satisfies BrunoTableColumns<Row>;
    const finalColumns = [serverFilterColumns[0]] as const satisfies BrunoTableColumns<Row>;
    const source = (
      transport: ReturnType<typeof makeLeasedViewport>,
      useWholeResult: typeof firstWholeResult.useWholeResult,
    ) => ({
      viewport: transport.viewport,
      useWholeResult,
      completeRawSelect: browserLeasedCompleteRawSelect,
      totalRows: 100,
      version: 1,
      status: "ready" as const,
    });
    const toolbar = (
      <BrunoTableToolbar>
        <BrunoTableQuickFilter />
      </BrunoTableToolbar>
    );
    const screen = await render(
      <BrunoTableServer
        tableId="TABLE_ID_SERVER_ATOMIC_FACET_INPUTS"
        columns={initialColumns}
        externalFilters={[{ field: "price", type: "greaterThan", filter: 5 }]}
        initialFilters={[{ columnId: "COL_ID_PRICE", type: "greaterThan", filter: 10 }]}
        initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
        quickFilterFields={["symbol"]}
        routeBy={{ desk: "rates" }}
        viewportSource={source(firstTransport, firstWholeResult.useWholeResult)}
      >
        {toolbar}
      </BrunoTableServer>,
    );
    await userEvent.fill(screen.getByRole("searchbox", { name: "Quick Filter" }), "A");
    await vi.waitFor(() =>
      expect(firstTransport.semanticKey.mock.lastCall?.[0]).toEqual(
        expect.objectContaining({
          where: expect.arrayContaining([
            {
              type: "OR",
              conditions: [{ field: "symbol", type: "contains", filter: "A" }],
            },
          ]),
        }),
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Filter Symbol" }));
    const dialog = screen.getByRole("dialog", { name: "Filter Symbol" });
    await vi.waitFor(() => expect(firstWholeResult.subscriptions).toHaveLength(1));
    firstWholeResult.useWholeResult.mockClear();

    await screen.rerender(
      <BrunoTableServer
        tableId="TABLE_ID_SERVER_ATOMIC_FACET_INPUTS"
        columns={finalColumns}
        externalFilters={[{ field: "price", type: "greaterThan", filter: 20 }]}
        initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
        quickFilterFields={["desk"]}
        routeBy={{ desk: "credit" }}
        viewportSource={source(secondTransport, secondWholeResult.useWholeResult)}
      >
        {toolbar}
      </BrunoTableServer>,
    );

    await vi.waitFor(() => expect(secondWholeResult.subscriptions).toHaveLength(1));
    expect(firstWholeResult.releases).toHaveLength(1);
    expect(firstWholeResult.useWholeResult).not.toHaveBeenCalled();
    expect(secondWholeResult.useWholeResult).toHaveBeenCalled();
    for (const [query] of secondWholeResult.useWholeResult.mock.calls) {
      expect(query).toEqual({
        routeBy: { desk: "credit" },
        groupBy: ["symbol"],
        aggregates: { __bruno_table_facet_count: { aggFunc: "count" } },
        where: [
          { field: "price", type: "greaterThan", filter: 20 },
          {
            type: "OR",
            conditions: [{ field: "desk", type: "contains", filter: "A" }],
          },
        ],
        orderBy: [{ field: "symbol", direction: "asc" }],
      });
    }
    await expect.element(dialog).toBeInTheDocument();
  });

  test("releases an open Server facet exactly once when its capability is disabled or removed", async () => {
    const transport = makeViewport();
    const wholeResult = createBrowserWholeResultSpy();
    const enabledColumns = [
      serverFilterColumns[0],
      { ...columns[1], enableFilter: true, enableSetFilter: true },
    ] as const satisfies BrunoTableColumns<Row>;
    const disabledColumns = [
      serverFilterColumns[0],
      { ...columns[1], enableFilter: true, enableSetFilter: false },
    ] as const satisfies BrunoTableColumns<Row>;
    const source = {
      viewport: transport.viewport,
      useWholeResult: wholeResult.useWholeResult,
      completeRawSelect: browserCompleteRawSelect,
      totalRows: 100,
      version: 1,
      status: "ready" as const,
    };
    const table = (nextColumns: BrunoTableColumns<Row>) => (
      <BrunoTableServer
        tableId="TABLE_ID_SERVER_OWN_FACET"
        columns={nextColumns}
        initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
        viewportSource={source}
      />
    );
    const screen = await render(table(enabledColumns));
    await userEvent.click(screen.getByRole("button", { name: "Filter Price" }));
    const dialog = screen.getByRole("dialog", { name: "Filter Price" });
    await expect
      .element(dialog.getByRole("searchbox", { name: "Search values for Price" }))
      .toBeVisible();
    await vi.waitFor(() => expect(wholeResult.subscriptions).toHaveLength(1));

    wholeResult.useWholeResult.mockClear();
    await screen.rerender(table(disabledColumns));
    await vi.waitFor(() => expect(wholeResult.releases).toHaveLength(1));
    expect(wholeResult.subscriptions).toHaveLength(1);
    expect(wholeResult.useWholeResult).not.toHaveBeenCalled();
    await expect.element(dialog).toBeInTheDocument();
    await expect
      .element(dialog.getByRole("searchbox", { name: "Search values for Price" }))
      .not.toBeInTheDocument();
    await expect
      .element(dialog.getByRole("combobox", { name: "Filter operator for Price" }))
      .toBeInTheDocument();

    await screen.rerender(table(enabledColumns));
    await vi.waitFor(() => expect(wholeResult.subscriptions).toHaveLength(2));
    expect(wholeResult.releases).toHaveLength(1);
    expect(wholeResult.useWholeResult).toHaveBeenCalledOnce();
    await expect
      .element(dialog.getByRole("searchbox", { name: "Search values for Price" }))
      .toBeVisible();

    wholeResult.useWholeResult.mockClear();
    await screen.rerender(table([serverFilterColumns[0]]));
    await vi.waitFor(() => expect(wholeResult.releases).toHaveLength(2));
    expect(wholeResult.subscriptions).toHaveLength(2);
    expect(wholeResult.useWholeResult).not.toHaveBeenCalled();
    await expect.element(dialog).not.toBeInTheDocument();
  });

  test("keeps width-only commits out of Server semantic query work", async () => {
    const transport = makeViewport();
    const wholeResult = createBrowserWholeResultSpy();
    let runtime: BrunoTableGridRuntime<Row> | undefined;
    const removeLifetime = installBrunoTableToolbarLifetimeListener((event) => {
      if (
        event.tableId === "TABLE_ID_SERVER" &&
        event.kind === "runtime-create" &&
        event.identity instanceof BrunoTableGridRuntime
      ) {
        runtime = event.identity;
      }
    });
    try {
      const screen = await render(
        <BrunoTableServer
          {...serverProps(transport.viewport, "ready")}
          columns={serverFilterColumns}
          viewportSource={{
            ...serverProps(transport.viewport, "ready").viewportSource,
            useWholeResult: wholeResult.useWholeResult,
          }}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: "Filter Symbol" }));
      const dialog = screen.getByRole("dialog", { name: "Filter Symbol" });
      await expect
        .element(dialog.getByRole("searchbox", { name: "Search values for Symbol" }))
        .toBeVisible();
      await vi.waitFor(() => expect(wholeResult.subscriptions).toHaveLength(1));
      wholeResult.useWholeResult.mockClear();
      transport.semanticKey.mockClear();
      const requestCount = transport.requests.length;
      const subscriptionCount = wholeResult.subscriptions.length;
      const releaseCount = wholeResult.releases.length;
      expect(
        runtime?.dispatchGridCommand({
          type: "column.resize.commit",
          columnId: "COL_ID_SYMBOL",
          width: 180,
        }),
      ).toBe(true);
      await settleBrunoTableBrowserFrames();
      await expect
        .element(screen.getByRole("separator", { name: "Resize Symbol" }))
        .toHaveAttribute("aria-valuenow", "180");
      expect(transport.semanticKey).not.toHaveBeenCalled();
      expect(transport.requests).toHaveLength(requestCount);
      expect(wholeResult.useWholeResult).not.toHaveBeenCalled();
      expect(wholeResult.subscriptions).toHaveLength(subscriptionCount);
      expect(wholeResult.releases).toHaveLength(releaseCount);
      await expect.element(dialog).toBeInTheDocument();
    } finally {
      removeLifetime();
    }
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
          2: { id: "throw-1", symbol: "THROW", price: 7, desk: "LDN" },
        },
        { 0: "row-aapl", 1: "row-invalid", 2: "row-throw" },
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
      grid
        .element()
        .dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowLeft" }),
        );
      const copyThrowing = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "c",
        [detectPlatform() === "mac" ? "metaKey" : "ctrlKey"]: true,
      });
      grid.element().dispatchEvent(copyThrowing);
      await settleBrunoTableBrowserFrames();
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(copyThrowing.defaultPrevented).toBe(false);

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
          useWholeResult: browserWholeResult,
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
      useWholeResult: browserWholeResult,
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

  test("resets navigation once for semantic Route and External Filter changes", async () => {
    const transport = makeLeasedViewport(1_000);
    const source = {
      viewport: transport.viewport,
      useWholeResult: browserWholeResult,
      completeRawSelect: browserLeasedCompleteRawSelect,
      totalRows: 1_000,
      version: 1,
      status: "ready" as const,
    };
    const renderServer = (desk: "rates" | "credit", minimumPrice: number) => (
      <BrunoTableServer
        tableId="TABLE_ID_SERVER_ROUTE_EXTERNAL_NAVIGATION"
        columns={columns}
        routeBy={{ desk }}
        externalFilters={[{ field: "price", type: "greaterThan", filter: minimumPrice }]}
        initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
        viewportSource={source}
      />
    );
    const screen = await render(renderServer("rates", 10));
    transport.requests[0]?.sink.setRowData(
      {
        0: { symbol: "OLD ZERO", price: 11, desk: "rates" },
        1: { symbol: "OLD ONE", price: 12, desk: "rates" },
      },
      { 0: "old-zero", 1: "old-one" },
    );
    const grid = screen.getByRole("grid", {
      name: "Data for TABLE_ID_SERVER_ROUTE_EXTERNAL_NAVIGATION",
    });
    const separator = screen.getByRole("separator", { name: "Resize Symbol" }).element();
    vi.spyOn(separator, "setPointerCapture").mockImplementation(() => undefined);
    vi.spyOn(separator, "hasPointerCapture").mockReturnValue(true);
    vi.spyOn(separator, "releasePointerCapture").mockImplementation(() => undefined);
    separator.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 100,
        pointerId: 72,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: 120, pointerId: 72 }),
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
    window.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, clientX: 120, pointerId: 72 }),
    );
    await expect.element(separator).toHaveAttribute("aria-valuenow", "180");
    transport.semanticKey.mockClear();

    grid.element().focus();
    for (let index = 0; index < 2; index += 1) {
      grid
        .element()
        .dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown" }),
        );
    }
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(
        screen.getByRole("gridcell", { name: "OLD ONE" }).element().id,
      ),
    );
    const windowCountBeforeScroll = transport.windows.length;
    grid.element().scrollTop = 360;
    grid.element().dispatchEvent(new Event("scroll"));
    await settleBrunoTableBrowserFrames();
    expect(transport.windows).toHaveLength(windowCountBeforeScroll + 1);
    expect(transport.windows.at(-1)?.firstRow).toBeLessThanOrEqual(10);
    expect(transport.windows.at(-1)?.lastRow).toBeGreaterThanOrEqual(10);
    expect(transport.requests).toHaveLength(1);
    expect(transport.releases).not.toHaveBeenCalled();
    expect(transport.semanticKey).not.toHaveBeenCalled();
    const preservedScrollTop = grid.element().scrollTop;
    const preservedActiveDescendant = grid.element().getAttribute("aria-activedescendant");

    await screen.rerender(renderServer("rates", 10));
    expect(transport.requests).toHaveLength(1);
    expect(transport.releases).not.toHaveBeenCalled();
    expect(grid.element().scrollTop).toBe(preservedScrollTop);
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(preservedActiveDescendant);
    await expect.element(separator).toHaveAttribute("aria-valuenow", "180");

    await screen.rerender(renderServer("rates", 20));
    await vi.waitFor(() => expect(transport.requests).toHaveLength(2));
    expect(transport.releases).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(grid.element().scrollTop).toBe(0));
    expect(transport.requests[1]?.query).toEqual({
      routeBy: { desk: "rates" },
      select: ["symbol", "price"],
      where: [{ field: "price", type: "greaterThan", filter: 20 }],
      orderBy: [{ field: "symbol", direction: "asc" }],
    });
    transport.requests[1]?.sink.setRowData(
      {
        0: { symbol: "EXTERNAL ZERO", price: 21, desk: "rates" },
        1: { symbol: "EXTERNAL ONE", price: 22, desk: "rates" },
      },
      { 0: "external-zero", 1: "external-one" },
    );
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(
        screen.getByRole("gridcell", { name: "EXTERNAL ZERO" }).element().id,
      ),
    );
    await expect.element(separator).toHaveAttribute("aria-valuenow", "180");

    grid
      .element()
      .dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown" }),
      );
    const windowCountBeforeRouteScroll = transport.windows.length;
    grid.element().scrollTop = 360;
    grid.element().dispatchEvent(new Event("scroll"));
    await settleBrunoTableBrowserFrames();
    expect(transport.windows).toHaveLength(windowCountBeforeRouteScroll + 1);
    expect(transport.requests).toHaveLength(2);

    await screen.rerender(renderServer("credit", 20));
    await vi.waitFor(() => expect(transport.requests).toHaveLength(3));
    expect(transport.releases).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(grid.element().scrollTop).toBe(0));
    expect(transport.requests[2]?.query).toEqual({
      routeBy: { desk: "credit" },
      select: ["symbol", "price"],
      where: [{ field: "price", type: "greaterThan", filter: 20 }],
      orderBy: [{ field: "symbol", direction: "asc" }],
    });
    transport.requests[2]?.sink.setRowData(
      {
        0: { symbol: "ROUTE ZERO", price: 21, desk: "credit" },
        1: { symbol: "ROUTE ONE", price: 22, desk: "credit" },
      },
      { 0: "route-zero", 1: "route-one" },
    );
    await vi.waitFor(() =>
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(
        screen.getByRole("gridcell", { name: "ROUTE ZERO" }).element().id,
      ),
    );
    await expect.element(separator).toHaveAttribute("aria-valuenow", "180");
  });

  test("replaces exactly once with final projection and External Filters from one commit", async () => {
    const transport = makeViewport(1_000);
    const screen = await render(
      <BrunoTableServer
        {...serverProps(transport.viewport, "ready")}
        externalFilters={[{ field: "desk", type: "equals", filter: "rates" }]}
      />,
    );
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SERVER" });
    grid.element().scrollTop = 360;
    grid.element().dispatchEvent(new Event("scroll"));

    await screen.rerender(
      <BrunoTableServer
        tableId="TABLE_ID_SERVER"
        columns={remappedColumns}
        externalFilters={[{ field: "desk", type: "equals", filter: "credit" }]}
        initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
        viewportSource={{
          viewport: transport.viewport,
          useWholeResult: browserWholeResult,
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
      where: [{ field: "desk", type: "equals", filter: "credit" }],
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
      useWholeResult: browserWholeResult,
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
    await settleBrunoTableBrowserFrames();
    expect(transport.requests).toHaveLength(2);
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
          useWholeResult: browserWholeResult,
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
            useWholeResult: browserWholeResult,
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
          useWholeResult: browserWholeResult,
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
            useWholeResult: browserWholeResult,
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

  test("keeps native half-open ranges authoritative in the published View Server", async () => {
    const inMemory = createInMemoryViewServerReact(actualViewportReact);
    await Effect.runPromise(
      inMemory.client.publishMany("orders", [
        { id: "range-lower", symbol: "LOWER", price: 10, desk: "LDN" },
        { id: "range-inside", symbol: "INSIDE", price: 19, desk: "LDN" },
        { id: "range-upper", symbol: "UPPER", price: 20, desk: "LDN" },
      ]),
    );

    function ActualRangeTable() {
      const viewportSource = actualViewportReact.useLiveQueryViewport("orders");
      return (
        <BrunoTableServer
          tableId="TABLE_ID_ACTUAL_SERVER_RANGE"
          columns={serverRangeColumns}
          initialFilters={[
            {
              columnId: "COL_ID_PRICE",
              type: "inRange",
              filter: 10,
              filterTo: 20,
            },
          ]}
          initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
          viewportSource={viewportSource}
        />
      );
    }

    try {
      const screen = await render(
        <inMemory.ViewServerInMemoryProvider>
          <ActualRangeTable />
        </inMemory.ViewServerInMemoryProvider>,
      );
      await expect.element(screen.getByRole("gridcell", { name: "LOWER" })).toBeInTheDocument();
      await expect.element(screen.getByRole("gridcell", { name: "INSIDE" })).toBeInTheDocument();
      expect(screen.getByRole("gridcell", { name: "UPPER" }).query()).toBeNull();
    } finally {
      await Effect.runPromise(inMemory.close);
    }
  });

  test("keeps one live whole-result facet beside the published viewport and releases it on close", async () => {
    const inMemory = createInMemoryViewServerReact(actualViewportReact);
    await Effect.runPromise(
      inMemory.client.publishMany("orders", [
        { id: "facet-1", symbol: "AAA", price: 10, desk: "LDN" },
        { id: "facet-2", symbol: "BBB", price: 20, desk: "NYC" },
        { id: "facet-3", symbol: "AAC", price: 30, desk: "LDN" },
      ]),
    );

    function ActualFacetTable({ desk }: Readonly<{ desk: string }>) {
      const viewportSource = actualViewportReact.useLiveQueryViewport("orders");
      return (
        <BrunoTableServer
          tableId="TABLE_ID_ACTUAL_SERVER_FACET"
          columns={serverFilterColumns}
          externalFilters={[{ field: "desk", type: "equals", filter: desk }]}
          initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
          viewportSource={viewportSource}
        />
      );
    }

    try {
      const screen = await render(
        <StrictMode>
          <inMemory.ViewServerInMemoryProvider>
            <ActualFacetTable desk="LDN" />
          </inMemory.ViewServerInMemoryProvider>
        </StrictMode>,
      );
      await expect
        .poll(
          async () =>
            (await Effect.runPromise(inMemory.client.health())).engine.topics.orders
              .activeSubscriptions,
        )
        .toBe(1);

      const trigger = screen.getByRole("button", { name: "Filter Symbol" });
      await userEvent.click(trigger);
      const dialog = screen.getByRole("dialog", { name: "Filter Symbol" });
      await expect.element(dialog.getByRole("checkbox", { name: "Select AAA, 1" })).toBeVisible();
      await expect.element(dialog.getByRole("checkbox", { name: "Select AAC, 1" })).toBeVisible();
      expect(dialog.getByRole("checkbox", { name: /BBB/ }).query()).toBeNull();
      await expect
        .poll(
          async () =>
            (await Effect.runPromise(inMemory.client.health())).engine.topics.orders
              .activeSubscriptions,
        )
        .toBe(2);

      await Effect.runPromise(
        inMemory.client.publish("orders", {
          id: "facet-4",
          symbol: "AAA",
          price: 40,
          desk: "LDN",
        }),
      );
      await expect.element(dialog.getByRole("checkbox", { name: "Select AAA, 2" })).toBeVisible();

      await Effect.runPromise(inMemory.client.delete("orders", "facet-3"));
      await expect
        .element(dialog.getByRole("checkbox", { name: /Select AAC/ }))
        .not.toBeInTheDocument();

      await screen.rerender(
        <StrictMode>
          <inMemory.ViewServerInMemoryProvider>
            <ActualFacetTable desk="NYC" />
          </inMemory.ViewServerInMemoryProvider>
        </StrictMode>,
      );
      await expect.element(dialog.getByRole("checkbox", { name: "Select BBB, 1" })).toBeVisible();
      await expect
        .poll(
          async () =>
            (await Effect.runPromise(inMemory.client.health())).engine.topics.orders
              .activeSubscriptions,
        )
        .toBe(2);

      await userEvent.click(trigger);
      await expect.element(dialog).not.toBeInTheDocument();
      await expect
        .poll(
          async () =>
            (await Effect.runPromise(inMemory.client.health())).engine.topics.orders
              .activeSubscriptions,
        )
        .toBe(1);

      await userEvent.click(trigger);
      const reopenedDialog = screen.getByRole("dialog", { name: "Filter Symbol" });
      await expect
        .element(reopenedDialog.getByRole("checkbox", { name: "Select BBB, 1" }))
        .toBeVisible();
      await userEvent.click(reopenedDialog.getByRole("button", { name: "Clear All" }));
      await expect.element(screen.getByRole("region", { name: "No rows" })).toBeInTheDocument();
      await Effect.runPromise(
        inMemory.client.publish("orders", {
          id: "facet-5",
          symbol: "CCC",
          price: 50,
          desk: "NYC",
        }),
      );
      await expect.element(screen.getByRole("region", { name: "No rows" })).toBeInTheDocument();
      await expect
        .poll(
          async () =>
            (await Effect.runPromise(inMemory.client.health())).engine.topics.orders
              .activeSubscriptions,
        )
        .toBe(1);
    } finally {
      await Effect.runPromise(inMemory.close);
    }
  });

  test("isolates 20 Hz whole-result facet publications from unrelated Server render islands", async () => {
    const inMemory = createInMemoryViewServerReact(actualViewportReact);
    await Effect.runPromise(
      inMemory.client.publishMany(
        "orders",
        Array.from({ length: 100 }, (_, index) => ({
          id: `facet-hot-${String(index)}`,
          symbol: `A${String(index).padStart(3, "0")}`,
          price: index,
          desk: "LDN",
        })),
      ),
    );

    function HotFacetTable() {
      const viewportSource = actualViewportReact.useLiveQueryViewport("orders");
      return (
        <BrunoTableServer
          tableId="TABLE_ID_ACTUAL_SERVER_HOT_FACET"
          columns={serverFilterColumns}
          initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
          viewportSource={viewportSource}
        />
      );
    }

    try {
      const screen = await render(
        <inMemory.ViewServerInMemoryProvider>
          <HotFacetTable />
        </inMemory.ViewServerInMemoryProvider>,
      );
      await userEvent.click(screen.getByRole("button", { name: "Filter Symbol" }));
      const dialog = screen.getByRole("dialog", { name: "Filter Symbol" });
      await expect.element(dialog.getByRole("checkbox", { name: "Select A000, 1" })).toBeVisible();
      await expect
        .poll(
          async () =>
            (await Effect.runPromise(inMemory.client.health())).engine.topics.orders
              .activeSubscriptions,
        )
        .toBe(2);

      const unrelated = vi.fn();
      const restores = [
        installBrunoTableClientViewRenderListenerForTable(
          "TABLE_ID_ACTUAL_SERVER_HOT_FACET",
          unrelated,
        ),
        installBrunoTableClientGridSurfaceRenderListenerForTable(
          "TABLE_ID_ACTUAL_SERVER_HOT_FACET",
          unrelated,
        ),
        installBrunoTableClientHeaderRenderListenerForTable(
          "TABLE_ID_ACTUAL_SERVER_HOT_FACET",
          unrelated,
        ),
        installBrunoTableClientRowRenderListenerForTable(
          "TABLE_ID_ACTUAL_SERVER_HOT_FACET",
          unrelated,
        ),
        installBrunoTableClientCellRenderListenerForTable(
          "TABLE_ID_ACTUAL_SERVER_HOT_FACET",
          unrelated,
        ),
        installBrunoTableClientColumnFilterTriggerRenderListener((columnId) => {
          if (columnId === "COL_ID_SYMBOL") unrelated();
        }),
        installBrunoTableToolbarSubscriptionListener((event) => {
          if (event.tableId === "TABLE_ID_ACTUAL_SERVER_HOT_FACET" && event.phase === "notify") {
            unrelated();
          }
        }),
      ];
      try {
        for (let index = 60; index < 80; index += 1) {
          await Effect.runPromise(
            inMemory.client.publish("orders", {
              id: `facet-hot-${String(index)}`,
              symbol: "HOT",
              price: index,
              desk: "LDN",
            }),
          );
        }
        await userEvent.fill(
          dialog.getByRole("searchbox", { name: "Search values for Symbol" }),
          "HOT",
        );
        await expect
          .element(dialog.getByRole("checkbox", { name: "Select HOT, 20" }))
          .toBeVisible();
        expect(unrelated).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole("button", { name: "Filter Symbol" }));
        await expect.element(dialog).not.toBeInTheDocument();
        await expect
          .poll(
            async () =>
              (await Effect.runPromise(inMemory.client.health())).engine.topics.orders
                .activeSubscriptions,
          )
          .toBe(1);
        unrelated.mockClear();
        await Effect.runPromise(
          inMemory.client.publish("orders", {
            id: "facet-hot-80",
            symbol: "HOT",
            price: 80,
            desk: "LDN",
          }),
        );
        expect(unrelated).not.toHaveBeenCalled();
        expect(
          (await Effect.runPromise(inMemory.client.health())).engine.topics.orders
            .activeSubscriptions,
        ).toBe(1);
      } finally {
        for (const restore of restores) restore();
      }
    } finally {
      await Effect.runPromise(inMemory.close);
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
          useWholeResult: browserWholeResult,
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
