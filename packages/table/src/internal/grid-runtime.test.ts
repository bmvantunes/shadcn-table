import { describe, expect, it, vi } from "vitest";

import { compileColumns, type CompiledColumn } from "./compile-columns";
import { BrunoTableSelectColumn } from "../column-helpers";
import {
  BrunoTableClientRowPipelineAdapter,
  type BrunoTableClientReconciliationEvent,
  type BrunoTableClientRowOrderChangeDetector,
  installBrunoTableClientReconciliationListener,
  installBrunoTableClientValueCachePruneListener,
} from "./client-source-adapter";
import type { BrunoTableClientAdmittedRow } from "./client-source-adapter";
import { BrunoTableGridRuntime, isBrunoTableInvalidCellValue } from "./grid-runtime";
import { sanitizeClientInitialFilters, sameBrunoTableFilterCollection } from "./grid-query";
import { BRUNO_TABLE_MAX_QUICK_FILTER_LENGTH } from "./quick-filter";
import type { BrunoTableValueType } from "../public-types";

type Row = { readonly id: string; readonly name: string; readonly note?: string };

const source = (
  rows: readonly Row[],
  status: "loading" | "ready" | "stale" | "closed" | "error" = "ready",
  extra: Partial<{
    readonly totalRows: number;
    readonly statusCode: string;
    readonly message: string;
    readonly retry: { readonly run: () => void; readonly pending: boolean };
  }> = {},
) => ({
  rows,
  totalRows: extra.totalRows ?? rows.length,
  version: 1,
  status,
  ...(extra.statusCode === undefined ? {} : { statusCode: extra.statusCode }),
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

const parserValueType = (acceptsNew: boolean): BrunoTableValueType<string, "text", "text"> => ({
  codecId: "test/filter-parser-cache",
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
  equivalent: (left, right) => left === right,
  compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
  formatCanonicalText: (value) => value,
  parseCanonicalText: (text) =>
    acceptsNew && text === "new"
      ? { _tag: "Success", value: text }
      : { _tag: "Failure", message: "Parser rejected." },
  formatDisplay: (value) => value,
  encodePersisted: (value) => value,
  decodePersisted: (input) =>
    typeof input === "string"
      ? { _tag: "Success", value: input }
      : { _tag: "Failure", message: "Expected persisted text." },
});

const rawRows = (admitted: readonly BrunoTableClientAdmittedRow[]): readonly unknown[] =>
  admitted.map((row) => row.raw);

const createRuntime = (
  initialSource: ReturnType<typeof source>,
  getRowId: (row: Row) => string = (row) => row.id,
) =>
  createClientRuntime(initialSource, getRowId, runtimeColumns, undefined, [
    { columnId: "COL_ID_NAME", direction: "asc" },
  ]);

function createClientRuntime(
  initialSource: ReturnType<typeof source>,
  initialGetRowId: (row: Row) => string,
  columns: readonly CompiledColumn[],
  initialFilters: readonly unknown[] | undefined,
  initialOrderBy: readonly { readonly columnId: string; readonly direction: "asc" | "desc" }[],
) {
  const adapter = new BrunoTableClientRowPipelineAdapter(
    initialSource,
    initialGetRowId,
    columns,
    initialFilters,
    initialOrderBy,
  );
  const runtime = new BrunoTableGridRuntime(
    adapter.getPublication(),
    columns,
    adapter.getQueryConfiguration(columns),
    "TABLE_ID_GRID_RUNTIME_CREATE_CLIENT",
  );
  const view = runtime.getView();
  const acceptCurrentRows = () => {
    const rows = adapter.createRowsStore(view, () => () => true).getSnapshot();
    adapter.acceptRows(rows);
  };
  acceptCurrentRows();
  return Object.freeze({
    ...view,
    getView: runtime.getView,
    resolveRowId: adapter.resolveRowId,
    createRowsStore: (detector: BrunoTableClientRowOrderChangeDetector) =>
      adapter.createRowsStore(view, () => detector),
    publish: (nextSource: ReturnType<typeof source>) => {
      runtime.publish(adapter.publish(nextSource));
      acceptCurrentRows();
    },
    reconcile: (
      nextSource: ReturnType<typeof source>,
      nextGetRowId: (row: Row) => string,
      nextColumns: readonly CompiledColumn[],
    ) => {
      const queryConfiguration = adapter.getQueryConfiguration(nextColumns);
      runtime.reconcile(
        adapter.reconcile(nextSource, nextGetRowId, nextColumns),
        nextColumns,
        queryConfiguration,
      );
      acceptCurrentRows();
    },
    configure: (nextGetRowId: (row: Row) => string, nextColumns: readonly CompiledColumn[]) => {
      const queryConfiguration = adapter.getQueryConfiguration(nextColumns);
      runtime.reconcile(
        adapter.configure(nextGetRowId, nextColumns),
        nextColumns,
        queryConfiguration,
      );
      acceptCurrentRows();
    },
  });
}

describe("BrunoTableGridRuntime sorting invariant", () => {
  it("normalizes an empty baseline when sortable columns are installed", () => {
    const adapter = new BrunoTableClientRowPipelineAdapter(
      source([]),
      (row: Row) => row.id,
      runtimeColumns,
      undefined,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const runtime = new BrunoTableGridRuntime(
      adapter.getPublication(),
      runtimeColumns,
      { baselineFilters: [], baselineOrderBy: [] },
      "TABLE_ID_NON_EMPTY_SORTING",
    );

    expect(runtime.getView().getSortingSnapshot()).toEqual([
      { columnId: "COL_ID_NAME", direction: "asc" },
    ]);
  });
});

describe("BrunoTable filter runtime primitives", () => {
  it("gates every filter command through the optional active editor seam", () => {
    const runtime = createClientRuntime(
      source([{ id: "first", name: "Ada" }]),
      (row) => row.id,
      runtimeColumns,
      [{ columnId: "COL_ID_NAME", type: "contains", filter: "A" }],
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const gate = vi.fn(() => false);
    const unregister = runtime.registerActiveEditorCommitGate(gate);
    const before = runtime.getQuerySnapshot();

    expect(
      runtime.dispatchGridCommand({ type: "column.filter.clear", columnId: "COL_ID_NAME" }),
    ).toBe(false);
    runtime.dispatchGridCommand({ type: "column.filters.clear" });
    runtime.dispatchGridCommand({ type: "column.filter.reset", columnId: "COL_ID_NAME" });
    runtime.dispatchGridCommand({
      type: "column.filter.replace",
      columnId: "COL_ID_NAME",
      filter: { columnId: "COL_ID_NAME", type: "contains", filter: "B" },
    });
    runtime.dispatchGridCommand({ type: "quick-filter.replace", text: "ada" });

    expect(gate).toHaveBeenCalledTimes(5);
    expect(runtime.getQuerySnapshot()).toBe(before);

    unregister();
    runtime.dispatchGridCommand({ type: "quick-filter.replace", text: "ada" });
    expect(runtime.getQuerySnapshot().quickFilter).toBe("ada");
  });

  it("sanitizes Boolean notEqual operands", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_ACTIVE",
        field: "active",
        headerName: "Active",
        valueType: "boolean",
      },
    ]);
    expect(
      sanitizeClientInitialFilters(
        [{ columnId: "COL_ID_ACTIVE", type: "notEqual", filter: true }],
        columns,
      ),
    ).toEqual([{ columnId: "COL_ID_ACTIVE", type: "notEqual", filter: true }]);
  });

  it("defers Boolean and Select in operands to Set Filter semantics", () => {
    const selectColumn = Reflect.apply(BrunoTableSelectColumn, undefined, [
      {
        columnId: "COL_ID_STATUS",
        field: "status",
        headerName: "Status",
        options: ["open", "closed"],
      },
    ]) as Readonly<Record<string, unknown>>;
    const columns = compileColumns([
      {
        columnId: "COL_ID_ACTIVE",
        field: "active",
        headerName: "Active",
        valueType: "boolean",
      },
      selectColumn,
    ]);

    expect(
      sanitizeClientInitialFilters(
        [
          { columnId: "COL_ID_ACTIVE", type: "in", filter: [true] },
          { columnId: "COL_ID_STATUS", type: "in", filter: ["open"] },
        ],
        columns,
      ),
    ).toEqual([]);
  });

  it("does not publish an equivalent text filter when sensitivity defaults are omitted", () => {
    const runtime = createClientRuntime(
      source([{ id: "first", name: "Ada" }]),
      (row) => row.id,
      runtimeColumns,
      [{ columnId: "COL_ID_NAME", type: "equals", filter: "Ada" }],
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const query = runtime.getQuerySnapshot();
    const queryListener = vi.fn();
    runtime.subscribeQuery(queryListener);

    runtime.dispatchGridCommand({
      type: "column.filter.replace",
      columnId: "COL_ID_NAME",
      filter: {
        columnId: "COL_ID_NAME",
        type: "equals",
        filter: "Ada",
        caseSensitive: false,
        accentSensitive: false,
      },
    });

    expect(runtime.getQuerySnapshot()).toBe(query);
    expect(queryListener).not.toHaveBeenCalled();

    runtime.dispatchGridCommand({
      type: "column.filter.replace",
      columnId: "COL_ID_NAME",
      filter: { columnId: "COL_ID_NAME", type: "equals", filter: "ada" },
    });

    expect(runtime.getQuerySnapshot()).toBe(query);
    expect(queryListener).not.toHaveBeenCalled();
  });

  it("compares in operands as an unordered semantic set without duplicate members", () => {
    const runtime = createClientRuntime(
      source([{ id: "first", name: "Ada" }]),
      (row) => row.id,
      runtimeColumns,
      [{ columnId: "COL_ID_NAME", type: "in", filter: ["Ada", "Grace"] }],
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const query = runtime.getQuerySnapshot();
    const queryListener = vi.fn();
    runtime.subscribeQuery(queryListener);

    runtime.dispatchGridCommand({
      type: "column.filter.replace",
      columnId: "COL_ID_NAME",
      filter: { columnId: "COL_ID_NAME", type: "in", filter: ["Grace", "Ada", "Ada"] },
    });

    expect(runtime.getQuerySnapshot()).toBe(query);
    expect(queryListener).not.toHaveBeenCalled();
  });

  it("does not collide when unordered in operands contain delimiters", () => {
    const runtime = createClientRuntime(
      source([{ id: "first", name: "a" }]),
      (row) => row.id,
      runtimeColumns,
      [{ columnId: "COL_ID_NAME", type: "in", filter: ["a", "b,text:c"] }],
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const query = runtime.getQuerySnapshot();
    const queryListener = vi.fn();
    runtime.subscribeQuery(queryListener);

    runtime.dispatchGridCommand({
      type: "column.filter.replace",
      columnId: "COL_ID_NAME",
      filter: { columnId: "COL_ID_NAME", type: "in", filter: ["a,text:b", "c"] },
    });

    expect(runtime.getQuerySnapshot()).not.toBe(query);
    expect(queryListener).toHaveBeenCalledOnce();
  });

  it("compares large text in operands through bounded keyed matching", () => {
    const values = Array.from({ length: 4_096 }, (_, index) => `Name-${String(index)}`);
    const runtime = createClientRuntime(
      source([{ id: "first", name: "Name-0" }]),
      (row) => row.id,
      runtimeColumns,
      [{ columnId: "COL_ID_NAME", type: "in", filter: values }],
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const query = runtime.getQuerySnapshot();
    const queryListener = vi.fn();
    runtime.subscribeQuery(queryListener);

    runtime.dispatchGridCommand({
      type: "column.filter.replace",
      columnId: "COL_ID_NAME",
      filter: { columnId: "COL_ID_NAME", type: "in", filter: [...values].reverse() },
    });

    expect(runtime.getQuerySnapshot()).toBe(query);
    expect(queryListener).not.toHaveBeenCalled();
  });

  it("bounds unordered fallback matching for maximum-size custom roots", () => {
    type OpaqueValue = Readonly<{ readonly id: number }>;
    const equivalent = vi.fn(
      (left: OpaqueValue, right: OpaqueValue): boolean => left.id === right.id,
    );
    const columns = compileColumns([
      {
        columnId: "COL_ID_OPAQUE",
        field: "value",
        headerName: "Opaque",
        valueType: {
          codecId: "test/opaque-filter-comparison",
          codecVersion: 1,
          filterFamily: "equality",
          editorFamily: "text",
          cellAlign: "start",
          editorLayout: "inline",
          defaultWidth: 120,
          decodeRuntime: (input: unknown) =>
            typeof input === "object" && input !== null
              ? { _tag: "Success" as const, value: input as OpaqueValue }
              : { _tag: "Failure" as const, message: "Expected an object." },
          equivalent,
          compare: () => 0,
          formatCanonicalText: (value: OpaqueValue) => String(value.id),
          parseCanonicalText: (text: string) => ({
            _tag: "Success" as const,
            value: Object.freeze({ id: Number(text) }),
          }),
          formatDisplay: (value: OpaqueValue) => String(value.id),
          encodePersisted: (value: OpaqueValue) => value.id,
          decodePersisted: (input: unknown) =>
            typeof input === "number"
              ? { _tag: "Success" as const, value: Object.freeze({ id: input }) }
              : { _tag: "Failure" as const, message: "Expected a number." },
        },
      } as never,
    ]);
    const columnsById = new Map(columns.map((column) => [column.columnId, column]));
    const previous = Array.from({ length: 16_384 }, (_, id) => ({
      columnId: "COL_ID_OPAQUE",
      type: "equals" as const,
      filter: Object.freeze({ id }),
    }));
    const next = [...previous].reverse();

    expect(sameBrunoTableFilterCollection(previous, next, columnsById)).toBe(false);
    expect(equivalent).toHaveBeenCalledTimes(4_097);
  });

  it("replaces a column's implicit root filter collection without wrapping it", () => {
    const runtime = createClientRuntime(
      source([{ id: "first", name: "Name-0" }]),
      (row) => row.id,
      runtimeColumns,
      undefined,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const filters = Array.from({ length: 1_024 }, (_, index) => ({
      columnId: "COL_ID_NAME",
      type: "equals" as const,
      filter: `Name-${String(index)}`,
    }));
    const generation = runtime.getQuerySnapshot().generation;

    runtime.dispatchGridCommand({
      type: "column.filter.replace",
      columnId: "COL_ID_NAME",
      filter: filters,
    });

    expect(runtime.getQuerySnapshot().filters).toHaveLength(filters.length);
    expect(runtime.getQuerySnapshot().generation).toBe(generation + 1);
  });

  it("compares the maximum admitted root through linear semantic keys", () => {
    const filters = Array.from({ length: 16_384 }, (_, index) => ({
      columnId: "COL_ID_NAME",
      type: "equals" as const,
      filter: `Name-${String(index)}`,
    }));
    const runtime = createClientRuntime(
      source([{ id: "first", name: "Name-0" }]),
      (row) => row.id,
      runtimeColumns,
      filters,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const query = runtime.getQuerySnapshot();
    const queryListener = vi.fn();
    runtime.subscribeQuery(queryListener);

    runtime.dispatchGridCommand({
      type: "column.filter.replace",
      columnId: "COL_ID_NAME",
      filter: [...filters].reverse(),
    });

    expect(runtime.getQuerySnapshot()).toBe(query);
    expect(queryListener).not.toHaveBeenCalled();
  });

  it("invalidates filter editor candidates for no-op Clear and Reset commands", () => {
    const runtime = createClientRuntime(
      source([{ id: "first", name: "Ada" }]),
      (row) => row.id,
      runtimeColumns,
      undefined,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const view = runtime.getView();
    const before = view.getColumnFilterCommandEpochSnapshot("COL_ID_NAME");

    view.dispatchGridCommand({ type: "column.filter.clear", columnId: "COL_ID_NAME" });
    expect(view.getColumnFilterCommandEpochSnapshot("COL_ID_NAME")).toBe(before + 1);
    view.dispatchGridCommand({ type: "column.filter.reset", columnId: "COL_ID_NAME" });
    expect(view.getColumnFilterCommandEpochSnapshot("COL_ID_NAME")).toBe(before + 2);
    view.dispatchGridCommand({ type: "column.filters.clear" });
    expect(view.getColumnFilterCommandEpochSnapshot("COL_ID_NAME")).toBe(before + 3);
  });

  it("notifies unaffected open filter editors when Clear All invalidates their candidates", () => {
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
    const runtime = createClientRuntime(
      source([{ id: "first", name: "Ada", note: "first" }]),
      (row) => row.id,
      columns,
      [{ columnId: "COL_ID_NAME", type: "equals", filter: "Ada" }],
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const view = runtime.getView();
    const listener = vi.fn();
    view.subscribeColumnFilterCommandEpoch("COL_ID_NOTE", listener);
    const before = view.getColumnFilterCommandEpochSnapshot("COL_ID_NOTE");

    view.dispatchGridCommand({ type: "column.filters.clear" });

    expect(view.getColumnFilterCommandEpochSnapshot("COL_ID_NOTE")).toBe(before + 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("invalidates only columns whose filter baseline changed during reconciliation", () => {
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
    const baseline = [{ columnId: "COL_ID_NOTE", type: "equals", filter: "first" }] as const;
    const adapter = new BrunoTableClientRowPipelineAdapter(
      source([{ id: "first", name: "Ada", note: "first" }]),
      (row) => row.id,
      columns,
      baseline,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const runtime = new BrunoTableGridRuntime(
      adapter.getPublication(),
      columns,
      adapter.getQueryConfiguration(columns),
      "TABLE_ID_BASELINE_INVALIDATION_SCOPE",
    );
    const view = runtime.getView();
    const nameEpoch = view.getColumnFilterCommandEpochSnapshot("COL_ID_NAME");
    const noteEpoch = view.getColumnFilterCommandEpochSnapshot("COL_ID_NOTE");

    runtime.reconcile(adapter.getPublication(), columns, {
      baselineFilters: [],
      baselineOrderBy: [{ columnId: "COL_ID_NAME", direction: "asc" }],
    });

    expect(view.getColumnFilterCommandEpochSnapshot("COL_ID_NAME")).toBe(nameEpoch);
    expect(view.getColumnFilterCommandEpochSnapshot("COL_ID_NOTE")).toBe(noteEpoch + 1);
  });

  it("bounds Quick Filter text at the command boundary", () => {
    const runtime = createClientRuntime(
      source([{ id: "first", name: "Ada" }]),
      (row) => row.id,
      runtimeColumns,
      undefined,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const view = runtime.getView();
    view.dispatchGridCommand({
      type: "quick-filter.replace",
      text: "x".repeat(BRUNO_TABLE_MAX_QUICK_FILTER_LENGTH + 50),
    });
    expect(view.getQuickFilterSnapshot()).toHaveLength(BRUNO_TABLE_MAX_QUICK_FILTER_LENGTH);
  });

  it("invalidates queued Quick Filter candidates for every replacement command", () => {
    const runtime = createClientRuntime(
      source([{ id: "first", name: "Ada" }]),
      (row) => row.id,
      runtimeColumns,
      undefined,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const view = runtime.getView();
    const before = view.getQuickFilterCommandEpochSnapshot();
    const epochListener = vi.fn();
    view.subscribeQuickFilterCommandEpoch(epochListener);

    view.dispatchGridCommand({ type: "quick-filter.replace", text: "ada" });
    expect(view.getQuickFilterCommandEpochSnapshot()).toBe(before + 1);
    view.dispatchGridCommand({ type: "quick-filter.replace", text: "" });
    expect(view.getQuickFilterCommandEpochSnapshot()).toBe(before + 2);
    expect(epochListener).toHaveBeenCalledTimes(2);
  });

  it("compares scalar array operands through their Value Semantics", () => {
    type Vector = readonly string[];
    type VectorRow = Readonly<{ readonly id: string; readonly vector: Vector }>;
    const vectorValueType: BrunoTableValueType<Vector, "equality", "text"> = {
      codecId: "test/vector",
      codecVersion: 1,
      filterFamily: "equality",
      editorFamily: "text",
      cellAlign: "start",
      editorLayout: "inline",
      defaultWidth: 120,
      decodeRuntime: (input) =>
        Array.isArray(input) && input.every((value) => typeof value === "string")
          ? { _tag: "Success", value: Object.freeze([...input]) }
          : { _tag: "Failure", message: "Expected a string vector." },
      equivalent: (left, right) =>
        left.length === right.length && left.every((value, index) => value === right[index]),
      compare: () => 0,
      formatCanonicalText: (value) => value.join(","),
      parseCanonicalText: (text) => ({ _tag: "Success", value: Object.freeze(text.split(",")) }),
      formatDisplay: (value) => value.join(","),
      encodePersisted: (value) => [...value],
      decodePersisted: (input) =>
        Array.isArray(input) && input.every((value) => typeof value === "string")
          ? { _tag: "Success", value: Object.freeze([...input]) }
          : { _tag: "Failure", message: "Expected a persisted string vector." },
    };
    const columns = compileColumns([
      {
        columnId: "COL_ID_VECTOR",
        field: "vector",
        headerName: "Vector",
        valueType: vectorValueType,
      },
    ]);
    const initialVector = Object.freeze(["a", "b"]);
    const adapter = new BrunoTableClientRowPipelineAdapter<VectorRow>(
      {
        rows: [{ id: "first", vector: initialVector }],
        totalRows: 1,
        version: 1,
        status: "ready",
      },
      (row) => row.id,
      columns,
      [{ columnId: "COL_ID_VECTOR", type: "equals", filter: initialVector }],
      [{ columnId: "COL_ID_VECTOR", direction: "asc" }],
    );
    const runtime = new BrunoTableGridRuntime(
      adapter.getPublication(),
      columns,
      adapter.getQueryConfiguration(columns),
      "TABLE_ID_VECTOR_FILTER_RUNTIME",
    );
    const view = runtime.getView();
    const query = view.getQuerySnapshot();
    const queryListener = vi.fn();
    view.subscribeQuery(queryListener);

    view.dispatchGridCommand({
      type: "column.filter.replace",
      columnId: "COL_ID_VECTOR",
      filter: { columnId: "COL_ID_VECTOR", type: "equals", filter: ["a", "b"] },
    });

    expect(view.getQuerySnapshot()).toBe(query);
    expect(queryListener).not.toHaveBeenCalled();
  });

  it("compares same-column compound conditions as an unordered set", () => {
    const runtime = createClientRuntime(
      source([{ id: "first", name: "Ada" }]),
      (row) => row.id,
      runtimeColumns,
      [
        {
          type: "AND",
          conditions: [
            { columnId: "COL_ID_NAME", type: "equals", filter: "Ada" },
            { columnId: "COL_ID_NAME", type: "contains", filter: "a" },
          ],
        },
      ],
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const query = runtime.getQuerySnapshot();
    const queryListener = vi.fn();
    runtime.subscribeQuery(queryListener);

    runtime.dispatchGridCommand({
      type: "column.filter.replace",
      columnId: "COL_ID_NAME",
      filter: {
        type: "AND",
        conditions: [
          { columnId: "COL_ID_NAME", type: "contains", filter: "A" },
          { columnId: "COL_ID_NAME", type: "equals", filter: "ada" },
        ],
      },
    });

    expect(runtime.getQuerySnapshot()).toBe(query);
    expect(queryListener).not.toHaveBeenCalled();
  });

  it("drops filter versions for columns removed during replacement", () => {
    const runtime = createClientRuntime(
      source([{ id: "first", name: "Ada" }]),
      (row) => row.id,
      runtimeColumns,
      undefined,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    runtime.dispatchGridCommand({
      type: "column.filter.replace",
      columnId: "COL_ID_NAME",
      filter: { columnId: "COL_ID_NAME", type: "equals", filter: "Ada" },
    });
    expect(runtime.getColumnFilterVersionSnapshot("COL_ID_NAME")).toBe(1);
    const view = runtime.getView();
    const epochListener = vi.fn(() => view.getColumnFilterSnapshot("COL_ID_NAME"));
    view.subscribeColumnFilterCommandEpoch("COL_ID_NAME", epochListener);

    const replacementColumns = compileColumns([
      {
        columnId: "COL_ID_ALIAS",
        field: "name",
        headerName: "Alias",
        valueType: "text",
      },
    ]);
    runtime.configure((row) => row.id, replacementColumns);

    expect(runtime.getColumnFilterVersionSnapshot("COL_ID_NAME")).toBe(0);
    expect(epochListener).toHaveBeenCalledOnce();
    expect(epochListener).toHaveReturnedWith(undefined);
  });

  it("publishes one generation for a committed Quick Filter without changing Grid Filters", () => {
    const adapter = new BrunoTableClientRowPipelineAdapter(
      source([{ id: "first", name: "Ada" }]),
      (row) => row.id,
      runtimeColumns,
      [{ columnId: "COL_ID_NAME", type: "equals", filter: "Ada" }],
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
      ["name"],
    );
    const runtime = new BrunoTableGridRuntime(
      adapter.getPublication(),
      runtimeColumns,
      adapter.getQueryConfiguration(runtimeColumns),
      "TABLE_ID_QUICK_FILTER_RUNTIME",
    );
    const view = runtime.getView();
    const queryListener = vi.fn();
    const filterListener = vi.fn();
    const quickFilterListener = vi.fn();
    const filterPositionResetListener = vi.fn();
    const columnFilterListener = vi.fn();
    view.subscribeQuery(queryListener);
    view.subscribeFilter(filterListener);
    view.subscribeQuickFilter(quickFilterListener);
    view.subscribeFilterPositionReset(filterPositionResetListener);
    view.subscribeColumnFilter("COL_ID_NAME", columnFilterListener);
    const before = view.getQuerySnapshot();

    view.dispatchGridCommand({ type: "quick-filter.replace", text: "ada" });

    expect(view.getQuerySnapshot()).toEqual({
      ...before,
      quickFilter: "ada",
      generation: before.generation + 1,
    });
    expect(view.getQuerySnapshot().filters).toBe(before.filters);
    expect(queryListener).toHaveBeenCalledOnce();
    expect(filterListener).toHaveBeenCalledOnce();
    expect(quickFilterListener).toHaveBeenCalledOnce();
    expect(columnFilterListener).not.toHaveBeenCalled();

    const committedGeneration = view.getQuerySnapshot().generation;
    const committedPositionResetEpoch = view.getFilterPositionResetEpochSnapshot();
    queryListener.mockClear();
    filterListener.mockClear();
    quickFilterListener.mockClear();
    view.dispatchGridCommand({ type: "quick-filter.replace", text: "ADA" });
    expect(view.getQuerySnapshot().quickFilter).toBe("ADA");
    expect(view.getQuerySnapshot().generation).toBe(committedGeneration);
    expect(queryListener).not.toHaveBeenCalled();
    expect(filterListener).toHaveBeenCalledOnce();
    expect(quickFilterListener).toHaveBeenCalledOnce();
    expect(view.getFilterPositionResetEpochSnapshot()).toBe(committedPositionResetEpoch + 1);
    expect(filterPositionResetListener).toHaveBeenCalledOnce();

    filterListener.mockClear();
    queryListener.mockClear();
    view.dispatchGridCommand({ type: "column.sort.toggle", columnId: "COL_ID_NAME", multi: false });
    expect(filterListener).not.toHaveBeenCalled();
    expect(queryListener).toHaveBeenCalledOnce();
  });

  it("does not publish a new generation when Reset already matches its baseline", () => {
    const adapter = new BrunoTableClientRowPipelineAdapter(
      source([{ id: "first", name: "Ada" }]),
      (row) => row.id,
      runtimeColumns,
      [{ columnId: "COL_ID_NAME", type: "equals", filter: "Ada" }],
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const runtime = new BrunoTableGridRuntime(
      adapter.getPublication(),
      runtimeColumns,
      adapter.getQueryConfiguration(runtimeColumns),
      "TABLE_ID_FILTER_RESET_NOOP",
    );
    const view = runtime.getView();
    const queryListener = vi.fn();
    view.subscribeQuery(queryListener);
    const before = view.getQuerySnapshot();

    view.resetColumnFilters("COL_ID_NAME");

    expect(view.getQuerySnapshot()).toBe(before);
    expect(queryListener).not.toHaveBeenCalled();
  });

  it("keeps Reset a no-op when another column filter changes root order", () => {
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
    const runtime = createClientRuntime(
      source([{ id: "first", name: "Ada", note: "math" }]),
      (row) => row.id,
      columns,
      [{ columnId: "COL_ID_NAME", type: "equals", filter: "Ada" }],
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    runtime.dispatchGridCommand({
      type: "column.filter.replace",
      columnId: "COL_ID_NOTE",
      filter: { columnId: "COL_ID_NOTE", type: "equals", filter: "math" },
    });
    const query = runtime.getQuerySnapshot();
    const queryListener = vi.fn();
    runtime.subscribeQuery(queryListener);

    runtime.resetColumnFilters("COL_ID_NAME");

    expect(runtime.getQuerySnapshot()).toBe(query);
    expect(queryListener).not.toHaveBeenCalled();
  });

  it("snapshots Quick Filter fields as immutable table configuration", () => {
    const adapter = new BrunoTableClientRowPipelineAdapter(
      source([{ id: "first", name: "Ada" }]),
      (row) => row.id,
      runtimeColumns,
      undefined,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
      ["name"],
    );
    const runtime = new BrunoTableGridRuntime(
      adapter.getPublication(),
      runtimeColumns,
      adapter.getQueryConfiguration(runtimeColumns),
      "TABLE_ID_QUICK_FILTER_FIELDS_RUNTIME",
    );
    const view = runtime.getView();
    const configuration = adapter.getQueryConfiguration(runtimeColumns);
    expect(view.getQuickFilterFieldsSnapshot()).toBe(configuration.quickFilterFields);
    expect(adapter.getQueryConfiguration(runtimeColumns)).toBe(configuration);
  });

  it("rejects sparse Quick Filter field tuples", () => {
    const sparseFields = Array(1) as unknown as readonly string[];

    expect(
      () =>
        new BrunoTableClientRowPipelineAdapter(
          source([{ id: "first", name: "Ada" }]),
          (row) => row.id,
          runtimeColumns,
          undefined,
          [{ columnId: "COL_ID_NAME", direction: "asc" }],
          sparseFields,
        ),
    ).toThrow(TypeError);
  });

  it("captures Quick Filter field length once and bounds hostile field tuples", () => {
    let lengthReads = 0;
    const growingFields = new Proxy(["name"] as readonly string[], {
      get(target, property, receiver) {
        if (property === "length") {
          lengthReads += 1;
          return lengthReads === 1 ? 1 : Number.MAX_SAFE_INTEGER;
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const adapter = new BrunoTableClientRowPipelineAdapter(
      source([{ id: "first", name: "Ada" }]),
      (row) => row.id,
      runtimeColumns,
      undefined,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
      growingFields,
    );

    expect(lengthReads).toBe(1);
    expect(adapter.getQueryConfiguration(runtimeColumns).quickFilterFields).toEqual(["name"]);
    expect(
      () =>
        new BrunoTableClientRowPipelineAdapter(
          source([{ id: "first", name: "Ada" }]),
          (row) => row.id,
          runtimeColumns,
          undefined,
          [{ columnId: "COL_ID_NAME", direction: "asc" }],
          Array.from({ length: 257 }, () => "name"),
        ),
    ).toThrow(/between 1 and 256/);
  });

  it("uses Value Semantics for opaque cyclic filter operands", () => {
    type CyclicOperand = { normalized?: CyclicOperand };
    const createCyclicOperand = (): CyclicOperand => {
      const operand: CyclicOperand = {};
      operand.normalized = operand;
      return operand;
    };
    const columns = compileColumns([
      {
        columnId: "COL_ID_CYCLIC",
        field: "name",
        headerName: "Cyclic",
        valueType: {
          codecId: "test/cyclic",
          codecVersion: 1,
          filterFamily: "equality",
          editorFamily: "text",
          cellAlign: "start",
          editorLayout: "inline",
          defaultWidth: 100,
          decodeRuntime: (input: unknown) =>
            typeof input === "object" && input !== null
              ? { _tag: "Success", value: input as CyclicOperand }
              : { _tag: "Failure", message: "Expected an object." },
          equivalent: (left: unknown, right: unknown) => left === right,
          compare: () => 0,
          formatCanonicalText: () => "cyclic",
          parseCanonicalText: () => ({ _tag: "Failure", message: "Not text." }),
          formatDisplay: () => "cyclic",
          encodePersisted: () => ({ value: "cyclic" }),
          decodePersisted: () => ({ _tag: "Failure", message: "Not persisted." }),
        },
      },
    ]);
    const adapter = new BrunoTableClientRowPipelineAdapter(
      source([{ id: "first", name: "Ada" }]),
      (row) => row.id,
      columns,
      undefined,
      [{ columnId: "COL_ID_CYCLIC", direction: "asc" }],
    );
    const runtime = new BrunoTableGridRuntime(
      adapter.getPublication(),
      columns,
      adapter.getQueryConfiguration(columns),
      "TABLE_ID_CYCLIC_FILTER_RUNTIME",
    );
    const view = runtime.getView();
    const first = createCyclicOperand();
    const second = createCyclicOperand();

    expect(() =>
      view.dispatchGridCommand({
        type: "column.filter.replace",
        columnId: "COL_ID_CYCLIC",
        filter: { columnId: "COL_ID_CYCLIC", type: "equals", filter: first },
      }),
    ).not.toThrow();
    const generation = view.getQuerySnapshot().generation;
    expect(() =>
      view.dispatchGridCommand({
        type: "column.filter.replace",
        columnId: "COL_ID_CYCLIC",
        filter: { columnId: "COL_ID_CYCLIC", type: "equals", filter: second },
      }),
    ).not.toThrow();
    expect(view.getQuerySnapshot().generation).toBe(generation + 1);
  });

  it("rejects invalid filter replacements and preserves semantic no-ops", () => {
    const adapter = new BrunoTableClientRowPipelineAdapter(
      source([{ id: "first", name: "Ada" }]),
      (row) => row.id,
      runtimeColumns,
      [{ columnId: "COL_ID_NAME", type: "equals", filter: "Ada" }],
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const runtime = new BrunoTableGridRuntime(
      adapter.getPublication(),
      runtimeColumns,
      adapter.getQueryConfiguration(runtimeColumns),
      "TABLE_ID_FILTER_REPLACEMENT_GUARDS",
    );
    const view = runtime.getView();
    const queryListener = vi.fn();
    view.subscribeQuery(queryListener);
    const before = view.getQuerySnapshot();

    view.dispatchGridCommand({
      type: "column.filter.replace",
      columnId: "COL_ID_NAME",
      filter: { columnId: "COL_ID_NAME", type: "unsupported", filter: "Ada" },
    });
    expect(view.getQuerySnapshot()).toBe(before);
    expect(queryListener).not.toHaveBeenCalled();

    view.dispatchGridCommand({
      type: "column.filter.replace",
      columnId: "COL_ID_NAME",
      filter: { columnId: "COL_ID_NAME", type: "equals", filter: "Ada" },
    });
    expect(view.getQuerySnapshot()).toBe(before);
    expect(queryListener).not.toHaveBeenCalled();
  });
});

describe("BrunoTable Grid Runtime with Client Row Pipeline Adapter", () => {
  it("constructs a row-order detector only after subscription and reuses it", () => {
    const first = { id: "first", name: "Ada" } satisfies Row;
    const adapter = new BrunoTableClientRowPipelineAdapter(
      source([first]),
      (row) => row.id,
      runtimeColumns,
      undefined,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const runtime = new BrunoTableGridRuntime(
      adapter.getPublication(),
      runtimeColumns,
      adapter.getQueryConfiguration(runtimeColumns),
      "TABLE_ID_GRID_RUNTIME_DETECTOR",
    );
    const detector = vi.fn<BrunoTableClientRowOrderChangeDetector>(() => true);
    const createDetector = vi.fn(() => detector);
    const rowsStore = adapter.createRowsStore(runtime.getView(), createDetector);

    expect(createDetector).not.toHaveBeenCalled();
    const disposeInitial = rowsStore.subscribe(() => undefined);
    expect(createDetector).toHaveBeenCalledOnce();
    disposeInitial();

    const listener = vi.fn();
    const disposeReplacement = rowsStore.subscribe(listener);
    expect(createDetector).toHaveBeenCalledOnce();
    runtime.publish(adapter.publish(source([{ ...first, name: "Ada Lovelace" }])));
    expect(detector).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledOnce();
    disposeReplacement();
  });

  it("accepts a sparse source-neutral logical row space without inventing identities", () => {
    const loaded = { id: "loaded", name: "Ada" } satisfies Row;
    const rowSpace = Object.freeze({
      totalRows: 3,
      loadedRows: 1,
      getRowId: (index: number) => (index === 1 ? "loaded" : undefined),
      getRow: (rowId: string) => (rowId === "loaded" ? loaded : undefined),
      getCellValue: (rowId: string, columnId: string) =>
        rowId === "loaded" && columnId === "COL_ID_NAME" ? loaded.name : undefined,
    });
    const runtime = new BrunoTableGridRuntime(
      Object.freeze({
        status: "loading" as const,
        totalRows: 3,
        version: 1,
        rowSpace,
        hasCoherentRows: true,
      }),
      runtimeColumns,
      Object.freeze({
        baselineFilters: Object.freeze([]),
        baselineOrderBy: Object.freeze([
          Object.freeze({ columnId: "COL_ID_NAME", direction: "asc" as const }),
        ]),
      }),
      "TABLE_ID_GRID_RUNTIME_SPARSE_LOADING",
    );

    expect(runtime.getBodySnapshot()).toEqual({ kind: "rows" });
    expect(runtime.getRowSpaceSnapshot()?.totalRows).toBe(3);
    expect(runtime.getRowSpaceSnapshot()?.getRowId(0)).toBeUndefined();
    expect(runtime.getRowSpaceSnapshot()?.getRowId(1)).toBe("loaded");
    expect(runtime.getRowSnapshot("loaded")).toBe(loaded);
  });

  it("keeps a non-empty sparse row space renderable before any slot loads", () => {
    const runtime = new BrunoTableGridRuntime<Row>(
      Object.freeze({
        status: "loading" as const,
        totalRows: 1_000_000,
        version: 1,
        rowSpace: Object.freeze({
          totalRows: 1_000_000,
          loadedRows: 0,
          getRowId: () => undefined,
          getRow: () => undefined,
          getCellValue: () => undefined,
        }),
        hasCoherentRows: false,
      }),
      runtimeColumns,
      Object.freeze({
        baselineFilters: Object.freeze([]),
        baselineOrderBy: Object.freeze([
          Object.freeze({ columnId: "COL_ID_NAME", direction: "asc" as const }),
        ]),
      }),
      "TABLE_ID_GRID_RUNTIME_SPARSE_EMPTY",
    );

    expect(runtime.getBodySnapshot()).toEqual({ kind: "rows" });
  });

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
    expect(rawRows(rowsStore.getSnapshot())).toEqual([first, nextSecond]);
    expect(Object.isFrozen(runtime.getBodySnapshot())).toBe(true);
    expect(runtime.getView()).toBe(runtime.getView());
  });

  it("observes replacements, insertions, removals, and reorders in a reused source array", () => {
    const first = { id: "first", name: "Ada" } satisfies Row;
    const second = { id: "second", name: "Grace" } satisfies Row;
    const reusedRows: Row[] = [first, second];
    const runtime = createRuntime(source(reusedRows));
    const rowsStore = runtime.createRowsStore(() => true);
    rowsStore.subscribe(() => undefined);

    const replacement = { id: "second", name: "Grace Hopper" } satisfies Row;
    reusedRows[1] = replacement;
    runtime.publish(source(reusedRows));
    expect(rawRows(rowsStore.getSnapshot())).toEqual([first, replacement]);
    expect(runtime.getRowSnapshot("second")).toBe(replacement);

    const third = { id: "third", name: "Katherine" } satisfies Row;
    reusedRows.push(third);
    runtime.publish(source(reusedRows));
    expect(rawRows(rowsStore.getSnapshot())).toEqual([first, replacement, third]);
    expect(runtime.getRowSnapshot("third")).toBe(third);

    reusedRows.reverse();
    runtime.publish(source(reusedRows));
    expect(rawRows(rowsStore.getSnapshot())).toEqual([third, replacement, first]);
    expect(runtime.getRowSpaceSnapshot()?.getRowId(0)).toBe("third");
    expect(runtime.getRowSpaceSnapshot()?.getRowId(2)).toBe("first");

    reusedRows.splice(1, 1);
    runtime.publish(source(reusedRows));
    expect(rawRows(rowsStore.getSnapshot())).toEqual([third, first]);
    expect(runtime.getRowSnapshot("second")).toBeUndefined();
  });

  it("patches only isolated row evidence in a large resident source", () => {
    const residentRows = Array.from({ length: 100_000 }, (_unused, index) => ({
      id: `row-${String(index)}`,
      name: `Name ${String(index)}`,
    })) satisfies readonly Row[];
    const getRowId = vi.fn((row: Row) => row.id);
    const reconciliationEvents: BrunoTableClientReconciliationEvent[] = [];
    const restoreInstrumentation = installBrunoTableClientReconciliationListener((event) => {
      reconciliationEvents.push(event);
    });

    try {
      const runtime = createRuntime(source(residentRows), getRowId);
      const unchanged = runtime.getRowSnapshot("row-99999");
      getRowId.mockClear();
      reconciliationEvents.length = 0;
      const replacement = { id: "row-50000", name: "Changed" } satisfies Row;

      runtime.publish(source(residentRows.with(50_000, replacement)));

      expect(getRowId).toHaveBeenCalledOnce();
      expect(reconciliationEvents).toEqual([
        {
          residentRows: 100_000,
          changedRows: 1,
          resolvedRowIds: 1,
          identityPatches: 1,
          rebuiltSourceSequence: false,
          rebuiltIdentityIndex: false,
        },
      ]);
      expect(runtime.getRowSnapshot("row-50000")).toBe(replacement);
      expect(runtime.getRowSnapshot("row-99999")).toBe(unchanged);
    } finally {
      restoreInstrumentation();
    }
  });

  it("publishes stable per-cell snapshots for unchanged canonical values", () => {
    const cellColumns = compileColumns([
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
    const first = { id: "first", name: "Ada", note: "Initial" } satisfies Row;
    const runtime = createClientRuntime(source([first]), (row) => row.id, cellColumns, undefined, [
      { columnId: "COL_ID_NAME", direction: "asc" },
    ]);
    const nameListener = vi.fn();
    const noteListener = vi.fn();
    runtime.subscribeCell("first", "COL_ID_NAME", nameListener);
    runtime.subscribeCell("first", "COL_ID_NOTE", noteListener);
    const nameSnapshot = runtime.getCellSnapshot("first", "COL_ID_NAME");
    const noteSnapshot = runtime.getCellSnapshot("first", "COL_ID_NOTE");

    runtime.publish(source([{ ...first, note: "Changed" }]));

    expect(nameListener).not.toHaveBeenCalled();
    expect(noteListener).toHaveBeenCalledOnce();
    expect(runtime.getCellSnapshot("first", "COL_ID_NAME")).toBe(nameSnapshot);
    expect(runtime.getCellSnapshot("first", "COL_ID_NOTE")).not.toBe(noteSnapshot);
    expect(runtime.getCellValueSnapshot("first", "COL_ID_NOTE")).toBe("Changed");
  });

  it("preserves cell snapshots for freshly decoded equivalent canonical values", () => {
    const [baseColumn] = runtimeColumns;
    const objectColumns = Object.freeze([
      Object.freeze({
        ...baseColumn!,
        semantics: Object.freeze({
          ...baseColumn!.semantics,
          decodeRuntime: (input: unknown) =>
            typeof input === "string"
              ? ({ _tag: "Success", value: Object.freeze({ text: input }) } as const)
              : ({ _tag: "Failure", message: "Expected text." } as const),
          equivalent: (left: unknown, right: unknown) =>
            (left as { readonly text: string }).text === (right as { readonly text: string }).text,
          compare: (left: unknown, right: unknown) => {
            const leftText = (left as { readonly text: string }).text;
            const rightText = (right as { readonly text: string }).text;
            return leftText === rightText ? 0 : leftText < rightText ? -1 : 1;
          },
          formatDisplay: (value: unknown) => (value as { readonly text: string }).text,
        }),
      }),
    ] satisfies readonly CompiledColumn[]);
    const first = { id: "first", name: "Ada", note: "Initial" } satisfies Row;
    const runtime = createClientRuntime(
      source([first]),
      (row) => row.id,
      objectColumns,
      undefined,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const listener = vi.fn();
    runtime.subscribeCell("first", "COL_ID_NAME", listener);
    const snapshot = runtime.getCellSnapshot("first", "COL_ID_NAME");

    runtime.publish(source([{ ...first, note: "Changed" }]));

    expect(listener).not.toHaveBeenCalled();
    expect(runtime.getCellSnapshot("first", "COL_ID_NAME")).toBe(snapshot);
  });

  it("publishes subscribed nullish cell transitions without invoking value callbacks", () => {
    const cellColumns = compileColumns([
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
    const nullNote = { id: "first", name: "Ada", note: null } as unknown as Row;
    const runtime = createClientRuntime(
      source([nullNote]),
      (row) => row.id,
      cellColumns,
      undefined,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const listener = vi.fn();
    runtime.subscribeCell("first", "COL_ID_NOTE", listener);
    const nullSnapshot = runtime.getCellSnapshot("first", "COL_ID_NOTE");

    runtime.publish(source([{ id: "first", name: "Ada" }]));

    expect(listener).toHaveBeenCalledOnce();
    const undefinedSnapshot = runtime.getCellSnapshot("first", "COL_ID_NOTE");
    expect(undefinedSnapshot).not.toBe(nullSnapshot);
    expect(undefinedSnapshot.value).toBeUndefined();
    listener.mockClear();

    runtime.publish(source([{ id: "first", name: "Ada", note: "Ready" }]));

    expect(listener).toHaveBeenCalledOnce();
    expect(runtime.getCellValueSnapshot("first", "COL_ID_NOTE")).toBe("Ready");
  });

  it("indexes columns before reconciling subscribed cells", () => {
    const indexedColumns = [...runtimeColumns];
    const first = { id: "first", name: "Ada" } satisfies Row;
    const runtime = createClientRuntime(
      source([first]),
      (row) => row.id,
      indexedColumns,
      undefined,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const find = vi.spyOn(indexedColumns, "find");
    const listener = vi.fn();
    runtime.subscribeCell("first", "COL_ID_NAME", listener);
    runtime.getCellSnapshot("first", "COL_ID_NAME");

    runtime.publish(source([{ ...first, name: "Augusta" }]));

    expect(find).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledOnce();
    expect(runtime.getCellValueSnapshot("first", "COL_ID_NAME")).toBe("Augusta");
  });

  it("refreshes abandoned cell reads and bounds pending snapshots", () => {
    const manyRows = Array.from({ length: 4_100 }, (_, index) => ({
      id: `row-${String(index)}`,
      name: `Name ${String(index)}`,
    })) satisfies readonly Row[];
    const runtime = createRuntime(source(manyRows));
    const firstSnapshot = runtime.getCellSnapshot("row-0", "COL_ID_NAME");
    for (let index = 1; index <= 4_096; index += 1) {
      runtime.getCellSnapshot(`row-${String(index)}`, "COL_ID_NAME");
    }

    const rereadAfterEviction = runtime.getCellSnapshot("row-0", "COL_ID_NAME");
    expect(rereadAfterEviction).not.toBe(firstSnapshot);
    expect(rereadAfterEviction.value).toBe("Name 0");

    const changedRows = manyRows.with(0, { id: "row-0", name: "Changed" });
    runtime.publish(source(changedRows));

    const refreshed = runtime.getCellSnapshot("row-0", "COL_ID_NAME");
    expect(refreshed).not.toBe(rereadAfterEviction);
    expect(refreshed.value).toBe("Changed");
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
          (previousRows[index]?.raw as Row | undefined)?.name !==
          (nextRows[index]?.raw as Row | undefined)?.name,
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
    expect(rawRows(rowsStore.getSnapshot())).toEqual([first, orderingUpdate]);
    expect(changes).toEqual([
      { rowIdsChanged: false, changedIndexes: [1] },
      { rowIdsChanged: false, changedIndexes: [1] },
    ]);
  });

  it("releases and resynchronizes derived row stores across idempotent disposal", () => {
    const first = { id: "first", name: "Ada" } satisfies Row;
    const runtime = createRuntime(source([first]));
    const rowsStore = runtime.createRowsStore(() => true);
    const staleListener = vi.fn();
    const unsubscribe = rowsStore.subscribe(staleListener);
    const initialSnapshot = rowsStore.getSnapshot();

    unsubscribe();
    unsubscribe();
    const updated = { id: "first", name: "Ada Lovelace" } satisfies Row;
    runtime.publish(source([updated]));

    expect(staleListener).not.toHaveBeenCalled();
    expect(rowsStore.getSnapshot()).toBe(initialSnapshot);

    const liveListener = vi.fn();
    const disposeLive = rowsStore.subscribe(liveListener);
    expect(rawRows(rowsStore.getSnapshot())).toEqual([updated]);
    const latest = { id: "first", name: "Countess Lovelace" } satisfies Row;
    runtime.publish(source([latest]));
    expect(liveListener).toHaveBeenCalledOnce();
    expect(rawRows(rowsStore.getSnapshot())).toEqual([latest]);
    disposeLive();
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
    const runtime = createClientRuntime(
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
    const getRowId = vi.fn((row: Row) => row.id);
    const runtime = createRuntime(source(rows), getRowId);
    const bodyListener = vi.fn();
    runtime.subscribeBody(bodyListener);
    const firstSnapshot = runtime.getBodySnapshot();
    getRowId.mockClear();

    runtime.publish(source(Array.from(rows)));

    expect(getRowId).not.toHaveBeenCalled();
    expect(bodyListener).not.toHaveBeenCalled();
    expect(runtime.getBodySnapshot()).toBe(firstSnapshot);
  });

  it("keeps unchanged row subscriptions quiet when the identity callback is recreated", () => {
    const first = { id: "first", name: "Ada" } satisfies Row;
    const second = { id: "second", name: "Grace" } satisfies Row;
    const rows = [first, second] as const;
    const runtime = createRuntime(source(rows));
    const bodyListener = vi.fn();
    const firstListener = vi.fn();
    const rowsListener = vi.fn();
    const rowsStore = runtime.createRowsStore((_previous, _next, change) => change.rowIdsChanged);
    runtime.subscribeBody(bodyListener);
    runtime.subscribeRow("first", firstListener);
    rowsStore.subscribe(rowsListener);
    const firstSnapshot = runtime.getRowSnapshot("first");

    const replacementGetRowId = vi.fn((row: Row) => row.id);
    runtime.configure(replacementGetRowId, runtimeColumns);

    expect(bodyListener).not.toHaveBeenCalled();
    expect(firstListener).not.toHaveBeenCalled();
    expect(rowsListener).not.toHaveBeenCalled();
    expect(runtime.getRowSnapshot("first")).toBe(firstSnapshot);
    expect(replacementGetRowId).toHaveBeenCalledTimes(rows.length);

    replacementGetRowId.mockClear();
    runtime.publish(source(Array.from(rows)));
    expect(replacementGetRowId).not.toHaveBeenCalled();
  });

  it("publishes an identity revision when getRowId changes for the same row array", () => {
    const row = { id: "first", name: "Ada" } satisfies Row;
    const rows = [row] as const;
    const runtime = createRuntime(source(rows));
    const rowsStore = runtime.createRowsStore((_previous, _next, change) => change.rowIdsChanged);
    const listener = vi.fn();
    rowsStore.subscribe(listener);
    const previousRows = rowsStore.getSnapshot();

    runtime.configure((value) => `next:${value.id}`, runtimeColumns);

    expect(listener).toHaveBeenCalledOnce();
    expect(rowsStore.getSnapshot()).not.toBe(previousRows);
    expect(rawRows(rowsStore.getSnapshot())).toEqual(rows);
    expect(runtime.getRowSnapshot("first")).toBeUndefined();
    expect(runtime.getRowSnapshot("next:first")).toBe(row);
  });

  it("accepts a unique identity swap when getRowId changes for unchanged rows", () => {
    const first = { id: "first", name: "Ada" } satisfies Row;
    const second = { id: "second", name: "Grace" } satisfies Row;
    const runtime = createRuntime(source([first, second]));
    const rowsStore = runtime.createRowsStore((_previous, _next, change) => change.rowIdsChanged);
    const listener = vi.fn();
    rowsStore.subscribe(listener);

    runtime.configure((row) => (row.id === "first" ? "second" : "first"), runtimeColumns);

    expect(listener).toHaveBeenCalledOnce();
    expect(runtime.getRowSpaceSnapshot()?.getRowId(0)).toBe("second");
    expect(runtime.getRowSpaceSnapshot()?.getRowId(1)).toBe("first");
    expect(runtime.getRowSnapshot("second")).toBe(first);
    expect(runtime.getRowSnapshot("first")).toBe(second);
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
    expect(rawRows(rowsStore.getSnapshot())).toEqual(nextRows);
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
          columns: replacementColumns,
          filters: [],
          quickFilter: "",
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

    const recovered = { id: "recovered", name: "Recovered" } satisfies Row;
    runtime.reconcile(source([recovered]), (row) => row.id, runtimeColumns);
    expect(runtime.getRowSnapshot("initial")).toBeUndefined();
    expect(runtime.getRowSnapshot("recovered")).toBe(recovered);
  });

  it("rejects incomplete ready and stale source snapshots visibly", () => {
    const row = { id: "first", name: "Ada" } satisfies Row;
    const runtime = createRuntime(source([row]));

    runtime.publish(source([], "ready", { totalRows: 1 }));
    expect(runtime.getChromeSnapshot()).toMatchObject({
      invalid: { kind: "row-count-mismatch", expectedRows: 1, receivedRows: 0 },
    });
    expect(runtime.getBodySnapshot().kind).toBe("invalid");

    runtime.publish(source([], "stale", { totalRows: 1 }));
    expect(runtime.getChromeSnapshot()).toMatchObject({
      invalid: { kind: "row-count-mismatch" },
    });
    expect(runtime.getBodySnapshot().kind).toBe("rows");
  });

  it("brands invalid source values for the row model or presentation island to reject", () => {
    type NumberRow = { readonly id: string; readonly name: string; readonly score: number };
    const numberColumns = compileColumns([
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
    ]);
    const invalidRows = [
      { id: "invalid", name: "Invalid", score: Number.NaN },
    ] satisfies readonly NumberRow[];
    const adapter = new BrunoTableClientRowPipelineAdapter(
      {
        rows: invalidRows,
        totalRows: invalidRows.length,
        version: 1,
        status: "ready",
      },
      (row) => row.id,
      numberColumns,
      undefined,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const runtime = new BrunoTableGridRuntime(
      adapter.getPublication(),
      numberColumns,
      adapter.getQueryConfiguration(numberColumns),
      "TABLE_ID_GRID_RUNTIME_INVALID_VALUE",
    );

    const value = runtime.getCellValueSnapshot("invalid", "COL_ID_SCORE");
    expect(isBrunoTableInvalidCellValue(value)).toBe(true);
    if (!isBrunoTableInvalidCellValue(value)) return;
    expect(value.invalid).toEqual({
      kind: "invalid-value",
      rowIndex: 0,
      columnId: "COL_ID_SCORE",
      message: "Expected a finite number value.",
    });
    expect(runtime.getBodySnapshot()).toEqual({ kind: "rows" });
  });

  it("leaves exhaustive query decoding to actual row-model reads", () => {
    const [baseColumn] = runtimeColumns;
    const decodeRuntime = vi.fn(baseColumn!.semantics.decodeRuntime);
    const instrumentedColumns = Object.freeze([
      Object.freeze({
        ...baseColumn!,
        semantics: Object.freeze({ ...baseColumn!.semantics, decodeRuntime }),
      }),
    ] satisfies readonly CompiledColumn[]);
    const initialRows = [
      { id: "first", name: "Ada" },
      { id: "second", name: "Grace" },
    ] satisfies readonly Row[];
    const initialSource = source(initialRows);
    const getRowId = (row: Row) => row.id;
    const adapter = new BrunoTableClientRowPipelineAdapter(
      initialSource,
      getRowId,
      instrumentedColumns,
      undefined,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );

    expect(decodeRuntime).not.toHaveBeenCalled();

    adapter.reconcile(initialSource, getRowId, instrumentedColumns);
    expect(decodeRuntime).not.toHaveBeenCalled();
  });

  it("decodes only changed source rows when column semantics stay installed", () => {
    const [baseColumn] = runtimeColumns;
    const decodeRuntime = vi.fn(baseColumn!.semantics.decodeRuntime);
    const instrumentedColumns = Object.freeze([
      Object.freeze({
        ...baseColumn!,
        semantics: Object.freeze({ ...baseColumn!.semantics, decodeRuntime }),
      }),
    ] satisfies readonly CompiledColumn[]);
    const first = { id: "first", name: "Ada" } satisfies Row;
    const second = { id: "second", name: "Grace" } satisfies Row;
    const adapter = new BrunoTableClientRowPipelineAdapter(
      source([first, second]),
      (row) => row.id,
      instrumentedColumns,
      undefined,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );

    let rowSpace = adapter.getPublication().rowSpace!;
    rowSpace.getCellValue("first", "COL_ID_NAME");
    rowSpace.getCellValue("second", "COL_ID_NAME");
    expect(decodeRuntime).toHaveBeenCalledTimes(2);

    adapter.publish(source([first, second]));
    rowSpace = adapter.getPublication().rowSpace!;
    rowSpace.getCellValue("first", "COL_ID_NAME");
    rowSpace.getCellValue("second", "COL_ID_NAME");
    expect(decodeRuntime).toHaveBeenCalledTimes(2);

    const updatedSecond = { id: "second", name: "Hopper" } satisfies Row;
    adapter.publish(source([first, updatedSecond]));
    rowSpace = adapter.getPublication().rowSpace!;
    rowSpace.getCellValue("first", "COL_ID_NAME");
    rowSpace.getCellValue("second", "COL_ID_NAME");
    expect(decodeRuntime).toHaveBeenCalledTimes(3);

    const replacementColumns = Object.freeze(Array.from(instrumentedColumns));
    adapter.configure((row) => (row as Row).id, replacementColumns);
    rowSpace = adapter.getPublication().rowSpace!;
    rowSpace.getCellValue("first", "COL_ID_NAME");
    rowSpace.getCellValue("second", "COL_ID_NAME");
    expect(decodeRuntime).toHaveBeenCalledTimes(3);

    adapter.publish(source([first, updatedSecond]));
    rowSpace = adapter.getPublication().rowSpace!;
    rowSpace.getCellValue("first", "COL_ID_NAME");
    rowSpace.getCellValue("second", "COL_ID_NAME");
    expect(decodeRuntime).toHaveBeenCalledTimes(3);
  });

  it("reuses canonical values across sustained sparse source publications", () => {
    const [baseColumn] = runtimeColumns;
    const decodeRuntime = vi.fn(baseColumn!.semantics.decodeRuntime);
    const instrumentedColumns = Object.freeze([
      Object.freeze({
        ...baseColumn!,
        semantics: Object.freeze({ ...baseColumn!.semantics, decodeRuntime }),
      }),
    ] satisfies readonly CompiledColumn[]);
    let rows = Array.from({ length: 256 }, (_, index) => ({
      id: `row-${String(index)}`,
      name: `Name ${String(index)}`,
    })) satisfies readonly Row[];
    const adapter = new BrunoTableClientRowPipelineAdapter(
      source(rows),
      (row) => row.id,
      instrumentedColumns,
      undefined,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );

    for (const row of rows) {
      adapter.getPublication().rowSpace?.getCellValue(row.id, "COL_ID_NAME");
    }
    expect(decodeRuntime).toHaveBeenCalledTimes(rows.length);

    for (let publication = 0; publication < 64; publication += 1) {
      const changedIndex = publication % rows.length;
      rows = rows.with(changedIndex, {
        ...rows[changedIndex]!,
        name: `Changed ${String(publication)}`,
      });
      adapter.publish(source(rows));
      for (const row of rows) {
        adapter.getPublication().rowSpace?.getCellValue(row.id, "COL_ID_NAME");
      }
    }

    expect(decodeRuntime).toHaveBeenCalledTimes(256 + 64);
  });

  it("prunes canonical values only when the retained column schema changes", () => {
    const first = { id: "first", name: "Ada" } satisfies Row;
    const second = { id: "second", name: "Grace" } satisfies Row;
    const adapter = new BrunoTableClientRowPipelineAdapter(
      source([first, second]),
      (row) => row.id,
      runtimeColumns,
      undefined,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const rowSpace = adapter.getPublication().rowSpace!;
    rowSpace.getCellValue("first", "COL_ID_NAME");
    rowSpace.getCellValue("second", "COL_ID_NAME");
    const prunes = vi.fn();
    const restore = installBrunoTableClientValueCachePruneListener(prunes);
    try {
      adapter.publish(source([first, { ...second, note: "Changed" }]));
      expect(prunes).not.toHaveBeenCalled();

      const replacementColumns = Object.freeze(
        runtimeColumns.map((column) => Object.freeze({ ...column })),
      );
      adapter.configure((row) => row.id, replacementColumns);
      expect(prunes).toHaveBeenCalledOnce();
      expect(prunes).toHaveBeenCalledWith(2);
    } finally {
      restore();
    }
  });

  it("decodes query columns columnarly and presentation cells on demand", () => {
    const decodeRuntime = vi.fn((input: unknown) => ({ _tag: "Success", value: input }) as const);
    const wideColumns = Object.freeze(
      compileColumns(
        Array.from({ length: 1_000 }, (_, index) => ({
          columnId: `COL_ID_LAZY_${String(index).padStart(4, "0")}`,
          field: "name",
          headerName: `Lazy ${String(index)}`,
          valueType: "text",
        })),
      ).map((column) =>
        Object.freeze({
          ...column,
          semantics: Object.freeze({ ...column.semantics, decodeRuntime }),
        }),
      ),
    );
    const first = { id: "first", name: "Ada" } satisfies Row;
    const second = { id: "second", name: "Grace" } satisfies Row;
    const adapter = new BrunoTableClientRowPipelineAdapter(
      source([first, second]),
      (row) => row.id,
      wideColumns,
      undefined,
      [{ columnId: "COL_ID_LAZY_0000", direction: "asc" }],
    );
    const runtime = new BrunoTableGridRuntime(
      adapter.getPublication(),
      wideColumns,
      adapter.getQueryConfiguration(wideColumns),
      "TABLE_ID_GRID_RUNTIME_LAZY_VALUES",
    );

    expect(runtime.getCellValueSnapshot("first", "COL_ID_LAZY_0000")).toBe("Ada");
    expect(runtime.getCellValueSnapshot("second", "COL_ID_LAZY_0000")).toBe("Grace");
    expect(decodeRuntime).toHaveBeenCalledTimes(2);
    expect(runtime.getCellValueSnapshot("first", "COL_ID_LAZY_0999")).toBe("Ada");
    expect(decodeRuntime).toHaveBeenCalledTimes(3);
    expect(runtime.getCellValueSnapshot("first", "COL_ID_LAZY_0999")).toBe("Ada");
    expect(decodeRuntime).toHaveBeenCalledTimes(3);
  });

  it("enforces one table-wide bound for primitive-row canonical values", () => {
    const decodeRuntime = vi.fn((input: unknown) => ({ _tag: "Success", value: input }) as const);
    const primitiveColumns = Object.freeze(
      compileColumns([
        {
          columnId: "COL_ID_LENGTH_PRIMARY",
          field: "length",
          headerName: "Primary length",
          valueType: "number",
        },
        {
          columnId: "COL_ID_LENGTH_SECONDARY",
          field: "length",
          headerName: "Secondary length",
          valueType: "number",
        },
      ]).map((column) =>
        Object.freeze({
          ...column,
          semantics: Object.freeze({ ...column.semantics, decodeRuntime }),
        }),
      ),
    );
    const primitiveRows = Array.from({ length: 9_000 }, (_, index) => `row-${String(index)}`);
    const adapter = new BrunoTableClientRowPipelineAdapter(
      {
        rows: primitiveRows,
        totalRows: primitiveRows.length,
        version: 1,
        status: "ready",
      },
      (row) => row,
      primitiveColumns,
      undefined,
      [{ columnId: "COL_ID_LENGTH_PRIMARY", direction: "asc" }],
    );
    const rowSpace = adapter.getPublication().rowSpace!;

    for (const rowId of primitiveRows) {
      rowSpace.getCellValue(rowId, "COL_ID_LENGTH_PRIMARY");
    }
    expect(decodeRuntime).toHaveBeenCalledTimes(9_000);
    for (const rowId of primitiveRows) {
      rowSpace.getCellValue(rowId, "COL_ID_LENGTH_SECONDARY");
    }
    expect(decodeRuntime).toHaveBeenCalledTimes(18_000);

    rowSpace.getCellValue(primitiveRows[0]!, "COL_ID_LENGTH_PRIMARY");
    expect(decodeRuntime).toHaveBeenCalledTimes(18_001);
  });

  it("enforces the same table-wide bound for retained object rows", () => {
    const decodeRuntime = vi.fn((input: unknown) => ({ _tag: "Success", value: input }) as const);
    const objectColumns = Object.freeze(
      compileColumns([
        {
          columnId: "COL_ID_NAME_PRIMARY",
          field: "name",
          headerName: "Primary name",
          valueType: "text",
        },
        {
          columnId: "COL_ID_NAME_SECONDARY",
          field: "name",
          headerName: "Secondary name",
          valueType: "text",
        },
      ]).map((column) =>
        Object.freeze({
          ...column,
          semantics: Object.freeze({ ...column.semantics, decodeRuntime }),
        }),
      ),
    );
    const objectRows = Array.from({ length: 9_000 }, (_, index) => ({
      id: `row-${String(index)}`,
      name: `Name ${String(index)}`,
    }));
    const adapter = new BrunoTableClientRowPipelineAdapter(
      {
        rows: objectRows,
        totalRows: objectRows.length,
        version: 1,
        status: "ready",
      },
      (row) => row.id,
      objectColumns,
      undefined,
      [{ columnId: "COL_ID_NAME_PRIMARY", direction: "asc" }],
    );
    const rowSpace = adapter.getPublication().rowSpace!;

    for (const row of objectRows) {
      rowSpace.getCellValue(row.id, "COL_ID_NAME_PRIMARY");
    }
    expect(decodeRuntime).toHaveBeenCalledTimes(9_000);
    for (const row of objectRows) {
      rowSpace.getCellValue(row.id, "COL_ID_NAME_SECONDARY");
    }
    expect(decodeRuntime).toHaveBeenCalledTimes(18_000);

    rowSpace.getCellValue(objectRows[0]!.id, "COL_ID_NAME_PRIMARY");
    expect(decodeRuntime).toHaveBeenCalledTimes(18_001);
  });

  it("retains canonical decoder output separately from the raw source row", () => {
    const [baseColumn] = runtimeColumns;
    const canonicalColumns = Object.freeze([
      Object.freeze({
        ...baseColumn!,
        semantics: Object.freeze({
          ...baseColumn!.semantics,
          decodeRuntime: (input: unknown) =>
            typeof input === "string"
              ? ({ _tag: "Success", value: input.toUpperCase() } as const)
              : ({ _tag: "Failure", message: "Expected text." } as const),
        }),
      }),
    ] satisfies readonly CompiledColumn[]);
    const raw = { id: "first", name: "ada" } satisfies Row;
    const adapter = new BrunoTableClientRowPipelineAdapter(
      source([raw]),
      (row) => row.id,
      canonicalColumns,
      undefined,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const runtime = new BrunoTableGridRuntime(
      adapter.getPublication(),
      canonicalColumns,
      adapter.getQueryConfiguration(canonicalColumns),
      "TABLE_ID_GRID_RUNTIME_CANONICAL_VALUES",
    );

    expect(runtime.getRowSnapshot("first")).toBe(raw);
    expect(runtime.getCellValueSnapshot("first", "COL_ID_NAME")).toBe("ADA");
    expect(
      adapter.createRowsStore(runtime.getView(), () => () => true).getSnapshot()[0],
    ).toMatchObject({
      raw,
      rowId: "first",
    });
    const admitted = adapter.createRowsStore(runtime.getView(), () => () => true).getSnapshot()[0]!;
    expect(
      admitted.values.read(admitted.raw, admitted.rowId, admitted.rowIndex, canonicalColumns[0]!),
    ).toBe("ADA");
  });

  it("retains the last coherent rows under an incomplete stale publication", () => {
    const row = { id: "first", name: "Ada" } satisfies Row;
    const runtime = createRuntime(source([row]));

    runtime.publish(source([], "stale", { totalRows: 1, message: "delayed partial" }));

    expect(runtime.getChromeSnapshot()).toMatchObject({
      status: "stale",
      invalid: { kind: "row-count-mismatch" },
      hasCoherentRows: true,
    });
    expect(runtime.getBodySnapshot()).toEqual({ kind: "rows" });
    expect(runtime.getRowSnapshot("first")).toBe(row);
  });

  it("transitions retained query rows without re-resolving resident identities", () => {
    const residentRows = Array.from({ length: 20_000 }, (_unused, index) => ({
      id: `row-${String(index)}`,
      name: `Accepted ${String(index)}`,
    })) satisfies readonly Row[];
    const candidateRows = residentRows.map((row, index) => ({
      ...row,
      name: `Candidate ${String(index)}`,
    }));
    const getRowId = vi.fn((row: Row) => row.id);
    const adapter = new BrunoTableClientRowPipelineAdapter(
      source(residentRows),
      getRowId,
      runtimeColumns,
      undefined,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const runtime = new BrunoTableGridRuntime(
      adapter.getPublication(),
      runtimeColumns,
      adapter.getQueryConfiguration(runtimeColumns),
      "TABLE_ID_GRID_RUNTIME_RETAINED_ROWS",
    );
    const rowsStore = adapter.createRowsStore(runtime.getView(), () => () => true);
    const unsubscribe = rowsStore.subscribe(() => undefined);
    adapter.acceptRows(rowsStore.getSnapshot());
    runtime.publish(adapter.publish(source(candidateRows, "stale")));
    const rejectedRows = rowsStore.getSnapshot();
    const reconciliationEvents = vi.fn<(event: BrunoTableClientReconciliationEvent) => void>();
    const removeReconciliationListener =
      installBrunoTableClientReconciliationListener(reconciliationEvents);
    getRowId.mockClear();

    try {
      const fallback = adapter.rejectQueryRows(rejectedRows, {
        kind: "invalid-value",
        rowIndex: 0,
        columnId: "COL_ID_NAME",
        message: "Rejected by the active query.",
      });
      runtime.publish(fallback!);
      const fallbackRows = rowsStore.getSnapshot();
      const empty = adapter.rejectQueryRows(fallbackRows, {
        kind: "invalid-value",
        rowIndex: 1,
        columnId: "COL_ID_NAME",
        message: "The retained predecessor also failed.",
      });

      expect(getRowId).not.toHaveBeenCalled();
      expect(reconciliationEvents).not.toHaveBeenCalled();
      expect(fallback?.rowSpace?.getRow("row-0")).toBe(residentRows[0]);
      expect(fallback?.invalid).toMatchObject({ kind: "invalid-value" });
      expect(empty).toMatchObject({ hasCoherentRows: false });
      expect(empty?.rowSpace).toBeUndefined();
    } finally {
      removeReconciliationListener();
      unsubscribe();
    }
  });

  it("rejects an unsupported source status without admitting its rows", () => {
    const malformed = {
      rows: [{ id: "invalid", name: "Untrusted" }],
      totalRows: 1,
      version: 1,
      status: "offline",
    } as unknown as ReturnType<typeof source>;
    const runtime = createRuntime(malformed);

    expect(runtime.getChromeSnapshot()).toEqual({
      status: "error",
      hasCoherentRows: false,
      invalid: { kind: "invalid-status", receivedStatus: "offline" },
    });
    expect(runtime.getBodySnapshot()).toEqual({ kind: "empty" });
    expect(runtime.getRowSnapshot("invalid")).toBeUndefined();
  });

  it("retains coherent rows while rejecting an unsupported source status", () => {
    const accepted = { id: "accepted", name: "Ada" } satisfies Row;
    const runtime = createRuntime(source([accepted]));
    const malformed = {
      rows: [{ id: "candidate", name: "Untrusted" }],
      totalRows: 1,
      version: 2,
      status: "offline",
    } as unknown as ReturnType<typeof source>;

    runtime.publish(malformed);

    expect(runtime.getChromeSnapshot()).toEqual({
      status: "error",
      hasCoherentRows: true,
      invalid: { kind: "invalid-status", receivedStatus: "offline" },
    });
    expect(runtime.getBodySnapshot()).toEqual({ kind: "rows" });
    expect(runtime.getRowSnapshot("accepted")).toBe(accepted);
    expect(runtime.getRowSnapshot("candidate")).toBeUndefined();
  });

  it("does not read rows from unsupported-status publications", () => {
    const rowsRead = vi.fn();
    const malformed = (version: number) =>
      ({
        get rows(): readonly Row[] {
          rowsRead();
          throw new Error("Unsupported-status rows must stay unread.");
        },
        totalRows: 1,
        version,
        status: "offline",
      }) as unknown as ReturnType<typeof source>;
    const initialRuntime = createRuntime(malformed(1));
    const accepted = { id: "accepted", name: "Ada" } satisfies Row;
    const updatedRuntime = createRuntime(source([accepted]));

    updatedRuntime.publish(malformed(2));

    expect(initialRuntime.getChromeSnapshot()).toEqual({
      status: "error",
      hasCoherentRows: false,
      invalid: { kind: "invalid-status", receivedStatus: "offline" },
    });
    expect(updatedRuntime.getChromeSnapshot()).toEqual({
      status: "error",
      hasCoherentRows: true,
      invalid: { kind: "invalid-status", receivedStatus: "offline" },
    });
    expect(updatedRuntime.getRowSnapshot("accepted")).toBe(accepted);
    expect(rowsRead).not.toHaveBeenCalled();
  });

  it.each(["status", "totalRows", "version"] as const)(
    "contains an unreadable required Client Source %s getter and retains accepted rows",
    (property) => {
      const unreadable = (version: number) => {
        const candidate = {
          rows: [{ id: "candidate", name: "Untrusted" }],
          totalRows: 1,
          version,
          status: "ready" as const,
        };
        Object.defineProperty(candidate, property, {
          get: () => {
            throw new Error(`Unreadable ${property}.`);
          },
        });
        return candidate as ReturnType<typeof source>;
      };
      const getRowId = vi.fn((row: Row) => row.id);
      const initialRuntime = createRuntime(unreadable(1), getRowId);
      const accepted = { id: "accepted", name: "Ada" } satisfies Row;
      const updatedRuntime = createRuntime(source([accepted]), getRowId);
      const identityReads = getRowId.mock.calls.length;

      expect(() => updatedRuntime.publish(unreadable(2))).not.toThrow();

      expect(initialRuntime.getChromeSnapshot()).toEqual({
        status: "error",
        hasCoherentRows: false,
        invalid: { kind: "invalid-lifecycle", field: property },
      });
      expect(initialRuntime.getBodySnapshot()).toEqual({ kind: "empty" });
      expect(updatedRuntime.getChromeSnapshot()).toEqual({
        status: "error",
        hasCoherentRows: true,
        invalid: { kind: "invalid-lifecycle", field: property },
      });
      expect(updatedRuntime.getRowSnapshot("accepted")).toBe(accepted);
      expect(updatedRuntime.getRowSnapshot("candidate")).toBeUndefined();
      expect(getRowId).toHaveBeenCalledTimes(identityReads);
    },
  );

  it.each([
    [
      "totalRows",
      {
        [Symbol.toPrimitive]: () => {
          throw new Error("Do not coerce.");
        },
      },
    ],
    ["totalRows", -1],
    ["totalRows", 1.5],
    ["version", "2"],
    ["version", Number.NaN],
    ["version", Number.POSITIVE_INFINITY],
  ] as const)("contains an invalid required Client Source %s value", (property, value) => {
    const malformed = {
      rows: [{ id: "candidate", name: "Untrusted" }],
      totalRows: 1,
      version: 1,
      status: "ready",
      [property]: value,
    } as unknown as ReturnType<typeof source>;

    expect(() => createRuntime(malformed)).not.toThrow();
    const runtime = createRuntime(malformed);
    expect(runtime.getChromeSnapshot()).toEqual({
      status: "error",
      hasCoherentRows: false,
      invalid: { kind: "invalid-lifecycle", field: property },
    });
    expect(runtime.getBodySnapshot()).toEqual({ kind: "empty" });
  });

  it.each(["statusCode", "message", "retry"] as const)(
    "omits an unreadable optional Client Source %s getter while admitting ready rows",
    (property) => {
      const candidate = { id: "candidate", name: "Trusted" } satisfies Row;
      const ready = source([candidate]);
      Object.defineProperty(ready, property, {
        get: () => {
          throw new Error(`Unreadable ${property}.`);
        },
      });

      const runtime = createRuntime(ready);

      expect(runtime.getChromeSnapshot()).toEqual({ status: "ready", hasCoherentRows: true });
      expect(runtime.getBodySnapshot()).toEqual({ kind: "rows" });
      expect(runtime.getRowSnapshot("candidate")).toBe(candidate);
    },
  );

  it.each(["statusCode", "message", "retry"] as const)(
    "preserves loading skeletons when the optional Client Source %s getter is unreadable",
    (property) => {
      const loading = source([], "loading", { totalRows: 2 });
      Object.defineProperty(loading, property, {
        get: () => {
          throw new Error(`Unreadable ${property}.`);
        },
      });

      const runtime = createRuntime(loading);

      expect(runtime.getChromeSnapshot()).toEqual({ status: "loading", hasCoherentRows: false });
      expect(runtime.getBodySnapshot()).toEqual({ kind: "loading", totalRows: 2 });
    },
  );

  it("rejects a malformed Client Source row collection without throwing", () => {
    const malformed = {
      rows: null,
      totalRows: 1,
      version: 1,
      status: "ready",
    } as unknown as ReturnType<typeof source>;
    const runtime = createRuntime(malformed);

    expect(runtime.getChromeSnapshot()).toEqual({
      status: "error",
      hasCoherentRows: false,
      invalid: { kind: "invalid-rows", receivedRows: "null" },
    });
    expect(runtime.getBodySnapshot()).toEqual({ kind: "empty" });
  });

  it("rejects a sparse Client Source row collection before resolving row identities", () => {
    const sparseRows = Array<Row>(2);
    sparseRows[1] = { id: "candidate", name: "Untrusted" };
    const getRowId = vi.fn((row: Row) => row.id);

    const runtime = createRuntime(source(sparseRows), getRowId);

    expect(runtime.getChromeSnapshot()).toEqual({
      status: "error",
      hasCoherentRows: false,
      invalid: { kind: "invalid-rows", receivedRows: "sparse array" },
    });
    expect(runtime.getBodySnapshot()).toEqual({ kind: "empty" });
    expect(getRowId).not.toHaveBeenCalled();
  });

  it("captures a published Array proxy length and entries exactly once inside the guarded snapshot", () => {
    const accepted = { id: "accepted", name: "Ada" } satisfies Row;
    const stable = { id: "stable", name: "Grace" } satisfies Row;
    const updated = { id: "accepted", name: "Ada Lovelace" } satisfies Row;
    const runtime = createRuntime(source([accepted, stable]));
    let lengthReads = 0;
    const entryReads = new Map<PropertyKey, number>();
    const proxiedRows = new Proxy([updated, stable], {
      get: (target, property, receiver) => {
        if (property === "length") {
          lengthReads += 1;
          if (lengthReads > 1) throw new Error("Client Source rows length was reread.");
        }
        if (property === "0" || property === "1") {
          const reads = (entryReads.get(property) ?? 0) + 1;
          entryReads.set(property, reads);
          if (reads > 1) throw new Error(`Client Source row ${property} was reread.`);
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    runtime.publish({
      rows: proxiedRows,
      totalRows: 2,
      version: 2,
      status: "ready",
    });

    expect(runtime.getChromeSnapshot()).toEqual({ status: "ready", hasCoherentRows: true });
    expect(runtime.getRowSnapshot("accepted")).toBe(updated);
    expect(runtime.getRowSnapshot("stable")).toBe(stable);
    expect(lengthReads).toBe(1);
    expect(entryReads).toEqual(
      new Map<PropertyKey, number>([
        ["0", 1],
        ["1", 1],
      ]),
    );
  });

  it("contains a cyclic Client Source rows prototype chain", () => {
    let cyclicRows: Row[];
    cyclicRows = new Proxy([] as Row[], {
      getPrototypeOf: () => cyclicRows,
    });

    expect(() =>
      createRuntime({ rows: cyclicRows, totalRows: 0, version: 1, status: "ready" }),
    ).not.toThrow();
    const runtime = createRuntime({
      rows: cyclicRows,
      totalRows: 0,
      version: 1,
      status: "ready",
    });
    expect(runtime.getChromeSnapshot()).toEqual({
      status: "error",
      hasCoherentRows: false,
      invalid: { kind: "invalid-rows", receivedRows: "unreadable" },
    });
    expect(runtime.getBodySnapshot()).toEqual({ kind: "empty" });
  });

  it("retains coherent rows while rejecting a malformed later row collection", () => {
    const accepted = { id: "accepted", name: "Ada" } satisfies Row;
    const runtime = createRuntime(source([accepted]));

    runtime.publish({
      rows: null,
      totalRows: 1,
      version: 2,
      status: "ready",
    } as unknown as ReturnType<typeof source>);

    expect(runtime.getChromeSnapshot()).toEqual({
      status: "error",
      hasCoherentRows: true,
      invalid: { kind: "invalid-rows", receivedRows: "null" },
    });
    expect(runtime.getBodySnapshot()).toEqual({ kind: "rows" });
    expect(runtime.getRowSnapshot("accepted")).toBe(accepted);
  });

  it("retains coherent rows while rejecting a sparse later row collection", () => {
    const accepted = { id: "accepted", name: "Ada" } satisfies Row;
    const getRowId = vi.fn((row: Row) => row.id);
    const runtime = createRuntime(source([accepted]), getRowId);
    const identityReads = getRowId.mock.calls.length;
    const sparseRows = Array<Row>(2);
    sparseRows[1] = { id: "candidate", name: "Untrusted" };

    runtime.publish(source(sparseRows));

    expect(runtime.getChromeSnapshot()).toEqual({
      status: "error",
      hasCoherentRows: true,
      invalid: { kind: "invalid-rows", receivedRows: "sparse array" },
    });
    expect(runtime.getBodySnapshot()).toEqual({ kind: "rows" });
    expect(runtime.getRowSnapshot("accepted")).toBe(accepted);
    expect(runtime.getRowSnapshot("candidate")).toBeUndefined();
    expect(getRowId).toHaveBeenCalledTimes(identityReads);
  });

  it.each([
    ["malformed rows", "stale" as const],
    ["unsupported status", "offline" as const],
  ])("retains initially stale accepted rows after %s", (_label, nextStatus) => {
    const accepted = { id: "accepted", name: "Ada" } satisfies Row;
    const runtime = createRuntime(source([accepted], "stale"));
    const malformed = {
      rows: nextStatus === "stale" ? null : [{ id: "candidate", name: "Untrusted" }],
      totalRows: 1,
      version: 2,
      status: nextStatus,
    } as unknown as ReturnType<typeof source>;

    runtime.publish(malformed);

    expect(runtime.getChromeSnapshot()).toMatchObject({
      status: "error",
      hasCoherentRows: true,
    });
    expect(runtime.getBodySnapshot()).toEqual({ kind: "rows" });
    expect(runtime.getRowSnapshot("accepted")).toBe(accepted);
    expect(runtime.getRowSnapshot("candidate")).toBeUndefined();
  });

  it("contains unreadable non-loading row collections and retains accepted rows", () => {
    const rowsRead = vi.fn();
    const unreadable = (version: number, status: "ready" | "stale") =>
      ({
        get rows(): readonly Row[] {
          rowsRead();
          throw new Error("Hostile row getter.");
        },
        totalRows: 1,
        version,
        status,
      }) as ReturnType<typeof source>;
    const initialRuntime = createRuntime(unreadable(1, "ready"));
    const accepted = { id: "accepted", name: "Ada" } satisfies Row;
    const updatedRuntime = createRuntime(source([accepted], "stale"));

    expect(() => updatedRuntime.publish(unreadable(2, "stale"))).not.toThrow();

    expect(initialRuntime.getChromeSnapshot()).toEqual({
      status: "error",
      hasCoherentRows: false,
      invalid: { kind: "invalid-rows", receivedRows: "unreadable" },
    });
    expect(initialRuntime.getBodySnapshot()).toEqual({ kind: "empty" });
    expect(updatedRuntime.getChromeSnapshot()).toEqual({
      status: "error",
      hasCoherentRows: true,
      invalid: { kind: "invalid-rows", receivedRows: "unreadable" },
    });
    expect(updatedRuntime.getBodySnapshot()).toEqual({ kind: "rows" });
    expect(updatedRuntime.getRowSnapshot("accepted")).toBe(accepted);
    expect(rowsRead).toHaveBeenCalledTimes(2);
  });

  it("keeps the last coherent rows available after a rejected ready publication", () => {
    const row = { id: "first", name: "Ada" } satisfies Row;
    const runtime = createRuntime(source([row]));

    runtime.publish(source([], "ready", { totalRows: 1 }));
    expect(runtime.getBodySnapshot()).toEqual({ kind: "invalid" });

    runtime.publish(source([], "error", { totalRows: 0, message: "connection lost" }));
    expect(runtime.getChromeSnapshot()).toMatchObject({
      status: "error",
      hasCoherentRows: true,
    });
    expect(runtime.getBodySnapshot()).toEqual({ kind: "rows" });
    expect(runtime.getRowSnapshot("first")).toBe(row);
  });

  it("keeps complete loading rows behind skeletons and retains prior coherent evidence", () => {
    const row = { id: "first", name: "Ada" } satisfies Row;
    const runtime = createRuntime(source([row]));
    const zeroRowLoading = createRuntime(source([], "loading"));

    expect(zeroRowLoading.getBodySnapshot()).toMatchObject({ kind: "loading" });

    runtime.publish(source([{ ...row, name: "Loading candidate" }], "loading", { totalRows: 1 }));
    expect(runtime.getBodySnapshot()).toEqual({ kind: "loading", totalRows: 1 });

    runtime.publish(source([], "error", { totalRows: 0, message: "connection lost" }));
    expect(runtime.getBodySnapshot()).toEqual({ kind: "rows" });
    expect(runtime.getRowSnapshot("first")).toBe(row);
  });

  it("does not read candidate rows from loading publications", () => {
    const rowsRead = vi.fn();
    const loadingSource = (version: number) =>
      ({
        get rows(): readonly Row[] {
          rowsRead();
          throw new Error("Loading rows must stay unread.");
        },
        totalRows: 1_000_000,
        version,
        status: "loading",
      }) as ReturnType<typeof source>;
    const runtime = createRuntime(loadingSource(1));

    expect(runtime.getBodySnapshot()).toEqual({ kind: "loading", totalRows: 1_000_000 });
    runtime.publish(loadingSource(2));
    expect(runtime.getBodySnapshot()).toEqual({ kind: "loading", totalRows: 1_000_000 });
    expect(rowsRead).not.toHaveBeenCalled();
  });

  it("directly constructs the first valid row sequence after loading", () => {
    const first = { id: "first", name: "Ada" } satisfies Row;
    const second = { id: "second", name: "Grace" } satisfies Row;
    const replacement = { id: "second", name: "Grace Hopper" } satisfies Row;
    const reconciliationEvents: BrunoTableClientReconciliationEvent[] = [];
    const restoreInstrumentation = installBrunoTableClientReconciliationListener((event) => {
      reconciliationEvents.push(event);
    });

    try {
      const runtime = createRuntime(source([], "loading", { totalRows: 2 }));

      runtime.publish(source([first, second]));
      expect(reconciliationEvents.at(-1)).toMatchObject({
        residentRows: 2,
        rebuiltSourceSequence: true,
        rebuiltIdentityIndex: true,
      });

      runtime.publish(source([first, replacement]));
      expect(reconciliationEvents.at(-1)).toMatchObject({
        residentRows: 2,
        changedRows: 1,
        rebuiltSourceSequence: false,
        rebuiltIdentityIndex: false,
      });

      runtime.configure((row) => row.id, runtimeColumns);
      expect(reconciliationEvents.at(-1)).toMatchObject({
        residentRows: 2,
        rebuiltSourceSequence: false,
        rebuiltIdentityIndex: false,
      });
    } finally {
      restoreInstrumentation();
    }
  });

  it("routes filter commands only through sanitized structural ownership", () => {
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
    const runtime = createClientRuntime(
      source([{ id: "first", name: "Ada" }]),
      (row) => row.id,
      columns,
      [
        {
          columnId: "COL_ID_NAME",
          type: "blank",
          condition: { columnId: "COL_ID_ALIAS", type: "blank" },
        },
      ],
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const query = runtime.getQuerySnapshot();
    const queryListener = vi.fn();
    runtime.subscribeQuery(queryListener);

    expect(runtime.getColumnCommandSnapshot("COL_ID_NAME").filterBaselineAvailable).toBe(true);
    expect(runtime.getColumnCommandSnapshot("COL_ID_ALIAS").filterBaselineAvailable).toBe(false);
    runtime.resetColumnFilters("COL_ID_ALIAS");

    expect(runtime.getQuerySnapshot()).toBe(query);
    expect(queryListener).not.toHaveBeenCalled();
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
    const runtime = createClientRuntime(
      source([{ id: "first", name: "Ada" }]),
      (row) => row.id,
      columns,
      [{ columnId: "COL_ID_NAME", type: "equals", filter: "Ada" }],
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const queryListener = vi.fn();
    const sortingListener = vi.fn();
    const nameListener = vi.fn();
    const aliasListener = vi.fn();
    runtime.subscribeQuery(queryListener);
    runtime.subscribeSorting(sortingListener);
    runtime.subscribeColumnCommands("COL_ID_NAME", nameListener);
    runtime.subscribeColumnCommands("COL_ID_ALIAS", aliasListener);

    runtime.toggleColumnSort("COL_ID_NAME", false);
    expect(runtime.getQuerySnapshot().orderBy).toEqual([
      { columnId: "COL_ID_NAME", direction: "desc" },
    ]);
    expect(nameListener).toHaveBeenCalledOnce();
    expect(aliasListener).not.toHaveBeenCalled();
    expect(sortingListener).toHaveBeenCalledOnce();
    expect(runtime.getSortingSnapshot()).toEqual([{ columnId: "COL_ID_NAME", direction: "desc" }]);

    runtime.clearColumnFilters("COL_ID_NAME");
    expect(runtime.getQuerySnapshot().filters).toEqual([]);
    expect(runtime.getPreserveActiveCellOnQueryChangeSnapshot()).toBe(false);
    expect(runtime.getColumnCommandSnapshot("COL_ID_NAME")).toMatchObject({
      filterActive: false,
      filterBaselineAvailable: true,
    });
    expect(sortingListener).toHaveBeenCalledOnce();

    runtime.resetColumnFilters("COL_ID_NAME");
    expect(runtime.getQuerySnapshot().filters).toHaveLength(1);
    expect(runtime.getPreserveActiveCellOnQueryChangeSnapshot()).toBe(false);
    expect(runtime.getColumnCommandSnapshot("COL_ID_NAME").filterActive).toBe(true);
    expect(runtime.getQuerySnapshot().generation).toBe(3);
    expect(queryListener).toHaveBeenCalledTimes(3);
    expect(sortingListener).toHaveBeenCalledOnce();
  });

  it("routes panel sorting commands through one non-empty runtime projection", () => {
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
      {
        columnId: "COL_ID_NOTE",
        field: "note",
        headerName: "Note",
        valueType: "text",
      },
    ]);
    const runtime = createClientRuntime(
      source([{ id: "first", name: "Ada" }]),
      (row) => row.id,
      columns,
      undefined,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const listener = vi.fn();
    runtime.subscribeSorting(listener);

    runtime.dispatchGridCommand({ type: "sorting.add", columnId: "COL_ID_ALIAS" });
    runtime.dispatchGridCommand({ type: "sorting.add", columnId: "COL_ID_NOTE" });
    runtime.dispatchGridCommand({
      type: "sorting.move",
      columnId: "COL_ID_NOTE",
      targetIndex: 0,
    });
    runtime.dispatchGridCommand({ type: "sorting.remove", columnId: "COL_ID_ALIAS" });
    runtime.dispatchGridCommand({ type: "sorting.remove", columnId: "COL_ID_NAME" });
    runtime.dispatchGridCommand({ type: "sorting.remove", columnId: "COL_ID_NOTE" });

    expect(runtime.getSortingSnapshot()).toEqual([{ columnId: "COL_ID_NOTE", direction: "asc" }]);
    expect(listener).toHaveBeenCalledTimes(5);

    runtime.dispatchGridCommand({ type: "sorting.reset" });
    expect(runtime.getSortingSnapshot()).toEqual([{ columnId: "COL_ID_NAME", direction: "asc" }]);
    expect(listener).toHaveBeenCalledTimes(6);
  });

  it("does not retain mutable caller-owned order entries in query snapshots", () => {
    const mutableOrderBy = [{ columnId: "COL_ID_NAME", direction: "asc" as "asc" | "desc" }];
    const runtime = createClientRuntime(
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
    const runtime = createClientRuntime(
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
      columns: replacementColumns,
      filters: [],
      quickFilter: "",
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
    const runtime = createClientRuntime(
      source([{ id: "first", name: "Ada" }]),
      (row) => row.id,
      runtimeColumns,
      [{ columnId: "COL_ID_NAME", type: "equals", filter: "Ada" }],
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const previousQuery = runtime.getQuerySnapshot();
    const previousCommandEpoch = runtime.getColumnFilterCommandEpochSnapshot("COL_ID_NAME");
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

    expect(runtime.getQuerySnapshot()).toEqual({
      columns: replacementColumns,
      filters: previousQuery.filters,
      quickFilter: previousQuery.quickFilter,
      orderBy: previousQuery.orderBy,
      generation: previousQuery.generation,
    });
    expect(runtime.getColumnFilterCommandEpochSnapshot("COL_ID_NAME")).toBe(previousCommandEpoch);
    expect(queryListener).toHaveBeenCalledOnce();
  });

  it("invalidates filter editor epochs when a custom parser changes", () => {
    const initialColumns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: parserValueType(false),
      },
    ]);
    const replacementColumns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: parserValueType(true),
      },
    ]);
    const runtime = createClientRuntime(
      source([{ id: "first", name: "new" }]),
      (row) => row.id,
      initialColumns,
      undefined,
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
    );
    const previousEpoch = runtime.getColumnFilterCommandEpochSnapshot("COL_ID_NAME");

    runtime.configure((row) => row.id, replacementColumns);

    expect(runtime.getColumnFilterCommandEpochSnapshot("COL_ID_NAME")).toBe(previousEpoch + 1);
  });

  it("advances query generation when an active column changes query semantics", () => {
    const runtime = createClientRuntime(
      source([{ id: "first", name: "Ada", note: "Countess" }]),
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
        field: "note",
        headerName: "Note",
        valueType: "text",
      },
    ]);

    runtime.configure((row) => row.id, replacementColumns);

    expect(runtime.getQuerySnapshot()).toEqual({
      columns: replacementColumns,
      filters: previousQuery.filters,
      quickFilter: previousQuery.quickFilter,
      orderBy: previousQuery.orderBy,
      generation: 1,
    });
    expect(queryListener).toHaveBeenCalledOnce();
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

  it("admits only bounded string lifecycle metadata", () => {
    const row = { id: "first", name: "Ada" } satisfies Row;
    const runtime = createRuntime(source([row]));
    const malformed = {
      ...source([row], "stale"),
      statusCode: 503,
      message: null,
    } as unknown as ReturnType<typeof source>;

    expect(() => runtime.publish(malformed)).not.toThrow();
    expect(runtime.getChromeSnapshot()).toMatchObject({ status: "stale" });
    expect(runtime.getChromeSnapshot()).not.toHaveProperty("statusCode");
    expect(runtime.getChromeSnapshot()).not.toHaveProperty("message");

    runtime.publish(
      source([row], "stale", {
        statusCode: "s".repeat(256),
        message: "m".repeat(1_024),
      }),
    );
    expect(runtime.getChromeSnapshot().statusCode).toHaveLength(128);
    expect(runtime.getChromeSnapshot().message).toHaveLength(512);
  });

  it("omits malformed source Retry capabilities", () => {
    const row = { id: "first", name: "Ada" } satisfies Row;
    const runtime = createRuntime(source([row]));
    const malformedRetries = [null, { run: null, pending: false }, { run: vi.fn(), pending: 1 }];

    for (const retry of malformedRetries) {
      const malformed = { ...source([row], "error"), retry } as unknown as ReturnType<
        typeof source
      >;
      expect(() => runtime.publish(malformed)).not.toThrow();
      expect(runtime.getChromeSnapshot()).not.toHaveProperty("retry");
      expect(() => runtime.retry()).not.toThrow();
    }

    const run = vi.fn();
    let runReads = 0;
    let pendingReads = 0;
    const changingRetry = {
      get run() {
        runReads += 1;
        return runReads === 1 ? run : null;
      },
      get pending() {
        pendingReads += 1;
        return pendingReads === 1 ? false : "invalid";
      },
    };
    runtime.publish({
      ...source([row], "error"),
      retry: changingRetry,
    } as unknown as ReturnType<typeof source>);
    runtime.retry();
    expect(runReads).toBe(1);
    expect(pendingReads).toBe(1);
    expect(runtime.getChromeSnapshot().retry?.pending).toBe(false);
    expect(run).toHaveBeenCalledOnce();

    const throwingRetries = [
      {
        get run(): never {
          throw new Error("run getter failed");
        },
        pending: false,
      },
      {
        run,
        get pending(): never {
          throw new Error("pending getter failed");
        },
      },
    ];
    for (const retry of throwingRetries) {
      const malformed = { ...source([row], "error"), retry } as unknown as ReturnType<
        typeof source
      >;
      expect(() => runtime.publish(malformed)).not.toThrow();
      expect(runtime.getChromeSnapshot()).not.toHaveProperty("retry");
    }
  });

  it("partitions source counts, source version, and chrome without waking rows or body", () => {
    const rows = [{ id: "first", name: "Ada" }] as const;
    const iterateRows = vi.spyOn(rows, Symbol.iterator);
    const getRowId = vi.fn((row: Row) => row.id);
    const runtime = createClientRuntime(source(rows), getRowId, runtimeColumns, undefined, [
      { columnId: "COL_ID_NAME", direction: "asc" },
    ]);
    const detector = vi.fn(() => true);
    const rowsStore = runtime.createRowsStore(detector);
    const rowsListener = vi.fn();
    const bodyListener = vi.fn();
    const chromeListener = vi.fn();
    const sourceListener = vi.fn();
    const sourceVersionListener = vi.fn();
    rowsStore.subscribe(rowsListener);
    runtime.subscribeBody(bodyListener);
    runtime.subscribeChrome(chromeListener);
    runtime.subscribeSource(sourceListener);
    runtime.subscribeSourceVersion(sourceVersionListener);
    iterateRows.mockClear();
    getRowId.mockClear();

    runtime.publish({ ...source(rows), version: 2 });

    expect(iterateRows).not.toHaveBeenCalled();
    expect(getRowId).not.toHaveBeenCalled();
    expect(detector).not.toHaveBeenCalled();
    expect(rowsListener).not.toHaveBeenCalled();
    expect(bodyListener).not.toHaveBeenCalled();
    expect(chromeListener).not.toHaveBeenCalled();
    expect(sourceListener).not.toHaveBeenCalled();
    expect(sourceVersionListener).toHaveBeenCalledOnce();
    expect(runtime.getSourceSnapshot()).toEqual({ totalRows: 1, loadedRows: 1 });
    expect(runtime.getSourceVersionSnapshot().version).toBe(2);

    runtime.publish({ ...source(rows), version: 3, status: "stale", message: "Delayed" });

    expect(chromeListener).toHaveBeenCalledOnce();
    expect(sourceListener).not.toHaveBeenCalled();
    expect(sourceVersionListener).toHaveBeenCalledTimes(2);
    expect(runtime.getSourceVersionSnapshot().version).toBe(3);

    runtime.publish({ ...source([], "loading", { totalRows: 2 }), version: 3 });

    expect(sourceListener).toHaveBeenCalledOnce();
    expect(sourceVersionListener).toHaveBeenCalledTimes(2);
    expect(runtime.getSourceSnapshot()).toEqual({ totalRows: 2, loadedRows: 0 });
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

    expect(runtime.getBodySnapshot()).toEqual({ kind: "empty" });
  });
});
