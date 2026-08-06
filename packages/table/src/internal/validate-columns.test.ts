import { describe, expect, it } from "vitest";

import { ColumnConfigurationError, validateColumns } from "./validate-columns";

describe("validateColumns", () => {
  it("accepts unique namespaced uppercase identities", () => {
    expect(() => {
      validateColumns([
        { columnId: "COL_ID_SYMBOL", headerName: "Symbol" },
        { columnId: "COL_ID_PRICE_2", headerName: "Price" },
      ]);
    }).not.toThrow();
  });

  it("rejects identities that cannot be trusted at runtime", () => {
    expect(() => {
      validateColumns([{ columnId: "price", headerName: "Price" }]);
    }).toThrow(ColumnConfigurationError);

    expect(() => {
      validateColumns([{ columnId: "COL_ID_price", headerName: "Price" }]);
    }).toThrow(ColumnConfigurationError);

    for (const columnId of ["COL_ID_é", "COL_ID_ß", "COL_ID_δ"]) {
      expect(() => {
        validateColumns([{ columnId, headerName: "Price" }]);
      }).toThrow(ColumnConfigurationError);
    }
  });

  it("rejects duplicate identities", () => {
    expect(() => {
      validateColumns([
        { columnId: "COL_ID_PRICE", headerName: "Price" },
        { columnId: "COL_ID_PRICE", headerName: "Unit price" },
      ]);
    }).toThrow("BrunoTable columnId must be unique: COL_ID_PRICE");
  });

  it("rejects missing, non-string, and blank header names", () => {
    expect(() => {
      validateColumns([{ columnId: "COL_ID_PRICE" }]);
    }).toThrow("BrunoTable headerName must be a non-empty string for column: COL_ID_PRICE");

    expect(() => {
      validateColumns([{ columnId: "COL_ID_PRICE", headerName: 42 }]);
    }).toThrow(ColumnConfigurationError);

    expect(() => {
      validateColumns([{ columnId: "COL_ID_PRICE", headerName: "   " }]);
    }).toThrow(ColumnConfigurationError);
  });
});
