import { describe, expect, it, vi } from "vitest";
import * as BigDecimal from "effect/BigDecimal";

import { compileColumns } from "./compile-columns";
import { BrunoTableServerRowPipelineAdapter } from "./server-source-adapter";
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
  filters: Object.freeze([]),
  quickFilter: "",
  orderBy: Object.freeze([{ columnId: "COL_ID_SYMBOL", direction: "asc" as const }]),
});

function makeViewport() {
  let request:
    | Readonly<{
        readonly query: unknown;
        readonly window: Readonly<{ readonly firstRow: number; readonly lastRow: number }>;
        readonly sink: Readonly<{
          readonly setRowCount: (count: number, keepRenderedRows?: boolean) => void;
          readonly setRowData: (
            rows: Readonly<Record<number, Row>>,
            keys: Readonly<Record<number, string>>,
          ) => void;
        }>;
      }>
    | undefined;
  const setWindow = vi.fn();
  const release = vi.fn();
  const replace = vi.fn((next: NonNullable<typeof request>) => {
    request = next;
    return { setWindow, release };
  });
  return { viewport: { replace }, replace, setWindow, release, getRequest: () => request };
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
    adapter.setRequiredRange(10, 30);
    expect(transport.setWindow).toHaveBeenCalledTimes(1);
    expect(transport.setWindow).toHaveBeenLastCalledWith({ firstRow: 10, lastRow: 29 });
    expect(transport.replace).toHaveBeenCalledTimes(1);
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
      totalRows: 200,
      version: 2,
      status: "ready",
    });
    expect(observed).toEqual([{ version: 2 }]);
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

  it("replaces only when the normalized source projection changes", () => {
    const transport = makeViewport();
    const adapter = new BrunoTableServerRowPipelineAdapter<Row>(
      columns,
      undefined,
      [],
      query.orderBy,
    );
    adapter.replace(transport.viewport, query);

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
    );
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
    );
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
    );
    adapter.replace(transport.viewport, query);
    expect(transport.replace).toHaveBeenCalledTimes(2);
    expect(transport.release).toHaveBeenCalledTimes(1);
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
    );
    adapter.replace(transport.viewport, {
      ...query,
      generation: 1,
      filters: [{ columnId: "COL_ID_SYMBOL_PRIMARY", type: "startsWith", filter: "A" }],
      orderBy: [{ columnId: "COL_ID_SYMBOL_PRIMARY", direction: "asc" }],
    });
    adapter.reconcileColumns(equivalentColumns.toReversed());
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
    adapter.reconcileColumns(second);
    adapter.replace(transport.viewport, query);
    expect(transport.replace).toHaveBeenCalledTimes(2);
    expect(transport.release).toHaveBeenCalledTimes(1);
  });
});
