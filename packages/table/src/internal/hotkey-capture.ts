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
  for (const binding of bindings) {
    handlers[binding.hotkey as Hotkey] = (event, context) => {
      if (event.isComposing) return;
      binding.onTrigger(event, context);
    };
  }
  const bubbleHandler = createMultiHotkeyHandler(handlers, {
    preventDefault: false,
    stopPropagation: false,
  });
  target.addEventListener("keydown", bubbleHandler);
  return () => target.removeEventListener("keydown", bubbleHandler);
}

type ForeignHeldShiftRegistration = {
  count: number;
  held: boolean;
  cleanup: () => void;
};

const foreignHeldShiftRegistrations = new WeakMap<Document, ForeignHeldShiftRegistration>();

export function registerBrunoTableForeignDocumentHeldShift(target: Document): () => void {
  const existing = foreignHeldShiftRegistrations.get(target);
  if (existing !== undefined) {
    existing.count += 1;
    return () => releaseForeignHeldShift(target, existing);
  }
  const registration: ForeignHeldShiftRegistration = {
    count: 1,
    held: false,
    cleanup: () => undefined,
  };
  const keydown = createMultiHotkeyHandler(
    { ["Shift+Shift" as Hotkey]: () => (registration.held = true) },
    { preventDefault: false, stopPropagation: false },
  );
  const keyup = createMultiHotkeyHandler(
    { ["Shift" as Hotkey]: () => (registration.held = false) },
    { preventDefault: false, stopPropagation: false },
  );
  const blur = () => (registration.held = false);
  target.addEventListener("keydown", keydown);
  target.addEventListener("keyup", keyup);
  target.defaultView?.addEventListener("blur", blur);
  registration.cleanup = () => {
    target.removeEventListener("keydown", keydown);
    target.removeEventListener("keyup", keyup);
    target.defaultView?.removeEventListener("blur", blur);
  };
  foreignHeldShiftRegistrations.set(target, registration);
  return () => releaseForeignHeldShift(target, registration);
}

export function isBrunoTableForeignDocumentShiftHeld(target: Document): boolean {
  return foreignHeldShiftRegistrations.get(target)?.held ?? false;
}

function releaseForeignHeldShift(
  target: Document,
  registration: ForeignHeldShiftRegistration,
): void {
  registration.count -= 1;
  if (registration.count > 0) return;
  registration.cleanup();
  foreignHeldShiftRegistrations.delete(target);
}
