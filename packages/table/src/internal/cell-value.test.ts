import { describe, expect, it } from "vitest";

import { readCompiledColumnValue } from "./cell-value";
import { compileColumns } from "./compile-columns";
import type { BrunoTableRuntimeRecord } from "./runtime-value";

describe("readCompiledColumnValue", () => {
  it("reads fields admitted by primitive and tuple row types", () => {
    const [stringColumn] = compileColumns([
      {
        columnId: "COL_ID_LENGTH",
        field: "length",
        headerName: "Length",
        valueType: "number",
      },
    ]);
    const [tupleColumn] = compileColumns([
      {
        columnId: "COL_ID_FIRST",
        field: "0",
        headerName: "First",
        valueType: "text",
      },
    ]);

    expect(readCompiledColumnValue(stringColumn!, "Ada")).toBe(3);
    expect(readCompiledColumnValue(tupleColumn!, ["Grace"] as const)).toBe("Grace");
  });

  it("preserves __proto__ as an own computed-column dependency", () => {
    const [column] = compileColumns([
      {
        columnId: "COL_ID_PROTO",
        fields: ["__proto__"],
        headerName: "Protocol",
        valueType: "text",
        valueGetter: ({ row }: { readonly row: BrunoTableRuntimeRecord }) => ({
          own: Object.hasOwn(row, "__proto__"),
          value: row["__proto__"],
        }),
      },
    ]);
    const row = Object.fromEntries([["__proto__", "safe-value"]]);

    expect(readCompiledColumnValue(column!, row)).toEqual({
      own: true,
      value: "safe-value",
    });
  });

  it("passes only the declared row parameter to computed getters", () => {
    let parameterKeys: readonly string[] = [];
    const [column] = compileColumns([
      {
        columnId: "COL_ID_SHAPE",
        fields: ["length"],
        headerName: "Shape",
        valueType: "number",
        valueGetter: (parameters: { readonly row: BrunoTableRuntimeRecord }) => {
          parameterKeys = Object.keys(parameters);
          return parameters.row["length"];
        },
      },
    ]);

    expect(readCompiledColumnValue(column!, "Ada")).toBe(3);
    expect(parameterKeys).toEqual(["row"]);
  });

  it("invokes computed getters without a receiver", () => {
    let receiverWasUndefined = false;
    const [column] = compileColumns([
      {
        columnId: "COL_ID_COMPUTED_RECEIVER",
        fields: ["value"],
        headerName: "Computed receiver",
        valueType: "number",
        valueGetter: function (this: void, { row }: { readonly row: BrunoTableRuntimeRecord }) {
          receiverWasUndefined = this === undefined;
          return row["value"];
        },
      },
    ]);

    expect(readCompiledColumnValue(column!, { value: 1 })).toBe(1);
    expect(receiverWasUndefined).toBe(true);
  });
});
