import { describe, expect, it, vi } from "vitest";

import type { BrunoTableColumns, BrunoTableValueType } from "../public-types";
import { BrunoTableSelectColumn } from "../column-helpers";
import { compileColumns } from "./compile-columns";
import {
  BRUNO_TABLE_PERSISTED_STATE_VERSION,
  createBrunoTableGridPreferences,
  createBrunoTablePersistedState,
} from "./grid-preferences";
import { BRUNO_TABLE_CLIENT_FILTER_MAX_INPUT_ENTRIES } from "./grid-query";

const accountEncodePersisted = vi.fn((value: Readonly<{ readonly address: string }>) => ({
  account: value.address,
}));

const accountValueType: BrunoTableValueType<
  Readonly<{ readonly address: string }>,
  "equality",
  "text"
> = Object.freeze({
  codecId: "test/account",
  codecVersion: 3,
  filterFamily: "equality",
  editorFamily: "text",
  cellAlign: "start",
  editorLayout: "inline",
  defaultWidth: 180,
  decodeRuntime: (input) =>
    typeof input === "object" && input !== null && "address" in input
      ? { _tag: "Success", value: { address: String(input.address) } }
      : { _tag: "Failure", message: "Expected account." },
  equivalent: (left, right) => left.address === right.address,
  compare: (left, right) =>
    left.address === right.address ? 0 : left.address < right.address ? -1 : 1,
  formatCanonicalText: (value) => value.address,
  parseCanonicalText: (text) => ({ _tag: "Success", value: { address: text } }),
  formatDisplay: (value) => value.address,
  encodePersisted: accountEncodePersisted,
  decodePersisted: (input) =>
    typeof input === "object" &&
    input !== null &&
    "account" in input &&
    typeof input.account === "string"
      ? { _tag: "Success", value: { address: input.account } }
      : { _tag: "Failure", message: "Invalid persisted account." },
});

function isStringArray(input: unknown): input is string[] {
  return Array.isArray(input) && input.every((value) => typeof value === "string");
}

const stringTupleValueType: BrunoTableValueType<readonly string[], "equality", "text"> =
  Object.freeze({
    codecId: "test/string-tuple",
    codecVersion: 1,
    filterFamily: "equality",
    editorFamily: "text",
    cellAlign: "start",
    editorLayout: "inline",
    defaultWidth: 160,
    decodeRuntime: (input) =>
      isStringArray(input)
        ? { _tag: "Success", value: Object.freeze(Array.from(input)) }
        : { _tag: "Failure", message: "Expected a string tuple." },
    equivalent: (left, right) =>
      left.length === right.length && left.every((value, index) => value === right[index]),
    compare: (left, right) => {
      const leftText = JSON.stringify(left);
      const rightText = JSON.stringify(right);
      return leftText === rightText ? 0 : leftText < rightText ? -1 : 1;
    },
    formatCanonicalText: (value) => JSON.stringify(value),
    parseCanonicalText: (text) => {
      try {
        const parsed: unknown = JSON.parse(text);
        return isStringArray(parsed)
          ? { _tag: "Success", value: Object.freeze(Array.from(parsed)) }
          : { _tag: "Failure", message: "Expected a string tuple." };
      } catch {
        return { _tag: "Failure", message: "Expected a string tuple." };
      }
    },
    formatDisplay: (value) => value.join(", "),
    encodePersisted: (value) => Object.freeze(Array.from(value)),
    decodePersisted: (input) =>
      isStringArray(input)
        ? { _tag: "Success", value: Object.freeze(Array.from(input)) }
        : { _tag: "Failure", message: "Expected a persisted string tuple." },
  });

type PreferenceRow = Readonly<{
  name: string;
  quantity: bigint;
  account: Readonly<{ readonly address: string }>;
  status: "open" | "closed";
  score: number;
}>;

const columnDefinitions = [
  {
    columnId: "COL_ID_NAME",
    field: "name",
    headerName: "Name",
    valueType: "text",
    width: 120,
    pinned: "start",
  },
  {
    columnId: "COL_ID_QUANTITY",
    field: "quantity",
    headerName: "Quantity",
    valueType: "bigint",
    width: 140,
  },
  {
    columnId: "COL_ID_ACCOUNT",
    field: "account",
    headerName: "Account",
    valueType: accountValueType,
    width: 180,
  },
  BrunoTableSelectColumn({
    columnId: "COL_ID_STATUS",
    field: "status",
    headerName: "Status",
    options: ["open", "closed"] as const,
  }),
  {
    columnId: "COL_ID_SCORE",
    field: "score",
    headerName: "Score",
    valueType: "number",
    width: 140,
  },
] satisfies BrunoTableColumns<PreferenceRow>;

const columns = compileColumns(columnDefinitions);

const initialOrderBy = Object.freeze([
  Object.freeze({ columnId: "COL_ID_NAME", direction: "asc" as const }),
]);

describe("Grid Preferences", () => {
  it("round-trips native exact operands through the compiled codec and JSON", () => {
    const preferences = createBrunoTableGridPreferences({
      tableId: "TABLE_ID_ORDERS",
      columns,
      initialFilters: [
        { columnId: "COL_ID_QUANTITY", type: "greaterThan", filter: 9_007_199_254_740_993n },
        { columnId: "COL_ID_ACCOUNT", type: "equals", filter: { address: "acct-42" } },
        { columnId: "COL_ID_STATUS", type: "equals", filter: "closed" },
        { columnId: "COL_ID_SCORE", type: "equals", filter: 1e21 },
      ],
      initialOrderBy,
    });

    const snapshot = createBrunoTablePersistedState(preferences);
    const json = JSON.stringify(snapshot);
    expect(json).toContain('"codecId":"@bruno/table/bigint"');
    expect(json).toContain('"value":"9007199254740993"');
    expect(json).toContain('"codecId":"test/account"');
    expect(json).toContain('"codecId":"@bruno/table/select"');
    expect(json).toContain('"codecId":"@bruno/table/number"');
    expect(json).toContain('"value":"1e+21"');

    const restored = createBrunoTableGridPreferences({
      tableId: "TABLE_ID_ORDERS",
      columns,
      initialFilters: [],
      initialOrderBy,
      initialPersistedState: JSON.parse(json),
    });
    expect(restored.filters).toEqual([
      { columnId: "COL_ID_QUANTITY", type: "greaterThan", filter: 9_007_199_254_740_993n },
      { columnId: "COL_ID_ACCOUNT", type: "equals", filter: { address: "acct-42" } },
      { columnId: "COL_ID_STATUS", type: "equals", filter: "closed" },
      { columnId: "COL_ID_SCORE", type: "equals", filter: 1e21 },
    ]);
  });

  it("round-trips a scalar array-valued custom operand without treating it as in", () => {
    const tupleColumns = compileColumns([
      {
        columnId: "COL_ID_TAGS",
        field: "tags",
        headerName: "Tags",
        valueType: stringTupleValueType,
      },
    ]);
    const snapshot = createBrunoTablePersistedState(
      createBrunoTableGridPreferences({
        tableId: "TABLE_ID_ARRAY_OPERAND",
        columns: tupleColumns,
        initialFilters: [{ columnId: "COL_ID_TAGS", type: "equals", filter: ["exact", "tuple"] }],
        initialOrderBy: [{ columnId: "COL_ID_TAGS", direction: "asc" }],
      }),
    );
    const restored = createBrunoTableGridPreferences({
      tableId: "TABLE_ID_ARRAY_OPERAND",
      columns: tupleColumns,
      initialFilters: [],
      initialOrderBy: [{ columnId: "COL_ID_TAGS", direction: "asc" }],
      initialPersistedState: JSON.parse(JSON.stringify(snapshot)),
    });

    expect(restored.filters).toEqual([
      { columnId: "COL_ID_TAGS", type: "equals", filter: ["exact", "tuple"] },
    ]);
  });

  it("preserves an own __proto__ key in a custom JSON-safe codec payload", () => {
    const protoValueType: BrunoTableValueType<string, "equality", "text"> = Object.freeze({
      ...accountValueType,
      codecId: "test/proto-key",
      codecVersion: 1,
      decodeRuntime: (input) =>
        typeof input === "string"
          ? { _tag: "Success", value: input }
          : { _tag: "Failure", message: "Expected text." },
      equivalent: (left, right) => left === right,
      compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
      formatCanonicalText: (value) => value,
      parseCanonicalText: (text) => ({ _tag: "Success", value: text }),
      formatDisplay: (value) => value,
      encodePersisted: (value) => JSON.parse(`{"__proto__":{"value":${JSON.stringify(value)}}}`),
      decodePersisted: (input) => {
        const descriptor =
          typeof input === "object" && input !== null
            ? Object.getOwnPropertyDescriptor(input, "__proto__")
            : undefined;
        const payload = descriptor?.value;
        return typeof payload === "object" && payload !== null && "value" in payload
          ? { _tag: "Success", value: String(payload.value) }
          : { _tag: "Failure", message: "Expected an own __proto__ payload." };
      },
    });
    const protoColumns = compileColumns([
      {
        columnId: "COL_ID_PROTO",
        field: "name",
        headerName: "Proto",
        valueType: protoValueType,
      },
    ]);
    const snapshot = createBrunoTablePersistedState(
      createBrunoTableGridPreferences({
        tableId: "TABLE_ID_PROTO",
        columns: protoColumns,
        initialFilters: [{ columnId: "COL_ID_PROTO", type: "equals", filter: "exact" }],
        initialOrderBy: [{ columnId: "COL_ID_PROTO", direction: "asc" }],
      }),
    );

    const restored = createBrunoTableGridPreferences({
      tableId: "TABLE_ID_PROTO",
      columns: protoColumns,
      initialFilters: [],
      initialOrderBy: [{ columnId: "COL_ID_PROTO", direction: "asc" }],
      initialPersistedState: JSON.parse(JSON.stringify(snapshot)),
    });
    expect(restored.filters).toEqual([
      { columnId: "COL_ID_PROTO", type: "equals", filter: "exact" },
    ]);
  });

  it("drops incompatible versions, table identities, codecs, operators, and malformed entries", () => {
    const baseline = [{ columnId: "COL_ID_NAME", type: "equals", filter: "baseline" }];
    const valid = createBrunoTablePersistedState(
      createBrunoTableGridPreferences({
        tableId: "TABLE_ID_ORDERS",
        columns,
        initialFilters: [{ columnId: "COL_ID_QUANTITY", type: "equals", filter: 42n }],
        initialOrderBy,
      }),
    );

    for (const candidate of [
      { ...valid, version: BRUNO_TABLE_PERSISTED_STATE_VERSION + 1 },
      { ...valid, tableId: "TABLE_ID_OTHER" },
      null,
      [],
    ]) {
      const restored = createBrunoTableGridPreferences({
        tableId: "TABLE_ID_ORDERS",
        columns,
        initialFilters: baseline,
        initialOrderBy,
        initialPersistedState: candidate,
      });
      expect(restored.filters).toEqual(baseline);
    }

    const validFilters = valid["filters"];
    expect(Array.isArray(validFilters)).toBe(true);
    const filter = Array.isArray(validFilters) ? validFilters[0] : undefined;
    expect(filter).toBeDefined();
    for (const tampered of [
      { ...filter, codecId: "test/stale" },
      { ...filter, codecVersion: 999 },
      { ...filter, type: "contains" },
      { ...filter, columnId: "COL_ID_REMOVED" },
      { ...filter, filter: { $brunoTableValue: "bigint", version: 1, value: "1.5" } },
    ]) {
      const restored = createBrunoTableGridPreferences({
        tableId: "TABLE_ID_ORDERS",
        columns,
        initialFilters: baseline,
        initialOrderBy,
        initialPersistedState: { ...valid, filters: [tampered] },
      });
      expect(restored.filters).toEqual([]);
    }

    const hostileLayout = {
      ...valid,
      columnWidths: Object.defineProperty({}, "COL_ID_NAME", {
        enumerable: true,
        get: () => {
          throw new Error("hostile width getter");
        },
      }),
    };
    expect(() =>
      createBrunoTableGridPreferences({
        tableId: "TABLE_ID_ORDERS",
        columns,
        initialFilters: baseline,
        initialOrderBy,
        initialPersistedState: hostileLayout,
      }),
    ).not.toThrow();
  });

  it("retains baselines for malformed preference slices and bounds hostile filter input", () => {
    const baselineFilters = [{ columnId: "COL_ID_NAME", type: "equals", filter: "baseline" }];
    const baseline = createBrunoTablePersistedState(
      createBrunoTableGridPreferences({
        tableId: "TABLE_ID_ORDERS",
        columns,
        initialFilters: [],
        initialOrderBy,
      }),
    );
    const invalidFilters = Object.defineProperty([], 0, {
      enumerable: true,
      get: () => {
        throw new Error("hostile persisted filter getter");
      },
    });
    Reflect.set(invalidFilters, "length", 1);

    for (const filters of [
      {},
      invalidFilters,
      Array.from({ length: BRUNO_TABLE_CLIENT_FILTER_MAX_INPUT_ENTRIES + 1 }, () => null),
    ]) {
      const restored = createBrunoTableGridPreferences({
        tableId: "TABLE_ID_ORDERS",
        columns,
        initialFilters: baselineFilters,
        initialOrderBy,
        initialPersistedState: { ...baseline, filters },
      });
      expect(restored.filters).toEqual(baselineFilters);
    }
  });

  it("rejects root snapshot accessors without invoking them", () => {
    const versionGetter = vi.fn(() => BRUNO_TABLE_PERSISTED_STATE_VERSION);
    const hostileRoot = Object.defineProperties(
      {},
      {
        version: { enumerable: true, get: versionGetter },
        tableId: { enumerable: true, value: "TABLE_ID_ORDERS" },
      },
    );
    const baselineFilters = [{ columnId: "COL_ID_NAME", type: "equals", filter: "baseline" }];

    const restored = createBrunoTableGridPreferences({
      tableId: "TABLE_ID_ORDERS",
      columns,
      initialFilters: baselineFilters,
      initialOrderBy,
      initialPersistedState: hostileRoot,
    });

    expect(versionGetter).not.toHaveBeenCalled();
    expect(restored.filters).toEqual(baselineFilters);
  });

  it("does not install an order override for an absent or malformed persisted order", () => {
    const baseline = createBrunoTablePersistedState(
      createBrunoTableGridPreferences({
        tableId: "TABLE_ID_ORDER_BASELINE",
        columns,
        initialFilters: [],
        initialOrderBy,
      }),
    );
    for (const columnOrder of [undefined, {}]) {
      const restored = createBrunoTableGridPreferences({
        tableId: "TABLE_ID_ORDER_BASELINE",
        columns,
        initialFilters: [],
        initialOrderBy,
        initialPersistedState: { ...baseline, columnOrder },
      });
      expect(restored.columnLayout.orderOverride).toBeUndefined();
    }
  });

  it("bounds hostile persisted column-order traversal before reading entries", () => {
    let descriptorCalls = 0;
    let lengthReads = 0;
    const overlongOrder = new Proxy(
      Array.from({ length: 10_000 }, () => "COL_ID_REMOVED"),
      {
        get: (target, key, receiver) => {
          if (key !== "length") return Reflect.get(target, key, receiver);
          lengthReads += 1;
          return lengthReads === 1 ? 10_000 : 0;
        },
        getOwnPropertyDescriptor: (target, key) => {
          descriptorCalls += 1;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    const restored = createBrunoTableGridPreferences({
      tableId: "TABLE_ID_BOUNDED_LAYOUT",
      columns,
      initialFilters: [],
      initialOrderBy,
      initialPersistedState: {
        version: BRUNO_TABLE_PERSISTED_STATE_VERSION,
        tableId: "TABLE_ID_BOUNDED_LAYOUT",
        filters: [],
        orderBy: initialOrderBy,
        groupBy: [],
        groupOrderBy: [],
        columnOrder: overlongOrder,
        columnVisibility: {},
        columnWidths: {},
        columnPinning: { start: [], end: [] },
      },
    });

    expect(descriptorCalls).toBe(0);
    expect(lengthReads).toBe(1);
    expect(restored.columnLayout.orderOverride).toBeUndefined();

    const negativeLengthOrder = new Proxy([], {
      get: (target, key, receiver) => (key === "length" ? -1 : Reflect.get(target, key, receiver)),
    });
    const negativeLength = createBrunoTableGridPreferences({
      tableId: "TABLE_ID_BOUNDED_LAYOUT",
      columns,
      initialFilters: [],
      initialOrderBy,
      initialPersistedState: {
        version: BRUNO_TABLE_PERSISTED_STATE_VERSION,
        tableId: "TABLE_ID_BOUNDED_LAYOUT",
        filters: [],
        orderBy: initialOrderBy,
        groupBy: [],
        groupOrderBy: [],
        columnOrder: negativeLengthOrder,
        columnVisibility: {},
        columnWidths: {},
        columnPinning: { start: [], end: [] },
      },
    });
    expect(negativeLength.columnLayout.orderOverride).toBeUndefined();
  });

  it("drops malformed pinning and stale widths instead of coercing them", () => {
    const baseline = createBrunoTablePersistedState(
      createBrunoTableGridPreferences({
        tableId: "TABLE_ID_ORDERS",
        columns,
        initialFilters: [],
        initialOrderBy,
      }),
    );
    const restored = createBrunoTableGridPreferences({
      tableId: "TABLE_ID_ORDERS",
      columns,
      initialFilters: [],
      initialOrderBy,
      initialPersistedState: {
        ...baseline,
        columnWidths: { COL_ID_NAME: 2, COL_ID_QUANTITY: 140.5 },
        columnPinning: { start: null, end: null },
      },
    });
    const snapshot = createBrunoTablePersistedState(restored);
    expect(snapshot["columnWidths"]).toEqual({});
    expect(snapshot["columnPinning"]).toEqual({ start: ["COL_ID_NAME"], end: [] });
  });

  it("keeps baseline pinning for a column introduced after the snapshot", () => {
    const oldColumns = compileColumns([
      {
        columnId: "COL_ID_EXISTING",
        field: "name",
        headerName: "Existing",
        valueType: "text",
        pinned: "start",
      },
    ]);
    const oldSnapshot = createBrunoTablePersistedState(
      createBrunoTableGridPreferences({
        tableId: "TABLE_ID_COLUMN_ADDITION",
        columns: oldColumns,
        initialFilters: [],
        initialOrderBy: [{ columnId: "COL_ID_EXISTING", direction: "asc" }],
      }),
    );
    const currentColumns = compileColumns([
      {
        columnId: "COL_ID_EXISTING",
        field: "name",
        headerName: "Existing",
        valueType: "text",
        pinned: "start",
      },
      {
        columnId: "COL_ID_NEW",
        field: "name",
        headerName: "New",
        valueType: "text",
        pinned: "end",
      },
    ]);
    const restored = createBrunoTableGridPreferences({
      tableId: "TABLE_ID_COLUMN_ADDITION",
      columns: currentColumns,
      initialFilters: [],
      initialOrderBy: [{ columnId: "COL_ID_EXISTING", direction: "asc" }],
      initialPersistedState: {
        ...oldSnapshot,
        columnPinning: { start: [], end: [] },
      },
    });

    expect(createBrunoTablePersistedState(restored)["columnPinning"]).toEqual({
      start: [],
      end: ["COL_ID_NEW"],
    });
  });

  it("restores valid preferences, falls back from an empty sanitized order, and drops grouping", () => {
    const persisted = {
      version: BRUNO_TABLE_PERSISTED_STATE_VERSION,
      tableId: "TABLE_ID_ORDERS",
      filters: [],
      orderBy: [{ columnId: "COL_ID_REMOVED", direction: "desc" }],
      groupBy: ["COL_ID_NAME"],
      groupOrderBy: [{ columnId: "COL_ID_NAME", direction: "desc" }],
      columnOrder: [
        "COL_ID_ACCOUNT",
        "COL_ID_NAME",
        "COL_ID_QUANTITY",
        "COL_ID_STATUS",
        "COL_ID_SCORE",
      ],
      columnVisibility: {
        COL_ID_NAME: false,
        COL_ID_QUANTITY: true,
        COL_ID_ACCOUNT: true,
        COL_ID_STATUS: true,
        COL_ID_SCORE: true,
      },
      columnWidths: { COL_ID_QUANTITY: 333, COL_ID_REMOVED: 999 },
      columnPinning: { start: ["COL_ID_ACCOUNT"], end: ["COL_ID_QUANTITY"] },
    };
    const restored = createBrunoTableGridPreferences({
      tableId: "TABLE_ID_ORDERS",
      columns,
      initialFilters: [{ columnId: "COL_ID_NAME", type: "equals", filter: "baseline" }],
      initialOrderBy,
      initialPersistedState: persisted,
    });

    expect(restored.orderBy).toEqual(initialOrderBy);
    expect(restored.groupBy).toEqual([]);
    expect(restored.groupOrderBy).toEqual([]);
    const snapshot = createBrunoTablePersistedState(restored);
    expect(snapshot["columnOrder"]).toEqual([
      "COL_ID_ACCOUNT",
      "COL_ID_NAME",
      "COL_ID_QUANTITY",
      "COL_ID_STATUS",
      "COL_ID_SCORE",
    ]);
    expect(snapshot["columnVisibility"]).toEqual({
      COL_ID_ACCOUNT: true,
      COL_ID_NAME: false,
      COL_ID_QUANTITY: true,
      COL_ID_STATUS: true,
      COL_ID_SCORE: true,
    });
    expect(snapshot["columnWidths"]).toEqual({
      COL_ID_QUANTITY: 333,
    });
    expect(snapshot["columnPinning"]).toEqual({
      start: ["COL_ID_ACCOUNT"],
      end: ["COL_ID_QUANTITY"],
    });
  });

  it("persists only durable width overrides and retains an explicit baseline-equal width", () => {
    const pristine = createBrunoTableGridPreferences({
      tableId: "TABLE_ID_WIDTH_INTENT",
      columns,
      initialFilters: [],
      initialOrderBy,
    });
    expect(createBrunoTablePersistedState(pristine)["columnWidths"]).toEqual({});

    const restored = createBrunoTableGridPreferences({
      tableId: "TABLE_ID_WIDTH_INTENT",
      columns,
      initialFilters: [],
      initialOrderBy,
      initialPersistedState: {
        ...createBrunoTablePersistedState(pristine),
        columnWidths: { COL_ID_NAME: 120 },
      },
    });
    expect(createBrunoTablePersistedState(restored)["columnWidths"]).toEqual({
      COL_ID_NAME: 120,
    });
  });

  it("encodes only at committed preference boundaries", () => {
    accountEncodePersisted.mockClear();
    const preferences = createBrunoTableGridPreferences({
      tableId: "TABLE_ID_ORDERS",
      columns,
      initialFilters: [{ columnId: "COL_ID_ACCOUNT", type: "equals", filter: { address: "a" } }],
      initialOrderBy,
    });
    expect(accountEncodePersisted).not.toHaveBeenCalled();
    createBrunoTablePersistedState(preferences);
    expect(accountEncodePersisted).toHaveBeenCalledOnce();
  });

  it("refuses non-JSON-safe output from a custom persisted codec", () => {
    const unsafeValueType: BrunoTableValueType<string, "equality", "text"> = {
      codecId: "test/unsafe-json",
      codecVersion: 1,
      filterFamily: "equality",
      editorFamily: "text",
      cellAlign: "start",
      editorLayout: "inline",
      defaultWidth: 120,
      decodeRuntime: (input) =>
        typeof input === "string"
          ? { _tag: "Success", value: input }
          : { _tag: "Failure", message: "Expected string." },
      equivalent: (left, right) => left === right,
      compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
      formatCanonicalText: (value) => value,
      parseCanonicalText: (text) => ({ _tag: "Success", value: text }),
      formatDisplay: (value) => value,
      encodePersisted: () => Number.NaN,
      decodePersisted: () => ({ _tag: "Failure", message: "Never decodes." }),
    };
    const unsafeColumns = compileColumns([
      {
        columnId: "COL_ID_UNSAFE",
        field: "name",
        headerName: "Unsafe",
        valueType: unsafeValueType,
      },
    ]);
    const preferences = createBrunoTableGridPreferences({
      tableId: "TABLE_ID_UNSAFE_JSON",
      columns: unsafeColumns,
      initialFilters: [{ columnId: "COL_ID_UNSAFE", type: "equals", filter: "value" }],
      initialOrderBy: [{ columnId: "COL_ID_UNSAFE", direction: "asc" }],
    });

    expect(() => createBrunoTablePersistedState(preferences)).toThrow("JSON-safe");
  });
});
