import { createMultiHotkeyHandler } from "@tanstack/hotkeys";

import type { Hotkey, HotkeyCallback, RegisterableHotkey } from "@tanstack/hotkeys";

export type BrunoTableCoreHotkeyBinding = Readonly<{
  hotkey: RegisterableHotkey;
  onTrigger: HotkeyCallback;
}>;

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

export function registerBrunoTableForeignDocumentHotkeys(
  target: Document,
  bindings: readonly BrunoTableCoreHotkeyBinding[],
): () => void {
  const handlers: Partial<Record<Hotkey, HotkeyCallback>> = {};
  for (const binding of bindings) handlers[binding.hotkey as Hotkey] = binding.onTrigger;
  const bubbleHandler = createMultiHotkeyHandler(handlers, {
    preventDefault: false,
    stopPropagation: false,
  });
  target.addEventListener("keydown", bubbleHandler);
  return () => target.removeEventListener("keydown", bubbleHandler);
}
