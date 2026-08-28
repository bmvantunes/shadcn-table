import { describe, expect, it } from "vitest";

import { assertBrunoTableBenchmarkBudget } from "./benchmark-budget";

describe("BrunoTable benchmark budget sampling", () => {
  it("excludes declared warmups and enforces zero-warmup measured samples", () => {
    expect(() =>
      assertBrunoTableBenchmarkBudget("warmups", [100, 100, ...Array<number>(100).fill(1)], {
        budgetMs: 8.33,
        measuredSampleCount: 100,
        warmupSampleCount: 2,
      }),
    ).not.toThrow();

    expect(() =>
      assertBrunoTableBenchmarkBudget("zero warmups", [10, 10, ...Array<number>(98).fill(1)], {
        budgetMs: 8.33,
        measuredSampleCount: 100,
        warmupSampleCount: 0,
      }),
    ).toThrow("zero warmups exceeded the frame reference with p99 10 ms");
  });
});
