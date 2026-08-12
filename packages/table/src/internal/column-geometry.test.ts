import { describe, expect, it } from "vitest";

import {
  projectBrunoTableLogicalColumnIndex,
  resolveBrunoTableReorderTargetIndex,
} from "./column-geometry";

const mountedRightWindow = [
  { columnIndex: 4, left: 0, width: 100 },
  { columnIndex: 5, left: 100, width: 100 },
  { columnIndex: 6, left: 200, width: 100 },
] as const;

describe("BrunoTable virtual reorder geometry", () => {
  it("resolves a target from absolute indexes when the source is offscreen", () => {
    expect(resolveBrunoTableReorderTargetIndex(mountedRightWindow, 0, "ltr", 1, 0, 8)).toBe(3);
    expect(resolveBrunoTableReorderTargetIndex(mountedRightWindow, 250, "ltr", 1, 0, 8)).toBe(6);
  });

  it("uses visual slots consistently in RTL", () => {
    const cells = [
      { columnIndex: 0, left: 200, width: 100 },
      { columnIndex: 1, left: 100, width: 100 },
      { columnIndex: 2, left: 0, width: 100 },
    ] as const;
    expect(resolveBrunoTableReorderTargetIndex(cells, 280, "rtl", 1, 0, 2)).toBe(0);
    expect(resolveBrunoTableReorderTargetIndex(cells, 20, "rtl", 1, 0, 2)).toBe(2);
  });

  it("projects mounted columns through an unmounted source placeholder", () => {
    expect(projectBrunoTableLogicalColumnIndex(4, 1, 6)).toBe(3);
    expect(projectBrunoTableLogicalColumnIndex(5, 1, 6)).toBe(4);
    expect(projectBrunoTableLogicalColumnIndex(6, 1, 6)).toBe(5);
    expect(projectBrunoTableLogicalColumnIndex(1, 6, 1)).toBe(2);
    expect(projectBrunoTableLogicalColumnIndex(4, 6, 1)).toBe(5);
  });
});
