import { describe, expect, it, vi } from "vitest";

import { compileColumns } from "./compile-columns";
import { BrunoTableClientRuntime } from "./grid-runtime";

type Row = { readonly id: string; readonly name: string };

const source = (
  rows: readonly Row[],
  status: "loading" | "ready" | "stale" | "closed" | "error" = "ready",
  extra: Partial<{
    readonly totalRows: number;
    readonly message: string;
    readonly retry: { readonly run: () => void; readonly pending: boolean };
  }> = {},
) => ({
  rows,
  totalRows: extra.totalRows ?? rows.length,
  version: 1,
  status,
  ...(extra.message === undefined ? {} : { message: extra.message }),
  ...(extra.retry === undefined ? {} : { retry: extra.retry }),
});

const runtimeColumns = compileColumns([
  {
    columnId: "COL_ID_NAME",
    field: "name",
    headerName: "Name",
    valueType: "text",
  },
]);

const createRuntime = (
  initialSource: ReturnType<typeof source>,
  getRowId: (row: Row) => string = (row) => row.id,
) =>
  new BrunoTableClientRuntime(initialSource, getRowId, runtimeColumns, undefined, [
    { columnId: "COL_ID_NAME", direction: "asc" },
  ]);

describe("BrunoTableClientRuntime", () => {
  it("publishes immutable snapshots and isolates changed row subscribers", () => {
    const first = { id: "first", name: "Ada" } satisfies Row;
    const second = { id: "second", name: "Grace" } satisfies Row;
    const runtime = createRuntime(source([first, second]));
    const bodyListener = vi.fn();
    const chromeListener = vi.fn();
    const rowsListener = vi.fn();
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    runtime.subscribeBody(bodyListener);
    runtime.subscribeChrome(chromeListener);
    runtime.subscribeRows(rowsListener);
    runtime.subscribeRow("first", firstListener);
    runtime.subscribeRow("second", secondListener);

    const nextSecond = { id: "second", name: "Grace Hopper" } satisfies Row;
    runtime.publish(source([first, nextSecond]));

    expect(bodyListener).not.toHaveBeenCalled();
    expect(chromeListener).not.toHaveBeenCalled();
    expect(rowsListener).toHaveBeenCalledOnce();
    expect(firstListener).not.toHaveBeenCalled();
    expect(secondListener).toHaveBeenCalledOnce();
    expect(runtime.getBodySnapshot().kind).toBe("rows");
    expect(Object.isFrozen(runtime.getBodySnapshot())).toBe(true);
    expect(runtime.getView()).toBe(runtime.getView());
  });

  it("reuses row collections when a source publishes the same row references", () => {
    const rows = [{ id: "first", name: "Ada" }] satisfies readonly Row[];
    const runtime = createRuntime(source(rows));
    const bodyListener = vi.fn();
    runtime.subscribeBody(bodyListener);
    const firstSnapshot = runtime.getBodySnapshot();

    runtime.publish(source(Array.from(rows)));

    expect(bodyListener).not.toHaveBeenCalled();
    expect(runtime.getBodySnapshot()).toBe(firstSnapshot);
  });

  it("keeps unchanged row subscriptions quiet when the identity callback is recreated", () => {
    const first = { id: "first", name: "Ada" } satisfies Row;
    const second = { id: "second", name: "Grace" } satisfies Row;
    const runtime = createRuntime(source([first, second]));
    const bodyListener = vi.fn();
    const firstListener = vi.fn();
    runtime.subscribeBody(bodyListener);
    runtime.subscribeRow("first", firstListener);
    const firstSnapshot = runtime.getRowSnapshot("first");

    runtime.configure((row) => row.id, runtimeColumns);

    expect(bodyListener).not.toHaveBeenCalled();
    expect(firstListener).not.toHaveBeenCalled();
    expect(runtime.getRowSnapshot("first")).toBe(firstSnapshot);
  });

  it("rejects incomplete ready and stale source snapshots visibly", () => {
    const row = { id: "first", name: "Ada" } satisfies Row;
    const runtime = createRuntime(source([row]));

    runtime.publish(source([], "ready", { totalRows: 1 }));
    expect(runtime.getChromeSnapshot()).toMatchObject({ incomplete: true, receivedRows: 0 });
    expect(runtime.getBodySnapshot().kind).toBe("invalid");

    runtime.publish(source([], "stale", { totalRows: 1 }));
    expect(runtime.getChromeSnapshot()).toMatchObject({ incomplete: true });
    expect(runtime.getBodySnapshot().kind).toBe("invalid");
  });

  it("retains the last coherent rows under an incomplete stale publication", () => {
    const row = { id: "first", name: "Ada" } satisfies Row;
    const runtime = createRuntime(source([row]));

    runtime.publish(source([], "stale", { totalRows: 1, message: "delayed partial" }));

    expect(runtime.getChromeSnapshot()).toMatchObject({
      status: "stale",
      incomplete: true,
      hasCoherentRows: true,
    });
    expect(runtime.getBodySnapshot()).toMatchObject({ kind: "rows", rowIds: ["first"] });
    expect(runtime.getRowSnapshot("first")).toBe(row);
  });

  it("owns live non-empty sorting and reversible initial filter commands", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
      {
        columnId: "COL_ID_ALIAS",
        field: "name",
        headerName: "Alias",
        valueType: "text",
      },
    ]);
    const runtime = new BrunoTableClientRuntime(
      source([{ id: "first", name: "Ada" }]),
      (row) => row.id,
      columns,
      [{ columnId: "COL_ID_NAME", type: "equals", filter: "Ada" }],
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const queryListener = vi.fn();
    const nameListener = vi.fn();
    const aliasListener = vi.fn();
    runtime.subscribeQuery(queryListener);
    runtime.subscribeColumnCommands("COL_ID_NAME", nameListener);
    runtime.subscribeColumnCommands("COL_ID_ALIAS", aliasListener);

    runtime.toggleColumnSort("COL_ID_NAME", false);
    expect(runtime.getQuerySnapshot().orderBy).toEqual([
      { columnId: "COL_ID_NAME", direction: "desc" },
    ]);
    expect(nameListener).toHaveBeenCalledOnce();
    expect(aliasListener).not.toHaveBeenCalled();

    runtime.clearColumnFilters("COL_ID_NAME");
    expect(runtime.getQuerySnapshot().filters).toEqual([]);
    expect(runtime.getColumnCommandSnapshot("COL_ID_NAME")).toMatchObject({
      filterActive: false,
      filterBaselineAvailable: true,
    });

    runtime.resetColumnFilters("COL_ID_NAME");
    expect(runtime.getQuerySnapshot().filters).toHaveLength(1);
    expect(runtime.getColumnCommandSnapshot("COL_ID_NAME").filterActive).toBe(true);
    expect(runtime.getQuerySnapshot().generation).toBe(3);
    expect(queryListener).toHaveBeenCalledTimes(3);
  });

  it("does not retain mutable caller-owned order entries in query snapshots", () => {
    const mutableOrderBy = [{ columnId: "COL_ID_NAME", direction: "asc" as "asc" | "desc" }];
    const runtime = new BrunoTableClientRuntime(
      source([{ id: "first", name: "Ada" }]),
      (row) => row.id,
      runtimeColumns,
      undefined,
      mutableOrderBy,
    );

    mutableOrderBy[0]!.direction = "desc";

    expect(runtime.getQuerySnapshot().orderBy).toEqual([
      { columnId: "COL_ID_NAME", direction: "asc" },
    ]);
    expect(Object.isFrozen(runtime.getQuerySnapshot().orderBy[0])).toBe(true);

    runtime.toggleColumnSort("COL_ID_NAME", false);
    expect(Object.isFrozen(runtime.getQuerySnapshot().orderBy[0])).toBe(true);
  });

  it("re-sanitizes owned query state when column definitions are replaced", () => {
    const row = { id: "first", name: "Ada" } satisfies Row;
    const runtime = new BrunoTableClientRuntime(
      source([row]),
      (value) => value.id,
      runtimeColumns,
      [{ columnId: "COL_ID_NAME", type: "equals", filter: "Ada" }],
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const replacementColumns = compileColumns([
      {
        columnId: "COL_ID_ALIAS",
        field: "name",
        headerName: "Alias",
        valueType: "text",
      },
    ]);

    runtime.configure((value) => value.id, replacementColumns);

    expect(runtime.getQuerySnapshot()).toEqual({
      filters: [],
      orderBy: [{ columnId: "COL_ID_ALIAS", direction: "asc" }],
      generation: 1,
    });
  });

  it("retains coherent rows for terminal lifecycle states and delegates only explicit retry", () => {
    const row = { id: "first", name: "Ada" } satisfies Row;
    const run = vi.fn();
    const retry = { run, pending: false };
    const runtime = createRuntime(source([row]));

    runtime.publish(source([row], "closed", { message: "socket ended", retry }));
    expect(runtime.getBodySnapshot().kind).toBe("rows");
    expect(runtime.getChromeSnapshot()).toMatchObject({
      status: "closed",
      hasCoherentRows: true,
    });
    runtime.retry();
    expect(run).toHaveBeenCalledOnce();

    retry.pending = true;
    runtime.retry();
    expect(run).toHaveBeenCalledTimes(2);

    runtime.publish(source([], "error", { totalRows: 1, retry: { run, pending: true } }));
    expect(runtime.getBodySnapshot().kind).toBe("rows");
    runtime.retry();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("retains prior coherent rows when a complete terminal publication is empty", () => {
    const row = { id: "first", name: "Ada" } satisfies Row;
    const runtime = createRuntime(source([row]));

    runtime.publish(source([], "error", { totalRows: 0, message: "connection lost" }));

    expect(runtime.getChromeSnapshot()).toMatchObject({
      status: "error",
      hasCoherentRows: true,
    });
    expect(runtime.getBodySnapshot()).toMatchObject({ kind: "rows", rowIds: ["first"] });
    expect(runtime.getRowSnapshot("first")).toBe(row);
  });

  it("uses a terminal Empty projection when no coherent rows exist", () => {
    const run = vi.fn();
    const runtime = createRuntime(source([], "error", { retry: { run, pending: false } }));

    expect(runtime.getBodySnapshot()).toMatchObject({
      kind: "empty",
      emptyTitle: "Live data error",
      destructive: true,
      retry: { pending: false },
    });
  });
});
