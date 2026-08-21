import { describe, expect, it } from "vitest";

import {
  BRUNO_TABLE_BASE_HOTKEY_REGISTRATION_COUNT,
  BRUNO_TABLE_COLUMN_GESTURE_ESCAPE_HOTKEYS,
  BRUNO_TABLE_ESCAPE_HOTKEYS,
  BRUNO_TABLE_FILTER_WORKFLOW_HOTKEY_REGISTRATION_COUNT,
  BRUNO_TABLE_GRID_HOTKEYS,
  brunoTableHotkeyRegistrationBound,
} from "./hotkey-adapter";

describe("BrunoTable hotkey Adapter contract", () => {
  it("keeps one table registration set bounded independently of rendered geometry", () => {
    expect(BRUNO_TABLE_GRID_HOTKEYS).toContain("Mod+ArrowUp");
    expect(BRUNO_TABLE_GRID_HOTKEYS).toContain("Mod+ArrowDown");
    expect(BRUNO_TABLE_GRID_HOTKEYS).toContain("Escape");
    expect(new Set(BRUNO_TABLE_GRID_HOTKEYS).size).toBe(BRUNO_TABLE_GRID_HOTKEYS.length);
    expect(brunoTableHotkeyRegistrationBound(1, 1)).toBe(
      brunoTableHotkeyRegistrationBound(10_000, 1_000),
    );
  });

  it("does not admit a per-cell, per-row, or per-header registration dimension", () => {
    expect(BRUNO_TABLE_ESCAPE_HOTKEYS).toHaveLength(16);
    expect(BRUNO_TABLE_COLUMN_GESTURE_ESCAPE_HOTKEYS).toBe(BRUNO_TABLE_ESCAPE_HOTKEYS);
    expect(BRUNO_TABLE_GRID_HOTKEYS).toHaveLength(58);
    expect(BRUNO_TABLE_BASE_HOTKEY_REGISTRATION_COUNT).toBe(74);
    expect(BRUNO_TABLE_FILTER_WORKFLOW_HOTKEY_REGISTRATION_COUNT).toBe(1);
    expect(brunoTableHotkeyRegistrationBound(0, 0)).toBe(
      BRUNO_TABLE_BASE_HOTKEY_REGISTRATION_COUNT,
    );
    expect(brunoTableHotkeyRegistrationBound(0, 0, 1)).toBe(
      BRUNO_TABLE_BASE_HOTKEY_REGISTRATION_COUNT +
        BRUNO_TABLE_FILTER_WORKFLOW_HOTKEY_REGISTRATION_COUNT,
    );
  });
});
