import { describe, expect, it } from "vitest";

import { BrunoTableNumberColumn } from "./column-helpers";

describe("BrunoTable Column Helper runtime capability guards", () => {
  it("rejects a non-function validator before returning a helper column", () => {
    expect(() =>
      Reflect.apply(BrunoTableNumberColumn, undefined, [
        {
          columnId: "COL_ID_INVALID_VALIDATE",
          field: "value",
          headerName: "Value",
          validate: "not-a-function",
        },
      ]),
    ).toThrow("validate must be a function");
  });
});
