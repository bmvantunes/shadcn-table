import type { CompiledColumn } from "./compile-columns";
import { readCompiledColumnValue } from "./cell-value";

export type ClientOrderBy = readonly {
  readonly columnId: string;
  readonly direction: "asc" | "desc";
}[];

export type BrunoTableOrderBy = ClientOrderBy;

type CompiledFilterOperandPlan = Readonly<{
  readonly normalizedOperand?: string | undefined;
  readonly normalizedOperands?: readonly (string | undefined)[] | undefined;
  readonly membershipKeys?: ReadonlySet<string> | undefined;
  readonly normalizedSubstringOperand?: string | undefined;
}>;

export type BrunoTableFilterComplexity = Readonly<{
  readonly rootEntries: number;
  readonly nodes: number;
  readonly operands: number;
  readonly textLength: number;
}>;

type BrunoTableClientFilterRoot = Readonly<{
  readonly filter: Readonly<Record<string, unknown>>;
  readonly columnId: string;
  /** Bounded active-filter label compiled from the admitted root, never rediscovered in the UI. */
  readonly activeFilterLabel: string;
  readonly signature?: string;
  readonly compiledOperandNodes: readonly object[];
  readonly complexity: BrunoTableFilterComplexity;
}>;

/**
 * The sole admitted Grid Filter representation used by the Client runtime. Raw filter snapshots
 * remain available at the Adapter seam, while commands and render projections use the retained
 * roots, per-column index, and semantic evidence compiled during one bounded admission pass.
 */
export type BrunoTableClientFilterCollection = Readonly<{
  readonly filters: readonly unknown[];
  readonly columnsById: ReadonlyMap<string, CompiledColumn>;
  readonly columnLabelsById: ReadonlyMap<string, string>;
  readonly roots: readonly BrunoTableClientFilterRoot[];
  readonly byColumn: ReadonlyMap<string, readonly unknown[]>;
  readonly rootsByColumn: ReadonlyMap<string, readonly BrunoTableClientFilterRoot[]>;
  readonly activeFilterLabelsByColumn: ReadonlyMap<string, readonly string[]>;
  readonly snapshotsByColumn: ReadonlyMap<string, unknown>;
  readonly complexityByColumn: ReadonlyMap<string, BrunoTableFilterComplexity>;
  readonly columnIds: ReadonlySet<string>;
  readonly signatureCountsByColumn: ReadonlyMap<string, ReadonlyMap<string, number>>;
  readonly opaqueRootCountByColumn: ReadonlyMap<string, number>;
  readonly complexity: BrunoTableFilterComplexity;
  readonly compiledOperands: ReadonlyMap<object, CompiledFilterOperandPlan>;
  readonly hasSharedNodes: boolean;
}>;

export function reconcileBrunoTableOrderBy(
  orderBy: BrunoTableOrderBy,
  baseline: BrunoTableOrderBy,
  columns: readonly CompiledColumn[],
): BrunoTableOrderBy {
  return reconcileClientOrderBy(orderBy, baseline, columns);
}

export function sanitizeBrunoTableOrderBy(
  orderBy: BrunoTableOrderBy | undefined,
  columns: readonly CompiledColumn[],
): BrunoTableOrderBy {
  return sanitizeClientOrderBy(orderBy, columns);
}

export function sanitizeBrunoTableFilters(
  filters: readonly unknown[] | undefined,
  columns: readonly CompiledColumn[],
): readonly unknown[] {
  return compileClientFilterCollection(filters, columns).filters;
}

/**
 * Legacy raw-input inspection kept for compatibility with low-level tests. Runtime commands use
 * BrunoTableClientFilterCollection.columnIds/rootsByColumn and never rediscover these identities.
 */
export function brunoTableFilterReferencesColumn(candidate: unknown, columnId: string): boolean {
  return filterReferencesColumn(candidate, columnId);
}

export function sanitizeClientInitialOrderBy(
  orderBy: ClientOrderBy | undefined,
  columns: readonly CompiledColumn[],
): ClientOrderBy {
  const sanitized = sanitizeClientOrderBy(orderBy, columns);
  if (sanitized.length === 0) {
    throw new TypeError(
      orderBy === undefined || isReadableEmptyArray(orderBy)
        ? "BrunoTable initialOrderBy is required."
        : hasSortableColumns(columns)
          ? "BrunoTable initialOrderBy contains no valid sortable column."
          : "BrunoTableClient requires at least one sortable column.",
    );
  }
  return sanitized;
}

export function reconcileClientOrderBy(
  orderBy: ClientOrderBy,
  baseline: ClientOrderBy,
  columns: readonly CompiledColumn[],
): ClientOrderBy {
  const current = sanitizeClientOrderBy(orderBy, columns);
  if (current.length > 0 || !hasSortableColumns(columns)) return current;
  const initial = sanitizeClientOrderBy(baseline, columns);
  if (initial.length > 0) return initial;
  const firstSortable = columns.find((column) => column.enableSorting !== false);
  return firstSortable === undefined
    ? EMPTY_ORDER_BY
    : Object.freeze([
        Object.freeze({ columnId: firstSortable.columnId, direction: "asc" as const }),
      ]);
}

export function sanitizeClientOrderBy(
  orderBy: ClientOrderBy | undefined,
  columns: readonly CompiledColumn[],
): ClientOrderBy {
  const candidates = snapshotRootEntries(orderBy);
  if (candidates === undefined || candidates === ROOT_ENTRIES_OVER_BUDGET) {
    return EMPTY_ORDER_BY;
  }
  const sortable = new Set<string>(
    columns.filter((column) => column.enableSorting !== false).map((column) => column.columnId),
  );
  const seen = new Set<string>();
  const sanitized: { readonly columnId: string; readonly direction: "asc" | "desc" }[] = [];
  for (const candidate of candidates) {
    try {
      const sort = asRecord(candidate);
      const direction = sort["direction"];
      const columnId = sort["columnId"];
      if (direction !== "asc" && direction !== "desc") continue;
      if (typeof columnId !== "string" || !sortable.has(columnId) || seen.has(columnId)) continue;
      seen.add(columnId);
      sanitized.push(Object.freeze({ columnId, direction }));
    } catch {
      // Ignore only this unreadable external entry so valid siblings remain usable.
    }
  }
  return Object.freeze(sanitized);
}

export function sanitizeClientInitialFilters(
  filters: readonly unknown[] | undefined,
  columns: readonly CompiledColumn[],
  options?: Readonly<{ readonly rejectOverBudget?: boolean }>,
): readonly unknown[] {
  return compileClientFilterCollection(filters, columns, options).filters;
}

/**
 * Admits the complete filter collection through one bounded pass. The returned collection is the
 * only representation the Client query/runtime path should use after this boundary: roots retain
 * their sanitized snapshots, while indexes and value-semantic evidence are compiled alongside
 * them. Invalid restoration/command candidates are dropped by default; initial configuration can
 * request a hard failure for an over-budget candidate.
 */
export function compileClientFilterCollection(
  filters: readonly unknown[] | undefined,
  columns: readonly CompiledColumn[],
  options?: Readonly<{ readonly rejectOverBudget?: boolean }>,
): BrunoTableClientFilterCollection {
  const candidates = snapshotRootEntries(filters);
  if (candidates === ROOT_ENTRIES_OVER_BUDGET) {
    if (options?.rejectOverBudget === true) {
      throw new TypeError(
        `BrunoTable initialFilters root contains more than ${BRUNO_TABLE_CLIENT_FILTER_MAX_ROOT_ENTRIES} entries.`,
      );
    }
    return createEmptyClientFilterCollection(columns);
  }
  if (candidates === undefined) return createEmptyClientFilterCollection(columns);
  const columnsById = new Map(columns.map((column) => [column.columnId, column]));
  const columnLabelsById = createClientFilterColumnLabels(columns);
  const captured = new WeakMap<object, Readonly<Record<string, unknown>> | undefined>();
  const capturedArrays = new WeakMap<object, CapturedFilterArray | undefined>();
  const context = createFilterSanitizationContext(
    {},
    new Map(),
    captured,
    capturedArrays,
    undefined,
    columnLabelsById,
    new Map(),
  );
  const roots: BrunoTableClientFilterRoot[] = [];
  for (const filter of candidates) {
    // Each root is a transaction over the one collection-wide ledger. Its weak traversal caches
    // and operand map are discarded with an invalid candidate, so hostile rejected roots cannot
    // retain compiled evidence or poison a later valid root through a cached failure.
    const previous = {
      nodes: context.nodes,
      operands: context.operands,
      textLength: context.textLength,
    };
    const rootContext = createFilterSanitizationContext(
      previous,
      new Map(),
      captured,
      capturedArrays,
      undefined,
      columnLabelsById,
      context.descriptionMemo,
      new Map(),
    );
    const next = sanitizeFilter(filter, columnsById, rootContext, 0);
    if (rootContext.overBudget && options?.rejectOverBudget === true) {
      throw new TypeError(
        `BrunoTable initialFilters may contain at most ${BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_NODES} nodes, ${BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_OPERANDS} operands, ${BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_TEXT_LENGTH} UTF-16 text units, and nesting depth ${BRUNO_TABLE_CLIENT_FILTER_MAX_DEPTH}.`,
      );
    }
    if (next === undefined || rootContext.overBudget) {
      continue;
    }
    const root = retainClientFilterRoot(next, columnsById, rootContext, previous);
    if (rootContext.overBudget && options?.rejectOverBudget === true) {
      throw new TypeError(
        `BrunoTable initialFilters may contain at most ${BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_NODES} nodes, ${BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_OPERANDS} operands, ${BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_TEXT_LENGTH} UTF-16 text units, and nesting depth ${BRUNO_TABLE_CLIENT_FILTER_MAX_DEPTH}.`,
      );
    }
    if (root === undefined || rootContext.overBudget) continue;
    mergeClientFilterDescriptionMemo(context.descriptionMemo, rootContext.pendingDescriptionMemo);
    context.nodes = rootContext.nodes;
    context.operands = rootContext.operands;
    context.textLength = rootContext.textLength;
    context.hasSharedNodes ||= rootContext.hasSharedNodes;
    for (const [node, plan] of rootContext.compiledOperands) {
      context.compiledOperands.set(node, plan);
    }
    roots.push(root);
  }
  return createClientFilterCollection(columnsById, roots, context, filters);
}

function createEmptyClientFilterCollection(
  columns: readonly CompiledColumn[],
): BrunoTableClientFilterCollection {
  const context = createFilterSanitizationContext(
    {},
    new Map(),
    undefined,
    undefined,
    undefined,
    createClientFilterColumnLabels(columns),
  );
  return createClientFilterCollection(
    new Map(columns.map((column) => [column.columnId, column])),
    [],
    context,
  );
}

function createClientFilterColumnLabels(
  columns: readonly CompiledColumn[],
): ReadonlyMap<string, string> {
  const headerCounts = new Map<string, number>();
  for (const column of columns) {
    headerCounts.set(column.headerName, (headerCounts.get(column.headerName) ?? 0) + 1);
  }
  const labels = new Map<string, string>();
  for (const [columnIndex, column] of columns.entries()) {
    labels.set(
      column.columnId,
      headerCounts.get(column.headerName) === 1
        ? column.headerName
        : `${column.headerName} (column ${String(columnIndex + 1)})`,
    );
  }
  return labels;
}

function retainClientFilterRoot(
  next: SanitizedFilterNode,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  context: FilterSanitizationContext,
  previous: Readonly<Pick<BrunoTableFilterComplexity, "nodes" | "operands" | "textLength">>,
): BrunoTableClientFilterRoot | undefined {
  const columnId = next.columnIds.values().next().value;
  if (typeof columnId !== "string") return undefined;
  const column = columnsById.get(columnId);
  if (column === undefined) return undefined;
  const activeFilterLabel = compileClientFilterDescription(
    column,
    next.filter,
    context.columnLabelsById.get(columnId) ?? column.headerName,
    context,
  );
  if (activeFilterLabel === undefined) return undefined;
  if (!reserveFilterText(activeFilterLabel.length, context)) return undefined;
  return {
    filter: next.filter,
    columnId,
    activeFilterLabel,
    ...(next.signature === undefined ? {} : { signature: next.signature }),
    compiledOperandNodes: Object.freeze([...context.compiledOperands.keys()]),
    complexity: {
      rootEntries: 1,
      nodes: context.nodes - previous.nodes,
      operands: context.operands - previous.operands,
      textLength: context.textLength - previous.textLength,
    },
  };
}

function createClientFilterCollection(
  columnsById: ReadonlyMap<string, CompiledColumn>,
  roots: readonly BrunoTableClientFilterRoot[],
  context: FilterSanitizationContext,
  sourceFilters?: readonly unknown[],
  previousCollection?: BrunoTableClientFilterCollection,
): BrunoTableClientFilterCollection {
  const frozenRoots = Object.freeze(
    roots.map((root) =>
      Object.isFrozen(root)
        ? root
        : Object.freeze({
            ...root,
            complexity: Object.freeze({ ...root.complexity }),
          }),
    ),
  );
  const rootFilters = frozenRoots.map((root) => root.filter);
  const compiledOperands = new Map<object, CompiledFilterOperandPlan>();
  for (const root of frozenRoots) {
    for (const node of root.compiledOperandNodes) {
      const plan = context.compiledOperands.get(node) ?? context.compiledOperandLookup.get(node);
      if (plan !== undefined) compiledOperands.set(node, plan);
    }
  }
  const filters = snapshotSanitizedFilterArray(sourceFilters, rootFilters);
  const byColumn = new Map<string, unknown[]>();
  const rootsByColumn = new Map<string, BrunoTableClientFilterRoot[]>();
  const activeFilterLabelsByColumn = new Map<string, string[]>();
  const snapshotsByColumn = new Map<string, unknown>();
  const complexityByColumn = new Map<string, BrunoTableFilterComplexity>();
  const signatureCountsByColumn = new Map<string, Map<string, number>>();
  const opaqueRootCountByColumn = new Map<string, number>();
  const columnIds = new Set<string>();
  for (const root of frozenRoots) {
    columnIds.add(root.columnId);
    const columnFilters = byColumn.get(root.columnId);
    if (columnFilters === undefined) byColumn.set(root.columnId, [root.filter]);
    else columnFilters.push(root.filter);
    const columnRoots = rootsByColumn.get(root.columnId);
    if (columnRoots === undefined) rootsByColumn.set(root.columnId, [root]);
    else columnRoots.push(root);
    const activeFilterLabels = activeFilterLabelsByColumn.get(root.columnId);
    if (activeFilterLabels === undefined) {
      activeFilterLabelsByColumn.set(root.columnId, [root.activeFilterLabel]);
    } else {
      activeFilterLabels.push(root.activeFilterLabel);
    }
    complexityByColumn.set(
      root.columnId,
      addFilterComplexity(complexityByColumn.get(root.columnId), root.complexity),
    );
    if (root.signature === undefined) {
      opaqueRootCountByColumn.set(
        root.columnId,
        (opaqueRootCountByColumn.get(root.columnId) ?? 0) + 1,
      );
    } else {
      const counts = signatureCountsByColumn.get(root.columnId) ?? new Map<string, number>();
      counts.set(root.signature, (counts.get(root.signature) ?? 0) + 1);
      signatureCountsByColumn.set(root.columnId, counts);
    }
  }
  for (const [columnId, columnFilters] of byColumn) {
    const previousFilters = previousCollection?.byColumn.get(columnId);
    if (
      previousCollection !== undefined &&
      previousFilters !== undefined &&
      sameReferences(previousFilters, columnFilters)
    ) {
      snapshotsByColumn.set(columnId, previousCollection.snapshotsByColumn.get(columnId));
    } else {
      snapshotsByColumn.set(
        columnId,
        columnFilters.length === 1 ? columnFilters[0] : Object.freeze(Array.from(columnFilters)),
      );
    }
  }
  for (const values of byColumn.values()) Object.freeze(values);
  for (const values of rootsByColumn.values()) Object.freeze(values);
  for (const values of activeFilterLabelsByColumn.values()) Object.freeze(values);
  for (const counts of signatureCountsByColumn.values()) Object.freeze(counts);
  return Object.freeze({
    filters,
    columnsById,
    columnLabelsById: context.columnLabelsById,
    roots: frozenRoots,
    byColumn,
    rootsByColumn,
    activeFilterLabelsByColumn,
    snapshotsByColumn,
    complexityByColumn,
    columnIds,
    signatureCountsByColumn,
    opaqueRootCountByColumn,
    complexity: Object.freeze({
      rootEntries: frozenRoots.length,
      nodes: context.nodes,
      operands: context.operands,
      textLength: context.textLength,
    }),
    compiledOperands,
    hasSharedNodes: context.hasSharedNodes,
  });
}

/** Removes one column's admitted roots without reopening or rescanning any expression. */
export function removeClientFilterColumn(
  collection: BrunoTableClientFilterCollection,
  columnId: string,
): BrunoTableClientFilterCollection {
  const roots = collection.roots.filter((root) => root.columnId !== columnId);
  if (roots.length === collection.roots.length) return collection;
  return (
    createDerivedClientFilterCollection(
      collection,
      roots,
      undefined,
      subtractFilterComplexity(collection.complexity, collection.complexityByColumn.get(columnId)),
    ) ?? collection
  );
}

/** Removes one retained root without reopening the other roots in that column. */
export function removeClientFilterRoot(
  collection: BrunoTableClientFilterCollection,
  columnId: string,
  rootFilter: unknown,
): BrunoTableClientFilterCollection | undefined {
  const root = collection.roots.find(
    (candidate) =>
      candidate.columnId === columnId &&
      (candidate === rootFilter || candidate.filter === rootFilter),
  );
  if (root === undefined) return undefined;
  return createDerivedClientFilterCollection(
    collection,
    collection.roots.filter((candidate) => candidate !== root),
    undefined,
    subtractFilterComplexity(collection.complexity, root.complexity),
  );
}

/** Restores one column from the already-admitted sanitized baseline collection. */
export function restoreClientFilterColumn(
  collection: BrunoTableClientFilterCollection,
  baseline: BrunoTableClientFilterCollection,
  columnId: string,
): BrunoTableClientFilterCollection | undefined {
  if (sameBrunoTableFilterColumn(collection, baseline, columnId)) return collection;
  const roots = [
    ...collection.roots.filter((root) => root.columnId !== columnId),
    ...baseline.roots.filter((root) => root.columnId === columnId),
  ];
  return createDerivedClientFilterCollection(
    collection,
    roots,
    baseline,
    addFilterComplexity(
      subtractFilterComplexity(collection.complexity, collection.complexityByColumn.get(columnId)),
      baseline.complexityByColumn.get(columnId),
    ),
  );
}

/**
 * Admits a replacement for one column against the remaining compiled collection. Existing roots
 * contribute their retained ledger cost and operand plans directly; only the replacement roots
 * cross the sanitizer/compiler boundary.
 */
export function replaceClientFilterColumn(
  collection: BrunoTableClientFilterCollection,
  columnId: string,
  candidate: unknown,
): BrunoTableClientFilterCollection | undefined {
  const candidateEntries =
    candidate === undefined ? [] : Array.isArray(candidate) ? candidate : [candidate];
  const candidates = snapshotRootEntries(candidateEntries);
  if (candidates === undefined || candidates === ROOT_ENTRIES_OVER_BUDGET) return undefined;
  return replaceClientFilterRoots(collection, columnId, candidates);
}

/**
 * Replaces one retained root while keeping every other root and its compiled evidence intact.
 * Overlay editors use this seam for continuous edits so Pacer work never rebuilds a whole
 * same-column root collection for one changed leaf.
 */
export function replaceClientFilterRoot(
  collection: BrunoTableClientFilterCollection,
  columnId: string,
  rootFilter: unknown,
  candidate: unknown,
): BrunoTableClientFilterCollection | undefined {
  const root = collection.roots.find(
    (candidateRoot) =>
      candidateRoot.columnId === columnId &&
      (candidateRoot === rootFilter || candidateRoot.filter === rootFilter),
  );
  if (root === undefined) return undefined;
  const candidates = snapshotRootEntries([candidate]);
  if (candidates === undefined || candidates === ROOT_ENTRIES_OVER_BUDGET) return undefined;
  if (candidates.length !== 1) return undefined;
  return replaceClientFilterRoots(collection, columnId, candidates, root);
}

function replaceClientFilterRoots(
  collection: BrunoTableClientFilterCollection,
  columnId: string,
  candidates: readonly unknown[],
  rootToReplace?: BrunoTableClientFilterRoot,
): BrunoTableClientFilterCollection | undefined {
  const retainedRoots = collection.roots.filter((root) =>
    rootToReplace === undefined ? root.columnId !== columnId : root !== rootToReplace,
  );
  if (retainedRoots.length + candidates.length > BRUNO_TABLE_CLIENT_FILTER_MAX_ROOT_ENTRIES) {
    return undefined;
  }
  const retainedComplexity =
    rootToReplace === undefined
      ? subtractFilterComplexity(collection.complexity, collection.complexityByColumn.get(columnId))
      : subtractFilterComplexity(collection.complexity, rootToReplace.complexity);
  if (candidates.length === 0)
    return createDerivedClientFilterCollection(
      collection,
      retainedRoots,
      undefined,
      retainedComplexity,
    );

  const captured = new WeakMap<object, Readonly<Record<string, unknown>> | undefined>();
  const capturedArrays = new WeakMap<object, CapturedFilterArray | undefined>();
  const retainedCompiledOperands = collectCompiledOperandPlans(retainedRoots, [
    collection.compiledOperands,
  ]);
  const context = createFilterSanitizationContext(
    retainedComplexity,
    new Map(),
    captured,
    capturedArrays,
    retainedCompiledOperands,
    collection.columnLabelsById,
    createClientFilterDescriptionMemo(retainedRoots),
  );
  context.hasSharedNodes = collection.hasSharedNodes;
  const candidateRoots: BrunoTableClientFilterRoot[] = [];
  for (const filter of candidates) {
    const previous = {
      nodes: context.nodes,
      operands: context.operands,
      textLength: context.textLength,
    };
    const candidateContext = createFilterSanitizationContext(
      previous,
      new Map(),
      captured,
      capturedArrays,
      new Map(),
      collection.columnLabelsById,
      context.descriptionMemo,
      new Map(),
    );
    const next = sanitizeFilter(filter, collection.columnsById, candidateContext, 0);
    const candidateColumnId = next?.columnIds.values().next().value;
    if (next === undefined || candidateContext.overBudget || candidateColumnId !== columnId) {
      return undefined;
    }
    const root = retainClientFilterRoot(next, collection.columnsById, candidateContext, previous);
    if (root === undefined || candidateContext.overBudget) return undefined;
    mergeClientFilterDescriptionMemo(
      context.descriptionMemo,
      candidateContext.pendingDescriptionMemo,
    );
    context.nodes = candidateContext.nodes;
    context.operands = candidateContext.operands;
    context.textLength = candidateContext.textLength;
    context.hasSharedNodes ||= candidateContext.hasSharedNodes;
    for (const [node, plan] of candidateContext.compiledOperands) {
      context.compiledOperands.set(node, plan);
    }
    candidateRoots.push(root);
  }
  const roots =
    rootToReplace === undefined
      ? [...retainedRoots, ...candidateRoots]
      : [
          ...retainedRoots.slice(0, collection.roots.indexOf(rootToReplace)),
          ...candidateRoots,
          ...retainedRoots.slice(collection.roots.indexOf(rootToReplace)),
        ];
  return createClientFilterCollection(
    collection.columnsById,
    roots,
    context,
    undefined,
    collection,
  );
}

function createDerivedClientFilterCollection(
  collection: BrunoTableClientFilterCollection,
  roots: readonly BrunoTableClientFilterRoot[],
  additional: BrunoTableClientFilterCollection | undefined,
  complexity: BrunoTableFilterComplexity,
): BrunoTableClientFilterCollection | undefined {
  if (!isClientFilterComplexityWithinBudget(complexity)) return undefined;
  const compiledOperands = collectCompiledOperandPlans(
    roots,
    additional === undefined || additional === collection
      ? [collection.compiledOperands]
      : [collection.compiledOperands, additional.compiledOperands],
  );
  const context = createFilterSanitizationContext(
    complexity,
    compiledOperands,
    undefined,
    undefined,
    undefined,
    collection.columnLabelsById,
  );
  context.hasSharedNodes = collection.hasSharedNodes || additional?.hasSharedNodes === true;
  return createClientFilterCollection(
    collection.columnsById,
    roots,
    context,
    undefined,
    collection,
  );
}

function collectCompiledOperandPlans(
  roots: readonly BrunoTableClientFilterRoot[],
  sources: readonly ReadonlyMap<object, CompiledFilterOperandPlan>[],
): Map<object, CompiledFilterOperandPlan> {
  const compiledOperands = new Map<object, CompiledFilterOperandPlan>();
  for (const root of roots) {
    for (const node of root.compiledOperandNodes) {
      for (const source of sources) {
        const plan = source.get(node);
        if (plan !== undefined) {
          compiledOperands.set(node, plan);
          break;
        }
      }
    }
  }
  return compiledOperands;
}

function addFilterComplexity(
  left: BrunoTableFilterComplexity | undefined,
  right: BrunoTableFilterComplexity | undefined,
): BrunoTableFilterComplexity {
  return {
    rootEntries: (left?.rootEntries ?? 0) + (right?.rootEntries ?? 0),
    nodes: (left?.nodes ?? 0) + (right?.nodes ?? 0),
    operands: (left?.operands ?? 0) + (right?.operands ?? 0),
    textLength: (left?.textLength ?? 0) + (right?.textLength ?? 0),
  };
}

function subtractFilterComplexity(
  total: BrunoTableFilterComplexity,
  removed: BrunoTableFilterComplexity | undefined,
): BrunoTableFilterComplexity {
  return {
    rootEntries: Math.max(0, total.rootEntries - (removed?.rootEntries ?? 0)),
    nodes: Math.max(0, total.nodes - (removed?.nodes ?? 0)),
    operands: Math.max(0, total.operands - (removed?.operands ?? 0)),
    textLength: Math.max(0, total.textLength - (removed?.textLength ?? 0)),
  };
}

function isClientFilterComplexityWithinBudget(complexity: BrunoTableFilterComplexity): boolean {
  return (
    complexity.rootEntries <= BRUNO_TABLE_CLIENT_FILTER_MAX_ROOT_ENTRIES &&
    complexity.nodes <= BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_NODES &&
    complexity.operands <= BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_OPERANDS &&
    complexity.textLength <= BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_TEXT_LENGTH
  );
}

export function filterClientRows<TRow>(
  rows: readonly TRow[],
  columns: readonly CompiledColumn[],
  filters: readonly unknown[] | undefined,
): readonly TRow[] {
  const predicate = createClientFilterPredicate(columns, filters);
  return predicate === undefined ? rows : rows.filter(predicate);
}

export type ClientFilterPlan = BrunoTableClientFilterCollection;

/**
 * Compiles immutable filter evidence once for the query consumers that use different row
 * adapters. The plan deliberately contains no row reader, so it can be shared by TanStack's
 * row model and the source row-order detector without crossing either adapter seam.
 */
export function compileClientFilterPlan(
  columns: readonly CompiledColumn[],
  filters: readonly unknown[] | undefined,
  collection?: BrunoTableClientFilterCollection,
): ClientFilterPlan | undefined {
  const plan = collection ?? compileClientFilterCollection(filters, columns);
  return plan.roots.length === 0 ? undefined : plan;
}

export function createClientFilterPredicate<TRow>(
  columns: readonly CompiledColumn[],
  filters: readonly unknown[] | undefined,
  readValue: (column: CompiledColumn, row: TRow) => unknown = readCompiledColumnValue,
  filterPlan?: ClientFilterPlan,
): ((row: TRow) => boolean) | undefined {
  const plan = filterPlan ?? compileClientFilterPlan(columns, filters);
  if (plan === undefined) return undefined;
  const columnsById = plan.columnsById;
  const readUnknown = (column: CompiledColumn, row: unknown) => readValue(column, row as TRow);
  return (row) => {
    const completed = plan.hasSharedNodes ? new WeakMap<object, boolean>() : undefined;
    return plan.roots.every((root) =>
      evaluateFilter(root.filter, row, columnsById, readUnknown, plan.compiledOperands, completed),
    );
  };
}

export function normalizeBrunoTableFilterText(
  value: string,
  caseSensitive = false,
  accentSensitive = false,
): string {
  const normalized = value.normalize("NFD");
  const comparable = accentSensitive ? normalized : normalized.replace(/\p{Mark}/gu, "");
  return caseSensitive ? comparable : comparable.toLowerCase();
}

/** UI draft bound only; admitted filters use the collection-wide text ledger below. */
export const BRUNO_TABLE_MAX_FILTER_OPERAND_LENGTH = 1_024;
const BRUNO_TABLE_MAX_FILTER_OPERAND_OBJECTS = 64;
const BRUNO_TABLE_MAX_FILTER_OPERAND_PROPERTIES = 256;
const BRUNO_TABLE_MAX_FILTER_OPERAND_DEPTH = 16;

export function boundBrunoTableFilterOperandText(text: string): string {
  return text.length <= BRUNO_TABLE_MAX_FILTER_OPERAND_LENGTH
    ? text
    : text.slice(0, BRUNO_TABLE_MAX_FILTER_OPERAND_LENGTH);
}

export function filterReferencesColumn(candidate: unknown, columnId: string): boolean {
  const columnIds = new Set<string>();
  collectClientFilterColumnIds(candidate, columnIds);
  return columnIds.has(columnId);
}

export function collectClientFilterColumnIds(candidate: unknown, target: Set<string>): void {
  collectFilterColumnIds(candidate, target, new WeakSet<object>());
}

function collectFilterColumnIds(
  candidate: unknown,
  target: Set<string>,
  visited: WeakSet<object>,
): void {
  if (typeof candidate !== "object" || candidate === null || visited.has(candidate)) return;
  visited.add(candidate);
  const filter = asRecord(candidate);
  if (typeof filter["columnId"] === "string") target.add(filter["columnId"]);
  if (Array.isArray(filter["conditions"])) {
    for (const condition of filter["conditions"])
      collectFilterColumnIds(condition, target, visited);
  }
  if (filter["condition"] !== undefined) {
    collectFilterColumnIds(filter["condition"], target, visited);
  }
}

function sanitizeFilter(
  candidate: unknown,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  context: FilterSanitizationContext,
  depth: number,
  precharged = false,
): SanitizedFilterNode | undefined {
  if (depth > BRUNO_TABLE_CLIENT_FILTER_MAX_DEPTH) {
    context.overBudget = true;
    return undefined;
  }
  if (typeof candidate !== "object" || candidate === null || context.visited.has(candidate)) {
    return undefined;
  }
  if (context.admittedNodes.has(candidate)) context.hasSharedNodes = true;
  else context.admittedNodes.add(candidate);
  if (!precharged) {
    if (!reserveFilterNodes(1, context)) {
      context.overBudget = true;
      return undefined;
    }
  }
  const completedAtDepth = context.completed.get(candidate);
  if (completedAtDepth?.has(depth) === true) return completedAtDepth.get(depth);
  context.visited.add(candidate);
  let captured: Readonly<Record<string, unknown>> | undefined;
  try {
    captured = context.captured.get(candidate);
    if (!context.captured.has(candidate)) {
      captured = captureFilterRecord(asRecord(candidate));
      context.captured.set(candidate, captured);
    }
  } catch {
    context.captured.set(candidate, undefined);
    context.visited.delete(candidate);
    return memoizeSanitizedFilter(candidate, depth, undefined, context, completedAtDepth);
  }
  let sanitized: SanitizedFilterNode | undefined;
  try {
    sanitized =
      captured === undefined
        ? undefined
        : sanitizeFilterRecord(captured, columnsById, context, depth);
  } finally {
    context.visited.delete(candidate);
  }
  return memoizeSanitizedFilter(candidate, depth, sanitized, context, completedAtDepth);
}

function captureFilterRecord(
  filter: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined {
  if (SANITIZED_FILTER_SNAPSHOTS.has(filter)) return filter;
  if (!Object.hasOwn(filter, "type")) return undefined;
  const type = filter["type"];
  const keys = filterCaptureKeys(type);
  if (keys === undefined) return undefined;
  const captured: Record<string, unknown> = { type };
  for (const key of keys) {
    if (!Object.hasOwn(filter, key)) continue;
    captured[key] = filter[key];
  }
  return Object.freeze(captured);
}

function captureDenseFilterArray(
  value: unknown,
  context: FilterSanitizationContext,
  reserveConditions: boolean,
  reserveOperands = false,
): readonly unknown[] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (SANITIZED_FILTER_SNAPSHOTS.has(value) && Array.isArray(value)) {
    if (!admitFilterArrayLength(value.length, context, reserveConditions)) return undefined;
    if (reserveOperands && !hasFilterOperandCapacity(value.length, context)) return undefined;
    if (reserveOperands && !reserveFilterOperands(value.length, context)) return undefined;
    return value;
  }
  let captured = context.capturedArrays.get(value);
  if (!context.capturedArrays.has(value)) {
    captured = captureFilterArrayLength(value);
    context.capturedArrays.set(value, captured);
  }
  if (captured === undefined) return undefined;
  if (!admitFilterArrayLength(captured.length, context, reserveConditions)) return undefined;
  if (reserveOperands && !hasFilterOperandCapacity(captured.length, context)) return undefined;
  if (!captured.attempted) {
    captured.attempted = true;
    const snapshot = snapshotDenseArray(value, captured.length);
    captured.snapshot = snapshot === undefined ? undefined : Object.freeze(snapshot);
    if (captured.snapshot !== undefined) SANITIZED_FILTER_SNAPSHOTS.add(captured.snapshot);
  }
  if (captured.snapshot === undefined) return undefined;
  if (reserveOperands && !reserveFilterOperands(captured.length, context)) return undefined;
  return captured.snapshot;
}

function admitFilterArrayLength(
  length: number,
  context: FilterSanitizationContext,
  reserveConditions: boolean,
): boolean {
  if (reserveConditions) return reserveConditionEntries(length, context);
  return true;
}

function captureFilterArrayLength(value: object): CapturedFilterArray | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const length = value.length;
    return Number.isSafeInteger(length) && length >= 0
      ? { attempted: false, length, snapshot: undefined }
      : undefined;
  } catch {
    return undefined;
  }
}

function reserveConditionEntries(length: number, context: FilterSanitizationContext): boolean {
  return reserveFilterNodes(length, context);
}

function reserveFilterNodes(length: number, context: FilterSanitizationContext): boolean {
  if (length < 0 || context.nodes > BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_NODES - length) {
    context.overBudget = true;
    return false;
  }
  context.nodes += length;
  return true;
}

function reserveFilterOperands(length: number, context: FilterSanitizationContext): boolean {
  if (!hasFilterOperandCapacity(length, context)) return false;
  context.operands += length;
  return true;
}

function hasFilterOperandCapacity(length: number, context: FilterSanitizationContext): boolean {
  if (length < 0 || context.operands > BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_OPERANDS - length) {
    context.overBudget = true;
    return false;
  }
  return true;
}

function reserveFilterText(length: number, context: FilterSanitizationContext): boolean {
  if (length < 0 || context.textLength > BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_TEXT_LENGTH - length) {
    context.overBudget = true;
    return false;
  }
  context.textLength += length;
  return true;
}

function reserveFilterNodeText(
  type: string,
  columnId: string | undefined,
  context: FilterSanitizationContext,
): boolean {
  return (
    reserveFilterText(type.length, context) &&
    (columnId === undefined || reserveFilterText(columnId.length, context))
  );
}

function memoizeSanitizedFilter(
  candidate: object,
  depth: number,
  sanitized: SanitizedFilterNode | undefined,
  context: FilterSanitizationContext,
  completedAtDepth: Map<number, SanitizedFilterNode | undefined> | undefined,
): SanitizedFilterNode | undefined {
  const memo = completedAtDepth ?? new Map<number, SanitizedFilterNode | undefined>();
  memo.set(depth, sanitized);
  if (completedAtDepth === undefined) context.completed.set(candidate, memo);
  return sanitized;
}

function filterCaptureKeys(type: unknown): readonly string[] | undefined {
  if (type === "AND" || type === "OR") return ["conditions"];
  if (type === "NOT") return ["condition"];
  if (type === "blank" || type === "notBlank") return ["columnId"];
  if (type === "inRange") return ["columnId", "filter", "filterTo"];
  if (
    type === "in" ||
    type === "equals" ||
    type === "notEqual" ||
    type === "contains" ||
    type === "notContains" ||
    type === "startsWith" ||
    type === "endsWith"
  ) {
    return ["columnId", "filter", "caseSensitive", "accentSensitive"];
  }
  if (
    type === "greaterThan" ||
    type === "greaterThanOrEqual" ||
    type === "lessThan" ||
    type === "lessThanOrEqual"
  ) {
    return ["columnId", "filter"];
  }
  return undefined;
}

function sanitizeFilterRecord(
  filter: Readonly<Record<string, unknown>>,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  context: FilterSanitizationContext,
  depth: number,
): SanitizedFilterNode | undefined {
  const type = filter["type"];
  if (type === "AND" || type === "OR") {
    if (!reserveFilterNodeText(type, undefined, context)) return undefined;
    const candidates = captureDenseFilterArray(filter["conditions"], context, true);
    if (candidates === undefined || candidates.length === 0) return undefined;
    const conditions: Readonly<Record<string, unknown>>[] = [];
    const conditionNodes: SanitizedFilterNode[] = [];
    const columnIds = new Set<string>();
    for (const candidate of candidates) {
      const condition = sanitizeFilter(candidate, columnsById, context, depth + 1, true);
      if (condition === undefined) return undefined;
      conditions.push(condition.filter);
      conditionNodes.push(condition);
      for (const columnId of condition.columnIds) columnIds.add(columnId);
    }
    if (columnIds.size > 1) return undefined;
    const sanitizedConditions = snapshotSanitizedFilterArray(candidates, conditions);
    const conditionSignatures = conditionNodes.map((condition) => condition.signature);
    const signature = conditionSignatures.every((value): value is string => value !== undefined)
      ? createFilterSignature([type, ...conditionSignatures.sort(compareStringValues)], context)
      : undefined;
    if (context.overBudget) return undefined;
    return {
      columnIds,
      filter: snapshotFilter(filter, ["type", "conditions"], {
        conditions: sanitizedConditions,
      }),
      ...(signature === undefined ? {} : { signature }),
    };
  }
  if (type === "NOT") {
    if (!reserveFilterNodeText(type, undefined, context)) return undefined;
    const condition = sanitizeFilter(filter["condition"], columnsById, context, depth + 1);
    if (condition === undefined) return undefined;
    const sanitized = snapshotFilter(filter, ["type", "condition"], {
      condition: condition.filter,
    });
    const signature =
      condition.signature === undefined
        ? undefined
        : createFilterSignature(["NOT", condition.signature], context);
    if (context.overBudget) return undefined;
    return {
      columnIds: condition.columnIds,
      filter: sanitized,
      ...(signature === undefined ? {} : { signature }),
    };
  }
  const columnId = filter["columnId"];
  if (typeof columnId !== "string") return undefined;
  const column = columnsById.get(columnId);
  if (column === undefined || column.enableFilter === false || column.kind !== "field") {
    return undefined;
  }
  if (typeof type !== "string" || !reserveFilterNodeText(type, columnId, context)) {
    return undefined;
  }
  const node = (
    sanitizedFilter: Readonly<Record<string, unknown>>,
  ): SanitizedFilterNode | undefined => {
    const plan = compileFilterOperandPlan(column, sanitizedFilter, context);
    if (
      plan === undefined &&
      (type === "contains" ||
        type === "notContains" ||
        type === "startsWith" ||
        type === "endsWith" ||
        (type === "in" && column.semantics.filterFamily === "text"))
    ) {
      return undefined;
    }
    if (plan !== undefined) context.compiledOperands.set(sanitizedFilter, plan);
    const signature = createLeafFilterSignature(column, sanitizedFilter, plan, context);
    if (context.overBudget) return undefined;
    return {
      columnIds: new Set([columnId]),
      filter: sanitizedFilter,
      ...(signature === undefined ? {} : { signature }),
    };
  };
  const operand = filter["filter"];
  const decode = (value: unknown) => {
    try {
      const decoded = column.semantics.decodeRuntime(value);
      if (decoded._tag === "Success" && !isBoundedFilterOperand(decoded.value, context)) {
        return { _tag: "Failure" as const, message: "Decoded value is not safely readable." };
      }
      return decoded;
    } catch {
      return { _tag: "Failure" as const, message: "Value decoding failed." };
    }
  };
  if (type === "blank" || type === "notBlank") {
    return node(snapshotFilter(filter, ["columnId", "type"]));
  }
  if (type === "in") {
    // Boolean and Select filters intentionally remain exact equality surfaces
    // until issue #13 owns Set Filter inclusion semantics and its live facets.
    if (column.semantics.filterFamily !== "text" && column.semantics.filterFamily !== "numeric") {
      return undefined;
    }
    const captured = captureDenseFilterArray(operand, context, false, true);
    if (
      captured === undefined ||
      captured.length === 0 ||
      !hasValidTextSensitivity(filter, column.semantics.filterFamily === "text")
    ) {
      return undefined;
    }
    if (!captured.every((value) => isBoundedFilterOperand(value, context))) return undefined;
    const decoded = captured.map(decode);
    const decodedValues = decoded.map((result) =>
      result._tag === "Success" ? result.value : undefined,
    );
    const sanitizedValues = snapshotSanitizedFilterArray(operand, decodedValues);
    return decoded.every((result) => result._tag === "Success")
      ? node(
          snapshotFilter(
            filter,
            ["columnId", "type", "filter", "caseSensitive", "accentSensitive"],
            { filter: sanitizedValues },
          ),
        )
      : undefined;
  }
  if (type === "inRange") {
    if (column.semantics.filterFamily !== "numeric") return undefined;
    if (
      !isBoundedFilterOperand(operand, context) ||
      !isBoundedFilterOperand(filter["filterTo"], context) ||
      !reserveFilterOperands(2, context)
    ) {
      return undefined;
    }
    const from = decode(operand);
    const to = decode(filter["filterTo"]);
    if (from._tag !== "Success" || to._tag !== "Success") return undefined;
    try {
      if (column.semantics.compare(from.value, to.value) >= 0) return undefined;
    } catch {
      return undefined;
    }
    return node(
      snapshotFilter(filter, ["columnId", "type", "filter", "filterTo"], {
        filter: from.value,
        filterTo: to.value,
      }),
    );
  }
  if (
    type === "equals" ||
    type === "notEqual" ||
    type === "greaterThan" ||
    type === "greaterThanOrEqual" ||
    type === "lessThan" ||
    type === "lessThanOrEqual"
  ) {
    if (
      (type === "greaterThan" ||
        type === "greaterThanOrEqual" ||
        type === "lessThan" ||
        type === "lessThanOrEqual") &&
      column.semantics.filterFamily !== "numeric"
    ) {
      return undefined;
    }
    let configuredSelectValue: unknown;
    let isConfiguredSelectValue = false;
    if (column.semantics.filterFamily === "select" && column.selectOptions !== undefined) {
      const configured = resolveConfiguredSelectValue(column, operand, context);
      if (configured === undefined) return undefined;
      configuredSelectValue = configured;
      isConfiguredSelectValue = true;
    }
    if (!isConfiguredSelectValue && !isBoundedFilterOperand(operand, context)) return undefined;
    if (!reserveFilterOperands(1, context)) return undefined;
    // Compiled Select options are already canonical. Reuse the admitted option
    // so a long trusted option never re-enters a consumer decoder.
    const result = isConfiguredSelectValue
      ? ({ _tag: "Success", value: configuredSelectValue } as const)
      : decode(operand);
    if (result._tag !== "Success") return undefined;
    if (
      (type === "equals" || type === "notEqual") &&
      !hasValidTextSensitivity(filter, column.semantics.filterFamily === "text")
    ) {
      return undefined;
    }
    return node(
      snapshotFilter(
        filter,
        type === "equals" || type === "notEqual"
          ? ["columnId", "type", "filter", "caseSensitive", "accentSensitive"]
          : ["columnId", "type", "filter"],
        { filter: result.value },
      ),
    );
  }
  if (
    type === "contains" ||
    type === "notContains" ||
    type === "startsWith" ||
    type === "endsWith"
  ) {
    const validSensitivity = hasValidTextSensitivity(filter, true);
    const textOperand = typeof operand === "string" ? operand : undefined;
    return column.semantics.filterFamily === "text" &&
      textOperand !== undefined &&
      isBoundedFilterOperand(textOperand, context) &&
      reserveFilterOperands(1, context) &&
      validSensitivity
      ? node(
          snapshotFilter(
            filter,
            ["columnId", "type", "filter", "caseSensitive", "accentSensitive"],
            { filter: textOperand },
          ),
        )
      : undefined;
  }
  return undefined;
}

/**
 * Builds the active-filter label while a sanitized root is admitted. The input graph has already
 * crossed the collection-wide node/operand/text boundary, and the bounded summary only retains
 * the first few visible children. Ordinary active-filter renders consume the retained string and
 * never walk this graph again.
 */
function compileClientFilterDescription(
  column: CompiledColumn,
  value: Readonly<Record<string, unknown>>,
  columnLabel: string,
  context: FilterSanitizationContext,
): string | undefined {
  const active = new WeakSet<object>();
  const describe = (candidate: unknown): string | undefined => {
    if (typeof candidate !== "object" || candidate === null) return columnLabel;
    if (context.descriptionMemo.has(candidate)) return context.descriptionMemo.get(candidate);
    if (context.pendingDescriptionMemo.has(candidate)) {
      return context.pendingDescriptionMemo.get(candidate);
    }
    if (active.has(candidate)) return "…";
    active.add(candidate);
    let description: string | undefined;
    if (Array.isArray(candidate)) {
      description = joinClientFilterDescriptions(candidate, " AND ", describe, context);
      active.delete(candidate);
      context.pendingDescriptionMemo.set(candidate, description);
      return description;
    }
    const record = candidate as Readonly<Record<string, unknown>>;
    const type = typeof record["type"] === "string" ? record["type"] : "filter";
    if ((type === "AND" || type === "OR") && Array.isArray(record["conditions"])) {
      const joiner = type === "AND" ? " AND " : " OR ";
      const conditions = joinClientFilterDescriptions(
        record["conditions"],
        joiner,
        describe,
        context,
      );
      description =
        conditions === undefined
          ? undefined
          : meterAndTruncateClientFilterDescription(`${columnLabel}: (${conditions})`, context);
    } else if (type === "NOT" && record["condition"] !== undefined) {
      const condition = describe(record["condition"]);
      description =
        condition === undefined
          ? undefined
          : meterAndTruncateClientFilterDescription(`${columnLabel}: NOT (${condition})`, context);
    } else {
      const operand = record["filter"];
      if (type === "blank" || type === "notBlank") {
        description = meterAndTruncateClientFilterDescription(`${columnLabel}: ${type}`, context);
      } else if (type === "inRange") {
        const from = formatClientFilterOperand(column, operand, type, context);
        const to = formatClientFilterOperand(column, record["filterTo"], type, context);
        description =
          from === undefined || to === undefined
            ? undefined
            : meterAndTruncateClientFilterDescription(
                `${columnLabel}: inRange ${from} ≤ value < ${to} (upper bound exclusive)`,
                context,
              );
      } else {
        const formattedOperand = formatClientFilterOperand(column, operand, type, context);
        if (formattedOperand === undefined) {
          description = undefined;
        } else {
          const sensitivity = [
            record["caseSensitive"] === true ? "case-sensitive" : undefined,
            record["accentSensitive"] === true ? "accent-sensitive" : undefined,
          ].filter((entry): entry is string => entry !== undefined);
          const sensitivityLabel = sensitivity.length > 0 ? ` (${sensitivity.join(", ")})` : "";
          description = meterAndTruncateClientFilterDescription(
            `${columnLabel}: ${type}${sensitivityLabel} ${formattedOperand}`,
            context,
          );
        }
      }
    }
    active.delete(candidate);
    context.pendingDescriptionMemo.set(candidate, description);
    return description;
  };
  return describe(value);
}

function formatClientFilterOperand(
  column: CompiledColumn,
  value: unknown,
  operator: unknown,
  context: FilterSanitizationContext,
): string | undefined {
  if (operator === "in" && Array.isArray(value)) {
    const joined = joinClientFilterDescriptions(
      value,
      ", ",
      (item) => formatClientFilterOperand(column, item, "equals", context),
      context,
    );
    return joined === undefined
      ? undefined
      : meterClientFilterDescriptionText(`[${joined}]`, context);
  }
  if (
    operator === "contains" ||
    operator === "notContains" ||
    operator === "startsWith" ||
    operator === "endsWith"
  ) {
    return meterClientFilterDescriptionText(
      typeof value === "string" ? JSON.stringify(value) : safeClientFilterString(value),
      context,
    );
  }
  try {
    const display = column.semantics.formatDisplay(value);
    return meterClientFilterDescriptionText(
      typeof value === "string" ? JSON.stringify(display) : safeClientFilterString(display),
      context,
    );
  } catch {
    return meterClientFilterDescriptionText(safeClientFilterString(value), context);
  }
}

const CLIENT_FILTER_DESCRIPTION_ITEM_LIMIT = 8;
const CLIENT_FILTER_DESCRIPTION_LENGTH_LIMIT = 512;

function joinClientFilterDescriptions(
  values: readonly unknown[],
  separator: string,
  render: (value: unknown) => string | undefined,
  context: FilterSanitizationContext,
): string | undefined {
  const visible: string[] = [];
  for (const value of values.slice(0, CLIENT_FILTER_DESCRIPTION_ITEM_LIMIT)) {
    const rendered = render(value);
    if (rendered === undefined) return undefined;
    visible.push(rendered);
  }
  const omitted = values.length - visible.length;
  if (omitted > 0) visible.push(`… ${String(omitted)} more`);
  return meterAndTruncateClientFilterDescription(visible.join(separator), context);
}

function meterClientFilterDescriptionText(
  value: string,
  context: FilterSanitizationContext,
): string | undefined {
  return reserveFilterText(value.length, context) ? value : undefined;
}

function meterAndTruncateClientFilterDescription(
  value: string,
  context: FilterSanitizationContext,
): string | undefined {
  const metered = meterClientFilterDescriptionText(value, context);
  return metered === undefined ? undefined : truncateClientFilterDescription(metered);
}

function truncateClientFilterDescription(value: string): string {
  return value.length <= CLIENT_FILTER_DESCRIPTION_LENGTH_LIMIT
    ? value
    : `${value.slice(0, CLIENT_FILTER_DESCRIPTION_LENGTH_LIMIT - 1)}…`;
}

function safeClientFilterString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "<unavailable>";
  }
}

function resolveConfiguredSelectValue(
  column: CompiledColumn,
  operand: unknown,
  context: FilterSanitizationContext,
): unknown {
  const selectOptions = column.selectOptions;
  if (selectOptions === undefined) return undefined;
  // Even an exact compiled-option hit is still an admitted filter operand. Meter its raw shape
  // and materialized text before taking the indexed fast path so repeated long Select values
  // cannot bypass the collection-wide ledger.
  if (!isBoundedFilterOperand(operand, context)) return undefined;
  let canonical: string | undefined;
  try {
    canonical = column.semantics.formatCanonicalText(operand);
  } catch {
    canonical = undefined;
  }
  if (canonical !== undefined && !reserveFilterText(canonical.length, context)) return undefined;
  const exactOptionIndex = column.selectOptionIndexes?.get(operand);
  if (exactOptionIndex !== undefined && Object.is(selectOptions[exactOptionIndex], operand)) {
    return selectOptions[exactOptionIndex];
  }
  const canonicalOptionIndex =
    canonical === undefined ? undefined : column.selectOptionCanonicalIndexes?.get(canonical);
  if (canonicalOptionIndex !== undefined) {
    try {
      if (column.semantics.equivalent(selectOptions[canonicalOptionIndex], operand)) {
        return selectOptions[canonicalOptionIndex];
      }
    } catch {
      // Continue to the bounded fallback below.
    }
  }
  // Custom equivalence cannot be indexed generically. The configured option domain is validated
  // and capped once during column compilation; this admission-only fallback scan is bounded
  // static metadata, not another Grid Filter node budget.
  for (const option of selectOptions) {
    try {
      if (column.semantics.equivalent(option, operand)) return option;
    } catch {
      // Ignore one unreadable custom operand and continue within the bounded option domain.
    }
  }
  return undefined;
}

function snapshotFilter(
  filter: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  replacements: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.hasOwn(replacements, key)) snapshot[key] = replacements[key];
    else if (Object.hasOwn(filter, key)) snapshot[key] = filter[key];
  }
  if (
    SANITIZED_FILTER_SNAPSHOTS.has(filter) &&
    Reflect.ownKeys(filter).length === Reflect.ownKeys(snapshot).length &&
    Reflect.ownKeys(snapshot).every((key) =>
      Object.is(filter[key as string], snapshot[key as string]),
    )
  ) {
    return filter;
  }
  const frozen = Object.freeze(snapshot);
  SANITIZED_FILTER_SNAPSHOTS.add(frozen);
  return frozen;
}

function snapshotSanitizedFilterArray<T>(input: unknown, values: readonly T[]): readonly T[] {
  if (
    typeof input === "object" &&
    input !== null &&
    SANITIZED_FILTER_SNAPSHOTS.has(input) &&
    Array.isArray(input) &&
    sameReferences(input, values)
  ) {
    return input as readonly T[];
  }
  const snapshot = Object.freeze(Array.from(values));
  SANITIZED_FILTER_SNAPSHOTS.add(snapshot);
  return snapshot;
}

function sameReferences(previous: readonly unknown[], next: readonly unknown[]): boolean {
  return previous.length === next.length && previous.every((value, index) => value === next[index]);
}

function compileFilterOperandPlan(
  column: CompiledColumn,
  filter: Readonly<Record<string, unknown>>,
  context: FilterSanitizationContext,
): CompiledFilterOperandPlan | undefined {
  const retained = context.compiledOperandLookup.get(filter);
  if (retained !== undefined) {
    context.compiledOperands.set(filter, retained);
    return retained;
  }
  const type = filter["type"];
  const caseSensitive = filter["caseSensitive"] === true;
  const accentSensitive = filter["accentSensitive"] === true;
  const operand = filter["filter"];
  if (column.semantics.filterFamily === "text") {
    if ((type === "equals" || type === "notEqual") && operand !== undefined) {
      return {
        normalizedOperand: normalizeCanonicalTextOperand(
          column,
          operand,
          caseSensitive,
          accentSensitive,
          context,
        ),
      };
    }
    if (type === "in" && Array.isArray(operand)) {
      const normalizedOperands = operand.map((item) =>
        normalizeCanonicalTextOperand(column, item, caseSensitive, accentSensitive, context),
      );
      if (normalizedOperands.some((value) => value === undefined || value.length === 0)) {
        return undefined;
      }
      const membershipKeys = compileFilterMembershipKeys(
        column,
        operand,
        normalizedOperands,
        context,
      );
      return {
        normalizedOperands: Object.freeze(normalizedOperands),
        ...(membershipKeys === undefined ? {} : { membershipKeys }),
      };
    }
    if (
      (type === "contains" ||
        type === "notContains" ||
        type === "startsWith" ||
        type === "endsWith") &&
      typeof operand === "string"
    ) {
      const normalizedSubstringOperand = normalizeFilterTextOperand(
        operand,
        caseSensitive,
        accentSensitive,
        context,
      );
      return normalizedSubstringOperand === undefined ? undefined : { normalizedSubstringOperand };
    }
  } else if (
    column.semantics.filterFamily === "numeric" &&
    type === "in" &&
    Array.isArray(operand)
  ) {
    const membershipKeys = compileFilterMembershipKeys(column, operand, [], context);
    if (membershipKeys !== undefined) return { membershipKeys };
  }
  return undefined;
}

function normalizeCanonicalTextOperand(
  column: CompiledColumn,
  operand: unknown,
  caseSensitive: boolean,
  accentSensitive: boolean,
  context?: FilterSanitizationContext,
): string | undefined {
  try {
    const canonical = column.semantics.formatCanonicalText(operand);
    if (context !== undefined && !reserveFilterText(canonical.length, context)) return undefined;
    const normalized = normalizeBrunoTableFilterText(canonical, caseSensitive, accentSensitive);
    if (context !== undefined && !reserveFilterText(normalized.length, context)) return undefined;
    return normalized;
  } catch {
    return undefined;
  }
}

function normalizeFilterTextOperand(
  operand: string,
  caseSensitive: boolean,
  accentSensitive: boolean,
  context: FilterSanitizationContext,
): string | undefined {
  if (!reserveFilterText(operand.length, context)) return undefined;
  const normalized = normalizeBrunoTableFilterText(operand, caseSensitive, accentSensitive);
  if (!reserveFilterText(normalized.length, context)) return undefined;
  if (normalized.length === 0) return undefined;
  return normalized;
}

function compileFilterMembershipKeys(
  column: CompiledColumn,
  operands: readonly unknown[],
  normalizedOperands: readonly (string | undefined)[],
  context?: FilterSanitizationContext,
): ReadonlySet<string> | undefined {
  const keys = new Set<string>();
  for (let index = 0; index < operands.length; index += 1) {
    const key = filterMembershipKey(column, operands[index], normalizedOperands[index]);
    if (key === undefined) return undefined;
    if (context !== undefined && !reserveFilterText(key.length, context)) return undefined;
    keys.add(key);
  }
  return keys;
}

function filterMembershipKey(
  column: CompiledColumn,
  value: unknown,
  normalizedText?: string,
): string | undefined {
  if (column.semantics.filterFamily === "text") {
    return normalizedText === undefined ? undefined : `text:${normalizedText}`;
  }
  if (column.valueType === "number") {
    return typeof value === "number" && Number.isFinite(value)
      ? `number:${String(value)}`
      : undefined;
  }
  if (column.valueType === "bigint") {
    return typeof value === "bigint" ? `bigint:${value.toString(10)}` : undefined;
  }
  return undefined;
}

function createLeafFilterSignature(
  column: CompiledColumn,
  filter: Readonly<Record<string, unknown>>,
  plan: CompiledFilterOperandPlan | undefined,
  context: FilterSanitizationContext,
): string | undefined {
  const type = filter["type"];
  const parts = ["leaf", column.columnId, typeof type === "string" ? type : "unknown"];
  if (filter["caseSensitive"] === true) parts.push("caseSensitive");
  if (filter["accentSensitive"] === true) parts.push("accentSensitive");
  if (type === "blank" || type === "notBlank") return createFilterSignature(parts, context);
  if (type === "in") {
    if (plan?.membershipKeys === undefined) return undefined;
    parts.push(...Array.from(plan.membershipKeys).sort(compareStringValues));
    return createFilterSignature(parts, context);
  }
  if (
    type === "contains" ||
    type === "notContains" ||
    type === "startsWith" ||
    type === "endsWith"
  ) {
    const normalized = plan?.normalizedSubstringOperand;
    return normalized === undefined
      ? undefined
      : createFilterSignature([...parts, normalized], context);
  }
  if (type === "inRange") {
    const from = filterOperandSignature(column, filter["filter"], context);
    const to = filterOperandSignature(column, filter["filterTo"], context);
    return from === undefined || to === undefined
      ? undefined
      : createFilterSignature([...parts, from, to], context);
  }
  if (type === "equals" || type === "notEqual") {
    if (column.semantics.filterFamily === "text") {
      const normalized = plan?.normalizedOperand;
      return normalized === undefined
        ? undefined
        : createFilterSignature([...parts, normalized], context);
    }
  }
  const operand = filterOperandSignature(column, filter["filter"], context);
  return operand === undefined ? undefined : createFilterSignature([...parts, operand], context);
}

function filterOperandSignature(
  column: CompiledColumn,
  value: unknown,
  context: FilterSanitizationContext,
): string | undefined {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (column.semantics.filterFamily === "select") {
    const index = column.selectOptionIndexes?.get(value);
    return index === undefined || !Object.is(column.selectOptions?.[index], value)
      ? undefined
      : `select:${String(index)}`;
  }
  if (column.semantics.filterFamily === "boolean") {
    return typeof value === "boolean" ? `boolean:${String(value)}` : undefined;
  }
  if (column.valueType === "number") {
    return typeof value === "number" && Number.isFinite(value)
      ? `number:${String(value)}`
      : undefined;
  }
  if (column.valueType === "bigint") {
    if (typeof value !== "bigint") return undefined;
    const decimal = value.toString(10);
    return reserveFilterText(decimal.length, context) ? `bigint:${decimal}` : undefined;
  }
  return undefined;
}

function createFilterSignature(
  parts: readonly string[],
  context: FilterSanitizationContext,
): string | undefined {
  // Length-delimited tokens are collision-free without JSON serialization. The final key is
  // charged once against the shared retained-text ledger before it is retained in the index. If a
  // A compound key that would exceed the remaining collection text budget stays opaque rather than
  // allocating an unbounded transient string. Leaf representations that can themselves be large
  // (notably BigInt decimal text) are charged before reaching this bounded signature assembly.
  const length = parts.reduce(
    (total, part) => total + part.length + String(part.length).length + 1,
    0,
  );
  if (length > BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_TEXT_LENGTH - context.textLength)
    return undefined;
  const signature = parts.map((part) => `${part.length}:${part}`).join("|");
  return reserveFilterText(signature.length, context) ? signature : undefined;
}

function compareStringValues(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function evaluateFilter(
  candidate: unknown,
  row: unknown,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  readValue: (column: CompiledColumn, row: unknown) => unknown,
  compiledOperands: ReadonlyMap<object, CompiledFilterOperandPlan>,
  completed: WeakMap<object, boolean> | undefined,
): boolean {
  if (completed === undefined) {
    return evaluateFilterRecord(
      candidate,
      row,
      columnsById,
      readValue,
      compiledOperands,
      undefined,
    );
  }
  const candidateObject =
    typeof candidate === "object" && candidate !== null ? candidate : undefined;
  if (candidateObject !== undefined && completed.has(candidateObject)) {
    return completed.get(candidateObject) ?? false;
  }
  const result = evaluateFilterRecord(
    candidate,
    row,
    columnsById,
    readValue,
    compiledOperands,
    completed,
  );
  if (candidateObject !== undefined) completed.set(candidateObject, result);
  return result;
}

function evaluateFilterRecord(
  candidate: unknown,
  row: unknown,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  readValue: (column: CompiledColumn, row: unknown) => unknown,
  compiledOperands: ReadonlyMap<object, CompiledFilterOperandPlan>,
  completed: WeakMap<object, boolean> | undefined,
): boolean {
  const filter = asRecord(candidate);
  const type = filter["type"];
  if (type === "AND" || type === "OR") {
    const conditions = Array.isArray(filter["conditions"]) ? filter["conditions"] : [];
    return type === "AND"
      ? conditions.every((condition) =>
          evaluateFilter(condition, row, columnsById, readValue, compiledOperands, completed),
        )
      : conditions.some((condition) =>
          evaluateFilter(condition, row, columnsById, readValue, compiledOperands, completed),
        );
  }
  if (type === "NOT") {
    return !evaluateFilter(
      filter["condition"],
      row,
      columnsById,
      readValue,
      compiledOperands,
      completed,
    );
  }
  const columnId = filter["columnId"];
  const column = typeof columnId === "string" ? columnsById.get(columnId) : undefined;
  if (column === undefined || column.enableFilter === false || column.kind !== "field") {
    return false;
  }

  const value = readValue(column, row);
  const operand = filter["filter"];
  const caseSensitive = filter["caseSensitive"] === true;
  const accentSensitive = filter["accentSensitive"] === true;
  const plan =
    typeof candidate === "object" && candidate !== null
      ? compiledOperands.get(candidate)
      : undefined;
  if (filter["type"] === "blank") return value === null || value === undefined || value === "";
  if (filter["type"] === "notBlank") return value !== null && value !== undefined && value !== "";
  if (filter["type"] === "equals") {
    return compareEquality(
      column,
      value,
      operand,
      caseSensitive,
      accentSensitive,
      plan?.normalizedOperand,
    );
  }
  if (filter["type"] === "notEqual") {
    return !compareEquality(
      column,
      value,
      operand,
      caseSensitive,
      accentSensitive,
      plan?.normalizedOperand,
    );
  }
  if (filter["type"] === "in") {
    if (plan?.membershipKeys !== undefined) {
      const key = filterMembershipKey(
        column,
        value,
        column.semantics.filterFamily === "text"
          ? normalizeCanonicalTextOperand(column, value, caseSensitive, accentSensitive)
          : undefined,
      );
      if (key !== undefined) return plan.membershipKeys.has(key);
    }
    return (
      Array.isArray(operand) &&
      operand.some((item, index) =>
        compareEquality(
          column,
          value,
          item,
          caseSensitive,
          accentSensitive,
          plan?.normalizedOperands?.[index],
        ),
      )
    );
  }
  if (
    (filter["type"] === "greaterThan" ||
      filter["type"] === "greaterThanOrEqual" ||
      filter["type"] === "lessThan" ||
      filter["type"] === "lessThanOrEqual" ||
      filter["type"] === "inRange") &&
    (value === null || value === undefined)
  ) {
    return false;
  }
  if (filter["type"] === "greaterThan") return column.semantics.compare(value, operand) > 0;
  if (filter["type"] === "greaterThanOrEqual") return column.semantics.compare(value, operand) >= 0;
  if (filter["type"] === "lessThan") return column.semantics.compare(value, operand) < 0;
  if (filter["type"] === "lessThanOrEqual") return column.semantics.compare(value, operand) <= 0;
  if (filter["type"] === "inRange") {
    return (
      column.semantics.compare(operand, value) <= 0 &&
      column.semantics.compare(value, filter["filterTo"]) < 0
    );
  }
  if (typeof operand !== "string") return filter["type"] === "notContains";
  if (value === null || value === undefined) return filter["type"] === "notContains";
  const left = normalizeBrunoTableFilterText(
    column.semantics.formatCanonicalText(value),
    caseSensitive,
    accentSensitive,
  );
  const right =
    plan?.normalizedSubstringOperand ??
    normalizeBrunoTableFilterText(operand, caseSensitive, accentSensitive);
  if (filter["type"] === "contains") return left.includes(right);
  if (filter["type"] === "notContains") return !left.includes(right);
  if (filter["type"] === "startsWith") return left.startsWith(right);
  if (filter["type"] === "endsWith") return left.endsWith(right);
  return false;
}

function compareEquality(
  column: CompiledColumn,
  value: unknown,
  operand: unknown,
  caseSensitive: boolean,
  accentSensitive: boolean,
  normalizedOperand?: string,
): boolean {
  if (value === null || value === undefined || operand === null || operand === undefined) {
    return value === operand;
  }
  if (column.semantics.filterFamily === "text") {
    return (
      normalizeBrunoTableFilterText(
        column.semantics.formatCanonicalText(value),
        caseSensitive,
        accentSensitive,
      ) ===
      (normalizedOperand ??
        normalizeBrunoTableFilterText(
          column.semantics.formatCanonicalText(operand),
          caseSensitive,
          accentSensitive,
        ))
    );
  }
  return column.semantics.equivalent(value, operand);
}

export function sameBrunoTableFilterCollection(
  previous: readonly unknown[],
  next: readonly unknown[],
  columnsById: ReadonlyMap<string, CompiledColumn>,
  unordered = true,
): boolean {
  const columns = Array.from(columnsById.values());
  return sameCompiledFilterCollections(
    compileClientFilterCollection(previous, columns),
    compileClientFilterCollection(next, columns),
    unordered,
  );
}

export function sameBrunoTableFilterValue(
  previous: unknown,
  next: unknown,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  column?: CompiledColumn,
  seen: WeakMap<object, object> = new WeakMap(),
): boolean {
  if (column !== undefined) return sameFilterSemanticValue(column, previous, next);
  return sameFilterValueStructure(previous, next, columnsById, seen);
}

function sameFilterSemanticValue(
  column: CompiledColumn,
  previous: unknown,
  next: unknown,
): boolean {
  if (Object.is(previous, next)) return true;
  if (previous === null || previous === undefined || next === null || next === undefined) {
    return previous === next;
  }
  try {
    if (column.semantics.filterFamily === "text") {
      return (
        normalizeBrunoTableFilterText(column.semantics.formatCanonicalText(previous)) ===
        normalizeBrunoTableFilterText(column.semantics.formatCanonicalText(next))
      );
    }
    return column.semantics.equivalent(previous, next);
  } catch {
    return false;
  }
}

function sameFilterValueStructure(
  previous: unknown,
  next: unknown,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  seen: WeakMap<object, object>,
): boolean {
  if (Object.is(previous, next)) return true;
  if (typeof previous !== typeof next || previous === null || next === null) return false;
  if (typeof previous !== "object" || typeof next !== "object") return false;
  const previousObject = previous as object;
  const nextObject = next as object;
  const matched = seen.get(previousObject);
  if (matched !== undefined) return matched === nextObject;
  seen.set(previousObject, nextObject);
  try {
    if (Array.isArray(previous) || Array.isArray(next)) {
      if (!Array.isArray(previous) || !Array.isArray(next) || previous.length !== next.length) {
        return false;
      }
      return previous.every((value, index) =>
        sameFilterValueStructure(value, next[index], columnsById, seen),
      );
    }
    const previousKeys = Reflect.ownKeys(previous);
    const nextKeys = Reflect.ownKeys(next);
    if (previousKeys.length !== nextKeys.length) return false;
    const nextKeySet = new Set(nextKeys);
    if (!previousKeys.every((key) => nextKeySet.has(key))) return false;
    const previousColumnId = readDataProperty(previous, "columnId");
    const nextColumnId = readDataProperty(next, "columnId");
    const column =
      typeof previousColumnId === "string" && previousColumnId === nextColumnId
        ? columnsById.get(previousColumnId)
        : undefined;
    const type = readDataProperty(previous, "type");
    for (const key of previousKeys) {
      const previousDescriptor = Object.getOwnPropertyDescriptor(previous, key);
      const nextDescriptor = Object.getOwnPropertyDescriptor(next, key);
      if (
        previousDescriptor === undefined ||
        nextDescriptor === undefined ||
        !Object.hasOwn(previousDescriptor, "value") ||
        !Object.hasOwn(nextDescriptor, "value")
      ) {
        return false;
      }
      const leftValue = previousDescriptor.value;
      const rightValue = nextDescriptor.value;
      if (column !== undefined && (key === "filter" || key === "filterTo")) {
        if (type === "in" && key === "filter" && Array.isArray(leftValue)) {
          if (!Array.isArray(rightValue) || leftValue.length !== rightValue.length) return false;
          const matchedValues = new Set<number>();
          if (
            !leftValue.every((value) => {
              const index = rightValue.findIndex(
                (candidate, candidateIndex) =>
                  !matchedValues.has(candidateIndex) &&
                  sameFilterSemanticValue(column, value, candidate),
              );
              if (index < 0) return false;
              matchedValues.add(index);
              return true;
            })
          ) {
            return false;
          }
        } else if (!sameFilterSemanticValue(column, leftValue, rightValue)) {
          return false;
        }
      } else if (!sameFilterValueStructure(leftValue, rightValue, columnsById, seen)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function readDataProperty(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : undefined;
}

function sameCompiledFilterCollections(
  previous: BrunoTableClientFilterCollection,
  next: BrunoTableClientFilterCollection,
  unordered: boolean,
): boolean {
  if (previous === next) return true;
  if (previous.roots.length !== next.roots.length) return false;
  if (previous.opaqueRootCountByColumn.size > 0 || next.opaqueRootCountByColumn.size > 0) {
    return false;
  }
  if (!unordered) {
    return previous.roots.every(
      (root, index) =>
        root.signature !== undefined && root.signature === next.roots[index]?.signature,
    );
  }
  const columnIds = new Set<string>([
    ...previous.signatureCountsByColumn.keys(),
    ...next.signatureCountsByColumn.keys(),
  ]);
  return [...columnIds].every((columnId) =>
    sameSignatureCounts(
      previous.signatureCountsByColumn.get(columnId),
      next.signatureCountsByColumn.get(columnId),
    ),
  );
}

export function sameBrunoTableFilterCollections(
  previous: BrunoTableClientFilterCollection,
  next: BrunoTableClientFilterCollection,
  unordered = true,
): boolean {
  return sameCompiledFilterCollections(previous, next, unordered);
}

export function sameBrunoTableFilterColumn(
  previous: BrunoTableClientFilterCollection,
  next: BrunoTableClientFilterCollection,
  columnId: string,
): boolean {
  if ((previous.opaqueRootCountByColumn.get(columnId) ?? 0) > 0) return false;
  if ((next.opaqueRootCountByColumn.get(columnId) ?? 0) > 0) return false;
  return sameSignatureCounts(
    previous.signatureCountsByColumn.get(columnId),
    next.signatureCountsByColumn.get(columnId),
  );
}

function sameSignatureCounts(
  previous: ReadonlyMap<string, number> | undefined,
  next: ReadonlyMap<string, number> | undefined,
): boolean {
  if (previous === next) return true;
  if (previous === undefined || next === undefined || previous.size !== next.size) return false;
  return [...previous].every(([signature, count]) => next.get(signature) === count);
}

function hasValidTextSensitivity(
  filter: Readonly<Record<string, unknown>>,
  supported: boolean,
): boolean {
  return ["caseSensitive", "accentSensitive"].every(
    (key) => !Object.hasOwn(filter, key) || (supported && typeof filter[key] === "boolean"),
  );
}

function snapshotDenseArray(values: unknown, length: number): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(values)) return undefined;
    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      if (!Object.hasOwn(values, index)) return undefined;
      snapshot.push(values[index]);
    }
    return snapshot;
  } catch {
    return undefined;
  }
}

function snapshotRootEntries(
  values: unknown,
): readonly unknown[] | undefined | typeof ROOT_ENTRIES_OVER_BUDGET {
  try {
    if (!Array.isArray(values)) return undefined;
    const length = values.length;
    if (!Number.isSafeInteger(length) || length < 0) return undefined;
    const indexes = readOwnArrayIndexes(values, length);
    if (indexes === undefined || indexes === ROOT_ENTRIES_OVER_BUDGET) return indexes;
    const snapshot: unknown[] = [];
    for (const index of indexes) {
      try {
        snapshot.push(values[index]);
      } catch {
        // Ignore only this unreadable external entry so valid siblings remain usable.
      }
    }
    return snapshot;
  } catch {
    return undefined;
  }
}

function readOwnArrayIndexes(
  values: readonly unknown[],
  length: number,
): readonly number[] | undefined | typeof ROOT_ENTRIES_OVER_BUDGET {
  try {
    const indexes: number[] = [];
    const ownKeys = Reflect.ownKeys(values);
    // An Array always owns its non-data `length` key. Count every other own
    // key, including symbols and non-index properties, before inspecting any
    // indexed values so hostile metadata cannot bypass the root budget.
    if (ownKeys.length > BRUNO_TABLE_CLIENT_FILTER_MAX_ROOT_ENTRIES + 1) {
      return ROOT_ENTRIES_OVER_BUDGET;
    }
    for (const key of ownKeys) {
      if (typeof key !== "string" || key === "length") continue;
      const index = Number(key);
      if (Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key) {
        indexes.push(index);
        if (indexes.length > BRUNO_TABLE_CLIENT_FILTER_MAX_ROOT_ENTRIES) {
          return ROOT_ENTRIES_OVER_BUDGET;
        }
      }
    }
    indexes.sort((left, right) => left - right);
    return indexes;
  } catch {
    return undefined;
  }
}

function isReadableEmptyArray(value: unknown): boolean {
  try {
    return Array.isArray(value) && value.length === 0;
  } catch {
    return false;
  }
}

function hasSortableColumns(columns: readonly CompiledColumn[]): boolean {
  return columns.some((column) => column.enableSorting !== false);
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Readonly<Record<string, unknown>>;
}

const EMPTY_ORDER_BY: ClientOrderBy = Object.freeze([]);
export const BRUNO_TABLE_CLIENT_FILTER_MAX_DEPTH = 64;
export const BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_NODES = 16_384;
export const BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_OPERANDS = 16_384;
export const BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_TEXT_LENGTH = 1_048_576;
// Compatibility names for internal tests and diagnostics. These are aggregate limits, not
// per-expression budgets.
export const BRUNO_TABLE_CLIENT_FILTER_MAX_NODES: number =
  BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_NODES;
export const BRUNO_TABLE_CLIENT_FILTER_MAX_OPERANDS: number =
  BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_OPERANDS;
export const BRUNO_TABLE_CLIENT_FILTER_MAX_ROOT_ENTRIES = 16_384;
const ROOT_ENTRIES_OVER_BUDGET = Symbol("BrunoTable root filter entries over budget");
const SANITIZED_FILTER_SNAPSHOTS = new WeakSet<object>();

type FilterSanitizationContext = {
  readonly captured: WeakMap<object, Readonly<Record<string, unknown>> | undefined>;
  readonly capturedArrays: WeakMap<object, CapturedFilterArray | undefined>;
  readonly completed: WeakMap<object, Map<number, SanitizedFilterNode | undefined>>;
  readonly visited: WeakSet<object>;
  readonly admittedNodes: WeakSet<object>;
  /** Raw operand objects and strings already metered during this root admission transaction. */
  readonly meteredOperandObjects: WeakSet<object>;
  readonly meteredOperandStrings: Set<string>;
  readonly compiledOperands: Map<object, CompiledFilterOperandPlan>;
  readonly compiledOperandLookup: ReadonlyMap<object, CompiledFilterOperandPlan>;
  readonly columnLabelsById: ReadonlyMap<string, string>;
  /** Descriptions committed by earlier accepted roots in this collection admission. */
  readonly descriptionMemo: Map<object, string | undefined>;
  /** Candidate-local descriptions; merged only after the candidate root is accepted. */
  readonly pendingDescriptionMemo: Map<object, string | undefined>;
  hasSharedNodes: boolean;
  nodes: number;
  operands: number;
  textLength: number;
  overBudget: boolean;
};

function createFilterSanitizationContext(
  initial: Readonly<{
    readonly nodes?: number;
    readonly operands?: number;
    readonly textLength?: number;
  }> = {},
  compiledOperands: Map<object, CompiledFilterOperandPlan> = new Map(),
  captured: WeakMap<object, Readonly<Record<string, unknown>> | undefined> = new WeakMap(),
  capturedArrays: WeakMap<object, CapturedFilterArray | undefined> = new WeakMap(),
  compiledOperandLookup: ReadonlyMap<object, CompiledFilterOperandPlan> = compiledOperands,
  columnLabelsById: ReadonlyMap<string, string> = new Map(),
  descriptionMemo: Map<object, string | undefined> = new Map(),
  pendingDescriptionMemo: Map<object, string | undefined> = new Map(),
): FilterSanitizationContext {
  return {
    captured,
    capturedArrays,
    completed: new WeakMap(),
    visited: new WeakSet(),
    admittedNodes: new WeakSet(),
    meteredOperandObjects: new WeakSet(),
    meteredOperandStrings: new Set(),
    compiledOperands,
    compiledOperandLookup,
    columnLabelsById,
    descriptionMemo,
    pendingDescriptionMemo,
    hasSharedNodes: false,
    nodes: initial.nodes ?? 0,
    operands: initial.operands ?? 0,
    textLength: initial.textLength ?? 0,
    overBudget: false,
  };
}

function createClientFilterDescriptionMemo(
  roots: readonly BrunoTableClientFilterRoot[],
): Map<object, string | undefined> {
  const memo = new Map<object, string | undefined>();
  for (const root of roots) memo.set(root.filter, root.activeFilterLabel);
  return memo;
}

function mergeClientFilterDescriptionMemo(
  target: Map<object, string | undefined>,
  source: ReadonlyMap<object, string | undefined>,
): void {
  for (const [node, description] of source) target.set(node, description);
}

function isBoundedFilterOperand(value: unknown, context: FilterSanitizationContext): boolean {
  // These per-operand object/property/depth checks are structural readability guards. They stop
  // an accessor-backed or cyclic value before decoding; they are deliberately not complexity
  // budgets and never replace or reset the collection-wide node/operand/text ledger below.
  const visited = new WeakSet<object>();
  const discoveredObjects: object[] = [];
  const discoveredStrings = new Set<string>();
  let objectCount = 0;
  let propertyCount = 0;

  const visit = (candidate: unknown, depth: number): boolean => {
    if (typeof candidate === "string") {
      if (!context.meteredOperandStrings.has(candidate)) discoveredStrings.add(candidate);
      return true;
    }
    if (
      candidate === null ||
      candidate === undefined ||
      typeof candidate === "boolean" ||
      typeof candidate === "number" ||
      typeof candidate === "bigint" ||
      typeof candidate === "symbol"
    ) {
      return true;
    }
    if (typeof candidate !== "object" || depth > BRUNO_TABLE_MAX_FILTER_OPERAND_DEPTH) {
      if (depth > BRUNO_TABLE_MAX_FILTER_OPERAND_DEPTH) context.overBudget = true;
      return false;
    }
    if (context.meteredOperandObjects.has(candidate)) return true;
    if (visited.has(candidate)) return true;
    visited.add(candidate);
    discoveredObjects.push(candidate);
    objectCount += 1;
    if (objectCount > BRUNO_TABLE_MAX_FILTER_OPERAND_OBJECTS) {
      context.overBudget = true;
      return false;
    }
    let keys: readonly PropertyKey[];
    try {
      keys = Reflect.ownKeys(candidate);
    } catch {
      return false;
    }
    propertyCount += keys.length;
    if (propertyCount > BRUNO_TABLE_MAX_FILTER_OPERAND_PROPERTIES) {
      context.overBudget = true;
      return false;
    }
    for (const key of keys) {
      if (typeof key === "string" && !context.meteredOperandStrings.has(key)) {
        discoveredStrings.add(key);
      }
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      } catch {
        return false;
      }
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) return false;
      if (!visit(descriptor.value, depth + 1)) return false;
    }
    return true;
  };

  if (!visit(value, 0)) return false;
  let textLength = 0;
  for (const text of discoveredStrings) textLength += text.length;
  if (!reserveFilterText(textLength, context)) return false;
  for (const object of discoveredObjects) context.meteredOperandObjects.add(object);
  for (const text of discoveredStrings) context.meteredOperandStrings.add(text);
  return true;
}

type CapturedFilterArray = {
  attempted: boolean;
  readonly length: number;
  snapshot: readonly unknown[] | undefined;
};

type SanitizedFilterNode = {
  readonly columnIds: ReadonlySet<string>;
  readonly filter: Readonly<Record<string, unknown>>;
  readonly signature?: string;
};
