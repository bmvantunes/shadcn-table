import { describe, expect, it, vi } from "vitest";

import { BrunoTableAggregateAlgebra } from "../public-types";
import { compileColumns } from "./compile-columns";
import {
  applyBrunoTableGridCommand,
  createBrunoTableColumnLayout,
  getBrunoTableColumnLayoutSnapshot,
} from "./column-management";
import {
  BrunoTableClientProjectionPlanCompiler,
  BrunoTableClientProjectionStore,
  ClientRowOrderStore,
  deriveClientProjectionRowModel,
} from "./client-row-pipeline";
import { BrunoTableClientRowPipelineAdapter } from "./client-source-adapter";
import { compileClientFilterCollection } from "./grid-query";
import { BrunoTableGridRuntime } from "./grid-runtime";

describe("ClientRowOrderStore", () => {
  it("keeps the raw row-space authority stable until identities or generation change", () => {
    const store = new ClientRowOrderStore(["first", "second", "third"], 0);
    const initialRowSpace = store.getSnapshot().rowSpace;
    expect(initialRowSpace.identitySnapshot?.rowIds).toEqual(["first", "second", "third"]);
    expect(initialRowSpace.identitySnapshot?.rowIndexById.get("third")).toBe(2);

    const listener = vi.fn();
    store.subscribe(listener);
    store.publish(["first", "second", "third"], 0);
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot().rowSpace).toBe(initialRowSpace);

    store.publish(["first", "second", "third"], 1);
    expect(listener).toHaveBeenCalledOnce();
    expect(store.getSnapshot().rowSpace).toBe(initialRowSpace);

    store.publish(["third", "first", "second"], 1);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().rowSpace).not.toBe(initialRowSpace);
    expect(store.getSnapshot().rowSpace.findRowIndex("first")).toBe(1);
  });

  it("publishes the complete replacement even when an earlier listener throws", () => {
    const store = new ClientRowOrderStore(["first", "second"], 0);
    const failure = new Error("listener failed");
    const laterListener = vi.fn();
    store.subscribe(() => {
      throw failure;
    });
    store.subscribe(laterListener);

    expect(() => store.publish(["second", "first"], 1)).toThrow(failure);
    expect(laterListener).toHaveBeenCalledOnce();
    expect(store.getSnapshot().queryGeneration).toBe(1);
    expect(store.getSnapshot().rowSpace.identitySnapshot?.rowIds).toEqual(["second", "first"]);
  });
});

describe("grouped Client projection planning", () => {
  it.each(["stale", "closed", "error"] as const)(
    "retains the compatible ready grouped epoch when a %s aggregate candidate fails",
    (status) => {
      type Money = Readonly<{ readonly minorUnits: bigint }>;
      type Row = Readonly<{ id: string; group: string; amount: Money }>;
      let rejectedOperation: "add" | "divide" | undefined;
      const columns = compileColumns([
        {
          columnId: "COL_ID_GROUP",
          field: "group",
          headerName: "Group",
          valueType: "text",
          groupBy: true,
        },
        {
          columnId: "COL_ID_AMOUNT",
          field: "amount",
          headerName: "Amount",
          valueType: {
            codecId: "test/pipeline-money",
            codecVersion: 1,
            filterFamily: "numeric",
            editorFamily: "text",
            cellAlign: "end",
            editorLayout: "inline",
            defaultWidth: 120,
            aggregateResults: { avg: "self" },
            aggregateAlgebra: BrunoTableAggregateAlgebra<Money>({
              add: (left, right) => {
                if (rejectedOperation === "add") throw new Error("aggregate candidate failed");
                return { minorUnits: left.minorUnits + right.minorUnits };
              },
              divideByCount: (total, count) => {
                if (rejectedOperation === "divide") {
                  throw new Error("aggregate candidate failed");
                }
                return { minorUnits: total.minorUnits / count };
              },
            }),
            decodeRuntime: (input: unknown) =>
              typeof input === "object" &&
              input !== null &&
              "minorUnits" in input &&
              typeof input.minorUnits === "bigint"
                ? { _tag: "Success" as const, value: input as Money }
                : { _tag: "Failure" as const, message: "Expected Money." },
            equivalent: (left: Money, right: Money) => left.minorUnits === right.minorUnits,
            compare: (left: Money, right: Money) =>
              left.minorUnits === right.minorUnits
                ? 0
                : left.minorUnits < right.minorUnits
                  ? -1
                  : 1,
            formatCanonicalText: (value: Money) => value.minorUnits.toString(),
            parseCanonicalText: (text: string) => ({
              _tag: "Success" as const,
              value: { minorUnits: BigInt(text) },
            }),
            formatDisplay: (value: Money) => value.minorUnits.toString(),
            encodePersisted: (value: Money) => value.minorUnits.toString(),
            decodePersisted: (input: unknown) =>
              typeof input === "string"
                ? { _tag: "Success" as const, value: { minorUnits: BigInt(input) } }
                : { _tag: "Failure" as const, message: "Expected persisted Money." },
          },
          aggFunc: "avg",
        },
      ]);
      const readyRows: readonly Row[] = [
        { id: "one", group: "A", amount: { minorUnits: 1n } },
        { id: "two", group: "A", amount: { minorUnits: 2n } },
      ];
      const source = (
        rows: readonly Row[],
        version: number,
        sourceStatus: typeof status | "ready",
      ) =>
        ({
          rows,
          totalRows: rows.length,
          version,
          status: sourceStatus,
          ...(sourceStatus === "ready" ? {} : { message: `${sourceStatus} candidate failed` }),
        }) as const;
      const adapter = new BrunoTableClientRowPipelineAdapter(
        source(readyRows, 1, "ready"),
        (row: Row) => row.id,
        columns,
        undefined,
        [{ columnId: "COL_ID_GROUP", direction: "asc" }],
      );
      const runtime = new BrunoTableGridRuntime(
        adapter.getPublication(),
        columns,
        adapter.getQueryConfiguration(columns),
        `TABLE_ID_GROUPED_${status.toUpperCase()}_FALLBACK`,
        { grouping: true },
      );
      const view = runtime.getView();
      const store = new BrunoTableClientProjectionStore(view, adapter, undefined).retain();
      view.dispatchGridCommand({ type: "grouping.add", columnId: "COL_ID_GROUP" });
      const readyProjection = view.getInstalledClientProjectionSnapshot();
      expect(readyProjection?.kind).toBe("grouped");
      const readyRowId = readyProjection?.rowIds[0];
      expect(readyRowId).toBeDefined();
      const readyAggregateCell = view.getCellSnapshot(readyRowId!, "COL_ID_AMOUNT");
      expect(readyAggregateCell).toMatchObject({
        kind: "available",
        value: { minorUnits: 1n },
      });

      rejectedOperation = "divide";
      const rejectedRows: readonly Row[] = [
        readyRows[0]!,
        { id: "two", group: "A", amount: { minorUnits: 4n } },
      ];
      adapter.reconcile(source(rejectedRows, 2, status), (row: Row) => row.id, columns);
      adapter.publishProjectionInput(columns, adapter.getQueryConfiguration(columns));

      const retainedProjection = view.getInstalledClientProjectionSnapshot();
      expect(retainedProjection).toMatchObject({
        kind: "grouped",
        rowIds: [readyRowId],
      });
      expect(retainedProjection?.columns).toBe(readyProjection?.columns);
      expect(retainedProjection?.presentationKey).toBe(readyProjection?.presentationKey);
      expect(retainedProjection?.queryGeneration).toBe(readyProjection?.queryGeneration);
      expect(view.getChromeSnapshot()).toMatchObject({
        status,
        message: `${status} candidate failed`,
        hasCoherentRows: true,
        invalid: {
          kind: "invalid-group",
          columnId: "COL_ID_AMOUNT",
          message: "Aggregate Algebra operation threw.",
        },
      });
      expect(view.getCellSnapshot(readyRowId!, "COL_ID_AMOUNT").value).toBe(
        readyAggregateCell.value,
      );
      expect(readyAggregateCell).toMatchObject({
        kind: "available",
        value: { minorUnits: 1n },
      });

      rejectedOperation = undefined;
      const recoveredRows: readonly Row[] = [
        readyRows[0]!,
        { id: "two", group: "A", amount: { minorUnits: 5n } },
      ];
      adapter.reconcile(source(recoveredRows, 3, "ready"), (row: Row) => row.id, columns);
      adapter.publishProjectionInput(columns, adapter.getQueryConfiguration(columns));

      expect(view.getInstalledClientProjectionSnapshot()?.kind).toBe("grouped");
      expect(view.getCellSnapshot(readyRowId!, "COL_ID_AMOUNT")).toMatchObject({
        kind: "available",
        value: { minorUnits: 3n },
      });
      expect(view.getChromeSnapshot()).toMatchObject({ status: "ready", hasCoherentRows: true });

      rejectedOperation = "divide";
      adapter.reconcile(source(rejectedRows, 4, "ready"), (row: Row) => row.id, columns);
      adapter.publishProjectionInput(columns, adapter.getQueryConfiguration(columns));
      expect(view.getInstalledClientProjectionSnapshot()).toMatchObject({
        kind: "invalid",
        rowIds: [],
        invalid: {
          kind: "invalid-group",
          columnId: "COL_ID_AMOUNT",
          message: "Aggregate Algebra operation threw.",
        },
      });
      expect(view.getChromeSnapshot().status).toBe("ready");

      rejectedOperation = undefined;
      adapter.reconcile(source(recoveredRows, 5, "ready"), (row: Row) => row.id, columns);
      adapter.publishProjectionInput(columns, adapter.getQueryConfiguration(columns));
      expect(view.getInstalledClientProjectionSnapshot()?.kind).toBe("grouped");

      rejectedOperation = "add";
      adapter.reconcile(source(rejectedRows, 6, "ready"), (row: Row) => row.id, columns);
      adapter.publishProjectionInput(columns, adapter.getQueryConfiguration(columns));
      expect(view.getInstalledClientProjectionSnapshot()).toMatchObject({
        kind: "invalid",
        rowIds: [],
        invalid: {
          kind: "invalid-value",
          rowIndex: 1,
          columnId: "COL_ID_AMOUNT",
          message: "Aggregate Algebra operation threw.",
        },
      });
      expect(view.getChromeSnapshot().status).toBe("ready");

      rejectedOperation = undefined;
      adapter.reconcile(source(recoveredRows, 7, "ready"), (row: Row) => row.id, columns);
      adapter.publishProjectionInput(columns, adapter.getQueryConfiguration(columns));
      expect(view.getInstalledClientProjectionSnapshot()?.kind).toBe("grouped");
      expect(view.getCellSnapshot(readyRowId!, "COL_ID_AMOUNT")).toMatchObject({
        kind: "available",
        value: { minorUnits: 3n },
      });
      store.release();
    },
  );

  it("reuses the exact logical and presentation plan across real value-only publications", () => {
    const groupKeyValueFormatter = vi.fn(({ value }: { readonly value: string }) => value);
    const aggregateValueFormatter = vi.fn(({ value }: { readonly value: bigint }) => String(value));
    const columns = compileColumns([
      {
        columnId: "COL_ID_GROUP",
        field: "group",
        headerName: "Group",
        valueType: "text",
        groupBy: true,
        groupKeyValueFormatter,
      },
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "bigint",
        aggFunc: "sum",
        aggregateValueFormatter,
      },
    ]);
    type Row = Readonly<{ id: string; group: string; value: bigint }>;
    const source = (value: bigint, version: number) => ({
      rows: [{ id: "one", group: "A", value }],
      totalRows: 1,
      version,
      status: "ready" as const,
    });
    const adapter = new BrunoTableClientRowPipelineAdapter(
      source(1n, 1),
      (row: Row) => row.id,
      columns,
      undefined,
      [{ columnId: "COL_ID_VALUE", direction: "asc" }],
    );
    const runtime = new BrunoTableGridRuntime(
      adapter.getPublication(),
      columns,
      adapter.getQueryConfiguration(columns),
      "TABLE_ID_STABLE_PROJECTION_PLAN",
      { grouping: true },
    );
    const view = runtime.getView();
    const planCompiler = new BrunoTableClientProjectionPlanCompiler();
    const store = new BrunoTableClientProjectionStore(
      view,
      adapter,
      undefined,
      planCompiler,
    ).retain();
    view.dispatchGridCommand({
      type: "column.resize.commit",
      columnId: "COL_ID_GROUP",
      width: 180,
    });
    view.dispatchGridCommand({
      type: "column.pin.commit",
      columnId: "COL_ID_VALUE",
      pinned: "start",
    });
    view.dispatchGridCommand({ type: "grouping.add", columnId: "COL_ID_GROUP" });
    const installed = view.getInstalledClientProjectionSnapshot();
    expect(installed?.kind).toBe("grouped");
    if (installed === undefined) {
      throw new Error("Expected an installed grouped Client projection.");
    }
    const initialCompilations = planCompiler.getCompilationDiagnosticSnapshot();

    for (const [value, version] of [
      [2n, 2],
      [3n, 3],
    ] as const) {
      adapter.publish(source(value, version));
      adapter.publishProjectionInput(columns, adapter.getQueryConfiguration(columns));
      const next = view.getInstalledClientProjectionSnapshot();
      expect(next?.columns).toBe(installed.columns);
      expect(next?.columns.map((column) => column.valueFormatter)).toEqual(
        installed.columns.map((column) => column.valueFormatter),
      );
      expect(planCompiler.getCompilationDiagnosticSnapshot()).toEqual(initialCompilations);
    }
    store.release();
  });

  it("derives and installs one candidate for one column-configuration transition", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_GROUP",
        field: "group",
        headerName: "Group",
        valueType: "text",
        groupBy: true,
      },
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "bigint",
        aggFunc: "sum",
      },
    ]);
    type Row = Readonly<{ id: string; group: string; value: bigint }>;
    const adapter = new BrunoTableClientRowPipelineAdapter(
      { rows: [{ id: "one", group: "A", value: 1n }], totalRows: 1, version: 1, status: "ready" },
      (row: Row) => row.id,
      columns,
      undefined,
      [{ columnId: "COL_ID_VALUE", direction: "asc" }],
    );
    const runtime = new BrunoTableGridRuntime(
      adapter.getPublication(),
      columns,
      adapter.getQueryConfiguration(columns),
      "TABLE_ID_ONE_PROJECTION_TRANSITION",
      { grouping: true },
    );
    const view = runtime.getView();
    const store = new BrunoTableClientProjectionStore(view, adapter, undefined).retain();
    view.dispatchGridCommand({ type: "grouping.add", columnId: "COL_ID_GROUP" });
    const projectGroupedRows = vi.spyOn(adapter, "projectGroupedRows");
    const queryNotifications = vi.fn();
    const columnNotifications = vi.fn();
    view.subscribeQuery(queryNotifications);
    view.subscribeColumnStructure(columnNotifications);
    const replacementColumns = compileColumns([
      {
        columnId: "COL_ID_GROUP",
        field: "group",
        headerName: "Renamed Group",
        valueType: "text",
        groupBy: true,
      },
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "bigint",
        aggFunc: "sum",
      },
    ]);

    adapter.publishProjectionInput(
      replacementColumns,
      adapter.getQueryConfiguration(replacementColumns),
    );

    expect(projectGroupedRows).toHaveBeenCalledOnce();
    expect(queryNotifications).toHaveBeenCalledOnce();
    expect(columnNotifications).not.toHaveBeenCalled();
    expect(view.getInstalledClientProjectionSnapshot()?.columns[0]?.headerName).toBe(
      "Renamed Group",
    );
    store.release();
  });

  it("does not execute dormant ordinary sorting while deriving grouped source rows", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_GROUP",
        field: "group",
        headerName: "Group",
        valueType: "text",
        groupBy: true,
      },
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "bigint",
        aggFunc: "sum",
      },
      {
        columnId: "COL_ID_DORMANT_SORT",
        field: "rank",
        headerName: "Dormant sort",
        valueType: "number",
      },
    ]);
    type Row = Readonly<{ id: string; group: string; value: bigint; rank: number }>;
    const rows = ["one", "two"].map(
      (id) =>
        Object.defineProperty({ id, group: "A", value: 1n }, "rank", {
          enumerable: true,
          get: () => {
            throw new TypeError("Dormant ordinary sort was evaluated.");
          },
        }) as Row,
    );
    const adapter = new BrunoTableClientRowPipelineAdapter(
      { rows, totalRows: 2, version: 1, status: "ready" },
      (candidate: Row) => candidate.id,
      columns,
      undefined,
      [{ columnId: "COL_ID_DORMANT_SORT", direction: "asc" }],
    );
    const projectionInput = adapter.getProjectionInputSnapshot();
    const filterCollection = compileClientFilterCollection([], columns);
    const rowModel = deriveClientProjectionRowModel(projectionInput.rows, {
      columns,
      columnLayout: getBrunoTableColumnLayoutSnapshot(createBrunoTableColumnLayout(columns)),
      filters: filterCollection.filters,
      filterCollection,
      quickFilter: "",
      quickFilterFields: [],
      orderBy: [{ columnId: "COL_ID_DORMANT_SORT", direction: "asc" }],
      groupBy: ["COL_ID_GROUP"],
      groupOrderBy: [{ columnId: "COL_ID_GROUP", direction: "asc" }],
      queryGeneration: 1,
      queryNavigationMode: "projection-reset",
    });

    expect(rowModel.kind).toBe("ready");
    if (rowModel.kind === "ready") expect(rowModel.rowIds).toEqual(["one", "two"]);
  });

  it("retains a hidden eligible key in the full logical projection authority", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_GROUP",
        field: "group",
        headerName: "Group",
        valueType: "text",
        groupBy: true,
      },
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "bigint",
        aggFunc: "sum",
      },
    ]);
    type Row = Readonly<{ id: string; group: string; value: bigint }>;
    const row: Row = { id: "one", group: "A", value: 1n };
    const adapter = new BrunoTableClientRowPipelineAdapter(
      { rows: [row], totalRows: 1, version: 1, status: "ready" },
      (candidate: Row) => candidate.id,
      columns,
      undefined,
      [{ columnId: "COL_ID_VALUE", direction: "asc" }],
    );
    const layout = applyBrunoTableGridCommand(createBrunoTableColumnLayout(columns), {
      type: "column.visibility.commit",
      columnId: "COL_ID_GROUP",
      visible: false,
    });
    const filterCollection = compileClientFilterCollection([], columns);
    const rowModel = deriveClientProjectionRowModel(adapter.getProjectionInputSnapshot().rows, {
      columns,
      columnLayout: getBrunoTableColumnLayoutSnapshot(layout),
      filters: filterCollection.filters,
      filterCollection,
      quickFilter: "",
      quickFilterFields: [],
      orderBy: [{ columnId: "COL_ID_VALUE", direction: "asc" }],
      groupBy: ["COL_ID_GROUP"],
      groupOrderBy: [{ columnId: "COL_ID_GROUP", direction: "asc" }],
      queryGeneration: 1,
      queryNavigationMode: "projection-reset",
    });

    expect(rowModel.kind).toBe("ready");
    if (rowModel.kind !== "ready") return;
    expect(rowModel.columns.map((column) => column.columnId)).toEqual([
      "COL_ID_GROUP",
      "COL_ID_VALUE",
    ]);
    expect(rowModel.visibleColumns.map((column) => column.columnId)).toEqual(["COL_ID_VALUE"]);
  });
});
