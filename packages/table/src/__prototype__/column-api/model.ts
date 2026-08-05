// PROTOTYPE — pure view-state reducer and snapshot selection for the terminal shell.

import {
  BrunoTablePrototypeCompiledOverrideColumns,
  BrunoTablePrototypeCompiledOrderColumns,
  BrunoTablePrototypeOrderColumns,
  BrunoTablePrototypeSampleSave,
} from "./scenarios.ts";

export type BrunoTablePrototypeView = "columns" | "computed" | "contract" | "preset" | "save";

export type BrunoTablePrototypeState = {
  readonly view: BrunoTablePrototypeView;
};

export const BrunoTablePrototypeInitialState: BrunoTablePrototypeState = {
  view: "columns",
};

export function BrunoTablePrototypeReduce(
  state: BrunoTablePrototypeState,
  key: string,
): BrunoTablePrototypeState {
  switch (key) {
    case "1":
      return { view: "columns" };
    case "2":
      return { view: "preset" };
    case "3":
      return { view: "computed" };
    case "4":
      return { view: "save" };
    case "5":
      return { view: "contract" };
    default:
      return state;
  }
}

export function BrunoTablePrototypeSnapshot(state: BrunoTablePrototypeState) {
  switch (state.view) {
    case "columns":
      return {
        question: "Do direct helpers remain ordinary columns with exact runtime semantics?",
        state: BrunoTablePrototypeCompiledOrderColumns,
      };
    case "preset": {
      const price = BrunoTablePrototypeCompiledOrderColumns.columns.find(
        (column) => column.columnId === "COL_ID_PRICE",
      );
      const overriddenPrice = BrunoTablePrototypeCompiledOverrideColumns.columns[0];
      return {
        question: "Does built-in → preset → individual precedence stay visible and unsurprising?",
        state: {
          builtIn: { valueType: "number", cellAlign: "end", editorLayout: "inline" },
          preset: {
            headerName: "Price",
            width: 112,
            format: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
          },
          individual: {
            columnId: "COL_ID_PRICE",
            field: "price",
            headerName: "Market price",
            width: 144,
            cellAlign: "start",
            format: { maximumFractionDigits: 4 },
          },
          compiledFromPresetOnly: price,
          compiledWithIndividualOverrides: overriddenPrice,
        },
      };
    }
    case "computed": {
      const weightedPrice = BrunoTablePrototypeCompiledOrderColumns.columns.find(
        (column) => column.columnId === "COL_ID_WEIGHTED_PRICE",
      );
      return {
        question: "Do declared dependencies alone drive the getter and server projection?",
        state: {
          column: weightedPrice,
          completeProjection: BrunoTablePrototypeCompiledOrderColumns.projection,
          compileProof: "row.status is rejected inside this getter because it is not in fields",
        },
      };
    }
    case "save":
      return {
        question: "Does one non-empty atomic save preserve row version and cell field/value pairs?",
        state: BrunoTablePrototypeSampleSave,
      };
    case "contract":
      return {
        question: "Which constraints did the TypeScript compiler prove without TanStack types?",
        state: {
          accepted: [
            "global helpers inside `satisfies BrunoTableColumns<Order>`",
            "row-aware callbacks without a repeated Order generic",
            "number, bigint, boolean, and text field correlation",
            "computed getter return inference",
            "non-empty computed dependencies restricted to Pick<Order, fields[number]>",
            "preset defaults with individual overrides",
            "editable Column Identity → source field → exact value correlation",
            "exact bigint Row Version in the non-empty Save Change Set",
          ],
          rejected: [
            "lowercase or unprefixed Column Identity",
            "number helper targeting a string field",
            "undeclared computed getter dependency",
            "empty computed fields tuple",
            "editable computed column",
            "save cell whose field does not match its Column Identity",
            "duplicate Column Identity during one-time runtime compilation",
          ],
          implementationLeak: "none — the prototype imports no TanStack type",
          consumerShape: BrunoTablePrototypeOrderColumns.map((column) => column.columnId),
        },
      };
  }
}
