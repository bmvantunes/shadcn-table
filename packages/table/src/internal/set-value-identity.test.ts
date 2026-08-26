import { describe, expect, it } from "vitest";

import { compileColumns } from "./compile-columns";
import { brunoTableSetValueKey, createBrunoTableSetValueIndex } from "./set-value-identity";

describe("BrunoTable Set value identity", () => {
  it("keeps null, undefined, and an exact empty string in distinct stable buckets", () => {
    const column = compileColumns([
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "text",
      },
    ])[0]!;

    const keys = [null, undefined, ""].map((value) => brunoTableSetValueKey(column, value));
    expect(new Set(keys).size).toBe(3);
    expect(createBrunoTableSetValueIndex(column, [null, undefined, ""]).size).toBe(3);
  });
});
