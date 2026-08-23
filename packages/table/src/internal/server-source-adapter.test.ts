import { describe, expect, it, vi } from "vitest";
import * as BigDecimal from "effect/BigDecimal";

import { compileColumns } from "./compile-columns";
import { BrunoTableGridRuntime } from "./grid-runtime";
import { BrunoTableServerRowPipelineAdapter } from "./server-source-adapter";
import { brunoTableTestSemanticQueryKey } from "./server-semantic-key.test-support";
import { BrunoTableBigDecimalColumn } from "../effect";
import type { BrunoTableColumns } from "../public-types";

type Row = Readonly<{ readonly symbol: string; readonly price: number }>;

const columns = compileColumns([
  {
    columnId: "COL_ID_SYMBOL",
    field: "symbol",
    headerName: "Symbol",
    valueType: "text",
  },
  {
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Price",
    valueType: "number",
    pinned: "end",
  },
]);

const query = Object.freeze({
  generation: 0,
  navigationMode: "reconcile" as const,
  filters: Object.freeze([]),
  quickFilter: "",
  orderBy: Object.freeze([{ columnId: "COL_ID_SYMBOL", direction: "asc" as const }]),
});

const completeRawSelect = ["symbol", "price"] as const;

function makeViewport<TRow = Row>() {
  let request:
    | Readonly<{
        readonly query: unknown;
        readonly window: Readonly<{ readonly firstRow: number; readonly lastRow: number }>;
        readonly sink: Readonly<{
          readonly setRowCount: (count: number, keepRenderedRows?: boolean) => void;
          readonly setRowData: (
            rows: Readonly<Record<number, TRow>>,
            keys: Readonly<Record<number, string>>,
          ) => void;
        }>;
      }>
    | undefined;
  const setWindow = vi.fn();
  const release = vi.fn();
  const semanticKey = vi.fn(brunoTableTestSemanticQueryKey);
  const replace = vi.fn((next: NonNullable<typeof request>) => {
    request = next;
    return { setWindow, release };
  });
  return {
    viewport: { replace, semanticKey },
    replace,
    semanticKey,
    setWindow,
    release,
    getRequest: () => request,
  };
}

describe("BrunoTableServerRowPipelineAdapter", () => {
  it("owns semantic replacement and keeps window movement inside one generation", () => {
    const transport = makeViewport();
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      ["symbol"],
      [],
      query.orderBy,
    );
    const publish = vi.fn();
    adapter.subscribePublication(publish);
    adapter.reconcileSource({
      viewport: transport.viewport,
      completeRawSelect,
      totalRows: 100,
      version: 1,
      status: "ready",
    });
    adapter.replace(transport.viewport, query);
    expect(transport.replace).toHaveBeenCalledTimes(1);
    expect(transport.getRequest()?.query).toEqual({
      select: ["symbol", "price"],
      where: [],
      orderBy: [{ field: "symbol", direction: "asc" }],
    });
    const firstPublication = adapter.getPublication();
    expect(firstPublication.rowSpace?.totalRows).toBe(18);
    expect(firstPublication.rowSpace?.loadedRows).toBe(0);

    firstPublication.rowSpace?.getRowId(0);
    publish.mockClear();
    adapter.setRequiredRange(10, 30);
    expect(transport.setWindow).toHaveBeenCalledTimes(1);
    expect(transport.setWindow).toHaveBeenLastCalledWith({ firstRow: 10, lastRow: 29 });
    expect(transport.replace).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it("uses source-owned semantic identity for exact Route and external operands", () => {
    const transport = makeViewport();
    const stableKey = Object.freeze({});
    transport.semanticKey.mockReturnValue(stableKey);
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      ["symbol"],
      [],
      query.orderBy,
      completeRawSelect,
    );
    adapter.reconcileSource({
      viewport: transport.viewport,
      completeRawSelect,
      totalRows: 100,
      version: 1,
      status: "ready",
    });

    adapter.replace(transport.viewport, query, {
      routeBy: { book: 9_007_199_254_740_993n },
      externalFilters: [{ field: "price", type: "equals", filter: 10 }],
      visibleColumnIds: ["COL_ID_SYMBOL", "COL_ID_PRICE"],
    });
    adapter.replace(transport.viewport, query, {
      routeBy: { book: 9_007_199_254_740_993n },
      externalFilters: [{ field: "price", type: "equals", filter: 10 }],
      visibleColumnIds: ["COL_ID_SYMBOL", "COL_ID_PRICE"],
    });

    expect(transport.semanticKey).toHaveBeenCalledTimes(2);
    expect(transport.replace).toHaveBeenCalledTimes(1);
    expect(transport.getRequest()?.query).toEqual({
      routeBy: { book: 9_007_199_254_740_993n },
      select: ["symbol", "price"],
      where: [{ field: "price", type: "equals", filter: 10 }],
      orderBy: [{ field: "symbol", direction: "asc" }],
    });
  });

  it("resets navigation only when prop-owned query inputs change semantically", () => {
    const transport = makeViewport();
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
      completeRawSelect,
    );
    const reconcileQuery = Object.freeze({ ...query, navigationMode: "reconcile" as const });
    const rates = {
      routeBy: { book: 1n },
      externalFilters: [{ field: "price", type: "equals", filter: 10 }],
      visibleColumnIds: ["COL_ID_SYMBOL", "COL_ID_PRICE"],
    } as const;
    adapter.replace(transport.viewport, reconcileQuery, rates, true);
    adapter.replace(
      transport.viewport,
      { ...reconcileQuery, generation: 1 },
      {
        ...rates,
        externalFilters: [{ field: "price", type: "equals", filter: 20 }],
      },
      true,
    );
    expect(adapter.getStructureSnapshot().navigationMode).toBe("reset");

    adapter.replace(
      transport.viewport,
      {
        ...reconcileQuery,
        generation: 2,
        orderBy: [{ columnId: "COL_ID_SYMBOL", direction: "desc" }],
      },
      {
        ...rates,
        externalFilters: [{ field: "price", type: "equals", filter: 20 }],
      },
      true,
    );
    expect(adapter.getStructureSnapshot().navigationMode).toBe("reconcile");
  });

  it("rejects a malformed replacement viewport before changing the active source", () => {
    const transport = makeViewport();
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
      completeRawSelect,
    );
    adapter.reconcileSource({
      viewport: transport.viewport,
      completeRawSelect,
      totalRows: 100,
      version: 1,
      status: "ready",
    });
    adapter.replace(transport.viewport, query);
    transport.getRequest()?.sink.setRowCount(250, true);
    transport.getRequest()?.sink.setRowData({ 0: { symbol: "OLD", price: 1 } }, { 0: "old" });
    const before = adapter.getPublication();

    expect(() =>
      adapter.reconcileSource({
        viewport: Object.freeze({}),
        completeRawSelect,
        totalRows: 7,
        version: 2,
        status: "error",
        message: "replacement",
      }),
    ).toThrow("BrunoTable Server viewportSource.viewport must expose replace().");
    expect(adapter.getPublication()).toBe(before);
    expect(adapter.getPublication().rowSpace?.getRow("old")).toEqual({
      symbol: "OLD",
      price: 1,
    });
    expect(adapter.getResultRowCountSnapshot()).toBe(250);
    expect(transport.release).not.toHaveBeenCalled();
  });

  it("resets navigation for a replacement viewport even when the runtime query reconciles", () => {
    const first = makeViewport();
    const second = makeViewport();
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
      completeRawSelect,
    );
    const reconcileQuery = Object.freeze({ ...query, navigationMode: "reconcile" as const });

    adapter.reconcileSource({
      viewport: first.viewport,
      completeRawSelect,
      totalRows: 100,
      version: 1,
      status: "ready",
    });
    adapter.replace(first.viewport, reconcileQuery);
    expect(adapter.getStructureSnapshot().navigationMode).toBe("reset");
    expect(adapter.getStructureSnapshot().generation).toBe(1);

    adapter.reconcileSource({
      viewport: second.viewport,
      completeRawSelect,
      totalRows: 100,
      version: 2,
      status: "ready",
    });
    adapter.release();
    expect(adapter.getStructureSnapshot().generation).toBe(1);
    adapter.replace(second.viewport, { ...reconcileQuery, generation: 1 });

    expect(adapter.getStructureSnapshot().navigationMode).toBe("reset");
    expect(adapter.getStructureSnapshot().generation).toBe(2);
  });

  it("forces reset when source-owned or Quick Filter projection changes override reconcile", () => {
    const transport = makeViewport();
    const rawPresentationColumns = compileColumns([
      {
        columnId: "COL_ID_SYMBOL",
        field: "symbol",
        headerName: "Symbol",
        valueType: "text",
        valueFormatter: ({ value }: { readonly value: string }) => value,
      },
      {
        columnId: "COL_ID_PRICE",
        field: "price",
        headerName: "Price",
        valueType: "number",
      },
    ]);
    const sourceProjectionAdapter = new BrunoTableServerRowPipelineAdapter<Row>(
      rawPresentationColumns,
      undefined,
      [],
      query.orderBy,
      completeRawSelect,
    );
    sourceProjectionAdapter.reconcileSource({
      viewport: transport.viewport,
      completeRawSelect,
      totalRows: 100,
      version: 1,
      status: "ready",
    });
    sourceProjectionAdapter.replace(transport.viewport, query);
    sourceProjectionAdapter.replace(transport.viewport, {
      ...query,
      generation: 1,
      orderBy: [{ columnId: "COL_ID_SYMBOL", direction: "desc" }],
    });
    expect(sourceProjectionAdapter.getStructureSnapshot().navigationMode).toBe("reconcile");

    sourceProjectionAdapter.reconcileSource({
      viewport: transport.viewport,
      completeRawSelect: ["symbol", "price", "desk"],
      totalRows: 100,
      version: 2,
      status: "ready",
    });
    sourceProjectionAdapter.replace(transport.viewport, {
      ...query,
      generation: 2,
      orderBy: [{ columnId: "COL_ID_SYMBOL", direction: "desc" }],
    });
    expect(sourceProjectionAdapter.getStructureSnapshot().navigationMode).toBe("reset");

    const quickFilterAdapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      ["symbol"],
      [],
      query.orderBy,
      completeRawSelect,
    );
    const quickQuery = Object.freeze({ ...query, quickFilter: "desk" });
    quickFilterAdapter.replace(transport.viewport, quickQuery);
    quickFilterAdapter.replace(transport.viewport, {
      ...quickQuery,
      generation: 1,
      orderBy: [{ columnId: "COL_ID_SYMBOL", direction: "desc" }],
    });
    expect(quickFilterAdapter.getStructureSnapshot().navigationMode).toBe("reconcile");

    quickFilterAdapter.reconcileColumns(columns, ["symbol", "desk"]);
    quickFilterAdapter.replace(transport.viewport, {
      ...quickQuery,
      generation: 2,
      orderBy: [{ columnId: "COL_ID_SYMBOL", direction: "desc" }],
    });
    expect(quickFilterAdapter.getStructureSnapshot().navigationMode).toBe("reset");
  });

  it("rejects missing or malformed complete projection authority without mutating the active source", () => {
    const first = makeViewport();
    const second = makeViewport();
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
      completeRawSelect,
    );
    adapter.reconcileSource({
      viewport: first.viewport,
      completeRawSelect,
      totalRows: 100,
      version: 1,
      status: "ready",
    });
    adapter.replace(first.viewport, query);
    first.getRequest()!.sink.setRowData({ 0: { symbol: "OLD", price: 1 } }, { 0: "old" });
    const coherentPublication = adapter.getPublication();
    const sparseCompleteRawSelect: unknown[] = ["symbol", "price"];
    sparseCompleteRawSelect.length = 3;

    for (const invalidSource of [
      {
        viewport: second.viewport,
        totalRows: 200,
        version: 2,
        status: "ready",
      },
      {
        viewport: second.viewport,
        completeRawSelect: ["symbol", "symbol"],
        totalRows: 200,
        version: 2,
        status: "ready",
      },
      {
        viewport: second.viewport,
        completeRawSelect: sparseCompleteRawSelect,
        totalRows: 200,
        version: 2,
        status: "ready",
      },
    ]) {
      expect(() =>
        adapter.reconcileSource(
          invalidSource as unknown as Parameters<typeof adapter.reconcileSource>[0],
        ),
      ).toThrowError(
        "BrunoTable Server viewportSource.completeRawSelect must be a non-empty unique source field tuple.",
      );
      expect(adapter.getPublication()).toBe(coherentPublication);
      expect(adapter.getPublication().rowSpace?.getRow("old")).toEqual({
        symbol: "OLD",
        price: 1,
      });
      expect(first.release).not.toHaveBeenCalled();
      expect(second.replace).not.toHaveBeenCalled();
    }

    adapter.reconcileSource({
      viewport: second.viewport,
      completeRawSelect,
      totalRows: 200,
      version: 2,
      status: "ready",
    });
    adapter.replace(second.viewport, { ...query, generation: 1 });
    expect(first.release).toHaveBeenCalledTimes(1);
    expect(second.replace).toHaveBeenCalledTimes(1);
  });

  it("reconciles Quick Filter projection fields and replaces only their semantic change", () => {
    const transport = makeViewport();
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      ["symbol"],
      [],
      query.orderBy,
    );
    const quickQuery = { ...query, quickFilter: "desk" };
    adapter.replace(transport.viewport, quickQuery);

    adapter.reconcileColumns(columns, ["symbol", "desk"]);
    adapter.replace(transport.viewport, { ...quickQuery, generation: 1 });

    expect(transport.replace).toHaveBeenCalledTimes(2);
    expect(transport.getRequest()?.query).toEqual({
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
      orderBy: [{ field: "symbol", direction: "asc" }],
    });
  });

  it("keeps one generation when Quick Filter fields are only reordered", () => {
    const transport = makeViewport();
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      ["symbol", "desk"],
      [],
      query.orderBy,
    );
    const quickQuery = { ...query, quickFilter: "desk" };
    adapter.replace(transport.viewport, quickQuery);

    adapter.reconcileColumns(columns, ["desk", "symbol"]);
    adapter.replace(transport.viewport, { ...quickQuery, generation: 1 });

    expect(transport.replace).toHaveBeenCalledTimes(1);
    expect(transport.release).not.toHaveBeenCalled();
  });

  it("never publishes provisional loading geometry as the result row count", () => {
    const transport = makeViewport();
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
    );
    adapter.reconcileSource({
      viewport: transport.viewport,
      completeRawSelect,
      totalRows: 100,
      version: 1,
      status: "loading",
    });
    adapter.replace(transport.viewport, query);

    expect(adapter.getPublication().rowSpace?.totalRows).toBe(18);
    expect(adapter.getPublication().rowSpace?.loadedRows).toBe(0);
    expect(adapter.getPublication().rowSpace?.getRowId(0)).toBeUndefined();
    expect(adapter.getPublication().totalRows).toBe(18);
    expect(adapter.getResultRowCountSnapshot()).toBe(100);
    transport.getRequest()!.sink.setRowCount(250, true);
    expect(adapter.getResultRowCountSnapshot()).toBe(250);
    adapter.reconcileSource({
      viewport: transport.viewport,
      completeRawSelect,
      totalRows: 100,
      version: 2,
      status: "stale",
    });
    expect(adapter.getResultRowCountSnapshot()).toBe(250);
  });

  it("projects loading geometry without retained or newly delivered row identity", () => {
    const transport = makeViewport();
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
      completeRawSelect,
    );
    adapter.reconcileSource({
      viewport: transport.viewport,
      completeRawSelect,
      totalRows: 100,
      version: 1,
      status: "ready",
    });
    adapter.replace(transport.viewport, query);
    transport.getRequest()!.sink.setRowData({ 0: { symbol: "OLD", price: 1 } }, { 0: "old" });
    expect(adapter.getStructureSnapshot().findRowIndex("old")).toBe(0);

    adapter.reconcileSource({
      viewport: transport.viewport,
      completeRawSelect,
      totalRows: 100,
      version: 2,
      status: "loading",
    });
    expect(adapter.getStructureSnapshot().findRowIndex("old")).toBeUndefined();
    const structure = vi.fn();
    adapter.subscribeStructure(structure);
    transport.getRequest()!.sink.setRowData({ 1: { symbol: "MOVED", price: 2 } }, { 1: "old" });
    expect(adapter.getStructureSnapshot().findRowIndex("old")).toBeUndefined();
    expect(structure).not.toHaveBeenCalled();

    adapter.reconcileSource({
      viewport: transport.viewport,
      completeRawSelect,
      totalRows: 100,
      version: 3,
      status: "ready",
    });
    expect(adapter.getStructureSnapshot().findRowIndex("old")).toBe(1);
  });

  it("hides provisional rows when a new generation is already stale", () => {
    const transport = makeViewport();
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
      completeRawSelect,
    );
    adapter.reconcileSource({
      viewport: transport.viewport,
      completeRawSelect,
      totalRows: 100,
      version: 1,
      status: "stale",
    });
    adapter.replace(transport.viewport, query);

    expect(adapter.getPublication()).toMatchObject({
      status: "stale",
      totalRows: 18,
      hasCoherentRows: false,
    });
    expect(adapter.getPublication().rowSpace).toBeUndefined();
  });

  it("invalidates a generation whose transport replacement throws", () => {
    let failedSink:
      | Readonly<{
          readonly setRowCount: (count: number, keepRenderedRows?: boolean) => void;
          readonly setRowData: (
            rows: Readonly<Record<number, Row>>,
            keys: Readonly<Record<number, string>>,
          ) => void;
        }>
      | undefined;
    const failure = new Error("replace failed");
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
    );
    const initial = makeViewport();
    adapter.reconcileSource({
      viewport: initial.viewport,
      completeRawSelect,
      totalRows: 100,
      version: 1,
      status: "ready",
    });
    adapter.replace(initial.viewport, query);
    initial.getRequest()!.sink.setRowCount(250, true);
    expect(adapter.getResultRowCountSnapshot()).toBe(250);
    const publishedRows: string[] = [];
    adapter.subscribePublication(() => {
      const rowSpace = adapter.getPublication().rowSpace;
      if (rowSpace === undefined) return;
      const rowId = rowSpace.getRowId(0);
      const row = rowId === undefined ? undefined : rowSpace.getRow(rowId);
      if (row !== undefined) publishedRows.push(row.symbol);
    });
    expect(() =>
      adapter.replace(
        {
          semanticKey: brunoTableTestSemanticQueryKey,
          replace(request: Readonly<{ readonly sink: NonNullable<typeof failedSink> }>) {
            failedSink = request.sink;
            request.sink.setRowCount(1, true);
            request.sink.setRowData({ 0: { symbol: "FAILED", price: 0 } }, { 0: "failed" });
            throw failure;
          },
        },
        query,
      ),
    ).toThrow(failure);
    expect(publishedRows).toEqual([]);
    expect(adapter.getPublication().rowSpace).toBeUndefined();
    expect(adapter.getPublication().totalRows).toBe(100);
    expect(adapter.getResultRowCountSnapshot()).toBe(100);
    failedSink!.setRowData({ 0: { symbol: "LATE", price: 0 } }, { 0: "late" });
    expect(adapter.getPublication().rowSpace).toBeUndefined();

    const recovered = makeViewport();
    expect(() => adapter.replace(recovered.viewport, query)).not.toThrow();
    expect(recovered.replace).toHaveBeenCalledTimes(1);
  });

  it("best-effort releases a partially valid generation before rejecting it", () => {
    const release = vi.fn(() => {
      throw new Error("secondary release failure");
    });
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
      completeRawSelect,
    );
    const viewport = {
      semanticKey: brunoTableTestSemanticQueryKey,
      replace: vi.fn(() => ({ release, setWindow: undefined })),
    };
    adapter.reconcileSource({
      viewport,
      completeRawSelect,
      totalRows: 100,
      version: 1,
      status: "ready",
    });

    expect(() => adapter.replace(viewport, query)).toThrow(
      "BrunoTable Server viewport generation must expose setWindow() and release().",
    );
    expect(release).toHaveBeenCalledOnce();
    expect(adapter.getPublication().rowSpace).toBeUndefined();
  });

  it("publishes row invalidation before propagating a controller release failure", () => {
    const releaseFailure = new Error("release failed");
    const first = makeViewport();
    first.release.mockImplementation(() => {
      throw releaseFailure;
    });
    const second = makeViewport();
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
    );
    adapter.reconcileSource({
      viewport: first.viewport,
      completeRawSelect,
      totalRows: 100,
      version: 1,
      status: "ready",
    });
    adapter.replace(first.viewport, query);
    const firstSink = first.getRequest()!.sink;
    firstSink.setRowCount(250, true);
    firstSink.setRowData({ 0: { symbol: "OLD", price: 1 } }, { 0: "old" });
    expect(adapter.getResultRowCountSnapshot()).toBe(250);
    const structureFailure = vi.fn(() => {
      throw new Error("structure subscriber failed");
    });
    const countFailure = vi.fn(() => {
      throw new Error("count subscriber failed");
    });
    const publish = vi.fn(() => {
      throw new Error("publication subscriber failed");
    });
    adapter.subscribeStructure(structureFailure);
    adapter.subscribeResultRowCount(countFailure);
    adapter.subscribePublication(publish);

    let observedFailure: unknown;
    try {
      adapter.replace(second.viewport, { ...query, generation: 1 });
    } catch (error) {
      observedFailure = error;
    }
    expect(observedFailure).toBe(releaseFailure);
    expect(adapter.getPublication().rowSpace).toBeUndefined();
    expect(adapter.getResultRowCountSnapshot()).toBe(100);
    expect(structureFailure).toHaveBeenCalledTimes(1);
    expect(countFailure).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(second.replace).not.toHaveBeenCalled();
    firstSink.setRowData({ 0: { symbol: "LATE", price: 2 } }, { 0: "late" });
    expect(adapter.getPublication().rowSpace).toBeUndefined();
  });

  it("surfaces malformed active deliveries while ignoring released-generation writes", () => {
    const first = makeViewport();
    const second = makeViewport();
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
    );
    adapter.replace(first.viewport, query);
    const firstSink = first.getRequest()!.sink;
    const initialPublication = adapter.getPublication();
    const publish = vi.fn();
    adapter.subscribePublication(publish);

    for (const count of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => firstSink.setRowCount(count, true)).toThrow(
        "BrunoTable Server viewport delivered an invalid row count.",
      );
    }
    expect(adapter.getPublication()).toBe(initialPublication);
    expect(adapter.getResultRowCountSnapshot()).toBe(0);
    expect(publish).not.toHaveBeenCalled();

    expect(() => firstSink.setRowData({ 0: { symbol: "BROKEN", price: 1 } }, {})).toThrow(
      "BrunoTable Server viewport delivered invalid row/key maps.",
    );
    expect(adapter.getPublication().rowSpace?.getRowId(0)).toBeUndefined();

    adapter.replace(second.viewport, { ...query, generation: 1 });
    expect(() => firstSink.setRowCount(-1, true)).not.toThrow();
    expect(() => firstSink.setRowData({ 0: { symbol: "LATE", price: 2 } }, {})).not.toThrow();
  });

  it("forwards one sanitized required window including authoritative empty space", () => {
    const invalidTransport = makeViewport();
    const invalidAdapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
    );
    invalidAdapter.replace(invalidTransport.viewport, query);
    invalidAdapter.setRequiredRange(Number.NaN, Number.POSITIVE_INFINITY);
    expect(invalidTransport.setWindow).toHaveBeenLastCalledWith({ firstRow: 0, lastRow: 0 });

    const emptyTransport = makeViewport();
    const emptyAdapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
    );
    emptyAdapter.replace(emptyTransport.viewport, query);
    emptyTransport.getRequest()!.sink.setRowCount(0, true);
    emptyAdapter.setRequiredRange(50, 75);
    expect(emptyTransport.setWindow).toHaveBeenLastCalledWith({ firstRow: 0, lastRow: 0 });

    const boundedTransport = makeViewport();
    const boundedAdapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
    );
    boundedAdapter.replace(boundedTransport.viewport, query);
    boundedTransport.getRequest()!.sink.setRowCount(3, true);
    boundedAdapter.setRequiredRange(50, 75);
    expect(boundedTransport.setWindow).toHaveBeenLastCalledWith({ firstRow: 2, lastRow: 2 });
  });

  it("retries an unchanged required window after controller dispatch fails", () => {
    const transport = makeViewport();
    transport.setWindow.mockImplementationOnce(() => {
      throw new Error("window failed");
    });
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
    );
    adapter.replace(transport.viewport, query);

    expect(() => adapter.setRequiredRange(10, 30)).toThrow("window failed");
    expect(() => adapter.setRequiredRange(10, 30)).not.toThrow();
    expect(transport.setWindow).toHaveBeenNthCalledWith(1, { firstRow: 10, lastRow: 29 });
    expect(transport.setWindow).toHaveBeenNthCalledWith(2, { firstRow: 10, lastRow: 29 });
    expect(transport.replace).toHaveBeenCalledTimes(1);
  });

  it("falls back to a current sortable identity when columns replace the baseline", () => {
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
    );
    const priceOnly = compileColumns([
      {
        columnId: "COL_ID_PRICE_NEXT",
        field: "price",
        headerName: "Price",
        valueType: "number",
      },
    ]);

    expect(() => adapter.reconcileColumns(priceOnly, undefined)).not.toThrow();
    expect(adapter.getQueryConfiguration().baselineOrderBy).toEqual([
      { columnId: "COL_ID_PRICE_NEXT", direction: "asc" },
    ]);
  });

  it("publishes one coherent sparse delivery and ignores released sinks", () => {
    const firstTransport = makeViewport();
    const secondTransport = makeViewport();
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
    );
    const publish = vi.fn();
    adapter.subscribePublication(publish);
    adapter.reconcileSource({
      viewport: firstTransport.viewport,
      completeRawSelect,
      totalRows: 100,
      version: 1,
      status: "ready",
    });
    adapter.replace(firstTransport.viewport, query);
    const firstSink = firstTransport.getRequest()!.sink;
    firstSink.setRowCount(100, true);
    publish.mockClear();
    const stable = { symbol: "AAPL", price: 240 } as const;
    firstSink.setRowData({ 12: stable }, { 12: "row-a" });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(adapter.getPublication().rowSpace?.getRow("row-a")).toBe(stable);

    adapter.replace(secondTransport.viewport, query);
    expect(firstTransport.release).toHaveBeenCalledTimes(1);
    expect(adapter.getPublication().rowSpace?.getRowId(12)).toBeUndefined();
    firstSink.setRowData({ 0: { symbol: "LATE", price: 0 } }, { 0: "late" });
    expect(adapter.getPublication().rowSpace?.getRowId(0)).toBeUndefined();
  });

  it("partitions sparse value publications from structural row-space changes", () => {
    const transport = makeViewport();
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
    );
    const publishStructure = vi.fn();
    adapter.reconcileSource({
      viewport: transport.viewport,
      completeRawSelect,
      totalRows: 100,
      version: 1,
      status: "ready",
    });
    adapter.replace(transport.viewport, query);
    adapter.subscribeStructure(publishStructure);

    transport.getRequest()!.sink.setRowData({ 0: { symbol: "AAPL", price: 240 } }, { 0: "row-a" });
    expect(publishStructure).toHaveBeenCalledTimes(1);
    const loadedStructure = adapter.getStructureSnapshot();

    publishStructure.mockClear();
    transport.getRequest()!.sink.setRowData({ 0: { symbol: "AAPL", price: 241 } }, { 0: "row-a" });
    expect(adapter.getPublication().rowSpace?.getCellValue("row-a", "COL_ID_PRICE")).toBe(241);
    expect(adapter.getStructureSnapshot()).toBe(loadedStructure);
    expect(publishStructure).not.toHaveBeenCalled();

    transport.getRequest()!.sink.setRowData({ 0: { symbol: "MSFT", price: 510 } }, { 0: "row-b" });
    expect(adapter.getStructureSnapshot()).not.toBe(loadedStructure);
    expect(publishStructure).toHaveBeenCalledTimes(1);

    publishStructure.mockClear();
    transport.getRequest()!.sink.setRowCount(50, true);
    expect(adapter.getStructureSnapshot().totalRows).toBe(50);
    expect(publishStructure).toHaveBeenCalledTimes(1);
  });

  it("notifies only subscribers for row identities affected by one sparse batch", () => {
    const transport = makeViewport();
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
      completeRawSelect,
    );
    adapter.reconcileSource({
      viewport: transport.viewport,
      completeRawSelect,
      totalRows: 100,
      version: 1,
      status: "ready",
    });
    adapter.replace(transport.viewport, query);
    const runtime = new BrunoTableGridRuntime(
      adapter.getPublication(),
      columns,
      adapter.getQueryConfiguration(),
      "TABLE_ID_SERVER_AFFECTED_SLOTS",
    );
    const view = runtime.getView();
    const reads: string[] = [];
    adapter.subscribePublication(() => {
      const publication = adapter.getPublication();
      const rowSpace = publication.rowSpace;
      runtime.publish(
        rowSpace === undefined
          ? publication
          : {
              ...publication,
              rowSpace: {
                ...rowSpace,
                getCellValue(rowId, columnId) {
                  reads.push(rowId);
                  return rowSpace.getCellValue(rowId, columnId);
                },
              },
            },
      );
    });
    const initialRows = Object.fromEntries(
      Array.from({ length: 18 }, (_, index) => [
        index,
        { symbol: `ROW-${String(index)}`, price: index },
      ]),
    );
    const initialKeys = Object.fromEntries(
      Array.from({ length: 18 }, (_, index) => [index, `row-${String(index)}`]),
    );
    transport.getRequest()!.sink.setRowData(initialRows, initialKeys);
    const notifications = Array.from({ length: 18 }, () => vi.fn());
    for (let index = 0; index < notifications.length; index += 1) {
      view.subscribeCell(`row-${String(index)}`, "COL_ID_PRICE", notifications[index]!);
    }
    reads.length = 0;
    for (const notification of notifications) notification.mockClear();

    transport.getRequest()!.sink.setRowData({ 7: { symbol: "ROW-7", price: 700 } }, { 7: "row-7" });

    expect(reads).toEqual(["row-7"]);
    expect(notifications[7]).toHaveBeenCalledOnce();
    expect(notifications.filter((notification) => notification.mock.calls.length > 0)).toEqual([
      notifications[7],
    ]);
  });

  it("does not retain semantically equivalent rows when display or raw-row evidence changes", () => {
    type Token = Readonly<{ readonly id: number; readonly label: string }>;
    type TokenRow = Readonly<{ readonly token: Token }>;
    const valueType = (formatDisplay: (value: Token) => string) => ({
      codecId: "test/server-token",
      codecVersion: 1,
      filterFamily: "equality" as const,
      editorFamily: "text" as const,
      cellAlign: "start" as const,
      editorLayout: "inline" as const,
      defaultWidth: 120,
      decodeRuntime: (input: unknown) =>
        typeof input === "object" && input !== null && "id" in input && "label" in input
          ? ({ _tag: "Success", value: input as Token } as const)
          : ({ _tag: "Failure", message: "Expected token." } as const),
      equivalent: (left: Token, right: Token) => left.id === right.id,
      compare: (left: Token, right: Token) => left.id - right.id,
      formatCanonicalText: (value: Token) => String(value.id),
      parseCanonicalText: (text: string) =>
        ({ _tag: "Success", value: { id: Number(text), label: text } }) as const,
      formatDisplay,
      encodePersisted: (value: Token) => ({ id: value.id, label: value.label }),
      decodePersisted: (input: unknown) =>
        typeof input === "object" && input !== null && "id" in input && "label" in input
          ? ({ _tag: "Success", value: input as Token } as const)
          : ({ _tag: "Failure", message: "Expected token." } as const),
    });
    const run = (rawRowAware: boolean) => {
      const tokenColumns = compileColumns([
        {
          columnId: "COL_ID_TOKEN",
          field: "token",
          headerName: "Token",
          valueType: valueType((value) => (rawRowAware ? String(value.id) : value.label)),
          ...(rawRowAware
            ? { valueFormatter: ({ row }: { readonly row: TokenRow }) => row.token.label }
            : {}),
        },
      ] as never);
      const transport = makeViewport<TokenRow>();
      const adapter = new BrunoTableServerRowPipelineAdapter<TokenRow>(
        tokenColumns,
        undefined,
        [],
        [{ columnId: "COL_ID_TOKEN", direction: "asc" }],
        ["token"],
      );
      adapter.reconcileSource({
        viewport: transport.viewport,
        completeRawSelect: ["token"],
        totalRows: 1,
        version: 1,
        status: "ready",
      });
      adapter.replace(transport.viewport, {
        generation: 0,
        navigationMode: "reset",
        filters: [],
        quickFilter: "",
        orderBy: [{ columnId: "COL_ID_TOKEN", direction: "asc" }],
      });
      const previous = { token: { id: 1, label: "OLD" } } as const;
      const next = { token: { id: 1, label: "NEW" } } as const;
      transport.getRequest()!.sink.setRowData({ 0: previous }, { 0: "token-1" });
      const previousReference = adapter.getPublication().rowSpace?.getRow("token-1");
      transport.getRequest()!.sink.setRowData({ 0: next }, { 0: "token-1" });
      expect(adapter.getPublication().rowSpace?.getRow("token-1")).toBe(next);
      expect(adapter.getPublication().rowSpace?.getRow("token-1")).not.toBe(previousReference);
    };

    run(false);
    run(true);
  });

  it("never publishes a new source envelope with old-generation rows", () => {
    const firstTransport = makeViewport();
    const secondTransport = makeViewport();
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
    );
    adapter.reconcileSource({
      viewport: firstTransport.viewport,
      completeRawSelect,
      totalRows: 100,
      version: 1,
      status: "ready",
    });
    adapter.replace(firstTransport.viewport, query);
    firstTransport.getRequest()!.sink.setRowData({ 0: { symbol: "OLD", price: 1 } }, { 0: "old" });
    const observed: Array<Readonly<{ readonly version: number; readonly rowId?: string }>> = [];
    adapter.subscribePublication(() => {
      const publication = adapter.getPublication();
      const rowId = publication.rowSpace?.getRowId(0);
      observed.push(
        rowId === undefined
          ? { version: publication.version }
          : { version: publication.version, rowId },
      );
    });

    adapter.release();
    adapter.reconcileSource({
      viewport: secondTransport.viewport,
      completeRawSelect,
      totalRows: 200,
      version: 2,
      status: "ready",
    });
    expect(observed).toEqual([{ version: 1 }, { version: 2 }]);
    adapter.replace(secondTransport.viewport, query);
    expect(observed.some((snapshot) => snapshot.version === 2 && snapshot.rowId === "old")).toBe(
      false,
    );
    expect(observed.at(-1)).toEqual({ version: 2 });
  });

  it("releases deterministically and rejects cleanup writes after release", () => {
    const transport = makeViewport();
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
    );
    adapter.replace(transport.viewport, query);
    const sink = transport.getRequest()!.sink;

    adapter.release();
    expect(transport.release).toHaveBeenCalledTimes(1);
    sink.setRowCount(999, true);
    sink.setRowData({ 0: { symbol: "LATE", price: 0 } }, { 0: "late" });
    expect(adapter.getPublication().rowSpace?.getRowId(0)).toBeUndefined();
  });

  it("publishes direct-release invalidation before preserving a controller failure", () => {
    const releaseFailure = new Error("release failed");
    const transport = makeViewport();
    transport.release.mockImplementationOnce(() => {
      throw releaseFailure;
    });
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
      completeRawSelect,
    );
    adapter.reconcileSource({
      viewport: transport.viewport,
      completeRawSelect,
      totalRows: 100,
      version: 1,
      status: "ready",
    });
    adapter.replace(transport.viewport, query);
    transport.getRequest()!.sink.setRowCount(250, true);
    transport.getRequest()!.sink.setRowData({ 0: { symbol: "OLD", price: 1 } }, { 0: "old" });
    const publications: Array<Readonly<{ readonly totalRows: number; readonly hasRows: boolean }>> =
      [];
    adapter.subscribePublication(() => {
      publications.push({
        totalRows: adapter.getResultRowCountSnapshot(),
        hasRows: adapter.getPublication().rowSpace !== undefined,
      });
    });

    expect(() => adapter.release()).toThrow(releaseFailure);
    expect(publications.at(-1)).toEqual({ totalRows: 100, hasRows: false });
    expect(adapter.getPublication().rowSpace).toBeUndefined();
    expect(adapter.getResultRowCountSnapshot()).toBe(100);
  });

  it("replaces only when the normalized source projection changes", () => {
    const transport = makeViewport();
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
    );
    adapter.reconcileSource({
      viewport: transport.viewport,
      completeRawSelect,
      totalRows: 100,
      version: 1,
      status: "ready",
    });
    adapter.replace(transport.viewport, query);
    transport.getRequest()?.sink.setRowCount(100, true);
    transport.getRequest()?.sink.setRowData({ 0: { symbol: "OLD", price: 1 } }, { 0: "old" });
    expect(adapter.getPublication().rowSpace?.loadedRows).toBe(1);
    expect(adapter.getPublication().rowSpace?.getRowId(0)).toBe("old");
    expect(adapter.getPublication().rowSpace?.getRow("old")).toMatchObject({ symbol: "OLD" });

    adapter.replace(transport.viewport, { ...query, generation: 1 });
    expect(transport.replace).toHaveBeenCalledTimes(1);

    adapter.reconcileColumns(
      compileColumns([
        {
          columnId: "COL_ID_SYMBOL",
          field: "symbol",
          headerName: "Symbol again",
          valueType: "text",
        },
        {
          columnId: "COL_ID_PRICE",
          field: "price",
          headerName: "Price again",
          valueType: "number",
          pinned: "end",
        },
      ]),
      undefined,
    );
    expect(adapter.getPublication().rowSpace?.getRow("old")).toMatchObject({ symbol: "OLD" });
    adapter.replace(transport.viewport, query);
    expect(transport.replace).toHaveBeenCalledTimes(1);

    adapter.reconcileColumns(
      compileColumns([
        {
          columnId: "COL_ID_SYMBOL",
          field: "symbol",
          headerName: "Symbol",
          valueType: "text",
        },
        {
          columnId: "COL_ID_PRICE",
          fields: ["price", "symbol"],
          headerName: "Derived price",
          valueType: "number",
          valueGetter: ({ row }: { readonly row: Row }) => row.price,
        },
      ]),
      undefined,
    );
    expect(adapter.getPublication().rowSpace?.getRow("old")).toMatchObject({ symbol: "OLD" });
    adapter.replace(transport.viewport, query);
    expect(transport.replace).toHaveBeenCalledTimes(1);

    adapter.reconcileColumns(
      compileColumns([
        {
          columnId: "COL_ID_SYMBOL",
          field: "symbol",
          headerName: "Symbol",
          valueType: "text",
        },
        {
          columnId: "COL_ID_PRICE",
          fields: ["symbol"],
          headerName: "Derived price",
          valueType: "number",
          valueGetter: ({ row }: { readonly row: Row }) => row.price,
        },
      ]),
      undefined,
    );
    expect(adapter.getPublication().rowSpace).toBeUndefined();
    expect(transport.release).toHaveBeenCalledTimes(1);
    adapter.replace(transport.viewport, query);
    expect(transport.replace).toHaveBeenCalledTimes(2);
    expect(transport.release).toHaveBeenCalledTimes(1);
  });

  it("replaces exactly once when raw-row presentation changes projection mode", () => {
    const transport = makeViewport();
    const completeRawSelect = ["symbol", "price", "desk"] as const;
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
      completeRawSelect,
    );
    adapter.reconcileSource({
      viewport: transport.viewport,
      completeRawSelect,
      totalRows: 100,
      version: 1,
      status: "ready",
    });
    adapter.replace(transport.viewport, query);
    expect(transport.getRequest()?.query).toMatchObject({ select: ["symbol", "price"] });

    const presentedColumns = compileColumns([
      {
        columnId: "COL_ID_SYMBOL",
        field: "symbol",
        headerName: "Symbol",
        valueType: "text",
        valueFormatter: () => "formatted",
      },
      columns[1]!,
    ]);
    adapter.reconcileColumns(presentedColumns, undefined);
    expect(transport.release).toHaveBeenCalledTimes(1);
    expect(adapter.getPublication().rowSpace).toBeUndefined();
    adapter.replace(transport.viewport, { ...query, generation: 1 });
    expect(transport.replace).toHaveBeenCalledTimes(2);
    expect(transport.getRequest()?.query).toMatchObject({ select: completeRawSelect });

    adapter.reconcileColumns(
      compileColumns([
        {
          columnId: "COL_ID_SYMBOL",
          field: "symbol",
          headerName: "Symbol again",
          valueType: "text",
          cellRenderer: () => "rendered",
        },
        columns[1]!,
      ]),
      undefined,
    );
    adapter.replace(transport.viewport, { ...query, generation: 2 });
    expect(transport.replace).toHaveBeenCalledTimes(2);
    expect(transport.release).toHaveBeenCalledTimes(1);

    adapter.reconcileColumns(columns, undefined);
    expect(transport.release).toHaveBeenCalledTimes(2);
    adapter.replace(transport.viewport, { ...query, generation: 3 });
    expect(transport.replace).toHaveBeenCalledTimes(3);
    expect(transport.getRequest()?.query).toMatchObject({ select: ["symbol", "price"] });
  });

  it("keeps one filtered source generation across unrelated same-field columns", () => {
    const equivalentColumns = compileColumns([
      {
        columnId: "COL_ID_SYMBOL_PRIMARY",
        field: "symbol",
        headerName: "Primary symbol",
        valueType: "text",
      },
      {
        columnId: "COL_ID_SYMBOL_SECONDARY",
        field: "symbol",
        headerName: "Secondary symbol",
        valueType: "text",
      },
    ]);
    const transport = makeViewport();
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      equivalentColumns,
      undefined,
      [],
      [{ columnId: "COL_ID_SYMBOL_PRIMARY", direction: "asc" }],
    );

    adapter.replace(transport.viewport, {
      ...query,
      filters: [{ columnId: "COL_ID_SYMBOL_PRIMARY", type: "startsWith", filter: "A" }],
      orderBy: [{ columnId: "COL_ID_SYMBOL_PRIMARY", direction: "asc" }],
    });
    adapter.reconcileColumns(
      compileColumns([
        {
          columnId: "COL_ID_SYMBOL_PRIMARY",
          field: "symbol",
          headerName: "Primary symbol",
          valueType: "text",
        },
      ]),
      undefined,
    );
    adapter.replace(transport.viewport, {
      ...query,
      generation: 1,
      filters: [{ columnId: "COL_ID_SYMBOL_PRIMARY", type: "startsWith", filter: "A" }],
      orderBy: [{ columnId: "COL_ID_SYMBOL_PRIMARY", direction: "asc" }],
    });
    adapter.reconcileColumns(equivalentColumns.toReversed(), undefined);
    adapter.replace(transport.viewport, {
      ...query,
      generation: 2,
      filters: [{ columnId: "COL_ID_SYMBOL_PRIMARY", type: "startsWith", filter: "A" }],
      orderBy: [{ columnId: "COL_ID_SYMBOL_PRIMARY", direction: "asc" }],
    });

    expect(transport.replace).toHaveBeenCalledTimes(1);
    expect(transport.release).not.toHaveBeenCalled();

    adapter.replace(transport.viewport, {
      ...query,
      generation: 3,
      filters: [{ columnId: "COL_ID_SYMBOL_PRIMARY", type: "startsWith", filter: "B" }],
      orderBy: [{ columnId: "COL_ID_SYMBOL_PRIMARY", direction: "asc" }],
    });
    expect(transport.replace).toHaveBeenCalledTimes(2);
    expect(transport.release).toHaveBeenCalledTimes(1);
  });

  it("keeps one source generation when presentation reorders distinct projection fields", () => {
    const transport = makeViewport();
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
    );

    adapter.replace(transport.viewport, query);
    expect(transport.getRequest()?.query).toEqual({
      select: ["symbol", "price"],
      where: [],
      orderBy: [{ field: "symbol", direction: "asc" }],
    });

    adapter.reconcileColumns(columns.toReversed(), undefined);
    adapter.replace(transport.viewport, { ...query, generation: 1 });

    expect(transport.replace).toHaveBeenCalledTimes(1);
    expect(transport.release).not.toHaveBeenCalled();
    expect(transport.getRequest()?.query).toEqual({
      select: ["symbol", "price"],
      where: [],
      orderBy: [{ field: "symbol", direction: "asc" }],
    });
  });

  it("ignores hidden computed dependencies and presentation until the column becomes visible", () => {
    const transport = makeViewport();
    const initialColumns = compileColumns([
      columns[0]!,
      {
        columnId: "COL_ID_DERIVED",
        fields: ["price"],
        headerName: "Derived",
        valueType: "number",
        valueGetter: () => 0,
      },
    ]);
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      initialColumns,
      undefined,
      [],
      query.orderBy,
      completeRawSelect,
    );
    const visibleSymbol = {
      routeBy: undefined,
      externalFilters: undefined,
      visibleColumnIds: ["COL_ID_SYMBOL"],
    } as const;

    adapter.replace(transport.viewport, query, visibleSymbol);
    expect(transport.getRequest()?.query).toMatchObject({ select: ["symbol"] });

    adapter.reconcileColumns(
      compileColumns([
        columns[0]!,
        {
          columnId: "COL_ID_DERIVED",
          fields: ["symbol"],
          headerName: "Derived again",
          valueType: "number",
          valueGetter: () => 1,
          cellRenderer: () => "rendered",
        },
      ]),
      undefined,
    );
    adapter.replace(transport.viewport, { ...query, generation: 1 }, visibleSymbol);

    expect(transport.replace).toHaveBeenCalledTimes(1);
    expect(transport.release).not.toHaveBeenCalled();

    adapter.replace(
      transport.viewport,
      { ...query, generation: 2 },
      {
        routeBy: undefined,
        externalFilters: undefined,
        visibleColumnIds: ["COL_ID_SYMBOL", "COL_ID_DERIVED"],
      },
    );
    expect(transport.replace).toHaveBeenCalledTimes(2);
    expect(transport.release).toHaveBeenCalledTimes(1);
    expect(transport.getRequest()?.query).toMatchObject({ select: completeRawSelect });
  });

  it("keeps hidden computed and raw-row presentation dormant during equivalent deliveries", () => {
    const run = (kind: "computed" | "raw-presentation") => {
      const hiddenGetter = vi.fn(() => 1);
      const hiddenColumn =
        kind === "computed"
          ? {
              columnId: "COL_ID_HIDDEN",
              fields: ["price"] as const,
              headerName: "Hidden derived",
              valueType: "number" as const,
              valueGetter: hiddenGetter,
            }
          : {
              columnId: "COL_ID_HIDDEN",
              field: "price" as const,
              headerName: "Hidden raw presentation",
              valueType: "number" as const,
              valueFormatter: () => "formatted",
            };
      const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
        compileColumns([columns[0]!, hiddenColumn]),
        undefined,
        [],
        query.orderBy,
        completeRawSelect,
      );
      const transport = makeViewport();
      adapter.reconcileSource({
        viewport: transport.viewport,
        completeRawSelect,
        totalRows: 1,
        version: 1,
        status: "ready",
      });
      adapter.replace(transport.viewport, query, {
        routeBy: undefined,
        externalFilters: undefined,
        visibleColumnIds: ["COL_ID_SYMBOL"],
      });
      const stable = { symbol: "AAPL", price: 1 } as const;
      transport.getRequest()!.sink.setRowData({ 0: stable }, { 0: "row-a" });
      const publish = vi.fn();
      adapter.subscribePublication(publish);
      hiddenGetter.mockClear();

      transport.getRequest()!.sink.setRowData({ 0: { symbol: "AAPL", price: 1 } }, { 0: "row-a" });

      expect(hiddenGetter).not.toHaveBeenCalled();
      expect(adapter.getPublication().rowSpace?.getRow("row-a")).toBe(stable);
      expect(publish).not.toHaveBeenCalled();
    };

    run("computed");
    run("raw-presentation");
  });

  it("uses the shared Quick Filter field admission policy", () => {
    expect(
      () =>
        new BrunoTableServerRowPipelineAdapter<Row>(
          columns,
          ["symbol", "symbol"],
          [],
          query.orderBy,
        ),
    ).not.toThrow();
    expect(
      () => new BrunoTableServerRowPipelineAdapter<Row>(columns, [""], [], query.orderBy),
    ).toThrow("non-empty source fields");
    expect(
      () =>
        new BrunoTableServerRowPipelineAdapter<Row>(
          columns,
          Array.from({ length: 257 }, () => "symbol"),
          [],
          query.orderBy,
        ),
    ).toThrow("between 1 and 256 fields");
  });

  it("retains moved row references through compiled exact BigDecimal semantics", () => {
    type ExactRow = Readonly<{
      readonly symbol: string;
      readonly amount: BigDecimal.BigDecimal;
      readonly desk: string;
    }>;
    const exactDefinitions = [
      {
        columnId: "COL_ID_SYMBOL",
        field: "symbol",
        headerName: "Symbol",
        valueType: "text",
      },
      BrunoTableBigDecimalColumn({
        columnId: "COL_ID_AMOUNT",
        field: "amount",
        headerName: "Amount",
      }),
    ] satisfies BrunoTableColumns<ExactRow>;
    const exactColumns = compileColumns(exactDefinitions);
    const transport = makeViewport();
    const adapter = new BrunoTableServerRowPipelineAdapter<ExactRow>(
      exactColumns,
      undefined,
      [],
      query.orderBy,
    );
    adapter.reconcileSource({
      viewport: transport.viewport,
      completeRawSelect: ["symbol", "amount"],
      totalRows: 100,
      version: 1,
      status: "ready",
    });
    adapter.replace(transport.viewport, query);
    const sink = transport.getRequest()!.sink as unknown as Readonly<{
      readonly setRowData: (
        rows: Readonly<Record<number, ExactRow>>,
        keys: Readonly<Record<number, string>>,
      ) => void;
    }>;
    const stable = {
      symbol: "AAPL",
      amount: BigDecimal.fromStringUnsafe("1.50"),
      desk: "LDN",
    } as const;
    sink.setRowData({ 0: stable }, { 0: "row-a" });
    sink.setRowData(
      { 1: { symbol: "AAPL", amount: BigDecimal.fromStringUnsafe("1.5"), desk: "LDN" } },
      { 1: "row-a" },
    );
    expect(adapter.getPublication().rowSpace?.getRow("row-a")).toBe(stable);
    expect(adapter.findRowIndex("row-a")).toBe(1);

    sink.setRowData(
      { 1: { symbol: "AAPL", amount: BigDecimal.fromStringUnsafe("1.5"), desk: "NYC" } },
      { 1: "row-a" },
    );
    expect(adapter.getPublication().rowSpace?.getRow("row-a")).toMatchObject({ desk: "NYC" });
    expect(adapter.getPublication().rowSpace?.getRow("row-a")).not.toBe(stable);
  });

  it("distinguishes delimiter-bearing projection field tuples", () => {
    const transport = makeViewport();
    const first = compileColumns([
      columns[0],
      {
        columnId: "COL_ID_COMPUTED",
        fields: ["a\u001fb"],
        headerName: "Computed",
        valueType: "text",
        valueGetter: () => "",
      },
    ]);
    const second = compileColumns([
      columns[0],
      {
        columnId: "COL_ID_COMPUTED",
        fields: ["a", "b"],
        headerName: "Computed",
        valueType: "text",
        valueGetter: () => "",
      },
    ]);
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      first,
      undefined,
      [],
      query.orderBy,
    );
    adapter.replace(transport.viewport, query);
    adapter.reconcileColumns(second, undefined);
    adapter.replace(transport.viewport, query);
    expect(transport.replace).toHaveBeenCalledTimes(2);
    expect(transport.release).toHaveBeenCalledTimes(1);
  });
});
