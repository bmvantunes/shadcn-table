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
