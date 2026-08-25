import { describe, expect, it, vi } from "vitest";
import * as BigDecimal from "effect/BigDecimal";

import { BrunoTableBigDecimalValueType } from "../effect";
import type { BrunoTableValueType } from "../public-types";
import { BRUNO_TABLE_CELL_EDIT_MAX_CANDIDATE_LENGTH, BrunoTableCellEditRuntime } from "./cell-edit";
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

  it("invalidates predicate traversal from the actor-owned draft revision", () => {
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
    expect(runtime.findTraversalDestination(0, "COL_ID_START", 1)).toBeUndefined();
    expect(runtime.findRangeTraversalDestination(range, row.id, "COL_ID_START", 1)).toBeUndefined();
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
});
