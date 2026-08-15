import { useLayoutEffect, useMemo, useState } from "react";

import type { ReactNode } from "react";

import type { BrunoTableClientProps, BrunoTableColumns } from "./public-types";
import {
  BrunoTableToolbar,
  BrunoTableToolbarStore,
  BrunoTableView,
} from "./internal/bruno-table-view";
import { BrunoTableClientRowPipeline } from "./internal/client-row-pipeline";
import {
  BrunoTableClientFilterProvider,
  BrunoTableQuickFilter,
  renderBrunoTableClientColumnFilter,
} from "./internal/client-filter-controls";
import { BrunoTableClientRowPipelineAdapter } from "./internal/client-source-adapter";
import { compileColumns } from "./internal/compile-columns";
import { BrunoTableGridRuntime } from "./internal/grid-runtime";
import { registerBrunoTableIdentity } from "./internal/table-identity-registry";

export { BrunoTableQuickFilter, BrunoTableToolbar };

export function BrunoTableClient<TRow, const TColumns extends BrunoTableColumns<TRow>>(
  props: BrunoTableClientProps<TRow, TColumns>,
): ReactNode {
  const tableId = requireBrunoTableId(props.tableId);
  const compiledColumns = useMemo(() => compileColumns(props.columns), [props.columns]);
  const [rowPipelineAdapter] = useState(
    () =>
      new BrunoTableClientRowPipelineAdapter(
        props.clientSource,
        props.getRowId,
        compiledColumns,
        props.initialFilters,
        props.initialOrderBy,
        props.quickFilterFields,
      ),
  );
  const [runtime] = useState(
    () =>
      new BrunoTableGridRuntime(
        rowPipelineAdapter.getPublication(),
        compiledColumns,
        rowPipelineAdapter.getQueryConfiguration(compiledColumns),
        tableId,
      ),
  );
  const [toolbar] = useState(() => new BrunoTableToolbarStore(props.children));
  const runtimeView = runtime.getView();

  useLayoutEffect(() => {
    const publication = rowPipelineAdapter.reconcile(
      props.clientSource,
      props.getRowId,
      compiledColumns,
    );
    const queryConfiguration = rowPipelineAdapter.getQueryConfiguration(compiledColumns);
    runtime.reconcile(publication, compiledColumns, queryConfiguration);
  }, [compiledColumns, props.clientSource, props.getRowId, rowPipelineAdapter, runtime]);

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

  return (
    <BrunoTableClientFilterProvider runtime={runtimeView}>
      <BrunoTableView
        runtime={runtimeView}
        tableId={tableId}
        compiledColumns={compiledColumns}
        toolbar={toolbar}
        rowPipeline={BrunoTableClientRowPipeline}
        rowPipelineAdapter={rowPipelineAdapter}
        renderColumnFilter={renderBrunoTableClientColumnFilter}
      />
    </BrunoTableClientFilterProvider>
  );
}

function requireBrunoTableId(tableId: unknown): string {
  if (typeof tableId !== "string" || tableId.trim().length === 0) {
    throw new TypeError("BrunoTable tableId must be a non-empty string.");
  }
  return tableId;
}
