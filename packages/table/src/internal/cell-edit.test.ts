import { describe, expect, it, vi } from "vitest";
import * as BigDecimal from "effect/BigDecimal";

import { BrunoTableSelectColumn } from "../column-helpers";
import { BrunoTableBigDecimalValueType } from "../effect";
import type { BrunoTableColumns, BrunoTableValueType } from "../public-types";
import {
  BRUNO_TABLE_CELL_EDIT_MAX_CANDIDATE_LENGTH,
  BrunoTableCellEditRuntime as BrunoTableCellEditRuntimeBase,
} from "./cell-edit";
import { compileColumns } from "./compile-columns";

type Row = Readonly<{
  readonly id: string;
  readonly quantity: bigint;
  readonly score: number;
}>;

const row: Row = { id: "row-1", quantity: 9_007_199_254_740_993n, score: 4 };
const columns = compileColumns([
  {
    columnId: "COL_ID_QUANTITY",
    field: "quantity",
    headerName: "Quantity",
    valueType: "bigint",
    isEditable: true,
  },
  {
    columnId: "COL_ID_SCORE",
    field: "score",
    headerName: "Score",
    valueType: "number",
    isEditable: ({ value }: { readonly value: number }) => value >= 0,
    validate: ({ value }: { readonly value: number }) =>
      value <= 10 ? undefined : "Score must be at most 10.",
  },
]);

class BrunoTableCellEditRuntime extends BrunoTableCellEditRuntimeBase {
  public constructor(options: ConstructorParameters<typeof BrunoTableCellEditRuntimeBase>[0]) {
    super(options);
    this.activate();
  }
}

describe("BrunoTable Cell Edit Session", () => {
  it("retains invalid raw input and commits exact typed values only after one gate", () => {
    const commit = vi.fn();
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: (rowId) => (rowId === row.id ? row : undefined),
      onCommit: commit,
    });

    expect(runtime.start("row-1", "COL_ID_QUANTITY")).toBe(true);
    expect(runtime.getSessionSnapshot()).toMatchObject({
      kind: "editing",
      initialText: "9007199254740993",
    });
    expect(runtime.commit("9007199254740993.5")).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({
      kind: "editing",
      invalidMessage: "Expected signed base-10 integer digits.",
    });
    expect(runtime.getDraftSnapshot("row-1", "COL_ID_QUANTITY")).toBe(undefined);
    expect(commit).not.toHaveBeenCalled();

    expect(runtime.commit("9007199254740995")).toBe(true);
    expect(runtime.getSessionSnapshot()).toEqual({ kind: "idle" });
    expect(runtime.getDraftSnapshot("row-1", "COL_ID_QUANTITY")).toBe(9_007_199_254_740_995n);
    expect(commit).toHaveBeenCalledWith({
      rowId: "row-1",
      columnId: "COL_ID_QUANTITY",
      field: "quantity",
      before: 9_007_199_254_740_993n,
      after: 9_007_199_254_740_995n,
    });
  });

  it("runs synchronous validation at commit and Escape restores the pre-session draft", () => {
    const commit = vi.fn();
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => row,
      onCommit: commit,
    });
    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("11")).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({
      invalidMessage: "Score must be at most 10.",
    });
    expect(runtime.cancel()).toBe(true);
    expect(runtime.getSessionSnapshot()).toEqual({ kind: "idle" });
    expect(runtime.getDraftSnapshot("row-1", "COL_ID_SCORE")).toBe(undefined);
    expect(commit).not.toHaveBeenCalled();

    expect(runtime.start("row-1", "COL_ID_SCORE", "replace", "7")).toBe(true);
    expect(runtime.getSessionSnapshot()).toMatchObject({ initialText: "7" });
    expect(runtime.commit("7")).toBe(true);
    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.getSessionSnapshot()).toMatchObject({ initialText: "7" });
    expect(runtime.cancel()).toBe(true);
    expect(runtime.getDraftSnapshot("row-1", "COL_ID_SCORE")).toBe(7);
  });

  it("bounds untrusted candidates and admits native Number validity through the actor gate", () => {
    const validate = vi.fn();
    const guardedColumns = compileColumns([
      {
        columnId: "COL_ID_SCORE",
        field: "score",
        headerName: "Score",
        valueType: "number",
        isEditable: true,
        validate,
      },
    ]);
    const runtime = new BrunoTableCellEditRuntime({ columns: guardedColumns, getRow: () => row });

    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    runtime.updateActiveCandidate(
      "1".repeat(BRUNO_TABLE_CELL_EDIT_MAX_CANDIDATE_LENGTH + 100),
      false,
    );
    expect(runtime.getActiveCandidateSnapshot().rawText).toHaveLength(
      BRUNO_TABLE_CELL_EDIT_MAX_CANDIDATE_LENGTH + 1,
    );
    expect(runtime.commit("1".repeat(BRUNO_TABLE_CELL_EDIT_MAX_CANDIDATE_LENGTH + 1))).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({
      invalidMessage: `Enter at most ${String(BRUNO_TABLE_CELL_EDIT_MAX_CANDIDATE_LENGTH)} characters.`,
    });
    expect(validate).not.toHaveBeenCalled();
    expect(runtime.commit("4", true)).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({ invalidMessage: "Enter a valid number." });
    expect(validate).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it("publishes only the affected cell projection instead of waking the matrix", () => {
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => row });
    const quantitySubscriber = vi.fn();
    const scoreSubscriber = vi.fn();
    const unsubscribeQuantity = runtime.subscribeCell(
      "row-1",
      "COL_ID_QUANTITY",
      quantitySubscriber,
    );
    const unsubscribeScore = runtime.subscribeCell("row-1", "COL_ID_SCORE", scoreSubscriber);

    expect(runtime.start("row-1", "COL_ID_QUANTITY")).toBe(true);
    expect(quantitySubscriber).toHaveBeenCalledTimes(1);
    expect(scoreSubscriber).not.toHaveBeenCalled();
    expect(runtime.commit("9007199254740995")).toBe(true);
    expect(quantitySubscriber).toHaveBeenCalledTimes(2);
    expect(scoreSubscriber).not.toHaveBeenCalled();

    unsubscribeQuantity();
    unsubscribeScore();
    runtime.dispose();
  });

  it("publishes draft presence independently from an undefined draft value", () => {
    type OptionalRow = Readonly<{ readonly id: string; readonly optional: string | undefined }>;
    const optionalValueType: BrunoTableValueType<string | undefined, "equality", "text"> = {
      codecId: "test/undefined",
      codecVersion: 1,
      filterFamily: "equality",
      editorFamily: "text",
      cellAlign: "start",
      editorLayout: "inline",
      defaultWidth: 100,
      decodeRuntime: (input) =>
        typeof input === "string" || input === undefined
          ? { _tag: "Success", value: input }
          : { _tag: "Failure", message: "Expected optional text." },
      equivalent: Object.is,
      compare: (left, right) => (Object.is(left, right) ? 0 : left === undefined ? -1 : 1),
      formatCanonicalText: (value) => value ?? "undefined",
      parseCanonicalText: () => ({ _tag: "Success", value: undefined }),
      formatDisplay: (value) => value ?? "undefined",
      encodePersisted: () => null,
      decodePersisted: () => ({ _tag: "Success", value: undefined }),
    };
    const optionalRow: OptionalRow = { id: "optional", optional: "source" };
    const optionalColumns = compileColumns([
      {
        columnId: "COL_ID_OPTIONAL",
        field: "optional",
        headerName: "Optional",
        valueType: optionalValueType,
        isEditable: true,
      },
    ]);
    const runtime = new BrunoTableCellEditRuntime({
      columns: optionalColumns,
      getRow: () => optionalRow,
    });
    const subscriber = vi.fn();
    const unsubscribe = runtime.subscribeCell("optional", "COL_ID_OPTIONAL", subscriber);

    expect(runtime.start("optional", "COL_ID_OPTIONAL")).toBe(true);
    expect(runtime.commit("undefined")).toBe(true);
    const projection = runtime.getCellSnapshot("optional", "COL_ID_OPTIONAL");
    expect(projection).toMatchObject({ active: false, hasDraft: true, draft: undefined });
    expect(Object.hasOwn(projection, "draft")).toBe(true);
    expect(subscriber).toHaveBeenCalledTimes(2);

    unsubscribe();
    runtime.dispose();
  });

  it("invalidates predicate traversal from the store-owned draft revision", () => {
    const draftColumns = compileColumns([
      {
        columnId: "COL_ID_START",
        field: "quantity",
        headerName: "Start",
        valueType: "bigint",
        isEditable: true,
      },
      {
        columnId: "COL_ID_SCORE",
        field: "score",
        headerName: "Score",
        valueType: "number",
        isEditable: ({ value }: { readonly value: number }) => value < 5,
      },
    ]);
    const runtime = new BrunoTableCellEditRuntime({ columns: draftColumns, getRow: () => row });
    const traversalInvalidation = vi.fn();
    const unsubscribeTraversal = runtime.subscribeTraversalInvalidation(traversalInvalidation);
    runtime.reconcileTraversal(draftColumns, {
      totalRows: 1,
      getRowId: (rowIndex) => (rowIndex === 0 ? row.id : undefined),
    });

    expect(runtime.findTraversalDestination(0, "COL_ID_START", 1)?.columnId).toBe("COL_ID_SCORE");
    const range = Object.freeze({
      axis: "horizontal" as const,
      rowId: row.id,
      columnIds: Object.freeze(["COL_ID_START", "COL_ID_SCORE"]),
    });
    expect(runtime.findRangeTraversalDestination(range, row.id, "COL_ID_START", 1)?.columnId).toBe(
      "COL_ID_SCORE",
    );
    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("7")).toBe(true);
    expect(traversalInvalidation).toHaveBeenCalledOnce();
    expect(runtime.findTraversalDestination(0, "COL_ID_START", 1)).toBeUndefined();
    expect(runtime.findRangeTraversalDestination(range, row.id, "COL_ID_START", 1)).toBeUndefined();
    runtime.reconcileTraversalRows(undefined);
    expect(traversalInvalidation).toHaveBeenCalledTimes(2);
    unsubscribeTraversal();
    runtime.dispose();
  });

  it("publishes actor-owned invalid, accepted, and cancel decisions coherently", () => {
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => row });
    const sessionObservations: Array<readonly [string, boolean]> = [];
    const cellObservations: Array<readonly [boolean, string]> = [];
    const unsubscribeSession = runtime.subscribeSession(() => {
      sessionObservations.push([
        runtime.getSessionSnapshot().kind,
        runtime.getCellSnapshot("row-1", "COL_ID_SCORE").active,
      ]);
    });
    const unsubscribeCell = runtime.subscribeCell("row-1", "COL_ID_SCORE", () => {
      cellObservations.push([
        runtime.getCellSnapshot("row-1", "COL_ID_SCORE").active,
        runtime.getSessionSnapshot().kind,
      ]);
    });

    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(sessionObservations).toEqual([["editing", true]]);
    expect(cellObservations).toEqual([[true, "editing"]]);
    expect(runtime.commit("11")).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({
      kind: "editing",
      invalidMessage: "Score must be at most 10.",
    });
    expect(runtime.getCellSnapshot("row-1", "COL_ID_SCORE").active).toBe(true);
    expect(runtime.commit("6")).toBe(true);
    expect(sessionObservations.at(-1)).toEqual(["idle", false]);
    expect(cellObservations.at(-1)).toEqual([false, "idle"]);

    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.cancel()).toBe(true);
    expect(sessionObservations.at(-1)).toEqual(["idle", false]);
    expect(cellObservations.at(-1)).toEqual([false, "idle"]);

    unsubscribeCell();
    unsubscribeSession();
    runtime.dispose();
  });

  it("applies actor-produced draft patches to store-owned memory in one observable batch", () => {
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => row });
    const initialDraftMemory = runtime.getDraftMemorySnapshot();
    const observations: Array<readonly [string, number, unknown]> = [];
    const unsubscribe = runtime.subscribeCell("row-1", "COL_ID_SCORE", () => {
      observations.push([
        runtime.getSessionSnapshot().kind,
        runtime.getDraftMemorySnapshot().size,
        runtime.getCellSnapshot("row-1", "COL_ID_SCORE").draft,
      ]);
    });

    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("11")).toBe(false);
    expect(runtime.getDraftMemorySnapshot()).toBe(initialDraftMemory);
    expect(runtime.commit("6")).toBe(true);
    expect(runtime.getDraftMemorySnapshot()).not.toBe(initialDraftMemory);
    expect(observations.at(-1)).toEqual(["idle", 1, 6]);

    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("4")).toBe(true);
    expect(observations.at(-1)).toEqual(["idle", 0, undefined]);

    unsubscribe();
    runtime.dispose();
  });

  it("keeps snapshot reads observational and bounds stores to live subscriptions or the editor", () => {
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => row });
    for (let index = 0; index < 1_000; index += 1) {
      runtime.getCellSnapshot(`row-${String(index)}`, "COL_ID_SCORE");
    }
    expect(runtime.getRetainedCellStoreCount()).toBe(0);

    const unsubscribe = runtime.subscribeCell("row-1", "COL_ID_SCORE", () => undefined);
    expect(runtime.getRetainedCellStoreCount()).toBe(1);
    unsubscribe();
    expect(runtime.getRetainedCellStoreCount()).toBe(0);

    const unsubscribeActive = runtime.subscribeCell("row-1", "COL_ID_SCORE", () => undefined);
    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.getRetainedCellStoreCount()).toBe(1);
    unsubscribeActive();
    expect(runtime.getRetainedCellStoreCount()).toBe(1);
    expect(runtime.cancel()).toBe(true);
    expect(runtime.getRetainedCellStoreCount()).toBe(0);

    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("6")).toBe(true);
    const first = runtime.getCellSnapshot("row-1", "COL_ID_SCORE");
    expect(runtime.getCellSnapshot("row-1", "COL_ID_SCORE")).toBe(first);
    expect(first).toMatchObject({ active: false, hasDraft: true, draft: 6 });
    expect(runtime.getRetainedCellStoreCount()).toBe(0);
    runtime.dispose();
  });

  it("preserves the optional Effect BigDecimal domain without number coercion", () => {
    const before = BigDecimal.fromStringUnsafe("12345678901234567890.00000000000000000001");
    const decimalRow = { id: "decimal", amount: before };
    const decimalColumns = compileColumns([
      {
        columnId: "COL_ID_AMOUNT",
        field: "amount",
        headerName: "Amount",
        valueType: BrunoTableBigDecimalValueType,
        isEditable: true,
      },
    ]);
    const runtime = new BrunoTableCellEditRuntime({
      columns: decimalColumns,
      getRow: () => decimalRow,
    });

    expect(runtime.start("decimal", "COL_ID_AMOUNT")).toBe(true);
    expect(runtime.commit("12345678901234567890.00000000000000000002")).toBe(true);
    const draft = runtime.getDraftSnapshot("decimal", "COL_ID_AMOUNT") as BigDecimal.BigDecimal;
    expect(
      BigDecimal.equals(
        draft,
        BigDecimal.fromStringUnsafe("12345678901234567890.00000000000000000002"),
      ),
    ).toBe(true);
  });

  it("resolves explicit nullish blank representations before scalar parsing", () => {
    type NullableRow = Readonly<{
      readonly id: string;
      readonly nullable: number | null;
      readonly optional: number | undefined;
      readonly required: number;
    }>;
    const nullableRow: NullableRow = {
      id: "nullable",
      nullable: 5,
      optional: 6,
      required: 7,
    };
    const nullableColumns = compileColumns([
      {
        columnId: "COL_ID_NULLABLE",
        field: "nullable",
        headerName: "Nullable",
        valueType: "number",
        isEditable: true,
        blankValue: null,
      },
      {
        columnId: "COL_ID_OPTIONAL",
        field: "optional",
        headerName: "Optional",
        valueType: "number",
        isEditable: true,
        blankValue: undefined,
      },
      {
        columnId: "COL_ID_REQUIRED",
        field: "required",
        headerName: "Required",
        valueType: "number",
        isEditable: true,
      },
    ] satisfies BrunoTableColumns<NullableRow>);
    const runtime = new BrunoTableCellEditRuntime({
      columns: nullableColumns,
      getRow: () => nullableRow,
    });

    expect(runtime.start("nullable", "COL_ID_NULLABLE")).toBe(true);
    expect(runtime.commit("")).toBe(true);
    expect(runtime.getDraftSnapshot("nullable", "COL_ID_NULLABLE")).toBe(null);
    expect(runtime.start("nullable", "COL_ID_OPTIONAL")).toBe(true);
    expect(runtime.commit("")).toBe(true);
    expect(runtime.getCellSnapshot("nullable", "COL_ID_OPTIONAL")).toMatchObject({
      hasDraft: true,
      draft: undefined,
    });
    expect(runtime.start("nullable", "COL_ID_REQUIRED")).toBe(true);
    expect(runtime.commit("")).toBe(false);
    expect(runtime.getDraftSnapshot("nullable", "COL_ID_REQUIRED")).toBeUndefined();
  });

  it("preserves the explicit null versus undefined edit representation", () => {
    type AmbiguousRow = Readonly<{
      readonly id: string;
      readonly value: number | null | undefined;
    }>;
    let ambiguousRow: AmbiguousRow = { id: "ambiguous", value: undefined };
    const nullColumns = compileColumns([
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "number",
        isEditable: true,
        blankValue: null,
      },
    ] satisfies BrunoTableColumns<AmbiguousRow>);
    const nullRuntime = new BrunoTableCellEditRuntime({
      columns: nullColumns,
      getRow: () => ambiguousRow,
    });

    expect(nullRuntime.start("ambiguous", "COL_ID_VALUE")).toBe(true);
    expect(nullRuntime.commit("")).toBe(true);
    expect(nullRuntime.getCellSnapshot("ambiguous", "COL_ID_VALUE")).toMatchObject({
      hasDraft: true,
      draft: null,
    });

    ambiguousRow = { id: "ambiguous", value: null };
    const undefinedColumns = compileColumns([
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "number",
        isEditable: true,
        blankValue: undefined,
      },
    ] satisfies BrunoTableColumns<AmbiguousRow>);
    const undefinedRuntime = new BrunoTableCellEditRuntime({
      columns: undefinedColumns,
      getRow: () => ambiguousRow,
    });

    expect(undefinedRuntime.start("ambiguous", "COL_ID_VALUE")).toBe(true);
    expect(undefinedRuntime.commit("")).toBe(true);
    expect(undefinedRuntime.getCellSnapshot("ambiguous", "COL_ID_VALUE")).toMatchObject({
      hasDraft: true,
      draft: undefined,
    });
  });

  it("keeps Select and Boolean blank intent distinct from exact scalar values", () => {
    type ChoiceRow = Readonly<{
      readonly id: string;
      readonly flag: boolean | null;
      readonly nullableChoice: "" | "ready" | null;
      readonly requiredChoice: "" | "ready";
    }>;
    const choiceRow: ChoiceRow = {
      id: "choice",
      flag: null,
      nullableChoice: null,
      requiredChoice: "ready",
    };
    const choiceColumns = compileColumns([
      {
        columnId: "COL_ID_FLAG",
        field: "flag",
        headerName: "Flag",
        valueType: "boolean",
        isEditable: true,
        blankValue: null,
      },
      BrunoTableSelectColumn({
        columnId: "COL_ID_NULLABLE_CHOICE",
        field: "nullableChoice",
        headerName: "Nullable choice",
        options: ["", "ready"],
        isEditable: true,
        blankValue: null,
      }),
      BrunoTableSelectColumn({
        columnId: "COL_ID_REQUIRED_CHOICE",
        field: "requiredChoice",
        headerName: "Required choice",
        options: ["", "ready"],
        isEditable: true,
      }),
    ] satisfies BrunoTableColumns<ChoiceRow>);
    const runtime = new BrunoTableCellEditRuntime({
      columns: choiceColumns,
      getRow: () => choiceRow,
    });

    expect(runtime.start("choice", "COL_ID_FLAG")).toBe(true);
    expect(runtime.getActiveCandidateSnapshot()).toMatchObject({ kind: "blank" });
    expect(runtime.commit("false", false, "scalar")).toBe(true);
    expect(runtime.getDraftSnapshot("choice", "COL_ID_FLAG")).toBe(false);

    expect(runtime.start("choice", "COL_ID_NULLABLE_CHOICE")).toBe(true);
    expect(runtime.commit("", false, "scalar")).toBe(true);
    expect(runtime.getDraftSnapshot("choice", "COL_ID_NULLABLE_CHOICE")).toBe("");
    expect(runtime.start("choice", "COL_ID_NULLABLE_CHOICE")).toBe(true);
    expect(runtime.commit("", false, "blank")).toBe(true);
    expect(runtime.getCellSnapshot("choice", "COL_ID_NULLABLE_CHOICE")).toMatchObject({
      hasDraft: false,
    });

    expect(runtime.start("choice", "COL_ID_REQUIRED_CHOICE")).toBe(true);
    expect(runtime.commit("", false, "scalar")).toBe(true);
    expect(runtime.getDraftSnapshot("choice", "COL_ID_REQUIRED_CHOICE")).toBe("");
    expect(runtime.start("choice", "COL_ID_REQUIRED_CHOICE")).toBe(true);
    expect(runtime.commit("", false, "blank")).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({ invalidMessage: "Enter a value." });
  });

  it("rejects policy-free blank input before a custom numeric text parser can coerce zero", () => {
    const parseCanonicalText = vi.fn((text: string) => ({
      _tag: "Success" as const,
      value: BigInt(text),
    }));
    const numericTextValueType: BrunoTableValueType<bigint, "numeric", "text"> = {
      codecId: "test/numeric-text",
      codecVersion: 1,
      filterFamily: "numeric",
      editorFamily: "text",
      cellAlign: "end",
      editorLayout: "inline",
      defaultWidth: 120,
      decodeRuntime: (input) =>
        typeof input === "bigint"
          ? { _tag: "Success", value: input }
          : { _tag: "Failure", message: "Expected bigint." },
      equivalent: Object.is,
      compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
      formatCanonicalText: String,
      parseCanonicalText,
      formatDisplay: String,
      encodePersisted: String,
      decodePersisted: (input) =>
        typeof input === "string"
          ? { _tag: "Success", value: BigInt(input) }
          : { _tag: "Failure", message: "Expected string." },
    };
    const customColumns = compileColumns([
      {
        columnId: "COL_ID_QUANTITY",
        field: "quantity",
        headerName: "Quantity",
        valueType: numericTextValueType,
        isEditable: true,
      },
    ]);
    const runtime = new BrunoTableCellEditRuntime({ columns: customColumns, getRow: () => row });

    expect(runtime.start("row-1", "COL_ID_QUANTITY")).toBe(true);
    expect(runtime.commit("")).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({ invalidMessage: "Enter a value." });
    expect(parseCanonicalText).not.toHaveBeenCalled();
  });

  it("contains throwing and malformed custom parsers as recoverable invalid candidates", () => {
    let parserMode: "throw" | "malformed" | "wrong-domain" = "throw";
    const customValueType: BrunoTableValueType<string> = {
      codecId: "test/throwing-editor-parser",
      codecVersion: 1,
      filterFamily: "text",
      editorFamily: "text",
      cellAlign: "start",
      editorLayout: "inline",
      defaultWidth: 120,
      decodeRuntime: (input) =>
        typeof input === "string"
          ? { _tag: "Success", value: input }
          : { _tag: "Failure", message: "Expected string." },
      equivalent: Object.is,
      compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
      formatCanonicalText: String,
      parseCanonicalText: () => {
        if (parserMode === "malformed") return { nope: true } as never;
        if (parserMode === "wrong-domain") return { _tag: "Success", value: 1n } as never;
        throw new Error("parser escaped");
      },
      formatDisplay: String,
      encodePersisted: String,
      decodePersisted: (input) =>
        typeof input === "string"
          ? { _tag: "Success", value: input }
          : { _tag: "Failure", message: "Expected string." },
    };
    const parserRow = { id: "parser", value: "before" };
    const parserColumns = compileColumns([
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: customValueType,
        isEditable: true,
      },
    ]);
    const runtime = new BrunoTableCellEditRuntime({
      columns: parserColumns,
      getRow: () => parserRow,
    });

    expect(runtime.start("parser", "COL_ID_VALUE")).toBe(true);
    runtime.updateActiveCandidate("candidate", false);
    expect(runtime.commit("candidate")).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({
      kind: "editing",
      invalidMessage: "BrunoTable Value Type parseCanonicalText failed.",
    });
    expect(runtime.getActiveCandidateSnapshot()).toMatchObject({
      kind: "scalar",
      rawText: "candidate",
    });

    parserMode = "malformed";
    expect(runtime.commit("still candidate")).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({
      invalidMessage: "BrunoTable Value Type parseCanonicalText failed.",
    });
    parserMode = "wrong-domain";
    expect(runtime.commit("wrong domain")).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({ invalidMessage: "Expected string." });
    expect(runtime.getDraftSnapshot("parser", "COL_ID_VALUE")).toBeUndefined();
    expect(runtime.cancel()).toBe(true);
  });

  it("contains hostile edit equality for both before and live-source comparisons", () => {
    for (const failureAt of [1, 2] as const) {
      let equalityCalls = 0;
      const valueType: BrunoTableValueType<string> = {
        codecId: `test/hostile-edit-equality-${String(failureAt)}`,
        codecVersion: 1,
        filterFamily: "text",
        editorFamily: "text",
        cellAlign: "start",
        editorLayout: "inline",
        defaultWidth: 120,
        decodeRuntime: (input) =>
          typeof input === "string"
            ? { _tag: "Success", value: input }
            : { _tag: "Failure", message: "Expected text." },
        equivalent: () => {
          equalityCalls += 1;
          if (equalityCalls === failureAt) throw new Error("equality escaped");
          return false;
        },
        compare: () => 0,
        formatCanonicalText: String,
        parseCanonicalText: (text) => ({ _tag: "Success", value: text }),
        formatDisplay: String,
        encodePersisted: String,
        decodePersisted: (input) => ({ _tag: "Success", value: String(input) }),
      };
      const liveRow = { value: "source" };
      const runtime = new BrunoTableCellEditRuntime({
        columns: compileColumns([
          {
            columnId: "COL_ID_VALUE",
            field: "value",
            headerName: "Value",
            valueType,
            isEditable: true,
          },
        ]),
        getRow: () => liveRow,
      });

      expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
      expect(runtime.commit("candidate")).toBe(false);
      expect(runtime.getSessionSnapshot()).toMatchObject({
        kind: "editing",
        invalidMessage: "The value is invalid.",
      });
      expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBeUndefined();
    }
  });

  it("keeps candidate ownership while XState reconciles a live Row Identity tombstone", () => {
    let liveRow: Row | undefined = row;
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => liveRow,
    });

    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    runtime.updateActiveCandidate("7", false);
    liveRow = { ...row, score: 5 };
    runtime.reconcileActiveRow();
    expect(runtime.getSessionSnapshot()).toMatchObject({ kind: "editing", rowMissing: false });
    expect(runtime.getActiveCandidateSnapshot()).toEqual({
      kind: "scalar",
      rawText: "7",
      nativeInvalid: false,
    });

    liveRow = undefined;
    runtime.reconcileActiveRow();
    expect(runtime.getSessionSnapshot()).toMatchObject({ kind: "editing", rowMissing: true });
    expect(runtime.commit("7")).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({
      kind: "editing",
      rowMissing: true,
    });
    expect(runtime.getSessionSnapshot()).not.toHaveProperty("invalidMessage");

    liveRow = { ...row, score: 6 };
    runtime.reconcileActiveRow();
    expect(runtime.getSessionSnapshot()).toMatchObject({ kind: "editing", rowMissing: false });
    expect(runtime.commit("7")).toBe(true);
    expect(runtime.getDraftSnapshot("row-1", "COL_ID_SCORE")).toBe(7);
  });

  it("captures one immutable draft command reader while later drafts publish", () => {
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => row });
    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("5")).toBe(true);
    const firstCommand = runtime.captureDraftCommandReader();

    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("6")).toBe(true);

    expect(firstCommand("row-1", "COL_ID_SCORE")).toEqual({
      hasDraft: true,
      value: 5,
    });
    expect(runtime.captureDraftCommandReader()("row-1", "COL_ID_SCORE")).toEqual({
      hasDraft: true,
      value: 6,
    });
  });

  it("preserves compatible drafts across recompiles and prunes a changed value domain", () => {
    const compileTextColumns = () =>
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType: "text",
          isEditable: true,
        },
      ]);
    const textColumns = compileTextColumns();
    const liveRow = { id: "row", value: "source" };
    const runtime = new BrunoTableCellEditRuntime({ columns: textColumns, getRow: () => liveRow });
    expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
    expect(runtime.commit("draft")).toBe(true);

    runtime.reconcileColumns(compileTextColumns());
    expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBe("draft");

    runtime.reconcileColumns(
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "other",
          headerName: "Other",
          valueType: "text",
          isEditable: true,
        },
      ]),
    );
    expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBeUndefined();

    const capabilityRuntime = new BrunoTableCellEditRuntime({
      columns: textColumns,
      getRow: () => liveRow,
    });
    expect(capabilityRuntime.start("row", "COL_ID_VALUE")).toBe(true);
    expect(capabilityRuntime.commit("draft")).toBe(true);
    capabilityRuntime.reconcileColumns(
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType: "text",
          isEditable: false,
        },
      ]),
    );
    expect(capabilityRuntime.getDraftSnapshot("row", "COL_ID_VALUE")).toBeUndefined();

    runtime.reconcileColumns(
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType: "number",
          isEditable: true,
        },
      ]),
    );
    expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBeUndefined();
  });

  it("preserves nullish blank drafts only across an unchanged explicit blank policy", () => {
    type NullableRow = Readonly<{
      readonly id: string;
      readonly value: number | null | undefined;
    }>;
    const liveRow: NullableRow = { id: "nullable", value: 1 };
    const customNumberValueType = (): BrunoTableValueType<number> => ({
      codecId: "test/non-null-number",
      codecVersion: 1,
      filterFamily: "numeric",
      editorFamily: "number",
      cellAlign: "end",
      editorLayout: "inline",
      defaultWidth: 100,
      decodeRuntime: (input) =>
        typeof input === "number"
          ? { _tag: "Success", value: input }
          : { _tag: "Failure", message: "Expected a non-null number." },
      equivalent: Object.is,
      compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
      formatCanonicalText: String,
      parseCanonicalText: (text) => ({ _tag: "Success", value: Number(text) }),
      formatDisplay: String,
      encodePersisted: (value) => value,
      decodePersisted: (input) =>
        typeof input === "number"
          ? { _tag: "Success", value: input }
          : { _tag: "Failure", message: "Expected a persisted number." },
    });
    const compileNullableColumns = (blankValue: null | undefined) =>
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType: customNumberValueType(),
          isEditable: true,
          blankValue,
        },
      ] satisfies BrunoTableColumns<NullableRow>);

    for (const blankValue of [null, undefined] as const) {
      const runtime = new BrunoTableCellEditRuntime({
        columns: compileNullableColumns(blankValue),
        getRow: () => liveRow,
      });
      expect(runtime.start("nullable", "COL_ID_VALUE")).toBe(true);
      expect(runtime.commit("", false, "blank")).toBe(true);
      expect(runtime.getCellSnapshot("nullable", "COL_ID_VALUE")).toMatchObject({
        hasDraft: true,
        draft: blankValue,
      });

      runtime.reconcileColumns(compileNullableColumns(blankValue));
      expect(runtime.getCellSnapshot("nullable", "COL_ID_VALUE")).toMatchObject({
        hasDraft: true,
        draft: blankValue,
      });
      expect(runtime.captureDraftCommandReader()("nullable", "COL_ID_VALUE")).toEqual({
        hasDraft: true,
        value: blankValue,
      });

      runtime.reconcileColumns(compileNullableColumns(blankValue === null ? undefined : null));
      expect(runtime.getCellSnapshot("nullable", "COL_ID_VALUE")).toMatchObject({
        hasDraft: false,
      });
      runtime.dispose();

      const removedPolicyRuntime = new BrunoTableCellEditRuntime({
        columns: compileNullableColumns(blankValue),
        getRow: () => liveRow,
      });
      expect(removedPolicyRuntime.start("nullable", "COL_ID_VALUE")).toBe(true);
      expect(removedPolicyRuntime.commit("", false, "blank")).toBe(true);
      removedPolicyRuntime.reconcileColumns(
        compileColumns([
          {
            columnId: "COL_ID_VALUE",
            field: "value",
            headerName: "Value",
            valueType: customNumberValueType(),
            isEditable: false,
          },
        ] satisfies BrunoTableColumns<NullableRow>),
      );
      expect(removedPolicyRuntime.getCellSnapshot("nullable", "COL_ID_VALUE")).toMatchObject({
        hasDraft: false,
      });
      removedPolicyRuntime.dispose();
    }
  });

  it("prunes drafts when a recompiled runtime decoder throws or returns malformed evidence", () => {
    const compileTextColumns = () =>
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType: "text",
          isEditable: true,
        },
      ]);
    const liveRow = { value: "source" };
    const hostileValueType = (mode: "throw" | "malformed"): BrunoTableValueType<string> => ({
      codecId: `test/hostile-recompile-${mode}`,
      codecVersion: 1,
      filterFamily: "text",
      editorFamily: "text",
      cellAlign: "start",
      editorLayout: "inline",
      defaultWidth: 120,
      decodeRuntime: () => {
        if (mode === "throw") throw new Error("decoder escaped");
        return { nope: true } as never;
      },
      equivalent: Object.is,
      compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
      formatCanonicalText: String,
      parseCanonicalText: (text) => ({ _tag: "Success", value: text }),
      formatDisplay: String,
      encodePersisted: String,
      decodePersisted: (input) => ({ _tag: "Success", value: String(input) }),
    });

    for (const mode of ["throw", "malformed"] as const) {
      const runtime = new BrunoTableCellEditRuntime({
        columns: compileTextColumns(),
        getRow: () => liveRow,
      });
      expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
      expect(runtime.commit("draft")).toBe(true);

      expect(() =>
        runtime.reconcileColumns(
          compileColumns([
            {
              columnId: "COL_ID_VALUE",
              field: "value",
              headerName: "Value",
              valueType: hostileValueType(mode),
              isEditable: true,
            },
          ]),
        ),
      ).not.toThrow();
      expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBeUndefined();
    }
  });

  it("rebinds an active invalid session across an equivalent column recompile", () => {
    const compileValidatedColumns = () =>
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType: "text",
          isEditable: true,
          validate: ({ value }: { readonly value: string }) =>
            value === "invalid" ? "Invalid value." : undefined,
        },
      ]);
    const runtime = new BrunoTableCellEditRuntime({
      columns: compileValidatedColumns(),
      getRow: () => ({ value: "source" }),
    });
    expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
    runtime.updateActiveCandidate("invalid", false);
    expect(runtime.commit("invalid")).toBe(false);

    runtime.reconcileColumns(compileValidatedColumns());

    expect(runtime.getSessionSnapshot()).toMatchObject({
      kind: "editing",
      columnId: "COL_ID_VALUE",
      invalidMessage: "Invalid value.",
    });
    expect(runtime.getActiveCandidateSnapshot()).toEqual({
      kind: "scalar",
      rawText: "invalid",
      nativeInvalid: false,
    });
  });

  it("cancels active candidates before an edit-facing column recompile can reinterpret them", () => {
    type OptionalRow = Readonly<{ readonly value: string | null | undefined }>;
    const decodeRuntime = (input: unknown) =>
      typeof input === "string" || input == null
        ? ({ _tag: "Success", value: input } as const)
        : ({ _tag: "Failure", message: "Expected nullable text." } as const);
    const formatCanonicalText = (value: string | null | undefined) => value ?? "";
    const parseText = (text: string) => ({ _tag: "Success", value: text }) as const;
    const parseUpper = (text: string) => ({ _tag: "Success", value: text.toUpperCase() }) as const;
    const valueType = (
      parseCanonicalText: typeof parseText,
      editorFamily: "text" | "number" = "text",
    ) => ({
      codecId: "test/active-session-authority",
      codecVersion: 1,
      filterFamily: "equality",
      editorFamily,
      cellAlign: "start",
      editorLayout: "inline",
      defaultWidth: 120,
      decodeRuntime,
      equivalent: Object.is,
      compare: () => 0 as const,
      formatCanonicalText,
      parseCanonicalText,
      formatDisplay: formatCanonicalText,
      encodePersisted: (value: string | null | undefined) => value ?? null,
      decodePersisted: decodeRuntime,
    });
    const compileOptional = (blankValue: null | undefined, parseCanonicalText = parseText) =>
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType: valueType(parseCanonicalText),
          isEditable: true,
          blankValue,
        },
      ]);
    const runtime = new BrunoTableCellEditRuntime({
      columns: compileOptional(null),
      getRow: (): OptionalRow => ({ value: null }),
    });

    expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
    runtime.updateActiveCandidate("", false, "blank");
    runtime.reconcileColumns(compileOptional(undefined));
    expect(runtime.getSessionSnapshot()).toEqual({ kind: "idle" });

    expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
    runtime.updateActiveCandidate("candidate", false);
    runtime.reconcileColumns(compileOptional(undefined, parseUpper));
    expect(runtime.getSessionSnapshot()).toEqual({ kind: "idle" });

    const familyRuntime = new BrunoTableCellEditRuntime({
      columns: compileOptional(undefined),
      getRow: (): OptionalRow => ({ value: "source" }),
    });
    expect(familyRuntime.start("row", "COL_ID_VALUE")).toBe(true);
    familyRuntime.reconcileColumns(
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType: valueType(parseText, "number"),
          isEditable: true,
          blankValue: undefined,
        },
      ]),
    );
    expect(familyRuntime.getSessionSnapshot()).toEqual({ kind: "idle" });

    type SelectRow = Readonly<{ readonly choice: "a" | "b" | "c" }>;
    const compileSelect = (changed: boolean) =>
      changed
        ? compileColumns([
            BrunoTableSelectColumn({
              columnId: "COL_ID_CHOICE",
              field: "choice",
              headerName: "Choice",
              options: ["a", "c", "b"],
              isEditable: true,
            }),
          ] satisfies BrunoTableColumns<SelectRow>)
        : compileColumns([
            BrunoTableSelectColumn({
              columnId: "COL_ID_CHOICE",
              field: "choice",
              headerName: "Choice",
              options: ["a", "b", "c"],
              isEditable: true,
            }),
          ] satisfies BrunoTableColumns<SelectRow>);
    const selectRuntime = new BrunoTableCellEditRuntime({
      columns: compileSelect(false),
      getRow: (): SelectRow => ({ choice: "a" }),
    });
    expect(selectRuntime.start("row", "COL_ID_CHOICE")).toBe(true);
    selectRuntime.updateActiveCandidate("a", false);
    selectRuntime.reconcileColumns(compileSelect(false));
    expect(selectRuntime.getSessionSnapshot()).toMatchObject({
      kind: "editing",
      columnId: "COL_ID_CHOICE",
    });
    expect(selectRuntime.getActiveCandidateSnapshot()).toMatchObject({ rawText: "a" });
    selectRuntime.reconcileColumns(compileSelect(true));
    expect(selectRuntime.getSessionSnapshot()).toEqual({ kind: "idle" });

    type ToggleRow = Readonly<{ readonly toggle: "N" | "Y" }>;
    const decodeToggle = (input: unknown) =>
      input === "N" || input === "Y"
        ? ({ _tag: "Success", value: input } as const)
        : ({ _tag: "Failure", message: "Expected N or Y." } as const);
    const formatToggle = (value: "N" | "Y") => value;
    const parseToggle = (text: string) => decodeToggle(text);
    const compileToggle = (booleanEditorValues: readonly ["N" | "Y", "N" | "Y"]) =>
      compileColumns([
        {
          columnId: "COL_ID_TOGGLE",
          field: "toggle",
          headerName: "Toggle",
          valueType: {
            codecId: "test/toggle-session-authority",
            codecVersion: 1,
            filterFamily: "equality",
            editorFamily: "boolean",
            booleanEditorValues,
            cellAlign: "center",
            editorLayout: "center",
            defaultWidth: 88,
            decodeRuntime: decodeToggle,
            equivalent: Object.is,
            compare: () => 0 as const,
            formatCanonicalText: formatToggle,
            parseCanonicalText: parseToggle,
            formatDisplay: formatToggle,
            encodePersisted: formatToggle,
            decodePersisted: decodeToggle,
          },
          isEditable: true,
        },
      ] satisfies BrunoTableColumns<ToggleRow>);
    const toggleRuntime = new BrunoTableCellEditRuntime({
      columns: compileToggle(["N", "Y"]),
      getRow: (): ToggleRow => ({ toggle: "N" }),
    });
    expect(toggleRuntime.start("row", "COL_ID_TOGGLE")).toBe(true);
    toggleRuntime.reconcileColumns(compileToggle(["N", "Y"]));
    expect(toggleRuntime.getSessionSnapshot()).toMatchObject({ kind: "editing" });
    toggleRuntime.reconcileColumns(compileToggle(["Y", "N"]));
    expect(toggleRuntime.getSessionSnapshot()).toEqual({ kind: "idle" });
  });

  it("blocks an active commit while dynamic edit permission is denied and recovers in place", () => {
    type PermissionRow = Readonly<{ readonly value: string; readonly allowed: boolean }>;
    let liveRow: PermissionRow = { value: "source", allowed: true };
    const compilePermissionColumns = (
      predicate: (context: { readonly row: PermissionRow; readonly value: string }) => boolean,
    ) =>
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType: "text",
          isEditable: predicate,
        },
      ]);
    const sourcePolicy = vi.fn(
      ({ row: candidateRow, value }: { readonly row: PermissionRow; readonly value: string }) =>
        candidateRow.allowed && value !== "locked",
    );
    const runtime = new BrunoTableCellEditRuntime({
      columns: compilePermissionColumns(sourcePolicy),
      getRow: () => liveRow,
    });
    expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
    runtime.updateActiveCandidate("candidate", false);

    const sessionSubscriber = vi.fn();
    const unsubscribe = runtime.subscribeSession(sessionSubscriber);
    sourcePolicy.mockClear();
    runtime.reconcileActiveRow(new Set(["unrelated"]));
    expect(sourcePolicy).not.toHaveBeenCalled();
    expect(sessionSubscriber).not.toHaveBeenCalled();

    liveRow = { value: "locked", allowed: true };
    runtime.reconcileActiveRow(new Set(["row"]));
    expect(runtime.getSessionSnapshot()).toMatchObject({
      kind: "editing",
      invalidMessage: "This cell is no longer editable.",
    });
    expect(runtime.commit("candidate")).toBe(false);
    expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBeUndefined();

    liveRow = { value: "source", allowed: true };
    runtime.reconcileActiveRow();
    expect(runtime.getSessionSnapshot()).toMatchObject({ kind: "editing" });
    expect(runtime.getSessionSnapshot()).not.toHaveProperty("invalidMessage");

    runtime.reconcileColumns(compilePermissionColumns(() => false));
    expect(runtime.getSessionSnapshot()).toMatchObject({
      kind: "editing",
      invalidMessage: "This cell is no longer editable.",
    });
    runtime.reconcileColumns(
      compilePermissionColumns(() => {
        throw new Error("policy failed");
      }),
    );
    expect(runtime.commit("candidate")).toBe(false);
    expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBeUndefined();

    runtime.reconcileColumns(compilePermissionColumns(() => true));
    expect(runtime.getSessionSnapshot()).not.toHaveProperty("invalidMessage");
    expect(runtime.commit("candidate")).toBe(true);
    expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBe("candidate");

    expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
    runtime.reconcileColumns(compilePermissionColumns(({ value }) => value === "candidate"));
    liveRow = { value: "locked", allowed: true };
    runtime.reconcileActiveRow();
    expect(runtime.getSessionSnapshot()).not.toHaveProperty("invalidMessage");
    unsubscribe();
  });

  it("clears a row-missing overlay on identity return and reveals prior validation", () => {
    let liveRow: Row | undefined = row;
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => liveRow });
    expect(runtime.start("row-1", "COL_ID_QUANTITY")).toBe(true);
    expect(runtime.commit("not-an-integer")).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({
      invalidMessage: "Expected signed base-10 integer digits.",
    });

    liveRow = undefined;
    runtime.reconcileActiveRow();
    expect(runtime.commit("not-an-integer")).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({
      rowMissing: true,
      invalidMessage: "Expected signed base-10 integer digits.",
    });

    liveRow = row;
    runtime.reconcileActiveRow();
    expect(runtime.getSessionSnapshot()).toMatchObject({
      rowMissing: false,
      invalidMessage: "Expected signed base-10 integer digits.",
    });
  });
});
