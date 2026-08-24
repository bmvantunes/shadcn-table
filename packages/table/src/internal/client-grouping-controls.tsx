import { Button } from "@bruno/shadcn/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bruno/shadcn/select";
import { memo, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import type { NamedExoticComponent, ReactElement } from "react";
import type { CompiledColumn } from "./compile-columns";
import type { BrunoTableRowPipelineRuntimeView } from "./grid-runtime";
import { useBrunoTableGroupByHotkeys } from "./hotkey-adapter";

type BrunoTableClientGroupByProps = Readonly<{
  readonly columns: readonly CompiledColumn[];
  readonly runtime: BrunoTableRowPipelineRuntimeView;
}>;

export const BrunoTableClientGroupBy: NamedExoticComponent<BrunoTableClientGroupByProps> = memo(
  function BrunoTableClientGroupBy({
    columns,
    runtime,
  }: BrunoTableClientGroupByProps): ReactElement | null {
    const query = useSyncExternalStore(
      runtime.subscribeQuery,
      runtime.getQuerySnapshot,
      runtime.getQuerySnapshot,
    );
    const eligible = columns.filter((column) => column.kind === "field" && column.groupBy);
    const region = useRef<HTMLDivElement>(null);
    const addGroupTrigger = useRef<HTMLButtonElement>(null);
    const addGroupFocusIntent = useRef(false);
    const groupChips = useRef(new Map<string, HTMLButtonElement>());
    const pendingFocus = useRef<Readonly<{ readonly columnId?: string }> | undefined>(undefined);
    const [addGroupOpen, setAddGroupOpen] = useState(false);
    const [announcement, setAnnouncement] = useState("");
    useLayoutEffect(() => {
      const target = pendingFocus.current;
      if (target === undefined) return;
      pendingFocus.current = undefined;
      const element =
        target.columnId === undefined
          ? addGroupTrigger.current
          : groupChips.current.get(target.columnId);
      element?.focus({ preventScroll: true });
    }, [query.groupBy]);
    useLayoutEffect(() => {
      if (addGroupOpen || !addGroupFocusIntent.current) return;
      addGroupFocusIntent.current = false;
      addGroupTrigger.current?.focus({ preventScroll: true });
    }, [addGroupOpen]);
    if (eligible.length === 0) return null;
    const active = new Set(query.groupBy);
    const inactive = eligible.filter((column) => !active.has(column.columnId));
    return (
      <div ref={region} aria-label="Group By" className="flex min-w-0 flex-col gap-1" role="region">
        <span className="text-xs font-medium">Group by</span>
        <Select
          open={addGroupOpen}
          value={null}
          onOpenChange={(open) => setAddGroupOpen(open && inactive.length > 0)}
          onValueChange={(columnId) => {
            if (columnId === null) return;
            addGroupFocusIntent.current = true;
            if (runtime.dispatchGridCommand({ type: "grouping.add", columnId })) {
              setAnnouncement(
                `${headerName(columns, columnId)} added at position ${String(query.groupBy.length + 1)}`,
              );
            } else {
              addGroupFocusIntent.current = false;
            }
          }}
        >
          <SelectTrigger
            ref={addGroupTrigger}
            aria-disabled={inactive.length === 0 || undefined}
            aria-label="Add Group"
            size="sm"
          >
            <SelectValue placeholder="Add Group" />
          </SelectTrigger>
          <SelectContent align="end">
            {inactive.map((column) => (
              <SelectItem key={column.columnId} value={column.columnId}>
                {column.headerName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ol aria-label="Active groups" className="flex flex-wrap gap-1" role="list">
          {query.groupBy.map((columnId, index) => (
            <li key={columnId} className="inline-flex items-center rounded-md border px-1">
              <BrunoTableClientGroupChip
                columnId={columnId}
                count={query.groupBy.length}
                index={index}
                name={headerName(columns, columnId)}
                register={(element) => {
                  if (element === null) groupChips.current.delete(columnId);
                  else groupChips.current.set(columnId, element);
                }}
                runtime={runtime}
                onMoved={(target) => {
                  setAnnouncement(
                    `${headerName(columns, columnId)} moved to position ${String(target + 1)} of ${String(query.groupBy.length)}`,
                  );
                }}
              />
              <Button
                aria-label={`Remove ${headerName(columns, columnId)} from Group By`}
                size="icon-xs"
                type="button"
                variant="ghost"
                onClick={() => {
                  if (!runtime.dispatchGridCommand({ type: "grouping.remove", columnId })) return;
                  const nextColumnId = query.groupBy[index + 1] ?? query.groupBy[index - 1];
                  pendingFocus.current =
                    nextColumnId === undefined ? Object.freeze({}) : { columnId: nextColumnId };
                  setAnnouncement(`${headerName(columns, columnId)} removed from Group By`);
                }}
              >
                <span aria-hidden="true">×</span>
              </Button>
            </li>
          ))}
        </ol>
        <span aria-live="polite" className="sr-only" role="status">
          {announcement}
        </span>
      </div>
    );
  },
);

type BrunoTableClientGroupChipProps = Readonly<{
  readonly columnId: string;
  readonly count: number;
  readonly index: number;
  readonly name: string;
  readonly onMoved: (targetIndex: number) => void;
  readonly register: (element: HTMLButtonElement | null) => void;
  readonly runtime: BrunoTableRowPipelineRuntimeView;
}>;

const BrunoTableClientGroupChip: NamedExoticComponent<BrunoTableClientGroupChipProps> = memo(
  function BrunoTableClientGroupChip({
    columnId,
    count,
    index,
    name,
    onMoved,
    register,
    runtime,
  }: BrunoTableClientGroupChipProps): ReactElement {
    const chip = useRef<HTMLButtonElement>(null);
    useLayoutEffect(() => {
      register(chip.current);
      return () => register(null);
    }, [register]);
    useBrunoTableGroupByHotkeys(chip, (direction) => {
      const target = index + direction;
      if (target < 0 || target >= count) return false;
      if (!runtime.dispatchGridCommand({ type: "grouping.move", columnId, direction }))
        return false;
      onMoved(target);
      return true;
    });
    return (
      <Button
        ref={chip}
        aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
        aria-label={`${name}, position ${String(index + 1)} of ${String(count)}`}
        size="xs"
        type="button"
        variant="ghost"
      >
        {name}
      </Button>
    );
  },
);

function headerName(columns: readonly CompiledColumn[], columnId: string): string {
  return columns.find((column) => column.columnId === columnId)?.headerName ?? columnId;
}
