import { describe, expect, it } from "vitest";

import { ColumnConfigurationError, validateColumns } from "./validate-columns";

describe("validateColumns", () => {
  it("accepts unique namespaced uppercase identities", () => {
    expect(() => {
      validateColumns([{ columnId: "COL_ID_SYMBOL" }, { columnId: "COL_ID_PRICE_2" }]);
    }).not.toThrow();
  });

  it("rejects identities that cannot be trusted at runtime", () => {
    expect(() => {
      validateColumns([{ columnId: "price" }]);
    }).toThrow(ColumnConfigurationError);

    expect(() => {
      validateColumns([{ columnId: "COL_ID_price" }]);
    }).toThrow(ColumnConfigurationError);
  });

  it("rejects duplicate identities", () => {
    expect(() => {
      validateColumns([{ columnId: "COL_ID_PRICE" }, { columnId: "COL_ID_PRICE" }]);
    }).toThrow("BrunoTable columnId must be unique: COL_ID_PRICE");
  });
});
