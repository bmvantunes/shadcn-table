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
import { collectClientFilterColumnIds, normalizeBrunoTableFilterText } from "./grid-query";
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
): ReactElement => {
  const { column, runtime, activateHeaderCommand, focusFallback, registerColumnFilterOpener } =
    props;
  return (
    <BrunoTableColumnFilter
      column={column}
      runtime={runtime}
      activateHeaderCommand={activateHeaderCommand}
      focusFallback={focusFallback}
      registerColumnFilterOpener={registerColumnFilterOpener}
    />
  );
};

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
  // quickFilterFields is snapshotted by the Client adapter for this Table Instance;
  // it is configuration, not a reactive row/query publication.
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
  const compositionSessionRef = useRef(0);
  const invalidatedCompositionSessionRef = useRef<number | null>(null);
  const publish = useCallback(
    (
      candidate: Readonly<{
        readonly text: string;
        readonly commandEpoch: number;
        readonly draftEpoch: number;
      }>,
    ): boolean => {
      if (runtime.getQuickFilterCommandEpochSnapshot() !== candidate.commandEpoch) return false;
      if (draftEpochRef.current !== candidate.draftEpoch) return false;
      return runtime.dispatchGridCommand({ type: "quick-filter.replace", text: candidate.text });
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
  useEffect(() => {
    return runtime.registerQuickFilterInvalidation(() => {
      debouncer.cancel();
      draftEpochRef.current += 1;
      if (composingRef.current) {
        invalidatedCompositionSessionRef.current = compositionSessionRef.current;
        composingRef.current = false;
      }
      const committed = runtime.getQuickFilterSnapshot();
      lastCommittedRef.current = committed;
      if (draftRef.current === committed) return;
      draftRef.current = committed;
      setDraft(committed);
    });
  }, [debouncer, runtime]);
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
          const compositionSession = compositionSessionRef.current;
          if (invalidatedCompositionSessionRef.current === compositionSession) {
            invalidatedCompositionSessionRef.current = null;
            composingRef.current = false;
            return;
          }
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
          compositionSessionRef.current += 1;
          invalidatedCompositionSessionRef.current = null;
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
            const previousDraft = draftRef.current;
            composingRef.current = false;
            debouncer.cancel();
            const draftEpoch = draftEpochRef.current + 1;
            draftEpochRef.current = draftEpoch;
            draftRef.current = "";
            setDraft("");
            const accepted = publish({
              text: "",
              commandEpoch: runtime.getQuickFilterCommandEpochSnapshot(),
              draftEpoch,
            });
            if (!accepted) {
              draftRef.current = previousDraft;
              setDraft(previousDraft);
              return;
            }
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
  const [entryWindowStart, setEntryWindowStart] = useState(0);
  const projection = activeFilterProjection(filters, entryWindowStart);
  return (
    <BrunoTableActiveFiltersReview
      entries={projection.entries}
      entryCount={projection.entryCount}
      maxEntryWindowStart={projection.maxEntryWindowStart}
      quickFilterActive={projection.quickFilterActive}
      runtime={runtime}
      setEntryWindowStart={setEntryWindowStart}
      visibleEntryWindowEnd={projection.visibleEntryWindowEnd}
      visibleEntryWindowStart={projection.visibleEntryWindowStart}
    />
  );
});

const BrunoTableActiveFiltersReview = memo(function BrunoTableActiveFiltersReview({
  entries,
  entryCount,
  maxEntryWindowStart,
  quickFilterActive,
  runtime,
  setEntryWindowStart,
  visibleEntryWindowEnd,
  visibleEntryWindowStart,
}: {
  readonly entries: readonly BrunoTableActiveFilterEntry[];
  readonly entryCount: number;
  readonly maxEntryWindowStart: number;
  readonly quickFilterActive: boolean;
  readonly runtime: BrunoTableRowPipelineRuntimeView;
  readonly setEntryWindowStart: (value: number | ((previous: number) => number)) => void;
  readonly visibleEntryWindowEnd: number;
  readonly visibleEntryWindowStart: number;
}): ReactElement {
  const [openStore] = useState(createBrunoTableActiveFilterOpenStore);
  const open = useSyncExternalStore(
    openStore.subscribe,
    openStore.getSnapshot,
    openStore.getSnapshot,
  );
  const visibleEntries = entries.slice(visibleEntryWindowStart, visibleEntryWindowEnd);
  useLayoutEffect(() => {
    openStore.setHasEntries(entryCount > 0);
  }, [entryCount, openStore]);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const removeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusFrame = useRef<number | null>(null);
  const cancelScheduledFocus = useCallback(() => {
    if (focusFrame.current === null) return;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(focusFrame.current);
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
      const nextIndex = index < entryCount - 1 ? index : index - 1;
      // Apply the command before changing the review projection. A rejected command lets the
      // active editor restore its own focus and keeps this review open for another attempt.
      const accepted =
        entry.kind === "quick"
          ? runtime.dispatchGridCommand({ type: "quick-filter.replace", text: "" })
          : runtime.dispatchGridCommand({
              type: "column.filter.clear",
              columnId: entry.columnId,
            });
      if (!accepted) return;
      if (nextIndex >= 0) {
        setEntryWindowStart(
          Math.floor(nextIndex / ACTIVE_FILTER_VISIBLE_ENTRIES) * ACTIVE_FILTER_VISIBLE_ENTRIES,
        );
      }
      if (nextKey === undefined) openStore.setOpen(false);
      focusAfterMutation(nextKey);
    },
    [entries, entryCount, focusAfterMutation, openStore, runtime, setEntryWindowStart],
  );

  const trigger = (
    <Button
      ref={triggerRef}
      aria-label={`Active filters (${String(entryCount)})`}
      aria-disabled={entryCount === 0 ? "true" : undefined}
      size="sm"
      tabIndex={entryCount === 0 ? -1 : undefined}
      type="button"
    >
      Filters {entryCount}
    </Button>
  );
  return (
    <Popover
      key={entryCount === 0 ? "empty" : "active"}
      open={open}
      onOpenChange={openStore.setOpen}
    >
      <PopoverTrigger render={trigger} />
      {entryCount > 0 ? (
        <PopoverContent
          aria-label="Active filters"
          className="max-h-[calc(100vh-1rem)] w-96 max-w-[calc(100vw-1rem)] overflow-y-auto"
          role="dialog"
        >
          <PopoverHeader>
            <PopoverTitle>Active filters</PopoverTitle>
            <PopoverDescription>
              Review filters across visible and hidden columns.
            </PopoverDescription>
            {entryCount > ACTIVE_FILTER_VISIBLE_ENTRIES ? (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span aria-live="polite" role="status">
                  {`Showing filters ${String(visibleEntryWindowStart + 1)}–${String(visibleEntryWindowEnd)} of ${entryCount.toLocaleString("en-US")}`}
                </span>
                <div className="flex gap-1">
                  <Button
                    aria-label="Previous active filters"
                    disabled={visibleEntryWindowStart === 0}
                    size="xs"
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setEntryWindowStart(
                        Math.max(0, visibleEntryWindowStart - ACTIVE_FILTER_VISIBLE_ENTRIES),
                      )
                    }
                  >
                    Previous
                  </Button>
                  <Button
                    aria-label="Next active filters"
                    disabled={visibleEntryWindowEnd === entryCount}
                    size="xs"
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setEntryWindowStart(
                        Math.min(
                          maxEntryWindowStart,
                          visibleEntryWindowStart + ACTIVE_FILTER_VISIBLE_ENTRIES,
                        ),
                      )
                    }
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </PopoverHeader>
          <div className="flex flex-col gap-2">
            {visibleEntries.map((entry) => (
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
                  const keepsQuickFilter = quickFilterActive;
                  const accepted = runtime.dispatchGridCommand({ type: "column.filters.clear" });
                  if (!accepted) return;
                  if (!keepsQuickFilter) openStore.setOpen(false);
                  focusAfterMutation(keepsQuickFilter ? "quick-filter" : undefined);
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

const ACTIVE_FILTER_VISIBLE_ENTRIES = 64;

type ActiveFilterProjection = Readonly<{
  readonly entries: readonly BrunoTableActiveFilterEntry[];
  readonly entryCount: number;
  readonly maxEntryWindowStart: number;
  readonly quickFilterActive: boolean;
  readonly visibleEntryWindowEnd: number;
  readonly visibleEntryWindowStart: number;
}>;

function activeFilterProjection(
  query: BrunoTableFilterSnapshot,
  requestedWindowStart: number,
): ActiveFilterProjection {
  const quickFilterActive = normalizeBrunoTableFilterText(query.quickFilter).length > 0;
  const filtersByColumn = collectActiveFilterColumnFilters(query);
  const headerCounts = new Map<string, number>();
  for (const column of query.columns) {
    headerCounts.set(column.headerName, (headerCounts.get(column.headerName) ?? 0) + 1);
  }
  const activeColumns: Array<{
    readonly column: (typeof query.columns)[number];
    readonly filters: readonly unknown[];
    readonly columnLabel: string;
  }> = [];
  for (const [columnIndex, column] of query.columns.entries()) {
    const filters = filtersByColumn.get(column.columnId) ?? [];
    if (filters.length === 0) continue;
    const columnLabel =
      headerCounts.get(column.headerName) === 1
        ? column.headerName
        : `${column.headerName} (column ${String(columnIndex + 1)})`;
    activeColumns.push({ column, filters, columnLabel });
  }
  const entryCount = activeColumns.length + (quickFilterActive ? 1 : 0);
  const maxEntryWindowStart = Math.max(0, entryCount - ACTIVE_FILTER_VISIBLE_ENTRIES);
  const visibleEntryWindowStart = Math.min(requestedWindowStart, maxEntryWindowStart);
  const visibleEntryWindowEnd = Math.min(
    entryCount,
    visibleEntryWindowStart + ACTIVE_FILTER_VISIBLE_ENTRIES,
  );
  const entries: BrunoTableActiveFilterEntry[] = [];
  let entryIndex = 0;
  if (quickFilterActive) {
    const shouldDescribe =
      entryIndex >= visibleEntryWindowStart && entryIndex < visibleEntryWindowEnd;
    entries.push({
      kind: "quick",
      key: "quick-filter",
      label: shouldDescribe
        ? `Quick Filter contains ${truncateActiveFilterSummary(JSON.stringify(query.quickFilter))}`
        : "Quick Filter",
    });
    entryIndex += 1;
  }
  for (const activeColumn of activeColumns) {
    const shouldDescribe =
      entryIndex >= visibleEntryWindowStart && entryIndex < visibleEntryWindowEnd;
    const descriptionState = shouldDescribe ? createActiveFilterDescriptionState() : undefined;
    entries.push({
      kind: "column",
      columnId: activeColumn.column.columnId,
      key: `column-filter-${activeColumn.column.columnId}`,
      label: shouldDescribe
        ? joinActiveFilterSummaries(activeColumn.filters, " AND ", (filter) =>
            describeActiveFilter(
              activeColumn.column,
              filter,
              activeColumn.columnLabel,
              descriptionState,
            ),
          )
        : activeColumn.columnLabel,
    });
    entryIndex += 1;
  }
  return {
    entries,
    entryCount,
    maxEntryWindowStart,
    quickFilterActive,
    visibleEntryWindowEnd,
    visibleEntryWindowStart,
  };
}

function collectActiveFilterColumnFilters(query: BrunoTableFilterSnapshot): Map<string, unknown[]> {
  const filtersByColumn = new Map<string, unknown[]>();
  for (const filter of query.filters) {
    const columnIds = new Set<string>();
    collectClientFilterColumnIds(filter, columnIds);
    for (const columnId of columnIds) {
      const filters = filtersByColumn.get(columnId);
      if (filters === undefined) filtersByColumn.set(columnId, [filter]);
      else filters.push(filter);
    }
  }
  return filtersByColumn;
}

type ActiveFilterDescriptionState = {
  readonly seen: WeakSet<object>;
  nodes: number;
};

function createActiveFilterDescriptionState(): ActiveFilterDescriptionState {
  return { seen: new WeakSet<object>(), nodes: 0 };
}

const ACTIVE_FILTER_DESCRIPTION_NODE_LIMIT = 1_024;

function enterActiveFilterDescription(value: object, state: ActiveFilterDescriptionState): boolean {
  if (state.seen.has(value) || state.nodes >= ACTIVE_FILTER_DESCRIPTION_NODE_LIMIT) return false;
  state.seen.add(value);
  state.nodes += 1;
  return true;
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
  state: ActiveFilterDescriptionState = createActiveFilterDescriptionState(),
): string {
  if (Array.isArray(value)) {
    if (!enterActiveFilterDescription(value, state)) return "…";
    return joinActiveFilterSummaries(value, " AND ", (condition) =>
      describeActiveFilter(column, condition, columnLabel, state),
    );
  }
  if (typeof value !== "object" || value === null) return columnLabel;
  if (!enterActiveFilterDescription(value, state)) return "…";
  const record = value as Readonly<Record<string, unknown>>;
  const type = typeof record["type"] === "string" ? record["type"] : "filter";
  if ((type === "AND" || type === "OR") && Array.isArray(record["conditions"])) {
    const joiner = type === "AND" ? " AND " : " OR ";
    return truncateActiveFilterSummary(
      `${columnLabel}: (${joinActiveFilterSummaries(record["conditions"], joiner, (condition) =>
        describeActiveFilter(column, condition, columnLabel, state),
      )})`,
    );
  }
  if (type === "NOT" && record["condition"] !== undefined) {
    return truncateActiveFilterSummary(
      `${columnLabel}: NOT (${describeActiveFilter(column, record["condition"], columnLabel, state)})`,
    );
  }
  const operand = record["filter"];
  if (type === "blank" || type === "notBlank") return `${columnLabel}: ${type}`;
  if (type === "inRange") {
    return truncateActiveFilterSummary(
      `${columnLabel}: inRange ${formatActiveFilterOperand(column, operand, type)} ≤ value < ${formatActiveFilterOperand(column, record["filterTo"], type)} (upper bound exclusive)`,
    );
  }
  const sensitivity = [
    record["caseSensitive"] === true ? "case-sensitive" : undefined,
    record["accentSensitive"] === true ? "accent-sensitive" : undefined,
  ].filter((value): value is string => value !== undefined);
  const sensitivityLabel = sensitivity.length > 0 ? ` (${sensitivity.join(", ")})` : "";
  return truncateActiveFilterSummary(
    `${columnLabel}: ${type}${sensitivityLabel} ${formatActiveFilterOperand(column, operand, type)}`,
  );
}

function formatActiveFilterOperand(
  column: CompiledColumn,
  value: unknown,
  operator?: string,
): string {
  if (operator === "in" && Array.isArray(value)) {
    return `[${joinActiveFilterSummaries(value, ", ", (item) =>
      formatActiveFilterOperand(column, item, "equals"),
    )}]`;
  }
  if (
    operator === "contains" ||
    operator === "notContains" ||
    operator === "startsWith" ||
    operator === "endsWith"
  ) {
    return truncateActiveFilterSummary(
      typeof value === "string" ? JSON.stringify(value) : String(value),
    );
  }
  try {
    const display = column.semantics.formatDisplay(value);
    return truncateActiveFilterSummary(
      typeof value === "string" ? JSON.stringify(display) : display,
    );
  } catch {
    return truncateActiveFilterSummary(String(value));
  }
}

const ACTIVE_FILTER_SUMMARY_ITEM_LIMIT = 8;
const ACTIVE_FILTER_SUMMARY_LENGTH_LIMIT = 512;

function joinActiveFilterSummaries(
  values: readonly unknown[],
  separator: string,
  render: (value: unknown) => string,
): string {
  const visible = values.slice(0, ACTIVE_FILTER_SUMMARY_ITEM_LIMIT).map((value) => render(value));
  const omitted = values.length - visible.length;
  if (omitted > 0) visible.push(`… ${String(omitted)} more`);
  return truncateActiveFilterSummary(visible.join(separator));
}

function truncateActiveFilterSummary(value: string): string {
  if (value.length <= ACTIVE_FILTER_SUMMARY_LENGTH_LIMIT) return value;
  return `${value.slice(0, ACTIVE_FILTER_SUMMARY_LENGTH_LIMIT - 1)}…`;
}
