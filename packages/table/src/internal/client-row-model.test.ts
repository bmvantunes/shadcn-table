import { afterEach, describe, expect, it, vi } from "vitest";

import { compileColumns } from "./compile-columns";
import {
  filterClientRows,
  filterReferencesColumn,
  sanitizeClientInitialFilters,
  sanitizeClientInitialOrderBy,
  sanitizeClientOrderBy,
} from "./client-row-model";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Client row model", () => {
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

    expect(() => sanitizeClientInitialOrderBy(undefined, columns)).toThrow(/is required/u);
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

  it("retains empty ranges and drops invalid text operands, sensitivities, and sparse arrays", () => {
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
    expect(
      sanitizeClientInitialFilters(
        [
          ...emptyRanges,
          { columnId: "COL_ID_NAME", type: "contains", filter: "" },
          { columnId: "COL_ID_NAME", type: "startsWith", filter: "\u0301" },
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
    ).toEqual(emptyRanges);
    const rows = [{ id: "middle", name: "Ada", score: 5, count: 5n }] as const;
    for (const range of emptyRanges) {
      expect(filterClientRows(rows, columns, [range])).toEqual([]);
    }

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
