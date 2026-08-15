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
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { ReactElement, ReactNode } from "react";

import { BrunoTableColumnFilter } from "./client-filter";
import type { BrunoTableColumnFilterRendererProps } from "./bruno-table-view";
import type { CompiledColumn } from "./compile-columns";
import { brunoTableFilterReferencesColumn, normalizeBrunoTableFilterText } from "./grid-query";
import type {
  BrunoTableFilterSnapshot,
  BrunoTableRowPipelineRuntimeView,
  BrunoTableRuntimeView,
} from "./grid-runtime";
import {
  boundBrunoTableQuickFilterText,
  BRUNO_TABLE_MAX_QUICK_FILTER_LENGTH,
} from "./quick-filter";
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
  const draftEpochRef = useRef(0);
  const composingRef = useRef(false);
  const publish = useCallback(
    (
      candidate: Readonly<{
        readonly text: string;
        readonly commandEpoch: number;
        readonly draftEpoch: number;
      }>,
    ): void => {
      if (runtime.getQuickFilterCommandEpochSnapshot() !== candidate.commandEpoch) return;
      if (draftEpochRef.current !== candidate.draftEpoch) return;
      runtime.dispatchGridCommand({ type: "quick-filter.replace", text: candidate.text });
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
        maxLength={BRUNO_TABLE_MAX_QUICK_FILTER_LENGTH}
        placeholder="Quick Filter"
        ref={inputRef}
        type="search"
        value={draft}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          const text = boundBrunoTableQuickFilterText(event.currentTarget.value);
          const draftEpoch = draftEpochRef.current + 1;
          draftEpochRef.current = draftEpoch;
          draftRef.current = text;
          setDraft(text);
          debouncer.maybeExecute({
            text,
            commandEpoch: runtime.getQuickFilterCommandEpochSnapshot(),
            draftEpoch,
          });
        }}
        onCompositionStart={() => {
          composingRef.current = true;
          draftEpochRef.current += 1;
          debouncer.cancel();
        }}
        onChange={(event) => {
          const text = boundBrunoTableQuickFilterText(event.currentTarget.value);
          const draftEpoch = draftEpochRef.current + 1;
          draftEpochRef.current = draftEpoch;
          draftRef.current = text;
          setDraft(text);
          if (composingRef.current) return;
          debouncer.maybeExecute({
            text,
            commandEpoch: runtime.getQuickFilterCommandEpochSnapshot(),
            draftEpoch,
          });
        }}
      />
      {draft.length === 0 ? null : (
        <Button
          aria-label="Clear Quick Filter"
          size="icon-xs"
          type="button"
          variant="ghost"
          onClick={() => {
            composingRef.current = false;
            debouncer.cancel();
            const draftEpoch = draftEpochRef.current + 1;
            draftEpochRef.current = draftEpoch;
            draftRef.current = "";
            setDraft("");
            publish({
              text: "",
              commandEpoch: runtime.getQuickFilterCommandEpochSnapshot(),
              draftEpoch,
            });
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
}): ReactElement {
  const filters = useSyncExternalStore(
    runtime.subscribeFilter,
    runtime.getFilterSnapshot,
    runtime.getFilterSnapshot,
  );
  const entries = activeFilterEntries(filters);
  return <BrunoTableActiveFiltersReview entries={entries} runtime={runtime} />;
});

const BrunoTableActiveFiltersReview = memo(function BrunoTableActiveFiltersReview({
  entries,
  runtime,
}: {
  readonly entries: readonly BrunoTableActiveFilterEntry[];
  readonly runtime: BrunoTableRowPipelineRuntimeView;
}): ReactElement {
  const [openStore] = useState(createBrunoTableActiveFilterOpenStore);
  const open = useSyncExternalStore(
    openStore.subscribe,
    openStore.getSnapshot,
    openStore.getSnapshot,
  );
  useLayoutEffect(() => {
    openStore.setHasEntries(entries.length > 0);
  }, [entries.length, openStore]);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const removeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusFrame = useRef<number | null>(null);
  const cancelScheduledFocus = useCallback(() => {
    if (focusFrame.current === null || typeof cancelAnimationFrame !== "function") return;
    cancelAnimationFrame(focusFrame.current);
    focusFrame.current = null;
  }, []);
  const focusAfterMutation = useCallback(
    (nextKey: string | undefined) => {
      cancelScheduledFocus();
      const focus = () => {
        focusFrame.current = null;
        (nextKey === undefined ? undefined : removeButtonRefs.current.get(nextKey))?.focus({
          preventScroll: true,
        });
        if (document.activeElement !== document.body) return;
        triggerRef.current?.focus({ preventScroll: true });
      };
      if (typeof requestAnimationFrame === "function") {
        focusFrame.current = requestAnimationFrame(() => {
          focusFrame.current = requestAnimationFrame(focus);
        });
      } else {
        focus();
      }
    },
    [cancelScheduledFocus],
  );
  useEffect(
    () => () => {
      cancelScheduledFocus();
      removeButtonRefs.current.clear();
    },
    [cancelScheduledFocus],
  );
  const removeEntry = useCallback(
    (entry: BrunoTableActiveFilterEntry): void => {
      const index = entries.findIndex((candidate) => candidate.key === entry.key);
      const nextKey = entries[index + 1]?.key ?? entries[index - 1]?.key;
      if (nextKey === undefined) openStore.setOpen(false);
      if (entry.kind === "quick") {
        runtime.dispatchGridCommand({ type: "quick-filter.replace", text: "" });
      } else {
        runtime.dispatchGridCommand({
          type: "column.filter.clear",
          columnId: entry.columnId,
        });
      }
      focusAfterMutation(nextKey);
    },
    [entries, focusAfterMutation, openStore, runtime],
  );

  const trigger = (
    <Button
      ref={triggerRef}
      aria-label={`Active filters (${String(entries.length)})`}
      aria-disabled={entries.length === 0 ? "true" : undefined}
      size="sm"
      tabIndex={entries.length === 0 ? -1 : undefined}
      type="button"
    >
      Filters {entries.length}
    </Button>
  );
  return (
    <Popover
      key={entries.length === 0 ? "empty" : "active"}
      open={open}
      onOpenChange={openStore.setOpen}
    >
      <PopoverTrigger render={trigger} />
      {entries.length > 0 ? (
        <PopoverContent
          aria-label="Active filters"
          className="w-96 max-w-[calc(100vw-1rem)]"
          role="dialog"
        >
          <PopoverHeader>
            <PopoverTitle>Active filters</PopoverTitle>
            <PopoverDescription>
              Review filters across visible and hidden columns.
            </PopoverDescription>
          </PopoverHeader>
          <div className="flex flex-col gap-2">
            {entries.map((entry) => (
              <div
                className="flex min-w-0 items-center justify-between gap-2 text-sm"
                key={entry.key}
              >
                <span className="min-w-0 flex-1 break-all">{entry.label}</span>
                <Button
                  ref={(element) => {
                    if (element === null) removeButtonRefs.current.delete(entry.key);
                    else removeButtonRefs.current.set(entry.key, element);
                  }}
                  aria-label={`Remove ${entry.label}`}
                  size="icon-xs"
                  className="shrink-0"
                  type="button"
                  variant="ghost"
                  onClick={() => removeEntry(entry)}
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
                onClick={() => {
                  if (!entries.some((entry) => entry.kind === "quick")) openStore.setOpen(false);
                  runtime.dispatchGridCommand({ type: "column.filters.clear" });
                  focusAfterMutation(undefined);
                }}
              >
                Clear all Grid Filters
              </Button>
            ) : null}
          </div>
        </PopoverContent>
      ) : null}
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
  if (normalizeBrunoTableFilterText(query.quickFilter).length > 0) {
    entries.push({
      kind: "quick",
      key: "quick-filter",
      label: `Quick Filter contains ${JSON.stringify(query.quickFilter)}`,
    });
  }
  const headerCounts = new Map<string, number>();
  for (const column of query.columns) {
    headerCounts.set(column.headerName, (headerCounts.get(column.headerName) ?? 0) + 1);
  }
  for (const [columnIndex, column] of query.columns.entries()) {
    const filters = query.filters.filter((filter) =>
      brunoTableFilterReferencesColumn(filter, column.columnId),
    );
    if (filters.length === 0) continue;
    const columnLabel =
      headerCounts.get(column.headerName) === 1
        ? column.headerName
        : `${column.headerName} (column ${String(columnIndex + 1)})`;
    entries.push({
      kind: "column",
      columnId: column.columnId,
      key: `column-filter-${column.columnId}`,
      label: filters
        .map((filter) => describeActiveFilter(column, filter, columnLabel))
        .join(" AND "),
    });
  }
  return entries;
}

function createBrunoTableActiveFilterOpenStore(): {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => boolean;
  readonly setOpen: (open: boolean) => void;
  readonly setHasEntries: (hasEntries: boolean) => void;
} {
  let open = false;
  let hasEntries = false;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => open,
    setOpen: (nextOpen) => {
      const next = nextOpen && hasEntries;
      if (open === next) return;
      open = next;
      notify();
    },
    setHasEntries: (nextHasEntries) => {
      hasEntries = nextHasEntries;
      if (hasEntries || !open) return;
      open = false;
      notify();
    },
  };
}

function describeActiveFilter(
  column: CompiledColumn,
  value: unknown,
  columnLabel = column.headerName,
): string {
  if (Array.isArray(value)) {
    return value
      .map((condition) => describeActiveFilter(column, condition, columnLabel))
      .join(" AND ");
  }
  if (typeof value !== "object" || value === null) return columnLabel;
  const record = value as Readonly<Record<string, unknown>>;
  const type = typeof record["type"] === "string" ? record["type"] : "filter";
  if ((type === "AND" || type === "OR") && Array.isArray(record["conditions"])) {
    const joiner = type === "AND" ? " AND " : " OR ";
    return `${columnLabel}: (${record["conditions"].map((condition) => describeActiveFilter(column, condition, columnLabel)).join(joiner)})`;
  }
  if (type === "NOT" && record["condition"] !== undefined) {
    return `${columnLabel}: NOT (${describeActiveFilter(column, record["condition"], columnLabel)})`;
  }
  const operand = record["filter"];
  if (type === "blank" || type === "notBlank") return `${columnLabel}: ${type}`;
  if (type === "inRange") {
    return `${columnLabel}: inRange ${formatActiveFilterOperand(column, operand, type)} ≤ value < ${formatActiveFilterOperand(column, record["filterTo"], type)} (upper bound exclusive)`;
  }
  const sensitivity = [
    record["caseSensitive"] === true ? "case-sensitive" : undefined,
    record["accentSensitive"] === true ? "accent-sensitive" : undefined,
  ].filter((value): value is string => value !== undefined);
  const sensitivityLabel = sensitivity.length > 0 ? ` (${sensitivity.join(", ")})` : "";
  return `${columnLabel}: ${type}${sensitivityLabel} ${formatActiveFilterOperand(column, operand, type)}`;
}

function formatActiveFilterOperand(
  column: CompiledColumn,
  value: unknown,
  operator?: string,
): string {
  if (operator === "in" && Array.isArray(value)) {
    return `[${value.map((item) => formatActiveFilterOperand(column, item, "equals")).join(", ")}]`;
  }
  if (
    operator === "contains" ||
    operator === "notContains" ||
    operator === "startsWith" ||
    operator === "endsWith"
  ) {
    return typeof value === "string" ? JSON.stringify(value) : String(value);
  }
  try {
    const display = column.semantics.formatDisplay(value);
    return typeof value === "string" ? JSON.stringify(display) : display;
  } catch {
    return String(value);
  }
}
