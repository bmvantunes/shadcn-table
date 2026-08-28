import {
  memo,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { ReactNode } from "react";

import type {
  BrunoTableClientProps,
  BrunoTableColumns,
  BrunoTableEditableClientProps,
  BrunoTableJsonValue,
  BrunoTableReadOnlyClientProps,
  BrunoTableSortBy,
} from "./public-types";
import {
  BrunoTableToolbar,
  BrunoTableToolbarStore,
  BrunoTableView,
} from "./internal/bruno-table-view";
import {
  BrunoTableClientProjectionStore,
  BrunoTableClientRowPipeline,
} from "./internal/client-row-pipeline";
import {
  BrunoTableClientFilterProvider,
  BrunoTableActiveFilters,
  BrunoTableQuickFilter,
  renderBrunoTableClientColumnFilter,
} from "./internal/client-filter-controls";
import {
  BrunoTableClientRowPipelineAdapter,
  type BrunoTableClientProjectionInputSnapshot,
} from "./internal/client-source-adapter";
import { compileColumns } from "./internal/compile-columns";
import { BrunoTableGridRuntime, isBrunoTableInvalidCellValue } from "./internal/grid-runtime";
import { registerBrunoTableIdentity } from "./internal/table-identity-registry";
import {
  BrunoTableActiveFilterCount,
  BrunoTableActiveSortCount,
  BrunoTableFilterControl,
  BrunoTableLoadedRowCount,
  BrunoTableResultRowCount,
  BrunoTableToolbarProvider,
  BrunoTableToolbarSpacer,
} from "./internal/toolbar-capabilities";
import { recordBrunoTableToolbarLifetime } from "./internal/toolbar-instrumentation";
import { BrunoTableRowSelectionRuntime } from "./internal/row-selection";
import { BrunoTableCellRangeRuntime } from "./internal/cell-range-clipboard";
import {
  BrunoTableCellEditRuntime,
  type BrunoTableCellEditDraftReviewSourceRow,
} from "./internal/cell-edit";
import { resolveBrunoTableCellContent } from "./internal/cell-presentation";
import { BrunoTableEditModeControl } from "./internal/edit-chrome";
import { BrunoTableEditMemoryRuntime } from "./internal/edit-memory";
import {
  adaptBrunoTableSaveHandler,
  BrunoTableSaveOperationRuntime,
} from "./internal/save-operations";
import { compileBrunoTableGroupRowsColumn } from "./internal/client-grouping-presentation";
import { BrunoTableClientGroupBy } from "./internal/client-grouping-controls";

function adaptBrunoTableRowVersionExtractor<TRow>(
  extractor: ((row: TRow) => unknown) | undefined,
): ((row: object) => unknown) | undefined {
  return extractor === undefined ? undefined : (row) => extractor(row as TRow);
}

function hasAuthoritativeBrunoTableEditSource(
  projectionInput: BrunoTableClientProjectionInputSnapshot,
): boolean {
  return (
    projectionInput.sourceRowIds.authoritative &&
    (projectionInput.publication.status === "ready" ||
      projectionInput.publication.status === "stale")
  );
}

export {
  BrunoTableActiveFilterCount,
  BrunoTableActiveSortCount,
  BrunoTableFilterControl,
  BrunoTableLoadedRowCount,
  BrunoTableQuickFilter,
  BrunoTableResultRowCount,
  BrunoTableToolbar,
  BrunoTableToolbarSpacer,
};
export type {
  BrunoTableFilterControlProps,
  BrunoTableGridFilterCommandCapability,
} from "./internal/toolbar-capabilities";

export function BrunoTableClient<
  TRow,
  const TColumns extends BrunoTableColumns<TRow>,
  TGetRowVersion extends (row: TRow) => unknown,
>(props: BrunoTableEditableClientProps<TRow, TColumns, TGetRowVersion>): ReactNode;
export function BrunoTableClient<TRow, const TColumns extends BrunoTableColumns<TRow>, TRowVersion>(
  props: BrunoTableClientProps<TRow, TColumns, TRowVersion>,
): ReactNode;
export function BrunoTableClient<TRow, const TColumns extends BrunoTableColumns<TRow>>(
  props: BrunoTableReadOnlyClientProps<TRow, TColumns>,
): ReactNode;
export function BrunoTableClient<TRow, const TColumns extends BrunoTableColumns<TRow>, TRowVersion>(
  props: BrunoTableClientProps<TRow, TColumns, TRowVersion>,
): ReactNode {
  const tableId = requireBrunoTableId(props.tableId);
  return (
    <BrunoTableClientInstance
      key={`${tableId}:${props.editable === true ? "editable" : "readonly"}`}
      props={props}
      tableId={tableId}
    />
  );
}

function BrunoTableClientInstance<
  TRow,
  const TColumns extends BrunoTableColumns<TRow>,
  TRowVersion,
>({
  gridAriaLabel,
  props,
  registerIdentity = true,
  tableId,
}: Readonly<{
  readonly gridAriaLabel?: string;
  readonly props: BrunoTableClientProps<TRow, TColumns, TRowVersion>;
  readonly registerIdentity?: boolean;
  readonly tableId: string;
}>): ReactNode {
  const compiledColumns = useMemo(() => compileColumns(props.columns), [props.columns]);
  const editable = props.editable === true;
  const onSaveEdits = props.onSaveEdits;
  if (editable && typeof props.getRowVersion !== "function") {
    throw new TypeError("BrunoTable editable Client Tables require getRowVersion.");
  }
  if (editable && typeof onSaveEdits !== "function") {
    throw new TypeError("BrunoTable editable Client Tables require onSaveEdits.");
  }
  if (
    editable &&
    !compiledColumns.some(
      (column) =>
        column.kind === "field" && column.isEditable !== undefined && column.isEditable !== false,
    )
  ) {
    throw new TypeError(
      "BrunoTable editable Client Tables require at least one potentially editable column.",
    );
  }
  const normalizedGroupRowsColumn = useMemo(
    () => compileBrunoTableGroupRowsColumn(editable ? undefined : props.groupRowsColumn),
    [editable, props.groupRowsColumn],
  );
  const {
    cellClassName: groupRowsCellClassName,
    cellRenderer: groupRowsCellRenderer,
    headerName: groupRowsHeaderName,
    valueFormatter: groupRowsValueFormatter,
    width: groupRowsWidth,
  } = normalizedGroupRowsColumn;
  const groupRowsColumn = useMemo(
    () =>
      Object.freeze({
        headerName: groupRowsHeaderName,
        width: groupRowsWidth,
        ...(groupRowsValueFormatter === undefined
          ? {}
          : { valueFormatter: groupRowsValueFormatter }),
        ...(groupRowsCellRenderer === undefined ? {} : { cellRenderer: groupRowsCellRenderer }),
        ...(groupRowsCellClassName === undefined ? {} : { cellClassName: groupRowsCellClassName }),
      }),
    [
      groupRowsCellClassName,
      groupRowsCellRenderer,
      groupRowsHeaderName,
      groupRowsValueFormatter,
      groupRowsWidth,
    ],
  );
  const [rowSelectionRuntime] = useState(() => new BrunoTableRowSelectionRuntime([]));
  const rowSelectionEnabled = props.rowSelection === true;
  const rowSelection = rowSelectionEnabled ? rowSelectionRuntime : undefined;
  const previousRowSelectionEnabled = useRef(rowSelectionEnabled);
  const [cellRange] = useState(() => new BrunoTableCellRangeRuntime(tableId));
  const [rowPipelineAdapter] = useState(
    () =>
      new BrunoTableClientRowPipelineAdapter(
        props.clientSource,
        props.getRowId,
        compiledColumns,
        props.initialFilters,
        props.initialOrderBy,
        props.quickFilterFields,
        groupRowsColumn,
      ),
  );
  const [runtime] = useState(() => {
    const created = new BrunoTableGridRuntime(
      rowPipelineAdapter.getPublication(),
      compiledColumns,
      rowPipelineAdapter.getQueryConfiguration(compiledColumns),
      tableId,
      {
        initialPersistedState: props.initialPersistedState,
        grouping: !editable,
        groupRowsWidth: groupRowsColumn.width,
        beforeGroupingChange: (entering) => {
          cellRange.clear();
          if (entering) rowSelectionRuntime.enterGroupedProjection();
        },
      },
    );
    if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
      recordBrunoTableToolbarLifetime({
        tableId,
        kind: "runtime-create",
        identity: created,
      });
    }
    return created;
  });
  const [editMemory] = useState(() => (editable ? new BrunoTableEditMemoryRuntime() : undefined));
  const [cellEdit] = useState(() =>
    editable
      ? new BrunoTableCellEditRuntime({
          columns: compiledColumns,
          getRow: rowPipelineAdapter.getAuthoritativeEditRowSnapshot,
          getCanonicalValue: (rowId, columnId) => {
            const snapshot = rowPipelineAdapter.getAuthoritativeEditCellSnapshot(rowId, columnId);
            return snapshot.found && !isBrunoTableInvalidCellValue(snapshot.value)
              ? Object.freeze({ _tag: "Success" as const, value: snapshot.value })
              : Object.freeze({ _tag: "Failure" as const });
          },
          ...(props.getRowVersion === undefined
            ? {}
            : { getRowVersion: adaptBrunoTableRowVersionExtractor(props.getRowVersion)! }),
          isSourceAuthoritative: () => {
            const projectionInput = rowPipelineAdapter.getProjectionInputSnapshot();
            return hasAuthoritativeBrunoTableEditSource(projectionInput);
          },
          ...(editMemory === undefined
            ? {}
            : {
                onCommit: (change) => editMemory.requestImmediateSave([change]),
                onCommitGesture: (changes) => editMemory.requestImmediateSave(changes),
              }),
          incrementalTraversal: true,
        })
      : undefined,
  );
  const [saveOperations] = useState(() =>
    cellEdit === undefined || editMemory === undefined
      ? undefined
      : new BrunoTableSaveOperationRuntime(cellEdit, editMemory),
  );
  const renderResetReview = useCallback(
    (reviewRows: readonly BrunoTableCellEditDraftReviewSourceRow[]) => (
      <BrunoTableResetReviewTable reviewRows={reviewRows} />
    ),
    [],
  );
  const [toolbar] = useState(() => new BrunoTableToolbarStore(props.children));
  const runtimeView = runtime.getView();
  const [projectionStore] = useState(
    () => new BrunoTableClientProjectionStore(runtimeView, rowPipelineAdapter, rowSelection),
  );

  useLayoutEffect(() => {
    projectionStore.setRowSelection(rowSelection);
  }, [projectionStore, rowSelection]);
  useLayoutEffect(() => {
    cellEdit?.setRowVersionExtractor(adaptBrunoTableRowVersionExtractor(props.getRowVersion));
  }, [cellEdit, props.getRowVersion]);
  useLayoutEffect(() => projectionStore.activate(), [projectionStore]);
  useLayoutEffect(() => {
    editMemory?.activate();
    return () => editMemory?.dispose();
  }, [editMemory]);
  useLayoutEffect(() => {
    if (editMemory === undefined || cellEdit === undefined) return;
    return editMemory.connectCellEdit(cellEdit);
  }, [cellEdit, editMemory]);
  useLayoutEffect(() => {
    if (saveOperations === undefined || onSaveEdits === undefined) return;
    return saveOperations.setHandler(adaptBrunoTableSaveHandler(onSaveEdits));
  }, [onSaveEdits, saveOperations]);
  useLayoutEffect(() => {
    if (saveOperations === undefined) return;
    return saveOperations.activate();
  }, [saveOperations]);
  useLayoutEffect(() => {
    if (editMemory === undefined) return;
    return runtime.registerEditCommandHandler((command) => {
      switch (command.type) {
        case "edits.reset":
          return editMemory.openResetReview();
        case "edits.undo":
          return editMemory.undo();
        case "edits.redo":
          return editMemory.redo();
      }
    });
  }, [editMemory, runtime]);
  useLayoutEffect(() => {
    const previouslyEnabled = previousRowSelectionEnabled.current;
    previousRowSelectionEnabled.current = rowSelectionEnabled;
    if (previouslyEnabled && !rowSelectionEnabled) {
      rowSelectionRuntime.enterGroupedProjection();
      return;
    }
    if (!previouslyEnabled && rowSelectionEnabled) {
      const projectionInput = rowPipelineAdapter.getProjectionInputSnapshot();
      if (runtime.getGroupBySnapshot().length === 0) {
        rowSelectionRuntime.leaveGroupedProjection(
          projectionInput.sourceRowIds.authoritative ? projectionInput.sourceRowIds.rowIds : [],
        );
      }
    }
  }, [rowPipelineAdapter, rowSelectionEnabled, rowSelectionRuntime, runtime]);
  const gridOwnedControls = useMemo(
    () => (
      <>
        {editable ? (
          editMemory === undefined ? null : (
            <BrunoTableEditModeControl runtime={editMemory} />
          )
        ) : (
          <BrunoTableClientGroupBy columns={compiledColumns} runtime={runtimeView} />
        )}
        <BrunoTableActiveFilters />
      </>
    ),
    [compiledColumns, editable, editMemory, runtimeView],
  );

  useLayoutEffect(() => {
    const publication = rowPipelineAdapter.reconcile(
      props.clientSource,
      props.getRowId,
      compiledColumns,
      groupRowsColumn,
    );
    const queryConfiguration = rowPipelineAdapter.getQueryConfiguration(compiledColumns);
    const installedProjection = runtime.getInstalledClientProjectionSnapshot();
    const groupingProjectionActive =
      runtime.getQuerySnapshot().groupBy.length > 0 ||
      installedProjection?.kind === "grouped" ||
      installedProjection?.kind === "invalid";
    rowPipelineAdapter.publishProjectionInput(
      compiledColumns,
      queryConfiguration,
      groupingProjectionActive,
    );
    editMemory?.setSavePreflightAvailable(
      hasAuthoritativeBrunoTableEditSource(rowPipelineAdapter.getProjectionInputSnapshot()),
    );
    cellEdit?.reconcileColumns(compiledColumns, (rowId) =>
      rowPipelineAdapter.getAuthoritativeEditRowSnapshot(rowId),
    );
    cellEdit?.reconcileSourceRows(publication.changedRowIds);
    cellEdit?.reconcileActiveRow(publication.changedRowIds);
    if (!groupingProjectionActive) {
      runtime.reconcile(publication, compiledColumns, queryConfiguration, groupRowsColumn.width);
    }
  }, [
    cellEdit,
    compiledColumns,
    editMemory,
    groupRowsColumn,
    props.clientSource,
    props.getRowId,
    rowPipelineAdapter,
    runtime,
  ]);

  useLayoutEffect(() => {
    runtime.setOnPersistChange(
      props.onPersistChange as
        | ((state: Readonly<Record<string, BrunoTableJsonValue>>) => void)
        | undefined,
    );
  }, [props.onPersistChange, runtime]);

  useLayoutEffect(() => {
    toolbar.publish(props.children);
  }, [props.children, toolbar]);

  useLayoutEffect(
    () =>
      __BRUNO_TABLE_DEVELOPMENT__ && registerIdentity
        ? registerBrunoTableIdentity(tableId, compiledColumns)
        : undefined,
    [compiledColumns, registerIdentity, tableId],
  );

  useLayoutEffect(() => () => cellRange.dispose(), [cellRange]);
  useLayoutEffect(() => {
    cellEdit?.activate();
    return () => cellEdit?.dispose();
  }, [cellEdit]);
  return (
    <BrunoTableClientFilterProvider facetRows={rowPipelineAdapter} runtime={runtimeView}>
      <BrunoTableToolbarProvider
        columns={compiledColumns}
        resultRows={rowPipelineAdapter}
        runtime={runtimeView}
        tableId={tableId}
      >
        <BrunoTableView
          runtime={runtimeView}
          tableId={tableId}
          {...(gridAriaLabel === undefined ? {} : { gridAriaLabel })}
          compiledColumns={compiledColumns}
          toolbar={toolbar}
          rowPipeline={BrunoTableClientRowPipeline}
          rowPipelineAdapter={rowPipelineAdapter}
          rowSelection={rowSelection}
          cellRange={cellRange}
          cellEdit={cellEdit}
          editMemory={editMemory}
          renderResetReview={renderResetReview}
          renderColumnFilter={renderBrunoTableClientColumnFilter}
          gridOwnedControls={gridOwnedControls}
        />
      </BrunoTableToolbarProvider>
    </BrunoTableClientFilterProvider>
  );
}

type BrunoTableResetReviewDisplayRow = BrunoTableCellEditDraftReviewSourceRow;

const BrunoTableResetReviewValue = memo(function BrunoTableResetReviewValue({
  row,
  kind,
}: Readonly<{
  readonly row: BrunoTableResetReviewDisplayRow;
  readonly kind: "server" | "mine";
}>): ReactNode {
  const snapshot = useSyncExternalStore(row.subscribe, row.getSnapshot, row.getSnapshot);
  const sourceRow = kind === "server" ? snapshot.serverRow : snapshot.projectedRow;
  if (sourceRow === undefined) return "Row missing";
  if (kind === "server" && !snapshot.serverValueAvailable) return "Unavailable";
  const value = kind === "server" ? snapshot.serverNow : snapshot.mine;
  const content =
    kind === "mine" && snapshot.candidateText !== undefined
      ? snapshot.candidateText
      : resolveBrunoTableCellContent(snapshot.column, sourceRow, value);
  return content;
});

const BrunoTableResetReviewStatus = memo(function BrunoTableResetReviewStatus({
  row,
}: Readonly<{ readonly row: BrunoTableResetReviewDisplayRow }>): ReactNode {
  const snapshot = useSyncExternalStore(row.subscribe, row.getSnapshot, row.getSnapshot);
  return snapshot.status;
});

const brunoTableResetReviewColumns = [
  {
    columnId: "COL_ID_ROW",
    field: "rowId",
    headerName: "Row",
    valueType: "text",
    pinned: "start",
  },
  {
    columnId: "COL_ID_COLUMN",
    field: "columnLabel",
    headerName: "Column",
    valueType: "text",
    pinned: "start",
  },
  {
    columnId: "COL_ID_SERVER_NOW",
    field: "serverText",
    headerName: "Server now",
    valueType: "text",
    enableSorting: false,
    enableFilter: false,
    cellRenderer: ({ row }: { readonly row: BrunoTableResetReviewDisplayRow }) => (
      <BrunoTableResetReviewValue row={row} kind="server" />
    ),
  },
  {
    columnId: "COL_ID_YOURS",
    field: "mineText",
    headerName: "Yours",
    valueType: "text",
    enableSorting: false,
    enableFilter: false,
    cellRenderer: ({ row }: { readonly row: BrunoTableResetReviewDisplayRow }) => (
      <BrunoTableResetReviewValue row={row} kind="mine" />
    ),
  },
  {
    columnId: "COL_ID_STATUS",
    field: "statusText",
    headerName: "Status",
    valueType: "text",
    enableSorting: false,
    enableFilter: false,
    cellRenderer: ({ row }: { readonly row: BrunoTableResetReviewDisplayRow }) => (
      <BrunoTableResetReviewStatus row={row} />
    ),
  },
] satisfies BrunoTableColumns<BrunoTableResetReviewDisplayRow>;
const BRUNO_TABLE_RESET_REVIEW_INITIAL_ORDER_BY = [
  { columnId: "COL_ID_ROW", direction: "asc" },
] as const satisfies BrunoTableSortBy<typeof brunoTableResetReviewColumns>;
const getBrunoTableResetReviewRowId = (row: BrunoTableResetReviewDisplayRow): string => row.id;

function BrunoTableResetReviewTable({
  reviewRows,
}: Readonly<{
  readonly reviewRows: readonly BrunoTableCellEditDraftReviewSourceRow[];
}>): ReactNode {
  const instanceId = useId();
  const tableId = `BRUNO_TABLE_INTERNAL_RESET_REVIEW_${instanceId}`;
  const rows = reviewRows;
  if (rows.length === 0) {
    return <p role="status">All changes now match the server.</p>;
  }
  return (
    <BrunoTableClientInstance
      gridAriaLabel="Reset Review changes"
      tableId={tableId}
      registerIdentity={false}
      props={{
        tableId,
        columns: brunoTableResetReviewColumns,
        initialOrderBy: BRUNO_TABLE_RESET_REVIEW_INITIAL_ORDER_BY,
        clientSource: {
          rows,
          totalRows: rows.length,
          version: rows.length,
          status: "ready",
        },
        getRowId: getBrunoTableResetReviewRowId,
      }}
    />
  );
}

function requireBrunoTableId(tableId: unknown): string {
  if (typeof tableId !== "string" || tableId.trim().length === 0) {
    throw new TypeError("BrunoTable tableId must be a non-empty string.");
  }
  return tableId;
}
