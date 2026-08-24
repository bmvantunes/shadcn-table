import { memo, useSyncExternalStore } from "react";

import type { NamedExoticComponent, ReactElement } from "react";
import type { BrunoTableRowPipelineProps } from "./bruno-table-view";
import type {
  BrunoTableQueryNavigationMode,
  BrunoTableRowPipelineRuntimeView,
} from "./grid-runtime";

export type BrunoTableServerRowPipelineAdapterView = Readonly<{
  readonly getStructureSnapshot: () => Readonly<{
    readonly totalRows: number;
    readonly getRowId: (index: number) => string | undefined;
    readonly findRowIndex: (rowId: string) => number | undefined;
    readonly generation: number;
    readonly navigationMode: BrunoTableQueryNavigationMode;
    readonly loading: boolean;
  }>;
  readonly subscribeStructure: (listener: () => void) => () => void;
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
  const structure = useSyncExternalStore(
    rowPipelineAdapter.subscribeStructure,
    rowPipelineAdapter.getStructureSnapshot,
    rowPipelineAdapter.getStructureSnapshot,
  );
  return children(
    Object.freeze({
      kind: "rows" as const,
      runtime,
      columns,
      rowSpace: Object.freeze({
        totalRows: structure.totalRows,
        getRowId: structure.getRowId,
        findRowIndex: structure.findRowIndex,
        setRequiredRange: rowPipelineAdapter.setRequiredRange,
        missingRowIdentityBehavior: "clear-conflicting-active-cell" as const,
      }),
      queryGeneration: structure.generation,
      queryNavigationMode: structure.navigationMode,
      loading: structure.loading,
    }),
  );
});
