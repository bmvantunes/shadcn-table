import { describe, expect, it } from "vitest";

import { readCompiledColumnValue } from "./cell-value";
import { compileColumns } from "./compile-columns";

describe("readCompiledColumnValue", () => {
  it("preserves __proto__ as an own computed-column dependency", () => {
    const [column] = compileColumns([
      {
        columnId: "COL_ID_PROTO",
        fields: ["__proto__"],
        headerName: "Protocol",
        valueType: "text",
        valueGetter: ({ row }: { readonly row: Readonly<Record<string, unknown>> }) => ({
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
});
