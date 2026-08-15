import { Button } from "@bruno/shadcn/button";
import { Input } from "@bruno/shadcn/input";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@bruno/shadcn/popover";
import { useDebouncer } from "@tanstack/react-pacer";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { ReactElement, ReactNode } from "react";

import { BrunoTableColumnFilter } from "./client-filter";
import type { BrunoTableColumnFilterRendererProps } from "./bruno-table-view";
import type { CompiledColumn } from "./compile-columns";
import { brunoTableFilterReferencesColumn } from "./grid-query";
import type {
  BrunoTableFilterSnapshot,
  BrunoTableRowPipelineRuntimeView,
  BrunoTableRuntimeView,
} from "./grid-runtime";
import { recordBrunoTableClientQuickFilterRender } from "./render-instrumentation";

const BrunoTableClientFilterRuntimeContext = createContext<
  BrunoTableRowPipelineRuntimeView | undefined
>(undefined);

export type BrunoTableClientFilterProviderProps = {
  readonly runtime: BrunoTableRowPipelineRuntimeView;
  readonly children: ReactNode;
};

export function BrunoTableClientFilterProvider({
  runtime,
  children,
}: BrunoTableClientFilterProviderProps): ReactElement {
  return (
    <BrunoTableClientFilterRuntimeContext.Provider value={runtime}>
      {children}
    </BrunoTableClientFilterRuntimeContext.Provider>
  );
}

export const renderBrunoTableClientColumnFilter = (
  props: BrunoTableColumnFilterRendererProps,
): ReactElement => <BrunoTableColumnFilter {...props} />;

export function BrunoTableQuickFilter(): ReactElement | null {
  const runtime = useContext(BrunoTableClientFilterRuntimeContext);
  if (runtime === undefined) {
    throw new Error("BrunoTableQuickFilter must be rendered inside BrunoTableClient.");
  }
  return <BrunoTableQuickFilterConnected runtime={runtime} />;
}

export function BrunoTableActiveFilters(): ReactElement | null {
  const runtime = useContext(BrunoTableClientFilterRuntimeContext);
  if (runtime === undefined) {
    throw new Error("BrunoTableActiveFilters must be rendered inside BrunoTableClient.");
  }
  return <BrunoTableActiveFiltersConnected runtime={runtime} />;
}

const BrunoTableQuickFilterConnected = memo(function BrunoTableQuickFilterConnected({
  runtime,
}: {
  readonly runtime: BrunoTableRuntimeView;
}): ReactElement | null {
  if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) recordBrunoTableClientQuickFilterRender();
  const fields = runtime.getQuickFilterFieldsSnapshot();
  const committed = useSyncExternalStore(
    runtime.subscribeQuickFilter,
    runtime.getQuickFilterSnapshot,
    runtime.getQuickFilterSnapshot,
  );
  if (fields.length === 0) {
    if (__BRUNO_TABLE_DEVELOPMENT__) {
      throw new TypeError(
        "BrunoTableQuickFilter requires BrunoTableClient quickFilterFields to be configured.",
      );
    }
    return null;
  }
  return <BrunoTableQuickFilterInput initialValue={committed} runtime={runtime} />;
});

const BrunoTableQuickFilterInput = memo(function BrunoTableQuickFilterInput({
  initialValue,
  runtime,
}: {
  readonly initialValue: string;
  readonly runtime: BrunoTableRuntimeView;
}): ReactElement {
  const [draft, setDraft] = useState(initialValue);
  const draftRef = useRef(initialValue);
  const lastCommittedRef = useRef(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const publish = useCallback(
    (text: string): void => {
      runtime.dispatchGridCommand({ type: "quick-filter.replace", text });
    },
    [runtime],
  );
  const debouncer = useDebouncer(publish, { wait: 150 });
  useEffect(() => {
    debouncer.cancel();
    if (lastCommittedRef.current === initialValue) return;
    lastCommittedRef.current = initialValue;
    if (draftRef.current === initialValue) return;
    draftRef.current = initialValue;
    setDraft(initialValue);
  }, [debouncer, initialValue]);
  useEffect(() => () => debouncer.cancel(), [debouncer]);
  return (
    <div className="flex min-w-56 items-center gap-1">
      <Input
        aria-label="Quick Filter"
        placeholder="Quick Filter"
        ref={inputRef}
        type="search"
        value={draft}
        onChange={(event) => {
          const text = event.currentTarget.value;
          draftRef.current = text;
          setDraft(text);
          debouncer.maybeExecute(text);
        }}
      />
      {draft.length === 0 ? null : (
        <Button
          aria-label="Clear Quick Filter"
          size="icon-xs"
          type="button"
          variant="ghost"
          onClick={() => {
            debouncer.cancel();
            draftRef.current = "";
            setDraft("");
            publish("");
            inputRef.current?.focus({ preventScroll: true });
          }}
        >
          ×
        </Button>
      )}
    </div>
  );
});

const BrunoTableActiveFiltersConnected = memo(function BrunoTableActiveFiltersConnected({
  runtime,
}: {
  readonly runtime: BrunoTableRowPipelineRuntimeView;
}): ReactElement | null {
  const filters = useSyncExternalStore(
    runtime.subscribeFilter,
    runtime.getFilterSnapshot,
    runtime.getFilterSnapshot,
  );
  const entries = activeFilterEntries(filters);
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button aria-label={`Active filters (${String(entries.length)})`} size="sm" type="button">
            Filters {entries.length}
          </Button>
        }
      />
      <PopoverContent aria-label="Active filters" className="w-96" role="dialog">
        <PopoverHeader>
          <PopoverTitle>Active filters</PopoverTitle>
          <PopoverDescription>Review filters across visible and hidden columns.</PopoverDescription>
        </PopoverHeader>
        <div className="flex flex-col gap-2">
          {entries.map((entry) => (
            <div className="flex items-center justify-between gap-2 text-sm" key={entry.key}>
              <span>{entry.label}</span>
              <Button
                aria-label={`Remove ${entry.label}`}
                size="icon-xs"
                type="button"
                variant="ghost"
                onClick={() => {
                  if (entry.kind === "quick") {
                    runtime.dispatchGridCommand({ type: "quick-filter.replace", text: "" });
                  } else {
                    runtime.dispatchGridCommand({
                      type: "column.filter.clear",
                      columnId: entry.columnId,
                    });
                  }
                }}
              >
                ×
              </Button>
            </div>
          ))}
          {entries.some((entry) => entry.kind === "column") ? (
            <Button
              aria-label="Clear all Grid Filters"
              size="sm"
              type="button"
              variant="outline"
              onClick={() => runtime.dispatchGridCommand({ type: "column.filters.clear" })}
            >
              Clear all Grid Filters
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
});

type BrunoTableActiveFilterEntry =
  | Readonly<{
      readonly kind: "column";
      readonly columnId: string;
      readonly key: string;
      readonly label: string;
    }>
  | Readonly<{ readonly kind: "quick"; readonly key: string; readonly label: string }>;

function activeFilterEntries(
  query: BrunoTableFilterSnapshot,
): readonly BrunoTableActiveFilterEntry[] {
  const entries: BrunoTableActiveFilterEntry[] = [];
  if (query.quickFilter.length > 0) {
    entries.push({
      kind: "quick",
      key: "quick-filter",
      label: `Quick Filter contains ${JSON.stringify(query.quickFilter)}`,
    });
  }
  for (const column of query.columns) {
    const filters = query.filters.filter((filter) =>
      brunoTableFilterReferencesColumn(filter, column.columnId),
    );
    if (filters.length === 0) continue;
    entries.push({
      kind: "column",
      columnId: column.columnId,
      key: `column-filter-${column.columnId}`,
      label: filters.map((filter) => describeActiveFilter(column, filter)).join(" AND "),
    });
  }
  return entries;
}

function describeActiveFilter(column: CompiledColumn, value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((condition) => describeActiveFilter(column, condition)).join(" AND ");
  }
  if (typeof value !== "object" || value === null) return column.headerName;
  const record = value as Readonly<Record<string, unknown>>;
  const type = typeof record["type"] === "string" ? record["type"] : "filter";
  if ((type === "AND" || type === "OR") && Array.isArray(record["conditions"])) {
    const joiner = type === "AND" ? " AND " : " OR ";
    return `${column.headerName}: (${record["conditions"].map((condition) => describeActiveFilter(column, condition)).join(joiner)})`;
  }
  if (type === "NOT" && record["condition"] !== undefined) {
    return `${column.headerName}: NOT (${describeActiveFilter(column, record["condition"])})`;
  }
  const operand = record["filter"];
  if (type === "blank" || type === "notBlank") return `${column.headerName}: ${type}`;
  return `${column.headerName}: ${type} ${formatActiveFilterOperand(column, operand)}`;
}

function formatActiveFilterOperand(column: CompiledColumn, value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => formatActiveFilterOperand(column, item)).join(", ")}]`;
  }
  if (typeof value === "string") return JSON.stringify(value);
  try {
    return column.semantics.formatDisplay(value);
  } catch {
    return String(value);
  }
}
