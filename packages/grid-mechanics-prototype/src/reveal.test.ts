import { describe, expect, it } from "vitest";

import { getMinimalRevealOffset } from "./reveal";

const base = {
  leadingInset: 216,
  maxScrollOffset: 10_000,
  scrollOffset: 500,
  trailingInset: 112,
  viewportSize: 900,
};

describe("getMinimalRevealOffset", () => {
  it("does not move when the target is already fully visible", () => {
    expect(getMinimalRevealOffset({ ...base, itemStart: 720, itemEnd: 832 })).toBe(500);
  });

  it("reveals exactly the target end beside an end-pinned column", () => {
    expect(getMinimalRevealOffset({ ...base, itemStart: 1_300, itemEnd: 1_412 })).toBe(624);
  });

  it("reveals exactly the target start beside start-pinned columns", () => {
    expect(getMinimalRevealOffset({ ...base, itemStart: 650, itemEnd: 762 })).toBe(434);
  });

  it("clamps at both scroll boundaries", () => {
    expect(getMinimalRevealOffset({ ...base, itemStart: 0, itemEnd: 112 })).toBe(0);
    expect(
      getMinimalRevealOffset({
        ...base,
        itemStart: 20_000,
        itemEnd: 20_112,
      }),
    ).toBe(10_000);
  });
});
