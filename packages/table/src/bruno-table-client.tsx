import { useLayoutEffect, useMemo, useState } from "react";

import type { ReactNode } from "react";

import type { BrunoTableClientProps, BrunoTableColumns } from "./public-types";
import {
  BrunoTableToolbar,
  BrunoTableToolbarStore,
  BrunoTableView,
} from "./internal/bruno-table-view";
import { createBrunoTableClientRowPipeline } from "./internal/client-row-pipeline";
import { BrunoTableClientRowPipelineAdapter } from "./internal/client-source-adapter";
import { compileColumns } from "./internal/compile-columns";
import { BrunoTableGridRuntime } from "./internal/grid-runtime";
import { registerBrunoTableIdentity } from "./internal/table-identity-registry";

export { BrunoTableToolbar };

export function BrunoTableClient<
  TRow extends object | string | number | bigint | boolean | symbol | null | undefined,
  const TColumns extends BrunoTableColumns<TRow>,
>(props: BrunoTableClientProps<TRow, TColumns>): ReactNode {
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
      ),
  );
  const [rowPipeline] = useState(() => createBrunoTableClientRowPipeline<TRow>());
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
        ? registerBrunoTableIdentity(tableId, compiledColumns)
        : undefined,
    [compiledColumns, tableId],
  );

  return (
    <BrunoTableView
      runtime={runtimeView}
      tableId={tableId}
      compiledColumns={compiledColumns}
      toolbar={toolbar}
      rowPipeline={rowPipeline}
      rowPipelineAdapter={rowPipelineAdapter}
    />
  );
}

function requireBrunoTableId(tableId: string): string {
  if (typeof tableId !== "string" || tableId.trim().length === 0) {
    throw new TypeError("BrunoTable tableId must be a non-empty string.");
  }
  return tableId;
}
