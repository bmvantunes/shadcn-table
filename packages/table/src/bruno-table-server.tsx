import type { LiveQueryViewportBaseRow } from "effect-view-server/react/viewport-base-row";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

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
  renderBrunoTableServerColumnFilter,
} from "./internal/client-filter-controls";
import { compileColumns } from "./internal/compile-columns";
import { BrunoTableGridRuntime } from "./internal/grid-runtime";
import { BrunoTableServerRowPipeline } from "./internal/server-row-pipeline";
import {
  BrunoTableServerFacetProvider,
  BrunoTableServerFacetRuntime,
} from "./internal/server-facet";
import {
  BrunoTableServerRowPipelineAdapter,
  type BrunoTableServerQueryInputs,
} from "./internal/server-source-adapter";
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
import { snapshotBrunoTableQuickFilterFields } from "./internal/quick-filter";

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

export function BrunoTableServer<
  TViewport,
  const TColumns extends BrunoTableColumns<LiveQueryViewportBaseRow<TViewport>>,
>(
  props: BrunoTableServerProps<LiveQueryViewportBaseRow<TViewport>, TColumns, TViewport>,
): ReactNode {
  const tableId = requireBrunoTableId(props.tableId);
  return <BrunoTableServerInstance key={tableId} props={props} tableId={tableId} />;
}

function BrunoTableServerInstance<TRow, const TColumns extends BrunoTableColumns<TRow>, TViewport>({
  props,
  tableId,
}: Readonly<{
  readonly props: BrunoTableServerProps<TRow, TColumns, TViewport>;
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
        props.viewportSource.completeRawSelect,
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
  const queryInputsRef = useRef<BrunoTableServerQueryInputs>({
    routeBy: props.routeBy,
    externalFilters: props.externalFilters,
    visibleColumnIds: runtimeView.getColumnStructureSnapshot().visibleColumnIds,
  });
  const stagingSemanticQueryRef = useRef(false);
  const gridOwnedControls = useMemo(() => <BrunoTableActiveFilters />, []);
  const quickFilterFields = useMemo(
    () => snapshotBrunoTableQuickFilterFields(props.quickFilterFields),
    [props.quickFilterFields],
  );
  const facetInputsRef = useRef({
    externalFilters: props.externalFilters,
    quickFilterFields,
    routeBy: props.routeBy,
    source: props.viewportSource,
  });
  const [facetRuntime] = useState(
    () =>
      new BrunoTableServerFacetRuntime({
        externalFilters: props.externalFilters,
        quickFilterFields,
        querySnapshot: runtimeView.getQuerySnapshot(),
        routeBy: props.routeBy,
        runtime: runtimeView,
        semanticIdentity: rowPipelineAdapter.getSemanticIdentity(),
        source: props.viewportSource,
      }),
  );

  // This declaration must precede the reconciliation effect with the same semantic dependency
  // superset so React stages the query before synchronous column/runtime publications can fire.
  useLayoutEffect(() => {
    stagingSemanticQueryRef.current = true;
  }, [
    compiledColumns,
    props.externalFilters,
    props.quickFilterFields,
    props.routeBy,
    props.viewportSource,
    props.viewportSource.completeRawSelect,
    props.viewportSource.viewport,
  ]);

  useLayoutEffect(() => {
    const unsubscribe = rowPipelineAdapter.subscribePublication(() => {
      runtimeView.publishRowPipeline(rowPipelineAdapter.getPublication());
    });
    return unsubscribe;
  }, [rowPipelineAdapter, runtimeView]);

  useLayoutEffect(() => {
    rowPipelineAdapter.reconcileSource(props.viewportSource);
  }, [props.viewportSource, rowPipelineAdapter]);

  useLayoutEffect(() => {
    stageBrunoTableServerSemanticQuery(stagingSemanticQueryRef, () => {
      const queryConfiguration = rowPipelineAdapter.reconcileColumns(
        compiledColumns,
        props.quickFilterFields,
      );
      runtime.reconcile(rowPipelineAdapter.getPublication(), compiledColumns, queryConfiguration);
    });
    const queryInputs = Object.freeze({
      routeBy: props.routeBy,
      externalFilters: props.externalFilters,
      visibleColumnIds: runtimeView.getColumnStructureSnapshot().visibleColumnIds,
    });
    queryInputsRef.current = queryInputs;
    facetInputsRef.current = {
      externalFilters: props.externalFilters,
      quickFilterFields,
      routeBy: props.routeBy,
      source: props.viewportSource,
    };
    rowPipelineAdapter.replace(
      props.viewportSource.viewport,
      runtimeView.getQuerySnapshot(),
      queryInputs,
      true,
    );
    facetRuntime.reconcile({
      ...facetInputsRef.current,
      querySnapshot: runtimeView.getQuerySnapshot(),
      runtime: runtimeView,
      semanticIdentity: rowPipelineAdapter.getSemanticIdentity(),
    });
  }, [
    compiledColumns,
    facetRuntime,
    props.externalFilters,
    props.quickFilterFields,
    props.routeBy,
    props.viewportSource,
    props.viewportSource.completeRawSelect,
    props.viewportSource.viewport,
    quickFilterFields,
    rowPipelineAdapter,
    runtime,
    runtimeView,
  ]);

  useLayoutEffect(() => {
    const replace = (resetWhenInputsChange: boolean) => {
      if (stagingSemanticQueryRef.current) return;
      const query = runtimeView.getQuerySnapshot();
      const queryInputs = Object.freeze({
        ...queryInputsRef.current,
        visibleColumnIds: runtimeView.getColumnStructureSnapshot().visibleColumnIds,
      });
      queryInputsRef.current = queryInputs;
      rowPipelineAdapter.replace(
        props.viewportSource.viewport,
        query,
        queryInputs,
        resetWhenInputsChange,
      );
      facetRuntime.reconcile({
        ...facetInputsRef.current,
        querySnapshot: query,
        runtime: runtimeView,
        semanticIdentity: rowPipelineAdapter.getSemanticIdentity(),
      });
    };
    const unsubscribeQuery = runtimeView.subscribeQuery(() => replace(false));
    const unsubscribeColumnStructure = runtimeView.subscribeColumnStructure(() => replace(true));
    return () => {
      unsubscribeQuery();
      unsubscribeColumnStructure();
      rowPipelineAdapter.release();
    };
  }, [facetRuntime, props.viewportSource.viewport, rowPipelineAdapter, runtimeView]);

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
    <BrunoTableServerFacetProvider runtime={facetRuntime}>
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
            renderColumnFilter={renderBrunoTableServerColumnFilter}
            enableActiveCellCopy
            gridOwnedControls={gridOwnedControls}
          />
        </BrunoTableToolbarProvider>
      </BrunoTableClientFilterProvider>
    </BrunoTableServerFacetProvider>
  );
}

function stageBrunoTableServerSemanticQuery(
  staging: { current: boolean },
  reconcile: () => void,
): void {
  staging.current = true;
  try {
    reconcile();
  } finally {
    staging.current = false;
  }
}

function requireBrunoTableId(tableId: unknown): string {
  if (typeof tableId !== "string" || tableId.trim().length === 0) {
    throw new TypeError("BrunoTable tableId must be a non-empty string.");
  }
  return tableId;
}
