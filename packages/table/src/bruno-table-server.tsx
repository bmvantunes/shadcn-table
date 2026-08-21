import { useLayoutEffect, useMemo, useState } from "react";

import type { ReactNode } from "react";
import type {
  BrunoTableColumns,
  BrunoTablePersistedState,
  BrunoTableServerProps,
} from "./public-types";
import {
  BrunoTableToolbar,
  BrunoTableToolbarStore,
  BrunoTableView,
} from "./internal/bruno-table-view";
import {
  BrunoTableActiveFilters,
  BrunoTableClientFilterProvider,
  BrunoTableQuickFilter,
  renderBrunoTableClientColumnFilter,
} from "./internal/client-filter-controls";
import { compileColumns } from "./internal/compile-columns";
import { BrunoTableGridRuntime } from "./internal/grid-runtime";
import { BrunoTableServerRowPipeline } from "./internal/server-row-pipeline";
import { BrunoTableServerRowPipelineAdapter } from "./internal/server-source-adapter";
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

export function BrunoTableServer<TRow, const TColumns extends BrunoTableColumns<TRow>>(
  props: BrunoTableServerProps<TRow, TColumns>,
): ReactNode {
  const tableId = requireBrunoTableId(props.tableId);
  return <BrunoTableServerInstance key={tableId} props={props} tableId={tableId} />;
}

function BrunoTableServerInstance<TRow, const TColumns extends BrunoTableColumns<TRow>>({
  props,
  tableId,
}: Readonly<{
  readonly props: BrunoTableServerProps<TRow, TColumns>;
  readonly tableId: string;
}>): ReactNode {
  const compiledColumns = useMemo(() => compileColumns(props.columns), [props.columns]);
  const [rowPipelineAdapter] = useState(
    () =>
      new BrunoTableServerRowPipelineAdapter<TRow>(
        compiledColumns,
        props.quickFilterFields,
        props.initialFilters,
        props.initialOrderBy,
      ),
  );
  const [runtime] = useState(() => {
    rowPipelineAdapter.reconcileSource(props.viewportSource);
    const created = new BrunoTableGridRuntime(
      rowPipelineAdapter.getPublication(),
      compiledColumns,
      rowPipelineAdapter.getQueryConfiguration(),
      tableId,
      { initialPersistedState: props.initialPersistedState },
    );
    if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
      recordBrunoTableToolbarLifetime({ tableId, kind: "runtime-create", identity: created });
    }
    return created;
  });
  const [toolbar] = useState(() => new BrunoTableToolbarStore(props.children));
  const runtimeView = runtime.getView();
  const gridOwnedControls = useMemo(() => <BrunoTableActiveFilters />, []);

  useLayoutEffect(() => {
    const unsubscribe = rowPipelineAdapter.subscribePublication(() => {
      runtimeView.publishRowPipeline(rowPipelineAdapter.getPublication());
    });
    return unsubscribe;
  }, [rowPipelineAdapter, runtimeView]);

  useLayoutEffect(() => {
    rowPipelineAdapter.reconcileSource(props.viewportSource);
    const queryConfiguration = rowPipelineAdapter.reconcileColumns(compiledColumns);
    runtime.reconcile(rowPipelineAdapter.getPublication(), compiledColumns, queryConfiguration);
    rowPipelineAdapter.replace(props.viewportSource.viewport, runtimeView.getQuerySnapshot());
  }, [compiledColumns, props.viewportSource, rowPipelineAdapter, runtime, runtimeView]);

  useLayoutEffect(() => {
    const replace = () => {
      const query = runtimeView.getQuerySnapshot();
      rowPipelineAdapter.replace(props.viewportSource.viewport, query);
    };
    replace();
    const unsubscribe = runtimeView.subscribeQuery(replace);
    return () => {
      unsubscribe();
      rowPipelineAdapter.release();
    };
  }, [props.viewportSource.viewport, rowPipelineAdapter, runtimeView]);

  useLayoutEffect(() => {
    const notify = props.onPersistChange;
    runtime.setOnPersistChange(
      notify === undefined
        ? undefined
        : (state) => notify(state as BrunoTablePersistedState<TRow, TColumns>),
    );
  }, [props.onPersistChange, runtime]);

  useLayoutEffect(() => toolbar.publish(props.children), [props.children, toolbar]);

  useLayoutEffect(
    () =>
      __BRUNO_TABLE_DEVELOPMENT__
        ? registerBrunoTableIdentity(tableId, compiledColumns)
        : undefined,
    [compiledColumns, tableId],
  );

  return (
    <BrunoTableClientFilterProvider runtime={runtimeView}>
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
          rowPipeline={BrunoTableServerRowPipeline}
          rowPipelineAdapter={rowPipelineAdapter}
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
