import { describe, expect, it } from "vitest";

import {
  BRUNO_TABLE_BASE_HOTKEY_REGISTRATION_COUNT,
  BRUNO_TABLE_FILTER_WORKFLOW_HOTKEY_REGISTRATION_COUNT,
  BRUNO_TABLE_GRID_HOTKEYS,
  brunoTableHotkeyRegistrationBound,
} from "./hotkey-adapter";

describe("BrunoTable hotkey Adapter contract", () => {
  it("keeps one table registration set bounded independently of rendered geometry", () => {
    expect(BRUNO_TABLE_GRID_HOTKEYS).toContain("Mod+ArrowUp");
    expect(BRUNO_TABLE_GRID_HOTKEYS).toContain("Mod+ArrowDown");
    expect(BRUNO_TABLE_GRID_HOTKEYS).toContain("Escape");
    expect(brunoTableHotkeyRegistrationBound(1, 1)).toBe(
      brunoTableHotkeyRegistrationBound(10_000, 1_000),
    );
  });

  it("does not admit a per-cell, per-row, or per-header registration dimension", () => {
    expect(brunoTableHotkeyRegistrationBound(0, 0)).toBe(
      BRUNO_TABLE_BASE_HOTKEY_REGISTRATION_COUNT,
    );
    expect(brunoTableHotkeyRegistrationBound(0, 0, 1)).toBe(
      BRUNO_TABLE_BASE_HOTKEY_REGISTRATION_COUNT +
        BRUNO_TABLE_FILTER_WORKFLOW_HOTKEY_REGISTRATION_COUNT,
    );
  });
});
