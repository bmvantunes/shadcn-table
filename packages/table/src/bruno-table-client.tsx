import { useLayoutEffect, useMemo, useState } from "react";

import type { ReactNode } from "react";

import type { BrunoTableClientProps, BrunoTableColumns } from "./public-types";
import {
  BrunoTableToolbar,
  BrunoTableToolbarStore,
  BrunoTableView,
} from "./internal/bruno-table-view";
import { BrunoTableClientRowPipeline } from "./internal/client-row-pipeline";
import { BrunoTableClientRowPipelineAdapter } from "./internal/client-source-adapter";
import { compileColumns } from "./internal/compile-columns";
import { BrunoTableGridRuntime } from "./internal/grid-runtime";
import { registerBrunoTableIdentity } from "./internal/table-identity-registry";

export { BrunoTableToolbar };

export function BrunoTableClient<TRow, const TColumns extends BrunoTableColumns<TRow>>(
  props: BrunoTableClientProps<TRow, TColumns>,
): ReactNode {
  const compiledColumns = useMemo(() => compileColumns(props.columns), [props.columns]);
  const [rowPipelineAdapter] = useState(
    () =>
      new BrunoTableClientRowPipelineAdapter(
        props.clientSource,
        props.getRowId,
        compiledColumns,
        props.initialFilters,
        props.initialOrderBy,
      ),
  );
  const [runtime] = useState(
    () =>
      new BrunoTableGridRuntime(
        rowPipelineAdapter.getPublication(),
        compiledColumns,
        rowPipelineAdapter.getQueryConfiguration(compiledColumns),
      ),
  );
  const [toolbar] = useState(() => new BrunoTableToolbarStore(props.children));
  const runtimeView = runtime.getView();

  useLayoutEffect(() => {
    const queryConfiguration = rowPipelineAdapter.getQueryConfiguration(compiledColumns);
    const publication = rowPipelineAdapter.reconcile(
      props.clientSource,
      props.getRowId,
      compiledColumns,
    );
    runtime.reconcile(publication, compiledColumns, queryConfiguration);
  }, [compiledColumns, props.clientSource, props.getRowId, rowPipelineAdapter, runtime]);

  useLayoutEffect(() => {
    toolbar.publish(props.children);
  }, [props.children, toolbar]);

  useLayoutEffect(
    () =>
      __BRUNO_TABLE_DEVELOPMENT__
        ? registerBrunoTableIdentity(props.tableId, compiledColumns)
        : undefined,
    [compiledColumns, props.tableId],
  );

  return (
    <BrunoTableView
      runtime={runtimeView}
      tableId={props.tableId}
      compiledColumns={compiledColumns}
      toolbar={toolbar}
      rowPipeline={BrunoTableClientRowPipeline}
      rowPipelineAdapter={rowPipelineAdapter}
    />
  );
}
