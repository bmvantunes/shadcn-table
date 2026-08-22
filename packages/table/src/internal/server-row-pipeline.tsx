import { memo, useSyncExternalStore } from "react";

import type { NamedExoticComponent, ReactElement } from "react";
import type { BrunoTableRowPipelineProps } from "./bruno-table-view";
import type { BrunoTableRowPipelineRuntimeView } from "./grid-runtime";

export type BrunoTableServerRowPipelineAdapterView = Readonly<{
  readonly getGeneration: () => number;
  readonly getStructureSnapshot: () => Readonly<{
    readonly totalRows: number;
    readonly getRowId: (index: number) => string | undefined;
  }>;
  readonly subscribeStructure: (listener: () => void) => () => void;
  readonly findRowIndex: (rowId: string) => number | undefined;
  readonly setRequiredRange: (start: number, end: number) => void;
}>;

export const BrunoTableServerRowPipeline: NamedExoticComponent<
  BrunoTableRowPipelineProps<
    BrunoTableRowPipelineRuntimeView,
    BrunoTableServerRowPipelineAdapterView
  >
> = memo(function BrunoTableServerRowPipeline({
  runtime,
  columns,
  rowPipelineAdapter,
  children,
}: BrunoTableRowPipelineProps<
  BrunoTableRowPipelineRuntimeView,
  BrunoTableServerRowPipelineAdapterView
>): ReactElement {
  const query = useSyncExternalStore(
    runtime.subscribeQuery,
    runtime.getQuerySnapshot,
    runtime.getQuerySnapshot,
  );
  const structure = useSyncExternalStore(
    rowPipelineAdapter.subscribeStructure,
    rowPipelineAdapter.getStructureSnapshot,
    rowPipelineAdapter.getStructureSnapshot,
  );
  return children(
    Object.freeze({
      kind: "rows" as const,
      columns,
      rowSpace: Object.freeze({
        totalRows: structure.totalRows,
        getRowId: structure.getRowId,
        findRowIndex: rowPipelineAdapter.findRowIndex,
        setRequiredRange: rowPipelineAdapter.setRequiredRange,
        missingRowIdentityBehavior: "clear-conflicting-active-cell" as const,
      }),
      queryGeneration: rowPipelineAdapter.getGeneration(),
      queryNavigationMode: query.navigationMode,
    }),
  );
});
