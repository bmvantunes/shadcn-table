import { describe, expect, it, vi } from "vitest";

import { compileColumns } from "./compile-columns";
import {
  applyBrunoTableGridCommand,
  createBrunoTableColumnLayout,
  getBrunoTableColumnLayoutSnapshot,
} from "./column-management";
import { ClientRowOrderStore, deriveClientProjectionRowModel } from "./client-row-pipeline";
import { BrunoTableClientRowPipelineAdapter } from "./client-source-adapter";
import { compileClientFilterCollection } from "./grid-query";

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
    const row = Object.defineProperty({ id: "one", group: "A", value: 1n }, "rank", {
      enumerable: true,
      get: () => {
        throw new TypeError("Dormant ordinary sort was evaluated.");
      },
    }) as Row;
    const adapter = new BrunoTableClientRowPipelineAdapter(
      { rows: [row], totalRows: 1, version: 1, status: "ready" },
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
    if (rowModel.kind === "ready") expect(rowModel.rowIds).toEqual(["one"]);
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
