import { Button } from "@bruno/shadcn/button";
import { Checkbox } from "@bruno/shadcn/checkbox";
import { DirectionProvider } from "@bruno/shadcn/direction";
import { Input } from "@bruno/shadcn/input";
import { NativeSelect, NativeSelectOption } from "@bruno/shadcn/native-select";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@bruno/shadcn/popover";
import { FunnelIcon } from "@phosphor-icons/react";
import { useDebouncer } from "@tanstack/react-pacer";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { NamedExoticComponent, ReactElement } from "react";

import type { CompiledColumn } from "./compile-columns";
import {
  BRUNO_TABLE_CLIENT_FILTER_MAX_DEPTH,
  BRUNO_TABLE_CLIENT_FILTER_MAX_NODES,
  BRUNO_TABLE_CLIENT_FILTER_MAX_OPERANDS,
  BRUNO_TABLE_MAX_FILTER_OPERAND_LENGTH,
  boundBrunoTableFilterOperandText,
} from "./grid-query";
import type { BrunoTableColumnCommandSnapshot, BrunoTableRuntimeView } from "./grid-runtime";
import { recordBrunoTableClientColumnFilterRender } from "./render-instrumentation";

export {
  BRUNO_TABLE_MAX_FILTER_OPERAND_LENGTH,
  boundBrunoTableFilterOperandText,
} from "./grid-query";

type FilterOperator =
  | "equals"
  | "notEqual"
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"
  | "in"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "lessThan"
  | "lessThanOrEqual"
  | "inRange"
  | "blank"
  | "notBlank";

type FilterLeafDraft = Readonly<{
  readonly kind: "leaf";
  readonly operator: FilterOperator;
  readonly first: string;
  readonly firstAuthored: boolean;
  readonly second: string;
  readonly secondAuthored: boolean;
  readonly inValues: readonly string[];
  readonly inValuesAuthored: readonly boolean[];
  readonly inValuesExplicit: boolean;
  readonly selectIndex: number | undefined;
  readonly caseSensitive: boolean;
  readonly accentSensitive: boolean;
}>;

type FilterChangeMode = "continuous" | "immediate" | "clear" | "local";

type FilterDraft =
  | FilterLeafDraft
  | Readonly<{
      readonly kind: "compound";
      readonly operator: "AND" | "OR";
      readonly conditions: readonly [FilterDraft, ...FilterDraft[]];
    }>
  | Readonly<{
      readonly kind: "not";
      readonly condition: FilterDraft;
    }>;

type FilterNode = Readonly<Record<string, unknown>>;

type FilterCandidate = Readonly<{
  readonly filter: FilterNode | undefined;
  readonly error?: string;
}>;

export type BrunoTableColumnFilterProps = {
  readonly column: CompiledColumn;
  readonly command: BrunoTableColumnCommandSnapshot;
  readonly runtime: BrunoTableRuntimeView;
  readonly activateHeaderCommand: (columnId: string) => void;
  readonly focusFallback: (columnId: string) => void;
  readonly registerColumnFilterOpener: (columnId: string, open: () => void) => () => void;
};

export const BrunoTableColumnFilter: NamedExoticComponent<BrunoTableColumnFilterProps> = memo(
  function BrunoTableColumnFilter({
    column,
    command,
    runtime,
    activateHeaderCommand,
    focusFallback,
    registerColumnFilterOpener,
  }: BrunoTableColumnFilterProps): ReactElement {
    const [open, setOpen] = useState(false);
    const [direction, setDirection] = useState<"ltr" | "rtl">("ltr");
    const closeReasonRef = useRef<string | null>(null);
    const escapeFocusFrameRef = useRef<number | null>(null);
    const wasOpenRef = useRef(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const label = `Filter ${column.headerName}`;
    const openFilter = useCallback((): void => {
      setDirection(readBrunoTableFilterDirection(triggerRef.current));
      activateHeaderCommand(column.columnId);
      setOpen(true);
    }, [activateHeaderCommand, column.columnId]);
    useLayoutEffect(
      () => registerColumnFilterOpener(column.columnId, openFilter),
      [column.columnId, openFilter, registerColumnFilterOpener],
    );
    useLayoutEffect(() => {
      wasOpenRef.current = open;
    }, [open]);
    useEffect(
      () => () => {
        if (escapeFocusFrameRef.current !== null) {
          cancelAnimationFrame(escapeFocusFrameRef.current);
        }
        if (!wasOpenRef.current || typeof document === "undefined") return;
        const active = document.activeElement;
        const overlay =
          active instanceof HTMLElement
            ? active.closest<HTMLElement>("[data-bruno-filter-overlay]")
            : null;
        if (
          active !== triggerRef.current &&
          overlay?.dataset["brunoFilterOverlay"] !== column.columnId
        ) {
          return;
        }
        focusFallback(column.columnId);
      },
      [column.columnId, focusFallback],
    );
    return (
      <DirectionProvider direction={direction}>
        <Popover
          open={open}
          onOpenChange={(nextOpen, eventDetails) => {
            if (nextOpen) {
              if (escapeFocusFrameRef.current !== null) {
                cancelAnimationFrame(escapeFocusFrameRef.current);
                escapeFocusFrameRef.current = null;
              }
              setDirection(readBrunoTableFilterDirection(triggerRef.current));
            } else if (
              eventDetails.reason === "escape-key" ||
              eventDetails.reason === "trigger-press" ||
              closeReasonRef.current === "escape-key"
            ) {
              escapeFocusFrameRef.current = requestAnimationFrame(() => {
                escapeFocusFrameRef.current = null;
                activateHeaderCommand(column.columnId);
              });
            }
            if (!nextOpen) closeReasonRef.current = null;
            setOpen(nextOpen);
          }}
        >
          <PopoverTrigger
            render={
              <Button
                ref={triggerRef}
                aria-label={command.filterActive ? `${label} (active)` : label}
                size="xs"
                tabIndex={-1}
                type="button"
                variant={command.filterActive ? "secondary" : "ghost"}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  setDirection(readBrunoTableFilterDirection(event.currentTarget));
                  activateHeaderCommand(column.columnId);
                }}
              />
            }
          >
            <FunnelIcon aria-hidden="true" />
          </PopoverTrigger>
          {open ? (
            <BrunoTableColumnFilterContent
              column={column}
              direction={direction}
              onEscape={() => {
                closeReasonRef.current = "escape-key";
              }}
              runtime={runtime}
            />
          ) : null}
        </Popover>
      </DirectionProvider>
    );
  },
);

function readBrunoTableFilterDirection(element?: Element | null): "ltr" | "rtl" {
  if (typeof document === "undefined") return "ltr";
  const source = element ?? document.activeElement;
  const grid = source?.closest<HTMLElement>('[role="grid"]') ?? null;
  const ownerDocument = source?.ownerDocument ?? document;
  return getComputedStyle(grid ?? ownerDocument.documentElement).direction === "rtl"
    ? "rtl"
    : "ltr";
}

const BrunoTableColumnFilterContent = memo(function BrunoTableColumnFilterContent({
  column,
  direction,
  onEscape,
  runtime,
}: {
  readonly column: CompiledColumn;
  readonly direction: "ltr" | "rtl";
  readonly onEscape: () => void;
  readonly runtime: BrunoTableRuntimeView;
}): ReactElement {
  if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
    recordBrunoTableClientColumnFilterRender(column.columnId);
  }
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribeFilter = runtime.subscribeColumnFilter(column.columnId, listener);
      const unsubscribeEpoch = runtime.subscribeColumnFilterCommandEpoch(column.columnId, listener);
      return () => {
        unsubscribeEpoch();
        unsubscribeFilter();
      };
    },
    [column.columnId, runtime],
  );
  const getVersion = useCallback(
    () =>
      runtime.getColumnFilterVersionSnapshot(column.columnId) +
      runtime.getColumnFilterCommandEpochSnapshot(column.columnId),
    [column.columnId, runtime],
  );
  const version = useSyncExternalStore(subscribe, getVersion, getVersion);
  return (
    <BrunoTableColumnFilterEditor
      column={column}
      committed={runtime.getColumnFilterSnapshot(column.columnId)}
      direction={direction}
      onEscape={onEscape}
      runtime={runtime}
      version={version}
    />
  );
});

type LocalFilterDraftState = Readonly<{
  readonly column: CompiledColumn;
  readonly version: number;
  readonly draft: FilterDraft;
  readonly error: string | undefined;
}>;

const BrunoTableColumnFilterEditor = memo(function BrunoTableColumnFilterEditor({
  column,
  committed,
  direction,
  onEscape,
  runtime,
  version,
}: {
  readonly column: CompiledColumn;
  readonly committed: unknown;
  readonly direction: "ltr" | "rtl";
  readonly onEscape: () => void;
  readonly runtime: BrunoTableRuntimeView;
  readonly version: number;
}): ReactElement {
  const [localState, setLocalState] = useState<LocalFilterDraftState>(() => ({
    column,
    version,
    draft: draftFromCommitted(column, committed),
    error: undefined,
  }));
  const currentState =
    localState.column === column && localState.version === version
      ? localState
      : {
          column,
          version,
          draft: draftFromCommitted(column, runtime.getColumnFilterSnapshot(column.columnId)),
          error: undefined,
        };
  const draft = currentState.draft;
  const error = currentState.error;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const errorId = useId();
  const commandEpoch = runtime.getColumnFilterCommandEpochSnapshot(column.columnId);

  const dispatchCandidate = useCallback(
    (candidate: FilterCandidate): void => {
      if (candidate.filter === undefined) return;
      if (runtime.getColumnFilterCommandEpochSnapshot(column.columnId) !== commandEpoch) return;
      runtime.dispatchGridCommand({
        type: "column.filter.replace",
        columnId: column.columnId,
        filter: candidate.filter,
      });
    },
    [column.columnId, commandEpoch, runtime],
  );
  const debouncer = useDebouncer(dispatchCandidate, { wait: 150 });

  useLayoutEffect(() => {
    if (localState.column !== column || localState.version !== version) debouncer.cancel();
  }, [column, debouncer, localState.column, localState.version, version]);

  useEffect(() => {
    (inputRef.current ?? selectRef.current)?.focus({ preventScroll: true });
    return () => debouncer.cancel();
  }, [debouncer]);

  const commitImmediately = useCallback(
    (candidate: FilterCandidate): void => {
      debouncer.cancel();
      if (candidate.filter !== undefined) dispatchCandidate(candidate);
    },
    [debouncer, dispatchCandidate],
  );

  const commitContinuous = useCallback(
    (candidate: FilterCandidate): void => {
      if (candidate.filter === undefined) {
        debouncer.cancel();
        return;
      }
      debouncer.maybeExecute(candidate);
    },
    [debouncer],
  );

  const commitDraft = useCallback(
    (nextDraft: FilterDraft, mode: FilterChangeMode, badInput = false): void => {
      if (mode === "clear") {
        debouncer.cancel();
        setLocalState({ column, version, draft: nextDraft, error: undefined });
        runtime.dispatchGridCommand({ type: "column.filter.clear", columnId: column.columnId });
        return;
      }
      if (mode === "local") {
        debouncer.cancel();
        setLocalState({ column, version, draft: nextDraft, error: undefined });
        return;
      }
      if (!isFilterDraftWithinBudget(nextDraft)) {
        debouncer.cancel();
        setLocalState({
          column,
          version,
          draft,
          error: "This filter expression is too complex.",
        });
        return;
      }
      const candidate =
        mode === "continuous"
          ? badInput
            ? { filter: undefined, error: "Enter a valid value." }
            : buildFilterCandidate(column, nextDraft)
          : buildFilterCandidate(column, nextDraft);
      setLocalState({ column, version, draft: nextDraft, error: candidate.error });
      if (mode === "continuous") commitContinuous(candidate);
      else commitImmediately(candidate);
    },
    [column, commitContinuous, commitImmediately, debouncer, draft, runtime, version],
  );

  return (
    <PopoverContent
      align="start"
      aria-label={labelForContent(column)}
      className="w-80"
      dir={direction}
      onKeyDown={(event) => {
        if (event.key === "Escape") onEscape();
      }}
      role="dialog"
      data-bruno-filter-overlay={column.columnId}
    >
      <PopoverHeader>
        <PopoverTitle>{`Filter ${column.headerName}`}</PopoverTitle>
        <PopoverDescription>
          Changes apply automatically. Clear and Reset remain column commands.
        </PopoverDescription>
      </PopoverHeader>
      <div className="flex flex-col gap-3">
        <FilterExpressionEditor
          column={column}
          draft={draft}
          errorId={errorId}
          inputRef={inputRef}
          selectRef={selectRef}
          onChange={commitDraft}
        />
        {error === undefined ? null : (
          <p id={errorId} aria-live="polite" className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </PopoverContent>
  );
});

function FilterExpressionEditor({
  column,
  draft,
  errorId,
  inputRef,
  onChange,
  path = "root",
  rootSelectRef,
  selectRef,
}: {
  readonly column: CompiledColumn;
  readonly draft: FilterDraft;
  readonly errorId: string;
  readonly inputRef?: React.RefObject<HTMLInputElement | null> | undefined;
  readonly onChange: (draft: FilterDraft, mode: FilterChangeMode, badInput?: boolean) => void;
  readonly path?: string;
  readonly rootSelectRef?: React.RefObject<HTMLSelectElement | null> | undefined;
  readonly selectRef?: React.RefObject<HTMLSelectElement | null> | undefined;
}): ReactElement {
  const expressionMode =
    draft.kind === "leaf" ? "leaf" : draft.kind === "compound" ? draft.operator : "NOT";
  const pathLabel = filterExpressionPathLabel(path);
  const labelSuffix = pathLabel === undefined ? "" : ` (${pathLabel})`;
  const modeLabel = `Filter expression for ${column.headerName}${labelSuffix}`;
  const isContinuous =
    column.semantics.editorFamily === "text" ||
    column.semantics.editorFamily === "number" ||
    column.semantics.editorFamily === "bigint" ||
    column.semantics.editorFamily === "bigdecimal";
  const operatorOptions = filterOperators(column);
  const removeConditionRefs = useRef(new Map<number, HTMLButtonElement>());
  const focusFrameRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
    },
    [],
  );
  const scheduleFocus = (resolveTarget: () => HTMLElement | null): void => {
    if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
    const focus = () => {
      focusFrameRef.current = null;
      const target = resolveTarget();
      target?.focus({ preventScroll: true });
    };
    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = requestAnimationFrame(focus);
    });
  };
  const focusAfterConditionRemoval = (nextIndex: number): void => {
    scheduleFocus(
      () =>
        (nextIndex < 0 ? undefined : removeConditionRefs.current.get(nextIndex)) ??
        rootSelectRef?.current ??
        selectRef?.current ??
        inputRef?.current ??
        null,
    );
  };
  const focusAddedControl = (controlId: string): void => {
    scheduleFocus(() => document.getElementById(controlId));
  };
  const updateLeaf = (nextLeaf: FilterLeafDraft, mode: FilterChangeMode, badInput = false) =>
    onChange(nextLeaf, mode, badInput);

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${errorId}-${path}-mode`}>
        Expression
        <NativeSelect
          ref={path === "root" ? selectRef : undefined}
          id={`${errorId}-${path}-mode`}
          aria-label={modeLabel}
          value={expressionMode}
          onChange={(event) => {
            onChange(changeExpressionMode(column, draft, event.currentTarget.value), "immediate");
          }}
        >
          <NativeSelectOption value="leaf">Single condition</NativeSelectOption>
          <NativeSelectOption value="AND">All conditions (AND)</NativeSelectOption>
          <NativeSelectOption value="OR">Any conditions (OR)</NativeSelectOption>
          <NativeSelectOption value="NOT">Not condition (NOT)</NativeSelectOption>
        </NativeSelect>
      </label>
      {draft.kind === "leaf" ? (
        (() => {
          const leaf = draft;
          return (
            <>
              <label
                className="flex flex-col gap-1 text-sm"
                htmlFor={`${errorId}-${path}-operator`}
              >
                Operator
                <NativeSelect
                  ref={path === "root" && leaf.operator === "blank" ? selectRef : undefined}
                  id={`${errorId}-${path}-operator`}
                  aria-label={`Filter operator for ${column.headerName}${labelSuffix}`}
                  value={leaf.operator}
                  onChange={(event) => {
                    const operator = event.currentTarget.value as FilterOperator;
                    updateLeaf(
                      Object.freeze({
                        ...leaf,
                        operator,
                        inValues:
                          operator === "in" && leaf.inValues.length === 0
                            ? leaf.firstAuthored
                              ? Object.freeze([leaf.first])
                              : Object.freeze([])
                            : leaf.inValues,
                        inValuesAuthored:
                          operator === "in" && leaf.inValues.length === 0
                            ? leaf.firstAuthored
                              ? Object.freeze([true])
                              : Object.freeze([])
                            : leaf.inValuesAuthored,
                        inValuesExplicit: operator === "in" ? leaf.inValuesExplicit : false,
                      }),
                      "immediate",
                    );
                  }}
                >
                  {operatorOptions.map((operator) => (
                    <NativeSelectOption key={operator} value={operator}>
                      {operatorLabelText(operator)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              {leaf.operator === "blank" || leaf.operator === "notBlank" ? null : (
                <FilterOperand
                  column={column}
                  draft={leaf}
                  errorId={errorId}
                  inputRef={inputRef}
                  path={path}
                  selectRef={selectRef}
                  inputLabel={`Filter value for ${column.headerName}${labelSuffix}`}
                  focusAddedControl={focusAddedControl}
                  onChange={updateLeaf}
                  continuous={isContinuous}
                />
              )}
              {column.semantics.filterFamily === "text" &&
              supportsTextSensitivity(leaf.operator) ? (
                <div className="flex flex-col gap-2 text-sm">
                  <label className="flex items-center gap-2" htmlFor={`${errorId}-${path}-case`}>
                    <Checkbox
                      id={`${errorId}-${path}-case`}
                      aria-label={`Case-sensitive filter for ${column.headerName}`}
                      checked={leaf.caseSensitive}
                      onCheckedChange={(checked) =>
                        updateLeaf(
                          Object.freeze({ ...leaf, caseSensitive: checked === true }),
                          "immediate",
                        )
                      }
                    />
                    Case-sensitive
                  </label>
                  <label className="flex items-center gap-2" htmlFor={`${errorId}-${path}-accent`}>
                    <Checkbox
                      id={`${errorId}-${path}-accent`}
                      aria-label={`Accent-sensitive filter for ${column.headerName}`}
                      checked={leaf.accentSensitive}
                      onCheckedChange={(checked) =>
                        updateLeaf(
                          Object.freeze({ ...leaf, accentSensitive: checked === true }),
                          "immediate",
                        )
                      }
                    />
                    Accent-sensitive
                  </label>
                </div>
              ) : null}
            </>
          );
        })()
      ) : draft.kind === "not" ? (
        <FilterExpressionEditor
          column={column}
          draft={draft.condition}
          errorId={errorId}
          inputRef={inputRef}
          onChange={(condition, mode, badInput) =>
            onChange(Object.freeze({ ...draft, condition }), mode, badInput)
          }
          path={`${path}-not`}
          rootSelectRef={rootSelectRef ?? selectRef}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {draft.conditions.map((condition, index) => {
            const conditionPath = `${path}-${String(index)}`;
            const conditionLabel = filterExpressionPathLabel(conditionPath);
            return (
              <div
                key={conditionPath}
                className="flex flex-col gap-2 rounded-md border p-2"
                role="group"
                aria-label={`Filter ${conditionLabel ?? "condition"} for ${column.headerName}`}
              >
                <FilterExpressionEditor
                  column={column}
                  draft={condition}
                  errorId={errorId}
                  onChange={(nextCondition, mode, badInput) => {
                    const conditions = draft.conditions.slice() as [FilterDraft, ...FilterDraft[]];
                    conditions[index] = nextCondition;
                    onChange(
                      Object.freeze({ ...draft, conditions: Object.freeze(conditions) }),
                      mode,
                      badInput,
                    );
                  }}
                  path={conditionPath}
                  rootSelectRef={rootSelectRef ?? selectRef}
                />
                {draft.conditions.length > 1 ? (
                  <Button
                    ref={(element) => {
                      if (element === null) removeConditionRefs.current.delete(index);
                      else removeConditionRefs.current.set(index, element);
                    }}
                    aria-label={`Remove condition ${String(index + 1)} for ${column.headerName}`}
                    size="xs"
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      const conditions = draft.conditions.filter(
                        (_, candidate) => candidate !== index,
                      );
                      onChange(
                        conditions.length === 1
                          ? conditions[0]!
                          : Object.freeze({
                              ...draft,
                              conditions: Object.freeze(conditions) as readonly [
                                FilterDraft,
                                ...FilterDraft[],
                              ],
                            }),
                        "immediate",
                      );
                      focusAfterConditionRemoval(
                        conditions.length === 1
                          ? -1
                          : index < draft.conditions.length - 1
                            ? index
                            : index - 1,
                      );
                    }}
                  >
                    Remove condition
                  </Button>
                ) : null}
              </div>
            );
          })}
          <Button
            aria-label={`Add condition for ${column.headerName}`}
            size="xs"
            type="button"
            variant="outline"
            onClick={() => {
              const nextIndex = draft.conditions.length;
              onChange(
                Object.freeze({
                  ...draft,
                  conditions: Object.freeze([
                    ...draft.conditions,
                    createDefaultLeaf(column),
                  ]) as readonly [FilterDraft, ...FilterDraft[]],
                }),
                "immediate",
              );
              focusAddedControl(`${errorId}-${path}-${String(nextIndex)}-mode`);
            }}
          >
            Add condition
          </Button>
        </div>
      )}
    </div>
  );
}

function FilterOperand({
  column,
  draft,
  errorId,
  focusAddedControl,
  inputLabel,
  inputRef,
  onChange,
  path,
  selectRef,
  continuous,
}: {
  readonly column: CompiledColumn;
  readonly draft: FilterLeafDraft;
  readonly errorId: string;
  readonly inputLabel: string;
  readonly inputRef?: React.RefObject<HTMLInputElement | null> | undefined;
  readonly focusAddedControl: (controlId: string) => void;
  readonly onChange: (draft: FilterLeafDraft, mode: FilterChangeMode, badInput?: boolean) => void;
  readonly path: string;
  readonly selectRef?: React.RefObject<HTMLSelectElement | null> | undefined;
  readonly continuous: boolean;
}): ReactElement {
  const isIn = draft.operator === "in";
  const composingRef = useRef(false);
  const latestDraftRef = useRef(draft);
  useEffect(() => {
    latestDraftRef.current = draft;
  }, [draft]);
  const beginComposition = (): void => {
    composingRef.current = true;
    onChange(latestDraftRef.current, "local");
  };
  const finishComposition = (): void => {
    composingRef.current = false;
    onChange(latestDraftRef.current, continuous ? "continuous" : "immediate");
  };
  const changeMode = (): FilterChangeMode =>
    composingRef.current ? "local" : continuous ? "continuous" : "immediate";
  const pathLabel = filterExpressionPathLabel(path);
  const labelSuffix = pathLabel === undefined ? "" : ` (${pathLabel})`;
  if (isBuiltInBooleanColumn(column)) {
    return (
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${errorId}-${path}-value`}>
        Value
        <NativeSelect
          ref={selectRef}
          id={`${errorId}-${path}-value`}
          aria-label={inputLabel}
          value={draft.first}
          onChange={(event) =>
            onChange(
              Object.freeze({
                ...draft,
                first: event.currentTarget.value,
                firstAuthored: event.currentTarget.value.length > 0,
              }),
              "immediate",
            )
          }
        >
          <NativeSelectOption value="">Choose a value</NativeSelectOption>
          <NativeSelectOption value="true">True</NativeSelectOption>
          <NativeSelectOption value="false">False</NativeSelectOption>
        </NativeSelect>
      </label>
    );
  }

  if (column.semantics.filterFamily === "select" && column.selectOptions !== undefined) {
    return (
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${errorId}-${path}-value`}>
        Value
        <NativeSelect
          ref={selectRef}
          id={`${errorId}-${path}-value`}
          aria-label={inputLabel}
          value={draft.selectIndex === undefined ? "" : selectOptionToken(draft.selectIndex)}
          onChange={(event) => {
            const token = event.currentTarget.value;
            const index = parseSelectOptionToken(token);
            const option = index === undefined ? undefined : column.selectOptions?.[index];
            onChange(
              Object.freeze({
                ...draft,
                first: option === undefined ? "" : column.semantics.formatCanonicalText(option),
                firstAuthored: option !== undefined,
                selectIndex: index,
              }),
              "immediate",
            );
          }}
        >
          <NativeSelectOption value="">Choose a value</NativeSelectOption>
          {column.selectOptions.map((option, index) => (
            <NativeSelectOption key={String(index)} value={selectOptionToken(index)}>
              {column.semantics.formatDisplay(option)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
    );
  }

  const isRange = draft.operator === "inRange";
  const isBigInt = column.semantics.editorFamily === "bigint";
  const isNumber = column.semantics.editorFamily === "number";
  const type = isNumber ? "number" : "text";
  const inputMode = isBigInt
    ? "numeric"
    : column.semantics.editorFamily === "bigdecimal"
      ? "decimal"
      : undefined;
  const values = isIn && draft.inValuesExplicit ? draft.inValues : [draft.first];
  return (
    <div className="flex flex-col gap-2">
      {isIn ? (
        <div
          aria-label={`Filter values for ${column.headerName}${labelSuffix}`}
          role="group"
          className="flex flex-col gap-2"
        >
          {values.map((value, index) => (
            <div key={String(index)} className="flex items-end gap-1">
              <label
                className="flex min-w-0 flex-1 flex-col gap-1 text-sm"
                htmlFor={`${errorId}-${path}-value-${String(index)}`}
              >
                {index === 0 ? "Value" : `Value ${String(index + 1)}`}
                <Input
                  ref={index === 0 ? inputRef : undefined}
                  id={`${errorId}-${path}-value-${String(index)}`}
                  aria-describedby={errorId}
                  aria-label={
                    index === 0
                      ? inputLabel
                      : `Filter value ${String(index + 1)} for ${column.headerName}${labelSuffix}`
                  }
                  inputMode={inputMode}
                  maxLength={BRUNO_TABLE_MAX_FILTER_OPERAND_LENGTH}
                  onCompositionEnd={finishComposition}
                  onCompositionStart={beginComposition}
                  step={isNumber ? "any" : undefined}
                  type={type}
                  value={value}
                  onChange={(event) => {
                    const nextValues = values.slice();
                    nextValues[index] = boundBrunoTableFilterOperandText(event.currentTarget.value);
                    const nextValuesAuthored = (
                      draft.inValuesAuthored.length > 0
                        ? draft.inValuesAuthored
                        : [draft.firstAuthored]
                    ).slice() as boolean[];
                    nextValuesAuthored[index] = true;
                    onChange(
                      Object.freeze({
                        ...draft,
                        first: nextValues[0] ?? "",
                        firstAuthored: true,
                        inValues: Object.freeze(nextValues),
                        inValuesAuthored: Object.freeze(nextValuesAuthored),
                        inValuesExplicit: true,
                      }),
                      changeMode(),
                      isNumber && event.currentTarget.validity.badInput,
                    );
                  }}
                />
              </label>
              {values.length > 1 ? (
                <Button
                  aria-label={`Remove filter value ${String(index + 1)} for ${column.headerName}`}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    const nextValues = values.filter((_, candidate) => candidate !== index);
                    const nextFocusId =
                      nextValues.length === 0
                        ? `${errorId}-${path}-add-value`
                        : `${errorId}-${path}-value-${String(Math.min(index, nextValues.length - 1))}`;
                    onChange(
                      Object.freeze({
                        ...draft,
                        first: nextValues[0] ?? "",
                        firstAuthored: nextValues.length > 0,
                        inValues: Object.freeze(nextValues),
                        inValuesExplicit: true,
                        inValuesAuthored: Object.freeze(
                          nextValues.map((_, candidate) => {
                            const sourceIndex = candidate >= index ? candidate + 1 : candidate;
                            return (
                              (draft.inValuesAuthored.length > 0
                                ? draft.inValuesAuthored
                                : [draft.firstAuthored])[sourceIndex] ?? false
                            );
                          }),
                        ),
                      }),
                      continuous ? "continuous" : "immediate",
                    );
                    focusAddedControl(nextFocusId);
                  }}
                >
                  ×
                </Button>
              ) : null}
            </div>
          ))}
          <Button
            aria-label={`Add filter value for ${column.headerName}`}
            id={`${errorId}-${path}-add-value`}
            size="xs"
            type="button"
            variant="outline"
            onClick={() => {
              const nextIndex = values.length;
              onChange(
                Object.freeze({
                  ...draft,
                  inValues: Object.freeze([...values, ""]),
                  inValuesAuthored: Object.freeze([
                    ...(draft.inValuesAuthored.length > 0
                      ? draft.inValuesAuthored
                      : values.map((_, index) => index === 0 && draft.firstAuthored)),
                    false,
                  ]),
                  inValuesExplicit: true,
                }),
                continuous ? "continuous" : "immediate",
              );
              focusAddedControl(`${errorId}-${path}-value-${String(nextIndex)}`);
            }}
          >
            Add value
          </Button>
        </div>
      ) : (
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${errorId}-${path}-value`}>
          Value
          <Input
            ref={inputRef}
            id={`${errorId}-${path}-value`}
            aria-describedby={errorId}
            aria-label={inputLabel}
            inputMode={inputMode}
            maxLength={BRUNO_TABLE_MAX_FILTER_OPERAND_LENGTH}
            onCompositionEnd={finishComposition}
            onCompositionStart={beginComposition}
            step={isNumber ? "any" : undefined}
            type={type}
            value={draft.first}
            onChange={(event) => {
              const value = boundBrunoTableFilterOperandText(event.currentTarget.value);
              onChange(
                Object.freeze({ ...draft, first: value, firstAuthored: true }),
                changeMode(),
                isNumber && event.currentTarget.validity.badInput,
              );
            }}
          />
        </label>
      )}
      {isRange ? (
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${errorId}-${path}-value-to`}>
          Less than
          <Input
            id={`${errorId}-${path}-value-to`}
            aria-describedby={errorId}
            aria-label={`Filter upper bound for ${column.headerName}${labelSuffix}`}
            inputMode={inputMode}
            maxLength={BRUNO_TABLE_MAX_FILTER_OPERAND_LENGTH}
            onCompositionEnd={finishComposition}
            onCompositionStart={beginComposition}
            step={isNumber ? "any" : undefined}
            type={type}
            value={draft.second}
            onChange={(event) => {
              const value = boundBrunoTableFilterOperandText(event.currentTarget.value);
              onChange(
                Object.freeze({ ...draft, second: value, secondAuthored: true }),
                changeMode(),
                isNumber && event.currentTarget.validity.badInput,
              );
            }}
          />
        </label>
      ) : null}
    </div>
  );
}

function filterOperators(column: CompiledColumn): readonly FilterOperator[] {
  switch (column.semantics.filterFamily) {
    case "text":
      return Object.freeze([
        "equals",
        "notEqual",
        "contains",
        "notContains",
        "startsWith",
        "endsWith",
        "in",
        "blank",
        "notBlank",
      ]);
    case "numeric":
      return Object.freeze([
        "equals",
        "notEqual",
        "in",
        "greaterThan",
        "greaterThanOrEqual",
        "lessThan",
        "lessThanOrEqual",
        "inRange",
        "blank",
        "notBlank",
      ]);
    case "boolean":
    case "select":
      return Object.freeze(["equals", "notEqual", "blank", "notBlank"]);
    case "equality":
      return Object.freeze(["equals", "notEqual", "in", "blank", "notBlank"]);
    default:
      return Object.freeze(["equals", "notEqual"]);
  }
}

function draftFromCommitted(column: CompiledColumn, committed: unknown): FilterDraft {
  if (Array.isArray(committed)) {
    const conditions = committed.map((condition) => draftFromNode(column, asRecord(condition)));
    if (conditions.length >= 2) {
      return Object.freeze({
        kind: "compound",
        operator: "AND",
        conditions: Object.freeze(conditions) as readonly [
          FilterDraft,
          FilterDraft,
          ...FilterDraft[],
        ],
      });
    }
    return conditions[0] ?? createDefaultLeaf(column);
  }
  return draftFromNode(column, asRecord(committed));
}

function draftFromNode(
  column: CompiledColumn,
  record: Readonly<Record<string, unknown>>,
): FilterDraft {
  const type = record["type"];
  if ((type === "AND" || type === "OR") && Array.isArray(record["conditions"])) {
    const conditions = record["conditions"].map((condition) =>
      draftFromNode(column, asRecord(condition)),
    );
    if (conditions.length >= 1) {
      return Object.freeze({
        kind: "compound",
        operator: type,
        conditions: Object.freeze(conditions) as readonly [
          FilterDraft,
          FilterDraft,
          ...FilterDraft[],
        ],
      });
    }
  }
  if (type === "NOT" && record["condition"] !== undefined) {
    return Object.freeze({
      kind: "not",
      condition: draftFromNode(column, asRecord(record["condition"])),
    });
  }
  const operator = isFilterOperator(type) ? type : defaultFilterOperator(column);
  const rawFilter = record["filter"];
  const inValues =
    operator === "in" && Array.isArray(rawFilter)
      ? Object.freeze(rawFilter.map((value) => formatOperand(column, value) ?? ""))
      : Object.freeze([]);
  const first =
    operator === "in"
      ? (inValues[0] ?? "")
      : (formatFilterDraftOperand(column, operator, rawFilter) ?? defaultOperand(column));
  return Object.freeze({
    kind: "leaf",
    operator,
    first,
    firstAuthored:
      operator === "in"
        ? inValues.length > 0
        : rawFilter !== undefined &&
          formatFilterDraftOperand(column, operator, rawFilter) !== undefined,
    second: formatOperand(column, record["filterTo"]) ?? "",
    secondAuthored: record["filterTo"] !== undefined,
    inValues,
    inValuesAuthored: Object.freeze(
      operator === "in" && Array.isArray(rawFilter) ? rawFilter.map(() => true) : [],
    ),
    inValuesExplicit: operator === "in" && Array.isArray(rawFilter),
    selectIndex:
      column.semantics.filterFamily === "select"
        ? findSelectOptionIndex(
            column,
            operator === "in" && Array.isArray(rawFilter) ? rawFilter[0] : rawFilter,
          )
        : undefined,
    caseSensitive: record["caseSensitive"] === true,
    accentSensitive: record["accentSensitive"] === true,
  });
}

function buildFilterCandidate(column: CompiledColumn, draft: FilterDraft): FilterCandidate {
  if (draft.kind === "not") {
    const condition = buildFilterCandidate(column, draft.condition);
    return condition.filter === undefined
      ? condition
      : { filter: Object.freeze({ type: "NOT", condition: condition.filter }) };
  }
  if (draft.kind === "compound") {
    const conditions: FilterNode[] = [];
    for (const conditionDraft of draft.conditions) {
      const condition = buildFilterCandidate(column, conditionDraft);
      if (condition.filter === undefined) return condition;
      conditions.push(condition.filter);
    }
    return {
      filter: Object.freeze({
        type: draft.operator,
        conditions: Object.freeze(conditions),
      }),
    };
  }
  return buildLeafFilterCandidate(column, draft);
}

function isFilterDraftWithinBudget(draft: FilterDraft): boolean {
  return countFilterDraftNodes(draft, 0) !== undefined;
}

function countFilterDraftNodes(draft: FilterDraft, depth: number): number | undefined {
  if (depth > BRUNO_TABLE_CLIENT_FILTER_MAX_DEPTH) return undefined;
  if (draft.kind === "leaf") {
    return draft.inValues.length <= BRUNO_TABLE_CLIENT_FILTER_MAX_OPERANDS ? 1 : undefined;
  }
  const childDrafts = draft.kind === "not" ? [draft.condition] : draft.conditions;
  let nodes = 1;
  for (const child of childDrafts) {
    const childNodes = countFilterDraftNodes(child, depth + 1);
    if (childNodes === undefined) return undefined;
    nodes += childNodes;
    if (nodes > BRUNO_TABLE_CLIENT_FILTER_MAX_NODES) return undefined;
  }
  return nodes;
}

function buildLeafFilterCandidate(column: CompiledColumn, draft: FilterLeafDraft): FilterCandidate {
  const base = {
    columnId: column.columnId,
    type: draft.operator,
    ...(column.semantics.filterFamily === "text"
      ? {
          caseSensitive: draft.caseSensitive,
          accentSensitive: draft.accentSensitive,
        }
      : {}),
  } satisfies Record<string, unknown>;
  if (draft.operator === "blank" || draft.operator === "notBlank") {
    return { filter: Object.freeze(base) };
  }
  if (isSubstringFilterOperator(draft.operator)) {
    return draft.firstAuthored
      ? { filter: Object.freeze({ ...base, filter: draft.first }) }
      : { filter: undefined, error: "Enter one or more valid values." };
  }
  if (draft.operator === "in") {
    if (!draft.inValuesExplicit && !draft.firstAuthored) {
      return { filter: undefined, error: "Enter one or more valid values." };
    }
    const authored = draft.inValuesExplicit ? draft.inValuesAuthored : [draft.firstAuthored];
    if (authored.some((value) => !value)) {
      return { filter: undefined, error: "Enter one or more valid values." };
    }
    const values = draft.inValuesExplicit ? draft.inValues : [draft.first];
    const decoded = values.map((value) => column.semantics.parseCanonicalText(value));
    const invalid = decoded.find((result) => result._tag === "Failure");
    if (invalid?._tag === "Failure") return { filter: undefined, error: invalid.message };
    return {
      filter: Object.freeze({
        ...base,
        filter: Object.freeze(
          decoded.map((result) => (result._tag === "Success" ? result.value : undefined)),
        ),
      }),
    };
  }
  if (column.semantics.filterFamily === "select" && column.selectOptions !== undefined) {
    const option =
      draft.selectIndex === undefined ? undefined : column.selectOptions?.[draft.selectIndex];
    if (option === undefined) return { filter: undefined, error: "Choose a value." };
    return { filter: Object.freeze({ ...base, filter: option }) };
  }
  if (!draft.firstAuthored) {
    return { filter: undefined, error: "Enter one or more valid values." };
  }
  const first = column.semantics.parseCanonicalText(draft.first);
  if (first._tag === "Failure") return { filter: undefined, error: first.message };
  if (draft.operator === "inRange") {
    if (!draft.secondAuthored) {
      return { filter: undefined, error: "Enter an upper bound." };
    }
    const second = column.semantics.parseCanonicalText(draft.second);
    if (second._tag === "Failure") return { filter: undefined, error: second.message };
    return {
      filter: Object.freeze({ ...base, filter: first.value, filterTo: second.value }),
    };
  }
  return { filter: Object.freeze({ ...base, filter: first.value }) };
}

function changeExpressionMode(
  column: CompiledColumn,
  draft: FilterDraft,
  mode: string,
): FilterDraft {
  if (mode === "leaf") {
    if (draft.kind === "leaf") return draft;
    return firstFilterLeaf(draft);
  }
  if (mode === "NOT") {
    return draft.kind === "not"
      ? draft
      : Object.freeze({
          kind: "not",
          condition: draft,
        });
  }
  if (mode !== "AND" && mode !== "OR") return draft;
  if (draft.kind === "compound") return Object.freeze({ ...draft, operator: mode });
  if (draft.kind === "not") {
    return Object.freeze({
      kind: "compound",
      operator: mode,
      conditions: Object.freeze([draft.condition, createDefaultLeaf(column)]) as readonly [
        FilterDraft,
        FilterDraft,
      ],
    });
  }
  return Object.freeze({
    kind: "compound",
    operator: mode,
    conditions: Object.freeze([draft, createDefaultLeaf(column)]) as readonly [
      FilterDraft,
      FilterDraft,
    ],
  });
}

function firstFilterLeaf(draft: FilterDraft): FilterLeafDraft {
  if (draft.kind === "leaf") return draft;
  if (draft.kind === "not") return firstFilterLeaf(draft.condition);
  return firstFilterLeaf(draft.conditions[0]);
}

function createDefaultLeaf(column: CompiledColumn): FilterLeafDraft {
  return Object.freeze({
    kind: "leaf",
    operator: defaultFilterOperator(column),
    first: defaultOperand(column),
    firstAuthored: false,
    second: "",
    secondAuthored: false,
    inValues: Object.freeze([]),
    inValuesAuthored: Object.freeze([]),
    inValuesExplicit: false,
    selectIndex: undefined,
    caseSensitive: false,
    accentSensitive: false,
  });
}

function formatOperand(column: CompiledColumn, value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return column.semantics.formatCanonicalText(value);
  } catch {
    return undefined;
  }
}

function formatFilterDraftOperand(
  column: CompiledColumn,
  operator: FilterOperator,
  value: unknown,
): string | undefined {
  if (isSubstringFilterOperator(operator) && typeof value === "string") {
    return value;
  }
  return formatOperand(column, value);
}

function isSubstringFilterOperator(operator: FilterOperator): boolean {
  return (
    operator === "contains" ||
    operator === "notContains" ||
    operator === "startsWith" ||
    operator === "endsWith"
  );
}

function supportsTextSensitivity(operator: FilterOperator): boolean {
  return (
    operator === "equals" ||
    operator === "notEqual" ||
    operator === "in" ||
    isSubstringFilterOperator(operator)
  );
}

function findSelectOptionIndex(column: CompiledColumn, value: unknown): number | undefined {
  if (value === undefined || column.selectOptions === undefined) return undefined;
  const index = column.selectOptions.findIndex((option) => {
    try {
      return column.semantics.equivalent(option, value);
    } catch {
      return false;
    }
  });
  return index === -1 ? undefined : index;
}

function defaultFilterOperator(column: CompiledColumn): FilterOperator {
  return filterOperators(column)[0] ?? "equals";
}

function defaultOperand(_column: CompiledColumn): string {
  return "";
}

function isBuiltInBooleanColumn(column: CompiledColumn): boolean {
  return column.valueType === "boolean";
}

function isFilterOperator(value: unknown): value is FilterOperator {
  return typeof value === "string" && filterOperatorSet.has(value as FilterOperator);
}

function operatorLabelText(operator: FilterOperator): string {
  const labels: Record<FilterOperator, string> = {
    equals: "Equals",
    notEqual: "Does not equal",
    contains: "Contains",
    notContains: "Does not contain",
    startsWith: "Starts with",
    endsWith: "Ends with",
    in: "Is one of",
    greaterThan: "Greater than",
    greaterThanOrEqual: "Greater than or equal",
    lessThan: "Less than",
    lessThanOrEqual: "Less than or equal",
    inRange: "In range (upper bound exclusive)",
    blank: "Is blank",
    notBlank: "Is not blank",
  };
  return labels[operator];
}

function labelForContent(column: CompiledColumn): string {
  return `Filter ${column.headerName}`;
}

function filterExpressionPathLabel(path: string): string | undefined {
  if (path === "root") return undefined;
  return path
    .split("-")
    .slice(1)
    .map((segment) => {
      if (segment === "not") return "NOT condition";
      const index = Number(segment);
      return Number.isInteger(index) && index >= 0
        ? `condition ${String(index + 1)}`
        : "nested condition";
    })
    .join(" / ");
}

function selectOptionToken(index: number): string {
  return `bruno-select-option-${String(index)}`;
}

function parseSelectOptionToken(value: string): number | undefined {
  const prefix = "bruno-select-option-";
  if (!value.startsWith(prefix)) return undefined;
  const index = Number(value.slice(prefix.length));
  return Number.isInteger(index) && index >= 0 ? index : undefined;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

const filterOperatorSet = new Set<FilterOperator>([
  "equals",
  "notEqual",
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "in",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
  "inRange",
  "blank",
  "notBlank",
]);
