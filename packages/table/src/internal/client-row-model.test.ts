import { afterEach, describe, expect, it, vi } from "vitest";

import { BrunoTableSelectColumn } from "../column-helpers";
import { compileColumns } from "./compile-columns";
import {
  createBrunoTableClientRowComparator,
  createClientFilterPredicate,
  filterClientRows,
  filterReferencesColumn,
  reconcileClientOrderBy,
  sanitizeClientInitialFilters,
  sanitizeClientInitialOrderBy,
  sanitizeClientOrderBy,
} from "./client-row-model";
import { compileClientFilterPlan } from "./grid-query";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Client row model", () => {
  it("sorts exact number and bigint keys by priority with stable source-order ties", () => {
    type ExactRow = Readonly<{
      sourceIndex: number;
      score: number;
      quantity: bigint;
      label: string;
    }>;
    const columns = compileColumns([
      {
        columnId: "COL_ID_SCORE",
        field: "score",
        headerName: "Score",
        valueType: "number",
      },
      {
        columnId: "COL_ID_QUANTITY",
        field: "quantity",
        headerName: "Quantity",
        valueType: "bigint",
      },
    ]);
    const rows = [
      {
        sourceIndex: 0,
        score: 1.25,
        quantity: 9_007_199_254_740_993n,
        label: "first equal key",
      },
      {
        sourceIndex: 1,
        score: 1.5,
        quantity: 9_007_199_254_740_994n,
        label: "higher number priority",
      },
      {
        sourceIndex: 2,
        score: 1.25,
        quantity: 9_007_199_254_740_992n,
        label: "lower exact bigint",
      },
      {
        sourceIndex: 3,
        score: 1.25,
        quantity: 9_007_199_254_740_993n,
        label: "second equal key",
      },
    ] satisfies readonly ExactRow[];
    const compare = createBrunoTableClientRowComparator<ExactRow>(
      columns,
      [
        { columnId: "COL_ID_SCORE", direction: "asc" },
        { columnId: "COL_ID_QUANTITY", direction: "desc" },
      ],
      (column, row) => (column.columnId === "COL_ID_SCORE" ? row.score : row.quantity),
      (row) => row.sourceIndex,
    );

    expect(rows.toSorted(compare).map((row) => row.label)).toEqual([
      "first equal key",
      "second equal key",
      "lower exact bigint",
      "higher number priority",
    ]);
  });

  it("uses locale-independent case normalization", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const localeLowerCase = vi
      .spyOn(String.prototype, "toLocaleLowerCase")
      .mockImplementation(() => {
        throw new Error("locale-sensitive normalization must not run");
      });

    expect(
      filterClientRows([{ id: "first", name: "I" }], columns, [
        { columnId: "COL_ID_NAME", type: "equals", filter: "i" },
      ]),
    ).toEqual([{ id: "first", name: "I" }]);
    expect(localeLowerCase).not.toHaveBeenCalled();
  });

  it("compiles text filter operands once before evaluating rows", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const normalize = vi.spyOn(String.prototype, "normalize");
    const predicate = createClientFilterPredicate(columns, [
      { columnId: "COL_ID_NAME", type: "equals", filter: "ada" },
    ]);
    const rows = [{ name: "Ada" }, { name: "Grace" }, { name: "ADA" }];

    expect(normalize).toHaveBeenCalledTimes(1);
    expect(rows.filter(predicate!)).toEqual([{ name: "Ada" }, { name: "ADA" }]);
    expect(normalize).toHaveBeenCalledTimes(rows.length + 1);
  });

  it("shares compiled filter operands across Client row adapters", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const filters = [{ columnId: "COL_ID_NAME", type: "equals", filter: "ada" }];
    const normalize = vi.spyOn(String.prototype, "normalize");
    const plan = compileClientFilterPlan(columns, filters);

    createClientFilterPredicate(
      columns,
      filters,
      (_column, row: { name: string }) => row.name,
      plan,
    );
    createClientFilterPredicate(
      columns,
      filters,
      (_column, row: { name: string }) => row.name,
      plan,
    );

    expect(normalize).toHaveBeenCalledTimes(1);
  });

  it("normalizes canonically equivalent accent-sensitive text", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);

    expect(
      filterClientRows([{ name: "caf\u00e9" }], columns, [
        {
          accentSensitive: true,
          columnId: "COL_ID_NAME",
          filter: "cafe\u0301",
          type: "equals",
        },
      ]),
    ).toHaveLength(1);
  });

  it("requires a valid initial sort and removes invalid or duplicate live entries", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);

    expect(() => sanitizeClientInitialOrderBy(undefined, columns)).toThrow(
      "BrunoTable initialOrderBy is required.",
    );
    expect(() =>
      sanitizeClientInitialOrderBy([{ columnId: "COL_ID_MISSING", direction: "asc" }], columns),
    ).toThrow(/no valid sortable column/u);
    expect(() =>
      sanitizeClientInitialOrderBy(
        null as unknown as Parameters<typeof sanitizeClientInitialOrderBy>[0],
        columns,
      ),
    ).toThrow(/no valid sortable column/u);
    expect(() =>
      sanitizeClientInitialOrderBy(
        [null] as unknown as Parameters<typeof sanitizeClientInitialOrderBy>[0],
        columns,
      ),
    ).toThrow(/no valid sortable column/u);
    expect(
      sanitizeClientInitialFilters(
        null as unknown as Parameters<typeof sanitizeClientInitialFilters>[0],
        columns,
      ),
    ).toEqual([]);
    expect(
      sanitizeClientOrderBy(
        [
          { columnId: "COL_ID_NAME", direction: "asc" },
          { columnId: "COL_ID_NAME", direction: "desc" },
          { columnId: "COL_ID_MISSING", direction: "asc" },
        ],
        columns,
      ),
    ).toEqual([{ columnId: "COL_ID_NAME", direction: "asc" }]);

    const sortFreeColumns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
        enableSorting: false,
      },
    ]);
    expect(() =>
      sanitizeClientInitialOrderBy(
        [{ columnId: "COL_ID_NAME", direction: "asc" }],
        sortFreeColumns,
      ),
    ).toThrow(/requires at least one sortable column/u);
  });

  it("restores valid non-empty sorting and falls back to its baseline otherwise", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
      {
        columnId: "COL_ID_SCORE",
        field: "score",
        headerName: "Score",
        valueType: "number",
      },
    ]);
    const baseline = sanitizeClientInitialOrderBy(
      [{ columnId: "COL_ID_NAME", direction: "asc" }],
      columns,
    );

    expect(
      reconcileClientOrderBy(
        [
          { columnId: "COL_ID_SCORE", direction: "desc" },
          { columnId: "COL_ID_SCORE", direction: "asc" },
        ],
        baseline,
        columns,
      ),
    ).toEqual([{ columnId: "COL_ID_SCORE", direction: "desc" }]);
    expect(reconcileClientOrderBy([], baseline, columns)).toEqual(baseline);
    expect(
      reconcileClientOrderBy([{ columnId: "COL_ID_STALE", direction: "asc" }], baseline, columns),
    ).toEqual(baseline);
  });

  it("keeps nullable text rows for notContains and applies half-open numeric ranges", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
      {
        columnId: "COL_ID_SCORE",
        field: "score",
        headerName: "Score",
        valueType: "number",
      },
    ]);
    const rows = [
      { id: "blank", name: null, score: 1 },
      { id: "middle", name: "Ada", score: 2 },
      { id: "upper", name: "Grace", score: 3 },
    ] as const;

    expect(
      filterClientRows(rows, columns, [
        { columnId: "COL_ID_NAME", type: "notContains", filter: "da" },
      ]).map((row) => row.id),
    ).toEqual(["blank", "upper"]);
    expect(
      filterClientRows(rows, columns, [
        { columnId: "COL_ID_SCORE", type: "inRange", filter: 1, filterTo: 3 },
      ]).map((row) => row.id),
    ).toEqual(["blank", "middle"]);
    expect(
      filterClientRows(rows, columns, [
        { columnId: "COL_ID_SCORE", type: "equals", filter: 2 },
      ]).map((row) => row.id),
    ).toEqual(["middle"]);
    expect(
      filterClientRows(rows, columns, [{ columnId: "COL_ID_SCORE", type: "in", filter: [2] }]).map(
        (row) => row.id,
      ),
    ).toEqual(["middle"]);
    expect(
      filterClientRows(rows, columns, [
        { columnId: "COL_ID_SCORE", type: "notEqual", filter: 2 },
      ]).map((row) => row.id),
    ).toEqual(["blank", "upper"]);
    expect(
      filterClientRows(rows, columns, [
        { columnId: "COL_ID_NAME", type: "notContains", filter: 2 },
      ]).map((row) => row.id),
    ).toEqual(["blank", "middle", "upper"]);
  });

  it("retains empty text operands with their exact predicate semantics", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const rows = [
      { id: "blank", name: null },
      { id: "empty", name: "" },
      { id: "value", name: "Ada" },
    ] as const;

    for (const type of ["contains", "startsWith", "endsWith"] as const) {
      expect(
        filterClientRows(rows, columns, [{ columnId: "COL_ID_NAME", type, filter: "" }]).map(
          (row) => row.id,
        ),
      ).toEqual(["empty", "value"]);
    }
    expect(
      filterClientRows(rows, columns, [
        { columnId: "COL_ID_NAME", type: "notContains", filter: "" },
      ]).map((row) => row.id),
    ).toEqual(["blank"]);
  });

  it("excludes nullish Number and BigInt values from every ordered filter", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_SCORE",
        field: "score",
        headerName: "Score",
        valueType: "number",
      },
      {
        columnId: "COL_ID_COUNT",
        field: "count",
        headerName: "Count",
        valueType: "bigint",
      },
    ]);
    const rows = [
      { id: "null", score: null, count: null },
      { id: "low", score: 4, count: 4n },
      { id: "middle", score: 5, count: 5n },
      { id: "high", score: 6, count: 6n },
    ] as const;
    const cases = [
      ["greaterThan", ["high"]],
      ["greaterThanOrEqual", ["middle", "high"]],
      ["lessThan", ["low"]],
      ["lessThanOrEqual", ["low", "middle"]],
    ] as const;

    for (const [type, expected] of cases) {
      expect(
        filterClientRows(rows, columns, [{ columnId: "COL_ID_SCORE", type, filter: 5 }]).map(
          (row) => row.id,
        ),
      ).toEqual(expected);
      expect(
        filterClientRows(rows, columns, [{ columnId: "COL_ID_COUNT", type, filter: 5n }]).map(
          (row) => row.id,
        ),
      ).toEqual(expected);
    }
    expect(
      filterClientRows(rows, columns, [
        { columnId: "COL_ID_SCORE", type: "inRange", filter: 4, filterTo: 6 },
      ]).map((row) => row.id),
    ).toEqual(["low", "middle"]);
    expect(
      filterClientRows(rows, columns, [
        { columnId: "COL_ID_COUNT", type: "inRange", filter: 4n, filterTo: 6n },
      ]).map((row) => row.id),
    ).toEqual(["low", "middle"]);
  });

  it("retains empty ranges and strings while dropping invalid text operands and arrays", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
      {
        columnId: "COL_ID_SCORE",
        field: "score",
        headerName: "Score",
        valueType: "number",
      },
      {
        columnId: "COL_ID_COUNT",
        field: "count",
        headerName: "Count",
        valueType: "bigint",
      },
    ]);
    const sparseCandidates = Array<string>(2);
    sparseCandidates[1] = "Ada";

    const emptyRanges = [
      { columnId: "COL_ID_SCORE", type: "inRange", filter: 5, filterTo: 5 },
      { columnId: "COL_ID_SCORE", type: "inRange", filter: 6, filterTo: 5 },
      { columnId: "COL_ID_COUNT", type: "inRange", filter: 5n, filterTo: 5n },
      { columnId: "COL_ID_COUNT", type: "inRange", filter: 6n, filterTo: 5n },
    ] as const;
    const emptyText = { columnId: "COL_ID_NAME", type: "contains", filter: "" } as const;
    const normalizedEmptyText = {
      columnId: "COL_ID_NAME",
      type: "startsWith",
      filter: "\u0301",
    } as const;
    expect(
      sanitizeClientInitialFilters(
        [
          ...emptyRanges,
          emptyText,
          normalizedEmptyText,
          {
            columnId: "COL_ID_NAME",
            type: "equals",
            filter: "Ada",
            caseSensitive: "yes",
          },
          {
            columnId: "COL_ID_NAME",
            type: "in",
            filter: ["Ada"],
            accentSensitive: 1,
          },
          { columnId: "COL_ID_NAME", type: "in", filter: sparseCandidates },
        ],
        columns,
      ),
    ).toEqual([...emptyRanges, emptyText, normalizedEmptyText]);
    const rows = [{ id: "middle", name: "Ada", score: 5, count: 5n }] as const;
    for (const range of emptyRanges) {
      expect(filterClientRows(rows, columns, [range])).toEqual([]);
    }
    expect(filterClientRows(rows, columns, [normalizedEmptyText])).toEqual(rows);

    expect(
      sanitizeClientInitialFilters(
        [
          {
            columnId: "COL_ID_NAME",
            type: "contains",
            filter: "Ada",
            caseSensitive: false,
            accentSensitive: true,
          },
          { columnId: "COL_ID_SCORE", type: "inRange", filter: 4, filterTo: 6 },
          { columnId: "COL_ID_COUNT", type: "inRange", filter: 4n, filterTo: 6n },
        ],
        columns,
      ),
    ).toHaveLength(3);
  });

  it("applies text-family operators to custom canonical text domains", () => {
    type Email = Readonly<{ readonly address: string }>;
    const emailValueType = {
      codecId: "test/email",
      codecVersion: 1,
      filterFamily: "text",
      editorFamily: "text",
      cellAlign: "start",
      editorLayout: "inline",
      defaultWidth: 180,
      decodeRuntime: (input: unknown) =>
        typeof input === "object" &&
        input !== null &&
        typeof Reflect.get(input, "address") === "string"
          ? ({ _tag: "Success", value: input as Email } as const)
          : ({ _tag: "Failure", message: "Expected email." } as const),
      equivalent: (left: Email, right: Email) => left.address === right.address,
      compare: (left: Email, right: Email) =>
        left.address === right.address ? 0 : left.address < right.address ? -1 : 1,
      formatCanonicalText: (value: Email) => value.address,
      parseCanonicalText: (text: string) =>
        ({ _tag: "Success", value: Object.freeze({ address: text }) }) as const,
      formatDisplay: (value: Email) => value.address,
      encodePersisted: (value: Email) => value.address,
      decodePersisted: (input: unknown) =>
        typeof input === "string"
          ? ({ _tag: "Success", value: Object.freeze({ address: input }) } as const)
          : ({ _tag: "Failure", message: "Expected persisted email." } as const),
    } as const;
    const columns = compileColumns([
      {
        columnId: "COL_ID_EMAIL",
        field: "email",
        headerName: "Email",
        valueType: emailValueType,
      },
    ]);
    const rows = [
      { id: "ada", email: Object.freeze({ address: "Ada@Example.com" }) },
      { id: "grace", email: Object.freeze({ address: "grace@example.com" }) },
      { id: "jose", email: Object.freeze({ address: "Jos\u00e9@Example.com" }) },
    ] as const;
    const filters = sanitizeClientInitialFilters(
      [{ columnId: "COL_ID_EMAIL", type: "contains", filter: "ADA@" }],
      columns,
    );

    expect(filters).toEqual([{ columnId: "COL_ID_EMAIL", type: "contains", filter: "ADA@" }]);
    expect(filterClientRows(rows, columns, filters).map((row) => row.id)).toEqual(["ada"]);
    const caseInsensitiveEquals = sanitizeClientInitialFilters(
      [
        {
          columnId: "COL_ID_EMAIL",
          type: "equals",
          filter: Object.freeze({ address: "ADA@EXAMPLE.COM" }),
          caseSensitive: false,
          accentSensitive: true,
        },
      ],
      columns,
    );
    expect(filterClientRows(rows, columns, caseInsensitiveEquals).map((row) => row.id)).toEqual([
      "ada",
    ]);
    const caseSensitiveEquals = sanitizeClientInitialFilters(
      [
        {
          columnId: "COL_ID_EMAIL",
          type: "equals",
          filter: Object.freeze({ address: "ADA@EXAMPLE.COM" }),
          caseSensitive: true,
        },
      ],
      columns,
    );
    expect(filterClientRows(rows, columns, caseSensitiveEquals)).toEqual([]);
    const accentInsensitiveIn = sanitizeClientInitialFilters(
      [
        {
          columnId: "COL_ID_EMAIL",
          type: "in",
          filter: [Object.freeze({ address: "Ad\u00e1@Example.com" })],
          caseSensitive: true,
          accentSensitive: false,
        },
      ],
      columns,
    );
    expect(filterClientRows(rows, columns, accentInsensitiveIn).map((row) => row.id)).toEqual([
      "ada",
    ]);
    const combiningMarkEquals = sanitizeClientInitialFilters(
      [
        {
          columnId: "COL_ID_EMAIL",
          type: "equals",
          filter: Object.freeze({ address: "Jose\u0301@Example.com" }),
          caseSensitive: true,
          accentSensitive: true,
        },
      ],
      columns,
    );
    expect(filterClientRows(rows, columns, combiningMarkEquals).map((row) => row.id)).toEqual([
      "jose",
    ]);
  });

  it("sanitizes compound filters and tracks nested column references", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const filter = {
      type: "NOT",
      condition: { columnId: "COL_ID_NAME", type: "blank" },
    };
    const [sanitized] = sanitizeClientInitialFilters([filter], columns);

    expect(sanitized).toEqual(filter);
    expect(filterReferencesColumn(sanitized, "COL_ID_NAME")).toBe(true);
    expect(filterReferencesColumn(sanitized, "COL_ID_MISSING")).toBe(false);
  });

  it("drops empty compounds and foreign structural keys from leaf filters", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
      {
        columnId: "COL_ID_SCORE",
        field: "score",
        headerName: "Score",
        valueType: "number",
      },
    ]);

    expect(sanitizeClientInitialFilters([{ type: "OR", conditions: [] }], columns)).toEqual([]);
    const [sanitized] = sanitizeClientInitialFilters(
      [
        {
          columnId: "COL_ID_NAME",
          type: "blank",
          condition: { columnId: "COL_ID_SCORE", type: "blank" },
          conditions: [{ columnId: "COL_ID_SCORE", type: "blank" }],
        },
      ],
      columns,
    );
    expect(sanitized).toEqual({ columnId: "COL_ID_NAME", type: "blank" });
    expect(filterReferencesColumn(sanitized, "COL_ID_NAME")).toBe(true);
    expect(filterReferencesColumn(sanitized, "COL_ID_SCORE")).toBe(false);
  });

  it("drops sparse compound condition arrays", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);

    expect(
      sanitizeClientInitialFilters(
        [
          { type: "AND", conditions: Array(1) },
          { type: "OR", conditions: Array(2) },
        ],
        columns,
      ),
    ).toEqual([]);
  });

  it("drops cyclic and over-depth compound filters without overflowing the stack", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const cyclic: { type: "NOT"; condition?: unknown } = { type: "NOT" };
    cyclic.condition = cyclic;
    let deep: unknown = { columnId: "COL_ID_NAME", type: "equals", filter: "Ada" };
    for (let depth = 0; depth < 1_000; depth += 1) deep = { type: "NOT", condition: deep };

    expect(() => sanitizeClientInitialFilters([cyclic, deep], columns)).not.toThrow();
    expect(sanitizeClientInitialFilters([cyclic, deep], columns)).toEqual([]);
    expect(() =>
      sanitizeClientInitialFilters([deep], columns, { rejectOverBudget: true }),
    ).toThrowError(
      "BrunoTable initialFilters expressions may contain at most 1024 nodes, nesting depth 64, and 4096 values per in operand.",
    );
  });

  it("accepts an acyclic compound filter that shares one immutable leaf", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const leaf = Object.freeze({ columnId: "COL_ID_NAME", type: "equals", filter: "Ada" });
    const shared = Object.freeze({
      type: "AND",
      conditions: Object.freeze([leaf, Object.freeze({ type: "NOT", condition: leaf })]),
    });

    const sanitized = sanitizeClientInitialFilters([shared], columns);

    expect(sanitized).toEqual([shared]);
    expect(filterClientRows([{ name: "Ada" }, { name: "Grace" }], columns, sanitized)).toEqual([]);
  });

  it("sanitizes and evaluates a deep shared filter DAG once per distinct node", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    let sourceReads = 0;
    const counted = <T extends Readonly<Record<string, unknown>>>(record: T): T =>
      new Proxy(Object.freeze(record), {
        get: (target, property, receiver) => {
          sourceReads += 1;
          if (sourceReads > 500) throw new Error("Shared filter DAG expanded exponentially.");
          return Reflect.get(target, property, receiver) as unknown;
        },
      });
    let shared: Readonly<Record<string, unknown>> = counted({
      columnId: "COL_ID_NAME",
      filter: "Ada",
      type: "equals",
    });
    const depth = 32;
    for (let index = 0; index < depth; index += 1) {
      shared = counted({ conditions: Object.freeze([shared, shared]), type: "AND" });
    }

    const sanitized = sanitizeClientInitialFilters([shared], columns);

    expect(sanitized).toHaveLength(1);
    expect(sourceReads).toBeLessThan(500);
    let sanitizedNode = sanitized[0] as Readonly<Record<string, unknown>>;
    for (let index = 0; index < depth; index += 1) {
      const conditions = sanitizedNode["conditions"] as readonly Readonly<
        Record<string, unknown>
      >[];
      expect(conditions[0]).toBe(conditions[1]);
      sanitizedNode = conditions[0]!;
    }

    let valueReads = 0;
    const predicate = createClientFilterPredicate(columns, sanitized, () => {
      valueReads += 1;
      if (valueReads > 100) throw new Error("Shared filter evaluation expanded exponentially.");
      return "Ada";
    });
    expect(predicate?.({})).toBe(true);
    expect(valueReads).toBe(1);
  });

  it("captures a nested source array once when its owner appears at different depths", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const leaf = Object.freeze({ columnId: "COL_ID_NAME", filter: "Ada", type: "equals" });
    let indexedReads = 0;
    let lengthReads = 0;
    const sourceConditions = new Proxy(Object.freeze([leaf]), {
      get: (target, property, receiver) => {
        if (property === "length") {
          lengthReads += 1;
          if (lengthReads > 1) throw new Error("Nested source array length was read twice.");
        }
        if (property === "0") {
          indexedReads += 1;
          if (indexedReads > 1) throw new Error("Nested source array was read twice.");
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const shared = Object.freeze({ conditions: sourceConditions, type: "AND" });
    const root = Object.freeze({
      conditions: Object.freeze([shared, Object.freeze({ condition: shared, type: "NOT" })]),
      type: "AND",
    });

    const sanitized = sanitizeClientInitialFilters([root], columns);

    expect(sanitized).toHaveLength(1);
    expect(indexedReads).toBe(1);
    expect(lengthReads).toBe(1);
    expect(filterClientRows([{ name: "Ada" }, { name: "Grace" }], columns, sanitized)).toEqual([]);
  });

  it("captures repeated top-level filter aliases once across independent root budgets", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const reads = { columnId: 0, filter: 0, type: 0 };
    const source = Object.defineProperties(
      {},
      {
        columnId: {
          get: () => {
            reads.columnId += 1;
            return "COL_ID_NAME";
          },
        },
        filter: {
          get: () => {
            reads.filter += 1;
            return "Ada";
          },
        },
        type: {
          get: () => {
            reads.type += 1;
            return "equals";
          },
        },
      },
    );

    const sanitized = sanitizeClientInitialFilters([source, source], columns);

    expect(sanitized).toHaveLength(2);
    expect(reads).toEqual({ columnId: 1, filter: 1, type: 1 });
    expect(filterClientRows([{ name: "Ada" }, { name: "Grace" }], columns, sanitized)).toEqual([
      { name: "Ada" },
    ]);
  });

  it("captures one physical array once when aliases cross conditions and operand roles", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const leaf = Object.freeze({ columnId: "COL_ID_NAME", filter: "Ada", type: "equals" });
    let indexedReads = 0;
    let lengthReads = 0;
    const sharedArray = new Proxy(Object.freeze([leaf]), {
      get: (target, property, receiver) => {
        if (property === "length") {
          lengthReads += 1;
          if (lengthReads > 1) throw new Error("Cross-role array length was read twice.");
        }
        if (property === "0") {
          indexedReads += 1;
          if (indexedReads > 1) throw new Error("Cross-role array entry was read twice.");
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    const sanitized = sanitizeClientInitialFilters(
      [
        { conditions: sharedArray, type: "AND" },
        { columnId: "COL_ID_NAME", filter: sharedArray, type: "in" },
      ],
      columns,
    );

    expect(sanitized).toHaveLength(1);
    expect(lengthReads).toBe(1);
    expect(indexedReads).toBe(1);
  });

  it("propagates internal Value Type decoder failures", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const throwingColumns = columns.map((column) => ({
      ...column,
      semantics: Object.freeze({
        ...column.semantics,
        decodeRuntime: () => {
          throw new Error("Decoder implementation failed.");
        },
      }),
    }));

    expect(() =>
      sanitizeClientInitialFilters(
        [{ columnId: "COL_ID_NAME", filter: "Ada", type: "equals" }],
        throwingColumns,
      ),
    ).toThrow("Decoder implementation failed.");
  });

  it("drops a filter whose properties cannot be read", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const unreadable = new Proxy<Record<string, unknown>>(
      {},
      {
        get: (target, property, receiver) => {
          if (property === "type") throw new Error("Unreadable filter type.");
          return Reflect.get(target, property, receiver) as unknown;
        },
      },
    );
    const valid = Object.freeze({ columnId: "COL_ID_NAME", type: "equals", filter: "Ada" });

    const sanitized = sanitizeClientInitialFilters([unreadable, valid], columns);

    expect(sanitized).toEqual([valid]);
  });

  it("captures each relevant filter property once before validation", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const reads = {
      accentSensitive: 0,
      caseSensitive: 0,
      columnId: 0,
      filter: 0,
      type: 0,
    };
    const stateful = Object.defineProperties<Record<string, unknown>>(
      {},
      {
        accentSensitive: {
          enumerable: true,
          get: () => {
            reads.accentSensitive += 1;
            return reads.accentSensitive === 1 ? false : true;
          },
        },
        caseSensitive: {
          enumerable: true,
          get: () => {
            reads.caseSensitive += 1;
            return reads.caseSensitive === 1 ? false : true;
          },
        },
        columnId: {
          enumerable: true,
          get: () => {
            reads.columnId += 1;
            return reads.columnId === 1 ? "COL_ID_NAME" : "COL_ID_MISSING";
          },
        },
        filter: {
          enumerable: true,
          get: () => {
            reads.filter += 1;
            return reads.filter === 1 ? "Ada" : "Grace";
          },
        },
        type: {
          enumerable: true,
          get: () => {
            reads.type += 1;
            return reads.type === 1 ? "equals" : "blank";
          },
        },
      },
    );

    const sanitized = sanitizeClientInitialFilters([stateful], columns);

    expect(reads).toEqual({
      accentSensitive: 1,
      caseSensitive: 1,
      columnId: 1,
      filter: 1,
      type: 1,
    });
    expect(sanitized).toEqual([
      {
        accentSensitive: false,
        caseSensitive: false,
        columnId: "COL_ID_NAME",
        filter: "Ada",
        type: "equals",
      },
    ]);
    expect(filterClientRows([{ name: "Ada" }, { name: "Grace" }], columns, sanitized)).toEqual([
      { name: "Ada" },
    ]);
  });

  it("owns admitted filter records and arrays before later evaluation", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    let denyFurtherReads = false;
    const operands = new Proxy(Object.freeze(["Ada"]), {
      get: (target, property, receiver) => {
        if (denyFurtherReads && property === "0") throw new Error("Operand read escaped.");
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const leaf = Object.freeze(
      Object.defineProperties<Record<string, unknown>>(
        {},
        {
          columnId: {
            enumerable: true,
            get: () => {
              if (denyFurtherReads) throw new Error("Column read escaped.");
              return "COL_ID_NAME";
            },
          },
          filter: {
            enumerable: true,
            get: () => {
              if (denyFurtherReads) throw new Error("Filter read escaped.");
              return operands;
            },
          },
          type: {
            enumerable: true,
            get: () => {
              if (denyFurtherReads) throw new Error("Type read escaped.");
              return "in";
            },
          },
        },
      ),
    );
    const conditions = new Proxy(Object.freeze([leaf]), {
      get: (target, property, receiver) => {
        if (denyFurtherReads && property === "0") throw new Error("Condition read escaped.");
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const compound = Object.freeze({ conditions, type: "AND" });

    const sanitized = sanitizeClientInitialFilters([compound], columns);
    denyFurtherReads = true;

    expect(Object.is(sanitized[0], compound)).toBe(false);
    expect(() =>
      filterClientRows([{ name: "Ada" }, { name: "Grace" }], columns, sanitized),
    ).not.toThrow();
    expect(filterClientRows([{ name: "Ada" }, { name: "Grace" }], columns, sanitized)).toEqual([
      { name: "Ada" },
    ]);
  });

  it("bounds root filter reads and preserves valid siblings around unreadable entries", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const root = Array<unknown>(1_000_000);
    root[0] = { columnId: "COL_ID_NAME", type: "startsWith", filter: "A" };
    root[1] = { columnId: "COL_ID_NAME", type: "equals", filter: "blocked" };
    root[2] = { columnId: "COL_ID_NAME", type: "notBlank" };
    let indexedProbes = 0;
    let ownKeyReads = 0;
    const countIndexedProbe = (property: PropertyKey) => {
      if (typeof property !== "string" || !/^\d+$/u.test(property)) return;
      indexedProbes += 1;
      if (indexedProbes > 1_024) throw new Error("Unbounded indexed root traversal.");
    };
    const hostileRoot = new Proxy(root, {
      get: (target, property, receiver) => {
        countIndexedProbe(property);
        if (property === "1") throw new Error("Unreadable root entry.");
        return Reflect.get(target, property, receiver) as unknown;
      },
      getOwnPropertyDescriptor: (target, property) => {
        countIndexedProbe(property);
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      has: (target, property) => {
        countIndexedProbe(property);
        return Reflect.has(target, property);
      },
      ownKeys: (target) => {
        ownKeyReads += 1;
        return Reflect.ownKeys(target);
      },
    });

    const sanitized = sanitizeClientInitialFilters(hostileRoot, columns);

    expect(sanitized).toEqual([
      { columnId: "COL_ID_NAME", type: "startsWith", filter: "A" },
      { columnId: "COL_ID_NAME", type: "notBlank" },
    ]);
    expect(indexedProbes).toBeLessThanOrEqual(3);
    expect(ownKeyReads).toBe(1);
  });

  it("caps hostile root filter materialization without limiting ordinary root collections", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const hostileRoot = Array.from({ length: 16_385 }, (_, index) => ({
      columnId: "COL_ID_NAME",
      filter: String(index),
      type: "equals",
    }));

    expect(sanitizeClientInitialFilters(hostileRoot, columns)).toEqual([]);
    expect(() =>
      sanitizeClientInitialFilters(hostileRoot, columns, { rejectOverBudget: true }),
    ).toThrow(/root contains more than 16384 entries/u);
    expect(sanitizeClientInitialFilters(hostileRoot.slice(0, 1_025), columns)).toHaveLength(1_025);

    const metadataRoot: unknown[] = [];
    for (let index = 0; index < 16_385; index += 1) {
      Object.defineProperty(metadataRoot, `metadata-${index}`, {
        configurable: true,
        value: index,
      });
    }
    expect(sanitizeClientInitialFilters(metadataRoot, columns)).toEqual([]);
    expect(() =>
      sanitizeClientInitialFilters(metadataRoot, columns, { rejectOverBudget: true }),
    ).toThrow(/root contains more than 16384 entries/u);
  });

  it("bounds root order reads and preserves valid siblings around unreadable entries", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const root = Array<unknown>(1_000_000);
    root[0] = { columnId: "COL_ID_NAME", direction: "desc" };
    root[1] = { columnId: "COL_ID_NAME", direction: "asc" };
    let indexedProbes = 0;
    let ownKeyReads = 0;
    const countIndexedProbe = (property: PropertyKey) => {
      if (typeof property !== "string" || !/^\d+$/u.test(property)) return;
      indexedProbes += 1;
      if (indexedProbes > 1_024) throw new Error("Unbounded indexed root traversal.");
    };
    const hostileRoot = new Proxy(root, {
      get: (target, property, receiver) => {
        countIndexedProbe(property);
        if (property === "0") throw new Error("Unreadable root entry.");
        return Reflect.get(target, property, receiver) as unknown;
      },
      getOwnPropertyDescriptor: (target, property) => {
        countIndexedProbe(property);
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      has: (target, property) => {
        countIndexedProbe(property);
        return Reflect.has(target, property);
      },
      ownKeys: (target) => {
        ownKeyReads += 1;
        return Reflect.ownKeys(target);
      },
    });

    expect(sanitizeClientOrderBy(hostileRoot as never, columns)).toEqual([
      { columnId: "COL_ID_NAME", direction: "asc" },
    ]);
    expect(indexedProbes).toBeLessThanOrEqual(2);
    expect(ownKeyReads).toBe(1);

    const unreadableLength = new Proxy([], {
      get: (target, property, receiver) => {
        if (property === "length") throw new Error("Unreadable root length.");
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    expect(() => sanitizeClientInitialOrderBy(unreadableLength as never, columns)).toThrow(
      /no valid sortable column/u,
    );
  });

  it("preserves public query collections larger than the hostile-input recursion depth", () => {
    const columnCount = 1_025;
    const columns = compileColumns(
      Array.from({ length: columnCount }, (_, index) => ({
        columnId: `COL_ID_FIELD_${index}`,
        field: `field_${index}`,
        headerName: `Field ${index}`,
        valueType: "number" as const,
      })),
    );
    const orderBy = Array.from({ length: columnCount }, (_, index) => ({
      columnId: `COL_ID_FIELD_${index}`,
      direction: "asc" as const,
    }));
    const filters = Array.from({ length: columnCount }, (_, index) => ({
      columnId: `COL_ID_FIELD_${index}`,
      filter: index,
      type: "equals",
    }));

    expect(sanitizeClientInitialOrderBy(orderBy, columns)).toHaveLength(columnCount);
    expect(sanitizeClientInitialFilters(filters, columns)).toHaveLength(columnCount);

    const [inFilter] = sanitizeClientInitialFilters(
      [
        {
          columnId: "COL_ID_FIELD_0",
          filter: Array.from({ length: columnCount }, (_, index) => index),
          type: "in",
        },
      ],
      columns,
    );
    expect((inFilter as { readonly filter: readonly unknown[] }).filter).toHaveLength(columnCount);
  });

  it("bounds each in operand before materializing hostile values", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_SCORE",
        field: "score",
        headerName: "Score",
        valueType: "number",
      },
    ]);
    const atLimit = sanitizeClientInitialFilters(
      [
        {
          columnId: "COL_ID_SCORE",
          filter: Array.from({ length: 4_096 }, (_, index) => index),
          type: "in",
        },
      ],
      columns,
    );
    expect(
      (atLimit[0] as { readonly filter: readonly unknown[] } | undefined)?.filter,
    ).toHaveLength(4_096);

    const ownKeys = vi.fn(Reflect.ownKeys);
    const overBudgetOperand = new Proxy(
      Array.from({ length: 4_097 }, (_, index) => index),
      { ownKeys },
    );
    const filter = {
      columnId: "COL_ID_SCORE",
      filter: overBudgetOperand,
      type: "in",
    };

    expect(sanitizeClientInitialFilters([filter], columns)).toEqual([]);
    expect(ownKeys).not.toHaveBeenCalled();
    expect(() =>
      sanitizeClientInitialFilters([filter], columns, { rejectOverBudget: true }),
    ).toThrowError(
      "BrunoTable initialFilters expressions may contain at most 1024 nodes, nesting depth 64, and 4096 values per in operand.",
    );
    expect(ownKeys).not.toHaveBeenCalled();
  });

  it("bounds text operands at the initial-filter boundary", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const overlong = "x".repeat(1_025);

    expect(
      sanitizeClientInitialFilters(
        [{ columnId: "COL_ID_NAME", filter: overlong, type: "equals" }],
        columns,
      ),
    ).toEqual([]);
    expect(
      sanitizeClientInitialFilters(
        [{ columnId: "COL_ID_NAME", filter: ["ok", overlong], type: "in" }],
        columns,
      ),
    ).toEqual([]);
    expect(() =>
      sanitizeClientInitialFilters(
        [{ columnId: "COL_ID_NAME", filter: overlong, type: "contains" }],
        columns,
        { rejectOverBudget: true },
      ),
    ).toThrow();

    const numericColumns = compileColumns([
      {
        columnId: "COL_ID_SCORE",
        field: "score",
        headerName: "Score",
        valueType: "number",
      },
    ]);
    expect(() =>
      sanitizeClientInitialFilters(
        [{ columnId: "COL_ID_SCORE", filter: overlong, type: "equals" }],
        numericColumns,
        { rejectOverBudget: true },
      ),
    ).toThrow();
  });

  it("rejects overlong custom operands before invoking the decoder", () => {
    const decodeRuntime = vi.fn((input: unknown) => ({ _tag: "Success" as const, value: input }));
    const customTextValueType = {
      codecId: "test/bounded-text",
      codecVersion: 1,
      filterFamily: "text",
      editorFamily: "text",
      cellAlign: "start",
      editorLayout: "inline",
      defaultWidth: 160,
      decodeRuntime,
      equivalent: (left: unknown, right: unknown) => Object.is(left, right),
      compare: () => 0,
      formatCanonicalText: (value: unknown) => String(value),
      parseCanonicalText: (text: string) => ({ _tag: "Success" as const, value: text }),
      formatDisplay: (value: unknown) => String(value),
      encodePersisted: (value: unknown) => String(value),
      decodePersisted: (input: unknown) => ({ _tag: "Success" as const, value: input }),
    } as const;
    const columns = compileColumns([
      {
        columnId: "COL_ID_CUSTOM_TEXT",
        field: "value",
        headerName: "Value",
        valueType: customTextValueType,
      },
    ]);

    expect(
      sanitizeClientInitialFilters(
        [{ columnId: "COL_ID_CUSTOM_TEXT", filter: "x".repeat(1_025), type: "equals" }],
        columns,
      ),
    ).toEqual([]);
    expect(decodeRuntime).not.toHaveBeenCalled();
  });

  it("admits configured Select values beyond the authored text bound", () => {
    const status = "x".repeat(1_025);
    const selectColumn = Reflect.apply(BrunoTableSelectColumn, undefined, [
      {
        columnId: "COL_ID_STATUS",
        field: "status",
        headerName: "Status",
        options: [status],
      },
    ]) as Readonly<Record<string, unknown>>;
    const columns = compileColumns([selectColumn]);

    expect(
      sanitizeClientInitialFilters(
        [{ columnId: "COL_ID_STATUS", filter: status, type: "equals" }],
        columns,
        { rejectOverBudget: true },
      ),
    ).toEqual([{ columnId: "COL_ID_STATUS", filter: status, type: "equals" }]);
  });

  it("does not re-decode an already compiled long Select option", () => {
    const status = "x".repeat(1_025);
    const decodeRuntime = vi.fn((input: unknown) => ({ _tag: "Success" as const, value: input }));
    const selectValueType = {
      codecId: "test/select",
      codecVersion: 1,
      filterFamily: "select",
      editorFamily: "select",
      cellAlign: "start",
      editorLayout: "fullWidth",
      defaultWidth: 160,
      decodeRuntime,
      equivalent: (left: unknown, right: unknown) => Object.is(left, right),
      compare: () => 0,
      formatCanonicalText: (value: unknown) => String(value),
      parseCanonicalText: (text: string) => ({ _tag: "Success" as const, value: text }),
      formatDisplay: (value: unknown) => String(value),
      encodePersisted: (value: unknown) => String(value),
      decodePersisted: (input: unknown) => ({ _tag: "Success" as const, value: input }),
    } as const;
    const columns = compileColumns([
      {
        columnId: "COL_ID_CUSTOM_SELECT",
        field: "status",
        headerName: "Status",
        valueType: selectValueType,
        options: [status],
      } as never,
    ]);
    const compileDecodeCalls = decodeRuntime.mock.calls.length;

    expect(
      sanitizeClientInitialFilters(
        [{ columnId: "COL_ID_CUSTOM_SELECT", filter: status, type: "equals" }],
        columns,
      ),
    ).toEqual([{ columnId: "COL_ID_CUSTOM_SELECT", filter: status, type: "equals" }]);
    expect(decodeRuntime).toHaveBeenCalledTimes(compileDecodeCalls);
  });

  it("captures admitted dense operands without enumerating unrelated own properties", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_SCORE",
        field: "score",
        headerName: "Score",
        valueType: "number",
      },
    ]);
    const values = [1] as number[] & { noise?: string };
    values.noise = "unrelated";
    const ownKeys = vi.fn((): never => {
      throw new Error("Dense operand own keys must not be enumerated.");
    });
    const operand = new Proxy(values, { ownKeys });

    const sanitized = sanitizeClientInitialFilters(
      [{ columnId: "COL_ID_SCORE", filter: operand, type: "in" }],
      columns,
    );

    expect((sanitized[0] as { readonly filter: readonly unknown[] }).filter).toEqual([1]);
    expect(ownKeys).not.toHaveBeenCalled();
  });

  it("rejects a compound filter over the total node budget before materializing conditions", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const leaf = Object.freeze({ columnId: "COL_ID_NAME", filter: "Ada", type: "equals" });
    const ownKeys = vi.fn(Reflect.ownKeys);
    const overBudgetConditions = new Proxy(
      Array.from({ length: 1_024 }, () => leaf),
      { ownKeys },
    );

    expect(
      sanitizeClientInitialFilters([{ conditions: overBudgetConditions, type: "AND" }], columns),
    ).toEqual([]);
    expect(ownKeys).not.toHaveBeenCalled();
    expect(() =>
      sanitizeClientInitialFilters([{ conditions: overBudgetConditions, type: "AND" }], columns, {
        rejectOverBudget: true,
      }),
    ).toThrowError(
      "BrunoTable initialFilters expressions may contain at most 1024 nodes, nesting depth 64, and 4096 values per in operand.",
    );

    expect(
      sanitizeClientInitialFilters(
        [{ conditions: Array.from({ length: 1_023 }, () => leaf), type: "AND" }],
        columns,
      ),
    ).toHaveLength(1);
  });

  it("applies the filter-node budget across nested condition arrays", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const leaf = Object.freeze({ columnId: "COL_ID_NAME", filter: "Ada", type: "equals" });
    const lastOwnKeys = vi.fn(Reflect.ownKeys);
    const groups = Array.from({ length: 32 }, (_, index) => ({
      conditions:
        index === 30
          ? new Proxy(
              Array.from({ length: 32 }, () => leaf),
              { ownKeys: lastOwnKeys },
            )
          : Array.from({ length: 32 }, () => leaf),
      type: "AND",
    }));

    expect(sanitizeClientInitialFilters([{ conditions: groups, type: "AND" }], columns)).toEqual(
      [],
    );
    expect(lastOwnKeys).not.toHaveBeenCalled();
  });

  it("reuses already-sanitized filter references for an equivalent column plan", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const first = sanitizeClientInitialFilters(
      [
        {
          type: "AND",
          conditions: [
            { columnId: "COL_ID_NAME", type: "startsWith", filter: "A" },
            { columnId: "COL_ID_NAME", type: "notBlank" },
          ],
        },
      ],
      columns,
    );
    const replacement = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Display name",
        valueType: "text",
        width: 240,
      },
    ]);

    expect(sanitizeClientInitialFilters(first, replacement)).toBe(first);
  });
});
