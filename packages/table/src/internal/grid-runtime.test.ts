import { describe, expect, it, vi } from "vitest";

import { compileColumns } from "./compile-columns";
import { BrunoTableClientRuntime } from "./grid-runtime";

type Row = { readonly id: string; readonly name: string; readonly note?: string };

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
    const rowsStore = runtime.createRowsStore(() => true);
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    runtime.subscribeBody(bodyListener);
    runtime.subscribeChrome(chromeListener);
    rowsStore.subscribe(rowsListener);
    runtime.subscribeRow("first", firstListener);
    runtime.subscribeRow("second", secondListener);
    const bodySnapshot = runtime.getBodySnapshot();

    const nextSecond = { id: "second", name: "Grace Hopper" } satisfies Row;
    runtime.publish(source([first, nextSecond]));

    expect(bodyListener).not.toHaveBeenCalled();
    expect(chromeListener).not.toHaveBeenCalled();
    expect(rowsListener).toHaveBeenCalledOnce();
    expect(firstListener).not.toHaveBeenCalled();
    expect(secondListener).toHaveBeenCalledOnce();
    expect(runtime.getBodySnapshot()).toBe(bodySnapshot);
    expect(runtime.getBodySnapshot()).toEqual({ kind: "rows" });
    expect(rowsStore.getSnapshot()).toEqual([first, nextSecond]);
    expect(Object.isFrozen(runtime.getBodySnapshot())).toBe(true);
    expect(runtime.getView()).toBe(runtime.getView());
  });

  it("advances a derived row-order snapshot only with its notification", () => {
    const first = { id: "first", name: "Ada" } satisfies Row;
    const second = { id: "second", name: "Grace" } satisfies Row;
    const runtime = createRuntime(source([first, second]));
    const changes: unknown[] = [];
    const rowsStore = runtime.createRowsStore((previousRows, nextRows, change) => {
      changes.push(change);
      if (change.rowIdsChanged) return true;
      return change.changedIndexes.some(
        (index) =>
          (previousRows[index] as Row | undefined)?.name !==
          (nextRows[index] as Row | undefined)?.name,
      );
    });
    const listener = vi.fn();
    rowsStore.subscribe(listener);
    const initialSnapshot = rowsStore.getSnapshot();
    const unrelatedUpdate = { id: "second", name: "Grace", note: "updated" } satisfies Row;

    runtime.publish(source([first, unrelatedUpdate]));

    expect(listener).not.toHaveBeenCalled();
    expect(rowsStore.getSnapshot()).toBe(initialSnapshot);
    expect(changes).toEqual([{ rowIdsChanged: false, changedIndexes: [1] }]);

    const orderingUpdate = { ...unrelatedUpdate, name: "Hopper" } satisfies Row;
    runtime.publish(source([first, orderingUpdate]));

    expect(listener).toHaveBeenCalledOnce();
    expect(rowsStore.getSnapshot()).toEqual([first, orderingUpdate]);
    expect(changes).toEqual([
      { rowIdsChanged: false, changedIndexes: [1] },
      { rowIdsChanged: false, changedIndexes: [1] },
    ]);
  });

  it("retains and silences unchanged column-command snapshots", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
      {
        columnId: "COL_ID_NOTE",
        field: "note",
        headerName: "Note",
        valueType: "text",
      },
    ]);
    const runtime = new BrunoTableClientRuntime(
      source([{ id: "first", name: "Ada", note: "math" }]),
      (row) => row.id,
      columns,
      undefined,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const unchangedListener = vi.fn();
    const previous = runtime.getColumnCommandSnapshot("COL_ID_NOTE");
    runtime.subscribeColumnCommands("COL_ID_NOTE", unchangedListener);

    runtime.toggleColumnSort("COL_ID_NAME", false);

    expect(runtime.getColumnCommandSnapshot("COL_ID_NOTE")).toBe(previous);
    expect(unchangedListener).not.toHaveBeenCalled();
  });

  it("keeps unsubscribe functions idempotent after a subscription key is reused", () => {
    const first = { id: "first", name: "Ada" } satisfies Row;
    const runtime = createRuntime(source([first]));
    const staleRowListener = vi.fn();
    const liveRowListener = vi.fn();
    const staleCommandListener = vi.fn();
    const liveCommandListener = vi.fn();

    const unsubscribeRow = runtime.subscribeRow("first", staleRowListener);
    unsubscribeRow();
    runtime.subscribeRow("first", liveRowListener);
    unsubscribeRow();

    const unsubscribeCommand = runtime.subscribeColumnCommands("COL_ID_NAME", staleCommandListener);
    unsubscribeCommand();
    runtime.subscribeColumnCommands("COL_ID_NAME", liveCommandListener);
    unsubscribeCommand();

    runtime.publish(source([{ id: "first", name: "Ada Lovelace" }]));
    runtime.toggleColumnSort("COL_ID_NAME", false);

    expect(staleRowListener).not.toHaveBeenCalled();
    expect(liveRowListener).toHaveBeenCalledOnce();
    expect(staleCommandListener).not.toHaveBeenCalled();
    expect(liveCommandListener).toHaveBeenCalledOnce();
  });

  it("notifies every listener in one channel before rethrowing the first listener error", () => {
    const runtime = createRuntime(source([{ id: "first", name: "Ada" }]));
    const laterListener = vi.fn();
    runtime.subscribeChrome(() => {
      throw new Error("listener failed");
    });
    runtime.subscribeChrome(laterListener);

    expect(() => runtime.publish(source([], "loading"))).toThrow("listener failed");
    expect(laterListener).toHaveBeenCalledOnce();
    expect(runtime.getChromeSnapshot().status).toBe("loading");
  });

  it("finishes state and query notifications before rethrowing a listener error", () => {
    const runtime = createRuntime(source([{ id: "first", name: "Ada" }]));
    const replacementColumns = compileColumns([
      {
        columnId: "COL_ID_ALIAS",
        field: "name",
        headerName: "Alias",
        valueType: "text",
      },
    ]);
    const bodyListener = vi.fn();
    const queryListener = vi.fn();
    const aliasCommandListener = vi.fn();
    runtime.subscribeChrome(() => {
      throw new Error("chrome failed");
    });
    runtime.subscribeBody(bodyListener);
    runtime.subscribeQuery(queryListener);
    runtime.subscribeColumnCommands("COL_ID_ALIAS", aliasCommandListener);

    expect(() =>
      runtime.reconcile(
        source([], "loading", { totalRows: 1 }),
        (row) => row.id,
        replacementColumns,
      ),
    ).toThrow("chrome failed");

    expect(bodyListener).toHaveBeenCalledOnce();
    expect(queryListener).toHaveBeenCalledOnce();
    expect(aliasCommandListener).toHaveBeenCalledOnce();
    expect(runtime.getQuerySnapshot()).toMatchObject({
      orderBy: [{ columnId: "COL_ID_ALIAS", direction: "asc" }],
      generation: 1,
    });
  });

  it("finishes row and query notifications when a row-order detector throws", () => {
    const runtime = createRuntime(source([{ id: "first", name: "Ada" }]));
    const replacementColumns = compileColumns([
      {
        columnId: "COL_ID_ALIAS",
        field: "name",
        headerName: "Alias",
        valueType: "text",
      },
    ]);
    const throwingRowsListener = vi.fn();
    const laterRowsListener = vi.fn();
    const changedRowListener = vi.fn();
    const queryListener = vi.fn();
    const aliasCommandListener = vi.fn();
    const throwingRowsStore = runtime.createRowsStore(() => {
      throw new Error("detector failed");
    });
    const laterRowsStore = runtime.createRowsStore(() => true);
    throwingRowsStore.subscribe(throwingRowsListener);
    laterRowsStore.subscribe(laterRowsListener);
    runtime.subscribeRow("first", changedRowListener);
    runtime.subscribeQuery(queryListener);
    runtime.subscribeColumnCommands("COL_ID_ALIAS", aliasCommandListener);

    expect(() =>
      runtime.reconcile(
        source([{ id: "first", name: "Ada Lovelace" }]),
        (row) => row.id,
        replacementColumns,
      ),
    ).toThrow("detector failed");

    expect(throwingRowsListener).toHaveBeenCalledOnce();
    expect(laterRowsListener).toHaveBeenCalledOnce();
    expect(changedRowListener).toHaveBeenCalledOnce();
    expect(queryListener).toHaveBeenCalledOnce();
    expect(aliasCommandListener).toHaveBeenCalledOnce();
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

  it("reconciles a new source and identity callback in one row pass", () => {
    const runtime = createRuntime(source([{ id: "initial", name: "Initial" }]));
    const nextRows = [
      { id: "first", name: "Ada" },
      { id: "second", name: "Grace" },
    ] satisfies readonly Row[];
    const getRowId = vi.fn((row: Row) => row.id);

    runtime.reconcile(source(nextRows), getRowId, runtimeColumns);

    expect(getRowId).toHaveBeenCalledTimes(nextRows.length);
    expect(runtime.getBodySnapshot()).toEqual({ kind: "rows" });
    const rowsStore = runtime.createRowsStore(() => true);
    expect(rowsStore.getSnapshot()).toEqual(nextRows);
  });

  it("notifies simultaneous source, identity, and column replacement as one coherent state", () => {
    const runtime = createRuntime(source([{ id: "initial", name: "Initial" }]));
    const replacementColumns = compileColumns([
      {
        columnId: "COL_ID_ALIAS",
        field: "name",
        headerName: "Alias",
        valueType: "text",
      },
    ]);
    const nextRow = { id: "next", name: "Ada" } satisfies Row;
    const observations: unknown[] = [];
    runtime.subscribeQuery(() => {
      observations.push({
        body: runtime.getBodySnapshot(),
        query: runtime.getQuerySnapshot(),
        resolvedRowId: runtime.resolveRowId(nextRow),
        row: runtime.getRowSnapshot("next:next"),
      });
    });

    runtime.reconcile(source([nextRow]), (row) => `next:${row.id}`, replacementColumns);

    expect(observations).toEqual([
      {
        body: { kind: "rows" },
        query: {
          filters: [],
          orderBy: [{ columnId: "COL_ID_ALIAS", direction: "asc" }],
          generation: 1,
        },
        resolvedRowId: "next:next",
        row: nextRow,
      },
    ]);
  });

  it("leaves every observable projection unchanged when reconciliation validation fails", () => {
    const runtime = createRuntime(source([{ id: "initial", name: "Initial" }]));
    const replacementColumns = compileColumns([
      {
        columnId: "COL_ID_ALIAS",
        field: "name",
        headerName: "Alias",
        valueType: "text",
      },
    ]);
    const previousBody = runtime.getBodySnapshot();
    const previousChrome = runtime.getChromeSnapshot();
    const previousQuery = runtime.getQuerySnapshot();
    const rowsStore = runtime.createRowsStore(() => true);
    const previousRows = rowsStore.getSnapshot();
    const previousRow = runtime.getRowSnapshot("initial");
    const previousNameCommand = runtime.getColumnCommandSnapshot("COL_ID_NAME");
    const previousAliasCommand = runtime.getColumnCommandSnapshot("COL_ID_ALIAS");
    const chromeListener = vi.fn();
    const queryListener = vi.fn();
    const bodyListener = vi.fn();
    const rowsListener = vi.fn();
    const rowListener = vi.fn();
    const nameCommandListener = vi.fn();
    const aliasCommandListener = vi.fn();
    runtime.subscribeChrome(chromeListener);
    runtime.subscribeQuery(queryListener);
    runtime.subscribeBody(bodyListener);
    rowsStore.subscribe(rowsListener);
    runtime.subscribeRow("initial", rowListener);
    runtime.subscribeColumnCommands("COL_ID_NAME", nameCommandListener);
    runtime.subscribeColumnCommands("COL_ID_ALIAS", aliasCommandListener);

    expect(() =>
      runtime.reconcile(
        source([
          { id: "first", name: "Ada" },
          { id: "second", name: "Grace" },
        ]),
        () => "duplicate",
        replacementColumns,
      ),
    ).toThrow(/duplicate row identity/u);

    expect(runtime.getBodySnapshot()).toBe(previousBody);
    expect(runtime.getChromeSnapshot()).toBe(previousChrome);
    expect(runtime.getQuerySnapshot()).toBe(previousQuery);
    expect(rowsStore.getSnapshot()).toBe(previousRows);
    expect(runtime.getRowSnapshot("initial")).toBe(previousRow);
    expect(runtime.getColumnCommandSnapshot("COL_ID_NAME")).toBe(previousNameCommand);
    expect(runtime.getColumnCommandSnapshot("COL_ID_ALIAS")).toBe(previousAliasCommand);
    expect(runtime.resolveRowId({ id: "still-old", name: "Old getter" })).toBe("still-old");
    expect(chromeListener).not.toHaveBeenCalled();
    expect(queryListener).not.toHaveBeenCalled();
    expect(bodyListener).not.toHaveBeenCalled();
    expect(rowsListener).not.toHaveBeenCalled();
    expect(rowListener).not.toHaveBeenCalled();
    expect(nameCommandListener).not.toHaveBeenCalled();
    expect(aliasCommandListener).not.toHaveBeenCalled();
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
    expect(runtime.getBodySnapshot()).toEqual({ kind: "rows" });
    expect(runtime.getRowSnapshot("first")).toBe(row);
  });

  it("keeps complete authoritative rows visible during loading refreshes", () => {
    const row = { id: "first", name: "Ada" } satisfies Row;
    const runtime = createRuntime(source([], "loading", { totalRows: 1 }));
    const zeroRowLoading = createRuntime(source([], "loading"));

    expect(zeroRowLoading.getBodySnapshot()).toMatchObject({ kind: "loading" });

    runtime.publish(source([row], "loading", { totalRows: 1 }));

    expect(runtime.getBodySnapshot()).toEqual({ kind: "rows" });
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

  it("rejects a sort-free replacement before changing observable state", () => {
    const runtime = createRuntime(source([{ id: "first", name: "Ada" }]));
    const previousQuery = runtime.getQuerySnapshot();
    const previousBody = runtime.getBodySnapshot();
    const sortFreeColumns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
        enableSorting: false,
      },
    ]);
    const queryListener = vi.fn();
    runtime.subscribeQuery(queryListener);

    expect(() => runtime.configure((row) => row.id, sortFreeColumns)).toThrow(
      /requires at least one sortable column/u,
    );

    expect(runtime.getQuerySnapshot()).toBe(previousQuery);
    expect(runtime.getBodySnapshot()).toBe(previousBody);
    expect(queryListener).not.toHaveBeenCalled();
  });

  it("preserves query state across layout-only column replacement", () => {
    const runtime = new BrunoTableClientRuntime(
      source([{ id: "first", name: "Ada" }]),
      (row) => row.id,
      runtimeColumns,
      [{ columnId: "COL_ID_NAME", type: "equals", filter: "Ada" }],
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const previousQuery = runtime.getQuerySnapshot();
    const queryListener = vi.fn();
    runtime.subscribeQuery(queryListener);
    const replacementColumns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Display name",
        valueType: "text",
        width: 240,
      },
    ]);

    runtime.configure((row) => row.id, replacementColumns);

    expect(runtime.getQuerySnapshot()).toBe(previousQuery);
    expect(queryListener).not.toHaveBeenCalled();
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

    // The runtime snapshots source-owned pending state; later caller mutation cannot rewrite it.
    retry.pending = true;
    runtime.retry();
    expect(run).toHaveBeenCalledTimes(2);

    runtime.publish(source([], "error", { totalRows: 1, retry: { run, pending: true } }));
    expect(runtime.getBodySnapshot().kind).toBe("rows");
    runtime.retry();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("invokes source retry with an undefined receiver", () => {
    const receivers: unknown[] = [];
    const run = function (this: void): void {
      receivers.push(this);
    };
    const runtime = createRuntime(source([], "error", { retry: { run, pending: false } }));

    runtime.retry();

    expect(receivers).toEqual([undefined]);
  });

  it("retains prior coherent rows when a complete terminal publication is empty", () => {
    const row = { id: "first", name: "Ada" } satisfies Row;
    const runtime = createRuntime(source([row]));

    runtime.publish(source([], "error", { totalRows: 0, message: "connection lost" }));

    expect(runtime.getChromeSnapshot()).toMatchObject({
      status: "error",
      hasCoherentRows: true,
    });
    expect(runtime.getBodySnapshot()).toEqual({ kind: "rows" });
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
