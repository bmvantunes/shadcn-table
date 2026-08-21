import { createMultiHotkeyHandler } from "@tanstack/hotkeys";

import type { Hotkey, HotkeyCallback } from "@tanstack/hotkeys";

export function registerBrunoTableCaptureHotkeys(
  target: Window,
  hotkeys: readonly Hotkey[],
  callback: HotkeyCallback,
): () => void {
  const handlers: Partial<Record<Hotkey, HotkeyCallback>> = {};
  for (const hotkey of hotkeys) {
    handlers[hotkey] = (event, context) => {
      if (event.isComposing) return;
      callback(event, context);
    };
  }
  const handler = createMultiHotkeyHandler(handlers, {
    preventDefault: false,
    stopPropagation: false,
  });
  target.addEventListener("keydown", handler, true);
  return () => target.removeEventListener("keydown", handler, true);
}
