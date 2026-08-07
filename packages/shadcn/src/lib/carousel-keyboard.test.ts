import { describe, expect, test } from "vite-plus/test";

import { getCarouselKeyboardAction } from "./carousel-keyboard";

describe("getCarouselKeyboardAction", () => {
  test("maps owner-focused arrow keys for both orientations", () => {
    expect(getCarouselKeyboardAction("horizontal", "ArrowLeft", true, false)).toBe("previous");
    expect(getCarouselKeyboardAction("horizontal", "ArrowRight", true, false)).toBe("next");
    expect(getCarouselKeyboardAction("vertical", "ArrowUp", true, false)).toBe("previous");
    expect(getCarouselKeyboardAction("vertical", "ArrowDown", true, false)).toBe("next");
  });

  test.each(["tab", "slider", "radio", "menu"])(
    "does not intercept arrow keys owned by a nested %s widget",
    () => {
      expect(getCarouselKeyboardAction("horizontal", "ArrowRight", false, false)).toBeUndefined();
      expect(getCarouselKeyboardAction("vertical", "ArrowDown", false, false)).toBeUndefined();
    },
  );

  test("honours an already prevented owner event", () => {
    expect(getCarouselKeyboardAction("horizontal", "ArrowRight", true, true)).toBeUndefined();
  });
});
