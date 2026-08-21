import { memo, useSyncExternalStore } from "react";

import type { NamedExoticComponent, ReactElement } from "react";
import type { BrunoTableRowPipelineProps } from "./bruno-table-view";
import type { BrunoTableRowPipelineRuntimeView } from "./grid-runtime";

export type BrunoTableServerRowPipelineAdapterView = Readonly<{
  readonly getGeneration: () => number;
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
  const rowSpace = useSyncExternalStore(
    runtime.subscribeRowSpace,
    runtime.getRowSpaceSnapshot,
    runtime.getRowSpaceSnapshot,
  );
  return children(
    Object.freeze({
      kind: "rows" as const,
      columns,
      rowSpace: Object.freeze({
        totalRows: rowSpace?.totalRows ?? 0,
        getRowId: (index: number) => rowSpace?.getRowId(index),
        findRowIndex: rowPipelineAdapter.findRowIndex,
        setRequiredRange: rowPipelineAdapter.setRequiredRange,
      }),
      queryGeneration: rowPipelineAdapter.getGeneration(),
      queryNavigationMode: query.navigationMode,
    }),
  );
});
