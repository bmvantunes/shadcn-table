import { describe, expect, test } from "vite-plus/test";

import { getMenubarContentSide } from "./menubar";

describe("getMenubarContentSide", () => {
  test("uses orientation-aware defaults and preserves an explicit side", () => {
    expect(getMenubarContentSide("horizontal", undefined)).toBe("bottom");
    expect(getMenubarContentSide("vertical", undefined)).toBe("inline-end");
    expect(getMenubarContentSide("vertical", "top")).toBe("top");
  });
});
