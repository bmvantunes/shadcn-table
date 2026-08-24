import { useLayoutEffect, useMemo, useState } from "react";

import type { ReactNode } from "react";

import type {
  BrunoTableClientProps,
  BrunoTableColumns,
  BrunoTablePersistedState,
} from "./public-types";
import {
  BrunoTableToolbar,
  BrunoTableToolbarStore,
  BrunoTableView,
} from "./internal/bruno-table-view";
import {
  acquireBrunoTableClientProjectionStore,
  BrunoTableClientRowPipeline,
} from "./internal/client-row-pipeline";
import {
  BrunoTableClientFilterProvider,
  BrunoTableActiveFilters,
  BrunoTableQuickFilter,
  renderBrunoTableClientColumnFilter,
} from "./internal/client-filter-controls";
import { BrunoTableClientRowPipelineAdapter } from "./internal/client-source-adapter";
import { compileColumns } from "./internal/compile-columns";
import { BrunoTableGridRuntime } from "./internal/grid-runtime";
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
import { compileBrunoTableGroupRowsColumn } from "./internal/client-grouping-presentation";
import { BrunoTableClientGroupBy } from "./internal/client-grouping-controls";

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

export function BrunoTableClient<TRow, const TColumns extends BrunoTableColumns<TRow>>(
  props: BrunoTableClientProps<TRow, TColumns>,
): ReactNode {
  const tableId = requireBrunoTableId(props.tableId);
  return <BrunoTableClientInstance key={tableId} props={props} tableId={tableId} />;
}

function BrunoTableClientInstance<TRow, const TColumns extends BrunoTableColumns<TRow>>({
  props,
  tableId,
}: Readonly<{
  readonly props: BrunoTableClientProps<TRow, TColumns>;
  readonly tableId: string;
}>): ReactNode {
  const compiledColumns = useMemo(() => compileColumns(props.columns), [props.columns]);
  const groupRowsColumn = useMemo(
    () => compileBrunoTableGroupRowsColumn(props.groupRowsColumn),
    [props.groupRowsColumn],
  );
  const [rowSelectionRuntime] = useState(() => new BrunoTableRowSelectionRuntime([]));
  const rowSelection = props.rowSelection === true ? rowSelectionRuntime : undefined;
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
        grouping: true,
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
  const [toolbar] = useState(() => new BrunoTableToolbarStore(props.children));
  const runtimeView = runtime.getView();
  const [projectionStore] = useState(() =>
    acquireBrunoTableClientProjectionStore(runtimeView, rowPipelineAdapter, rowSelection),
  );
  projectionStore.setRowSelection(rowSelection);
  const gridOwnedControls = useMemo(
    () => (
      <>
        <BrunoTableClientGroupBy columns={compiledColumns} runtime={runtimeView} />
        <BrunoTableActiveFilters />
      </>
    ),
    [compiledColumns, runtimeView],
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
    if (!groupingProjectionActive) {
      runtime.reconcile(publication, compiledColumns, queryConfiguration, groupRowsColumn.width);
    }
  }, [
    compiledColumns,
    groupRowsColumn,
    props.clientSource,
    props.getRowId,
    rowPipelineAdapter,
    runtime,
  ]);

  useLayoutEffect(() => {
    const notify = props.onPersistChange;
    runtime.setOnPersistChange(
      notify === undefined
        ? undefined
        : (state) => notify(state as BrunoTablePersistedState<TRow, TColumns, true>),
    );
  }, [props.onPersistChange, runtime]);

  useLayoutEffect(() => {
    toolbar.publish(props.children);
  }, [props.children, toolbar]);

  useLayoutEffect(
    () =>
      __BRUNO_TABLE_DEVELOPMENT__
        ? registerBrunoTableIdentity(tableId, compiledColumns)
        : undefined,
    [compiledColumns, tableId],
  );

  useLayoutEffect(() => () => cellRange.dispose(), [cellRange]);
  useLayoutEffect(() => () => projectionStore.release(), [projectionStore]);

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
          compiledColumns={compiledColumns}
          toolbar={toolbar}
          rowPipeline={BrunoTableClientRowPipeline}
          rowPipelineAdapter={rowPipelineAdapter}
          rowSelection={rowSelection}
          cellRange={cellRange}
          renderColumnFilter={renderBrunoTableClientColumnFilter}
          gridOwnedControls={gridOwnedControls}
        />
      </BrunoTableToolbarProvider>
    </BrunoTableClientFilterProvider>
  );
}

function requireBrunoTableId(tableId: unknown): string {
  if (typeof tableId !== "string" || tableId.trim().length === 0) {
    throw new TypeError("BrunoTable tableId must be a non-empty string.");
  }
  return tableId;
}
