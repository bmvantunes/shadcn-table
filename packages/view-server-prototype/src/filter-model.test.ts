import { describe, expect, it } from "vitest";

import {
  compileWhere,
  initialFilterModel,
  toggleStatus,
  type StatusSetIntent,
} from "./filter-model";

describe("filter translation", () => {
  it("combines external, grid, quick, and set intent through one AND root", () => {
    const where = compileWhere({
      externalRegion: "eu",
      minimumPrice: 100,
      quickFilter: "alp",
      symbolContains: "aa",
      status: { mode: "only", included: ["open", "closed"] },
    });

    expect(where).toEqual([
      { field: "region", type: "equals", filter: "eu" },
      { field: "price", type: "greaterThanOrEqual", filter: 100 },
      { field: "symbol", type: "contains", filter: "aa" },
      {
        type: "OR",
        conditions: [
          { field: "symbol", type: "contains", filter: "alp" },
          { field: "desk", type: "contains", filter: "alp" },
        ],
      },
      { field: "status", type: "in", filter: ["open", "closed"] },
    ]);
  });

  it("compiles none to a real contradiction instead of an empty in filter", () => {
    expect(
      compileWhere({
        ...initialFilterModel,
        status: { mode: "only", included: [] },
      }),
    ).toEqual([
      {
        type: "NOT",
        condition: {
          field: "status",
          type: "in",
          filter: ["open", "closed", "cancelled"],
        },
      },
    ]);
  });

  it("normalizes selecting every value back to no filter", () => {
    let intent: StatusSetIntent = { mode: "only", included: [] };
    intent = toggleStatus(intent, "open");
    intent = toggleStatus(intent, "closed");
    intent = toggleStatus(intent, "cancelled");
    expect(intent).toEqual({ mode: "all-except", excluded: [] });
    expect(compileWhere({ ...initialFilterModel, status: intent })).toEqual([]);
  });
});
