import { describe, expect, it, vi } from "vitest";

import { compileColumns } from "./compile-columns";
import {
  BRUNO_TABLE_ROWS_COLUMN_ID,
  type BrunoTableClientGroupedProjection,
  type BrunoTableClientGroupedRow,
} from "./client-grouping";
import {
  compileBrunoTableGroupRowsColumn,
  createBrunoTableGroupedColumns,
} from "./client-grouping-presentation";
import {
  BrunoTableClientProjectionCoordinator,
  createBrunoTableGroupedProjectionCandidate,
  createBrunoTableInvalidProjectionCandidate,
  createBrunoTableRawProjectionCandidate,
  type BrunoTableClientProjectionCandidate,
} from "./client-projection";
import {
  BrunoTableGridRuntime,
  type BrunoTableInstalledClientProjectionSnapshot,
  type BrunoTableRowPipelinePublication,
  type BrunoTableRowPipelineRuntimeView,
} from "./grid-runtime";

const columns = compileColumns([
  {
    columnId: "COL_ID_DESK",
    field: "desk",
    headerName: "Desk",
    valueType: "text",
    groupBy: true,
  },
  {
    columnId: "COL_ID_REGION",
    field: "region",
    headerName: "Region",
    valueType: "text",
    groupBy: true,
  },
  {
    columnId: "COL_ID_QUANTITY",
    field: "quantity",
    headerName: "Quantity",
    valueType: "bigint",
    aggFunc: "sum",
  },
]);

describe("BrunoTableClientProjectionCoordinator", () => {
  it("atomically installs one wholly coherent structural epoch per accepted transition", () => {
    const initial = rawCandidate(0, ["raw-a", "raw-b"]);
    const runtime = createRuntime(initial.publication);
    const view = runtime.getView();
    const coordinator = new BrunoTableClientProjectionCoordinator(initial);
    expect(coordinator.commit(initial, view.publishRowPipeline)).toBe(true);

    const records: ReturnType<typeof recordProjection>[] = [];
    view.subscribeInstalledClientProjection(() => {
      const snapshot = view.getInstalledClientProjectionSnapshot();
      if (snapshot !== undefined) records.push(recordProjection(snapshot, view));
    });
    const transitions = [
      groupedCandidate(1, ["COL_ID_DESK"], [groupedRow("group-desk", 1n)]),
      groupedCandidate(2, ["COL_ID_DESK", "COL_ID_REGION"], [groupedRow("group-desk-region", 2n)]),
      groupedCandidate(3, ["COL_ID_REGION", "COL_ID_DESK"], [groupedRow("group-region-desk", 3n)]),
      groupedCandidate(4, ["COL_ID_DESK"], [groupedRow("group-desk", 4n)]),
      rawCandidate(5, ["raw-b", "raw-a"]),
      invalidCandidate(6, ["COL_ID_DESK"]),
      groupedCandidate(7, ["COL_ID_DESK"], [groupedRow("group-recovered", 7n)]),
    ];

    for (const candidate of transitions) {
      expect(coordinator.commit(candidate, view.publishRowPipeline)).toBe(true);
    }

    expect(records).toHaveLength(transitions.length - 1);
    expect(records.map(({ epoch, kind, groupBy }) => ({ epoch, kind, groupBy }))).toEqual([
      { epoch: 0, kind: "grouped", groupBy: ["COL_ID_DESK"] },
      { epoch: 1, kind: "grouped", groupBy: ["COL_ID_DESK", "COL_ID_REGION"] },
      { epoch: 2, kind: "grouped", groupBy: ["COL_ID_REGION", "COL_ID_DESK"] },
      { epoch: 3, kind: "grouped", groupBy: ["COL_ID_DESK"] },
      { epoch: 0, kind: "invalid", groupBy: ["COL_ID_DESK"] },
      { epoch: 1, kind: "grouped", groupBy: ["COL_ID_DESK"] },
    ]);
    expect(records.map(({ columnIds }) => columnIds)).toEqual([
      ["COL_ID_DESK", BRUNO_TABLE_ROWS_COLUMN_ID, "COL_ID_QUANTITY"],
      ["COL_ID_DESK", "COL_ID_REGION", BRUNO_TABLE_ROWS_COLUMN_ID, "COL_ID_QUANTITY"],
      ["COL_ID_REGION", "COL_ID_DESK", BRUNO_TABLE_ROWS_COLUMN_ID, "COL_ID_QUANTITY"],
      ["COL_ID_DESK", BRUNO_TABLE_ROWS_COLUMN_ID, "COL_ID_QUANTITY"],
      ["COL_ID_DESK", "COL_ID_REGION", "COL_ID_QUANTITY"],
      ["COL_ID_DESK", BRUNO_TABLE_ROWS_COLUMN_ID, "COL_ID_QUANTITY"],
    ]);
    for (const record of records) expect(record.rowIds).toEqual(record.authorityRowIds);
  });

  it("keeps the stable runtime and fine cell subscriptions for value-only publications", () => {
    const initial = groupedCandidate(
      1,
      ["COL_ID_DESK"],
      [groupedRow("group-a", 1n), groupedRow("group-b", 2n)],
    );
    const runtime = createRuntime(publication([]));
    const view = runtime.getView();
    const coordinator = new BrunoTableClientProjectionCoordinator(initial);
    coordinator.commit(initial, view.publishRowPipeline);
    const installed = view.getInstalledClientProjectionSnapshot();
    const structuralListener = vi.fn();
    const changedCellListener = vi.fn();
    const unchangedCellListener = vi.fn();
    view.subscribeInstalledClientProjection(structuralListener);
    view.subscribeCell("group-a", "COL_ID_QUANTITY", changedCellListener);
    view.subscribeCell("group-b", "COL_ID_QUANTITY", unchangedCellListener);

    for (let value = 2n; value <= 21n; value += 1n) {
      coordinator.commit(
        groupedCandidate(
          1,
          ["COL_ID_DESK"],
          [groupedRow("group-a", value), groupedRow("group-b", 2n)],
          new Set(["group-a"]),
        ),
        view.publishRowPipeline,
      );
    }

    expect(runtime.getView()).toBe(view);
    expect(view.getInstalledClientProjectionSnapshot()).toBe(installed);
    expect(structuralListener).not.toHaveBeenCalled();
    expect(changedCellListener).toHaveBeenCalledTimes(20);
    expect(unchangedCellListener).not.toHaveBeenCalled();
    expect(view.getCellSnapshot("group-a", "COL_ID_QUANTITY")).toMatchObject({
      kind: "available",
      value: 21n,
    });
  });

  it("keeps the old epoch visible until commit and does not roll back on listener failure", () => {
    const initial = rawCandidate(0, ["raw-a"]);
    const runtime = createRuntime(initial.publication);
    const view = runtime.getView();
    const coordinator = new BrunoTableClientProjectionCoordinator(initial);
    coordinator.commit(initial, view.publishRowPipeline);
    const deferred = groupedCandidate(1, ["COL_ID_DESK"], [groupedRow("group-a", 1n)]);
    expect(view.getInstalledClientProjectionSnapshot()).toBeUndefined();
    expect(view.getRowSpaceSnapshot()?.getRowId(0)).toBe("raw-a");

    const laterListener = vi.fn();
    view.subscribeInstalledClientProjection(() => {
      throw new Error("listener failed");
    });
    view.subscribeInstalledClientProjection(laterListener);
    expect(() => coordinator.commit(deferred, view.publishRowPipeline)).toThrow("listener failed");
    expect(view.getInstalledClientProjectionSnapshot()).toMatchObject({
      epoch: 0,
      kind: "grouped",
      rowIds: ["group-a"],
    });
    expect(view.getRowSpaceSnapshot()?.getRowId(0)).toBe("group-a");
    expect(view.getCellSnapshot("group-a", "COL_ID_QUANTITY").column?.columnId).toBe(
      "COL_ID_QUANTITY",
    );
    expect(laterListener).toHaveBeenCalledOnce();
  });

  it("stages active-key removal without publishing and installs configuration plus raw authority once", () => {
    const runtime = createRuntime(publication(["raw-a"]));
    const view = runtime.getView();
    view.dispatchGridCommand({ type: "grouping.add", columnId: "COL_ID_DESK" });
    const grouped = groupedCandidate(1, ["COL_ID_DESK"], [groupedRow("group-a", 1n)]);
    const coordinator = new BrunoTableClientProjectionCoordinator(grouped);
    coordinator.commit(grouped, (candidatePublication) =>
      view.reconcileClientProjection(
        candidatePublication,
        columns,
        {
          baselineFilters: [],
          baselineOrderBy: [{ columnId: "COL_ID_DESK", direction: "asc" }],
        },
        96,
      ),
    );
    const replacementColumns = compileColumns([
      {
        columnId: "COL_ID_DESK",
        field: "desk",
        headerName: "Desk",
        valueType: "text",
      },
      columns[1],
      columns[2],
    ]);
    const queryListener = vi.fn();
    const projectionListener = vi.fn();
    view.subscribeQuery(queryListener);
    view.subscribeInstalledClientProjection(projectionListener);

    const staged = view.stageClientProjectionConfiguration(
      replacementColumns,
      {
        baselineFilters: [],
        baselineOrderBy: [{ columnId: "COL_ID_DESK", direction: "asc" }],
      },
      96,
    );
    expect(staged.query).toMatchObject({
      columns: replacementColumns,
      groupBy: [],
      navigationMode: "projection-reset",
    });
    expect(view.getQuerySnapshot().groupBy).toEqual(["COL_ID_DESK"]);
    expect(queryListener).not.toHaveBeenCalled();
    expect(projectionListener).not.toHaveBeenCalled();

    const raw = createBrunoTableRawProjectionCandidate({
      columns: replacementColumns,
      rowIds: ["raw-a"],
      publication: publication(["raw-a"]),
      queryGeneration: staged.query.generation,
      queryNavigationMode: staged.query.navigationMode,
    });
    const rawCoordinator = new BrunoTableClientProjectionCoordinator(raw);
    rawCoordinator.commit(raw, (candidatePublication) =>
      view.reconcileClientProjection(
        candidatePublication,
        replacementColumns,
        {
          baselineFilters: [],
          baselineOrderBy: [{ columnId: "COL_ID_DESK", direction: "asc" }],
        },
        96,
      ),
    );

    expect(queryListener).toHaveBeenCalledOnce();
    expect(projectionListener).toHaveBeenCalledOnce();
    expect(view.getInstalledClientProjectionSnapshot()).toBeUndefined();
    expect(view.getQuerySnapshot().groupBy).toEqual([]);
    expect(view.getRowSpaceSnapshot()?.getRowId(0)).toBe("raw-a");
  });
});

function createRuntime(publication: BrunoTableRowPipelinePublication<unknown>) {
  return new BrunoTableGridRuntime(
    publication,
    columns,
    {
      baselineFilters: [],
      baselineOrderBy: [{ columnId: "COL_ID_DESK", direction: "asc" }],
    },
    "TABLE_ID_CLIENT_PROJECTION",
    { grouping: true },
  );
}

function rawCandidate(
  generation: number,
  rowIds: readonly string[],
): BrunoTableClientProjectionCandidate {
  return createBrunoTableRawProjectionCandidate({
    columns,
    rowIds,
    publication: publication(rowIds),
    queryGeneration: generation,
    queryNavigationMode: generation === 0 ? "reconcile" : "projection-reset",
  });
}

function groupedCandidate(
  generation: number,
  groupBy: readonly string[],
  rows: readonly BrunoTableClientGroupedRow[],
  changedRowIds?: ReadonlySet<string>,
): BrunoTableClientProjectionCandidate {
  const rowIds = Object.freeze(rows.map(({ rowId }) => rowId));
  const projection: Extract<BrunoTableClientGroupedProjection, { readonly kind: "ready" }> =
    Object.freeze({
      kind: "ready",
      groupBy: Object.freeze(Array.from(groupBy)),
      rows: Object.freeze(Array.from(rows)),
      rowIds,
    });
  const groupedColumns = createBrunoTableGroupedColumns({
    columns,
    visibleColumnIds: columns.map(({ columnId }) => columnId),
    groupBy,
    rowsColumn: compileBrunoTableGroupRowsColumn(undefined),
  });
  return createBrunoTableGroupedProjectionCandidate({
    projection,
    columns: groupedColumns,
    publication: publication(rowIds, rows, changedRowIds),
    queryGeneration: generation,
    queryNavigationMode: "projection-reset",
  });
}

function invalidCandidate(
  generation: number,
  groupBy: readonly string[],
): BrunoTableClientProjectionCandidate {
  return createBrunoTableInvalidProjectionCandidate({
    groupBy,
    columns,
    publication: publication([]),
    queryGeneration: generation,
    queryNavigationMode: "clear",
    invalid: Object.freeze({
      kind: "invalid-value",
      rowIndex: 0,
      columnId: "COL_ID_QUANTITY",
      message: "Invalid aggregate result.",
    }),
  });
}

function groupedRow(rowId: string, quantity: bigint): BrunoTableClientGroupedRow {
  return Object.freeze({
    rowId,
    rowCount: 1n,
    groupKeys: Object.freeze([{ _tag: "Present" as const, value: rowId }]),
    values: new Map<string, unknown>([
      ["COL_ID_DESK", rowId],
      [BRUNO_TABLE_ROWS_COLUMN_ID, 1n],
      ["COL_ID_QUANTITY", quantity],
    ]),
    presences: new Map(),
  });
}

function publication(
  rowIds: readonly string[],
  rows: readonly BrunoTableClientGroupedRow[] = [],
  changedRowIds?: ReadonlySet<string>,
): BrunoTableRowPipelinePublication<unknown> {
  const rowsById = new Map(rows.map((row) => [row.rowId, row]));
  return Object.freeze({
    status: "ready",
    totalRows: rowIds.length,
    version: 1,
    hasCoherentRows: true,
    ...(changedRowIds === undefined ? {} : { changedRowIds }),
    rowSpace: Object.freeze({
      totalRows: rowIds.length,
      loadedRows: rowIds.length,
      getRowId: (index: number) => rowIds[index],
      getRow: (rowId: string) => rowsById.get(rowId),
      getCellValue: (rowId: string, columnId: string) => rowsById.get(rowId)?.values.get(columnId),
    }),
  });
}

function recordProjection(
  snapshot: BrunoTableInstalledClientProjectionSnapshot,
  runtime: BrunoTableRowPipelineRuntimeView,
) {
  const authority = runtime.getRowSpaceSnapshot();
  return Object.freeze({
    epoch: snapshot.epoch,
    kind: snapshot.kind,
    groupBy: Array.from(snapshot.groupBy),
    columnIds: snapshot.columns.map(({ columnId }) => columnId),
    rowIds: Array.from(snapshot.rowIds),
    authorityRowIds: Array.from({ length: authority?.totalRows ?? 0 }, (_, index) =>
      authority?.getRowId(index),
    ),
  });
}
