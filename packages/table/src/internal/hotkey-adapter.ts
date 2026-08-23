import {
  detectPlatform,
  getKeyStateTracker,
  useHotkeys,
  useKeyHold,
} from "@tanstack/react-hotkeys";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import type {
  Hotkey,
  HotkeyCallback,
  RegisterableHotkey,
  UseHotkeyDefinition,
} from "@tanstack/react-hotkeys";
import type { RefCallback, RefObject } from "react";
import type { BrunoTableNavigationCommand } from "./navigation";
import {
  registerBrunoTableCaptureHotkeys,
  registerBrunoTableForeignDocumentHeldShift,
  registerBrunoTableForeignDocumentHotkeys,
  isBrunoTableForeignDocumentShiftHeld,
} from "./hotkey-capture";

// Supported by the manager and KeyboardEvent, but omitted from 0.10.0's
// closed Key union. Keep the compatibility assertion at this one Adapter seam.
export const BRUNO_TABLE_CONTEXT_MENU_HOTKEY = "ContextMenu" as RegisterableHotkey;

type BrunoTableHotkeyBinding = Readonly<{
  hotkey: RegisterableHotkey;
  allowInTextInput?: boolean;
  onTrigger: HotkeyCallback;
}>;

export type BrunoTableHotkeyGesture = Readonly<Pick<KeyboardEvent, "defaultPrevented" | "target">> &
  Pick<KeyboardEvent, "preventDefault">;

export const BRUNO_TABLE_ESCAPE_HOTKEYS: readonly Hotkey[] = Object.freeze([
  "Escape",
  "Control+Escape",
  "Alt+Escape",
  "Shift+Escape",
  "Meta+Escape",
  "Control+Alt+Escape",
  "Control+Shift+Escape",
  "Control+Meta+Escape",
  "Alt+Shift+Escape",
  "Alt+Meta+Escape",
  "Shift+Meta+Escape",
  "Control+Alt+Shift+Escape",
  "Control+Alt+Meta+Escape",
  "Control+Shift+Meta+Escape",
  "Alt+Shift+Meta+Escape",
  "Control+Alt+Shift+Meta+Escape",
] satisfies readonly Hotkey[]);

export type BrunoTableGridHotkeyCommands = Readonly<{
  escape: (event: BrunoTableHotkeyGesture) => void;
  shiftTab: (event: BrunoTableHotkeyGesture) => void;
  headerMenu: (event: BrunoTableHotkeyGesture) => void;
  copy: (event: BrunoTableHotkeyGesture) => void;
  selectAll?: ((event: BrunoTableHotkeyGesture) => void) | undefined;
  resize: (
    event: BrunoTableHotkeyGesture,
    adjustment: "minimum" | "maximum" | -1 | 1,
    step: number,
    allowActiveHeader?: boolean,
  ) => void;
  activate: (
    event: BrunoTableHotkeyGesture,
    intent: "enter" | "f2" | "space",
    alt: boolean,
    shift: boolean,
  ) => void;
  navigate: (event: BrunoTableHotkeyGesture, command: BrunoTableNavigationCommand) => void;
  page: (event: BrunoTableHotkeyGesture, direction: -1 | 1) => void;
}>;

function createBrunoTableGridHotkeyBindings(
  commands: BrunoTableGridHotkeyCommands,
): readonly BrunoTableHotkeyBinding[] {
  return [
    ...BRUNO_TABLE_ESCAPE_HOTKEYS.map((hotkey) => ({
      hotkey,
      allowInTextInput: true,
      onTrigger: commands.escape,
    })),
    { hotkey: "Shift+Tab", allowInTextInput: true, onTrigger: commands.shiftTab },
    { hotkey: "Shift+F10", onTrigger: commands.headerMenu },
    { hotkey: BRUNO_TABLE_CONTEXT_MENU_HOTKEY, onTrigger: commands.headerMenu },
    { hotkey: "Mod+C", onTrigger: commands.copy },
    ...(commands.selectAll === undefined
      ? []
      : ([{ hotkey: "Mod+A", onTrigger: commands.selectAll }] as const)),
    {
      hotkey: "Alt+ArrowLeft",
      onTrigger: (event) => commands.resize(event, -1, 10, true),
    },
    {
      hotkey: "Alt+ArrowRight",
      onTrigger: (event) => commands.resize(event, 1, 10, true),
    },
    {
      hotkey: "Alt+Shift+ArrowLeft",
      onTrigger: (event) => commands.resize(event, -1, 50, true),
    },
    {
      hotkey: "Alt+Shift+ArrowRight",
      onTrigger: (event) => commands.resize(event, 1, 50, true),
    },
    {
      hotkey: "Enter",
      onTrigger: (event) => commands.activate(event, "enter", false, false),
    },
    {
      hotkey: "Shift+Enter",
      onTrigger: (event) => commands.activate(event, "enter", false, true),
    },
    {
      hotkey: "Alt+Enter",
      onTrigger: (event) => commands.activate(event, "enter", true, false),
    },
    {
      hotkey: "Alt+Shift+Enter",
      onTrigger: (event) => commands.activate(event, "enter", true, true),
    },
    {
      hotkey: "Space",
      onTrigger: (event) => commands.activate(event, "space", false, false),
    },
    {
      hotkey: "Shift+Space",
      onTrigger: (event) => commands.activate(event, "space", false, true),
    },
    { hotkey: "F2", onTrigger: (event) => commands.activate(event, "f2", false, false) },
    {
      hotkey: "ArrowUp",
      onTrigger: (event) => commands.navigate(event, { type: "step", direction: "up" }),
    },
    {
      hotkey: "ArrowDown",
      onTrigger: (event) => commands.navigate(event, { type: "step", direction: "down" }),
    },
    {
      hotkey: "ArrowLeft",
      onTrigger: (event) => {
        commands.resize(event, -1, 10);
        commands.navigate(event, { type: "step", direction: "left" });
      },
    },
    {
      hotkey: "ArrowRight",
      onTrigger: (event) => {
        commands.resize(event, 1, 10);
        commands.navigate(event, { type: "step", direction: "right" });
      },
    },
    {
      hotkey: "Shift+ArrowUp",
      onTrigger: (event) => commands.navigate(event, { type: "step", direction: "up" }),
    },
    {
      hotkey: "Shift+ArrowDown",
      onTrigger: (event) => commands.navigate(event, { type: "step", direction: "down" }),
    },
    {
      hotkey: "Shift+ArrowLeft",
      onTrigger: (event) => {
        commands.resize(event, -1, 50);
        commands.navigate(event, { type: "step", direction: "left" });
      },
    },
    {
      hotkey: "Shift+ArrowRight",
      onTrigger: (event) => {
        commands.resize(event, 1, 50);
        commands.navigate(event, { type: "step", direction: "right" });
      },
    },
    {
      hotkey: "Mod+ArrowUp",
      onTrigger: (event) => commands.navigate(event, { type: "column-edge", edge: "start" }),
    },
    {
      hotkey: "Mod+ArrowDown",
      onTrigger: (event) => commands.navigate(event, { type: "column-edge", edge: "end" }),
    },
    {
      hotkey: "Mod+ArrowLeft",
      onTrigger: (event) => {
        commands.resize(event, -1, 10);
        commands.navigate(event, { type: "row-edge", edge: "start" });
      },
    },
    {
      hotkey: "Mod+ArrowRight",
      onTrigger: (event) => {
        commands.resize(event, 1, 10);
        commands.navigate(event, { type: "row-edge", edge: "end" });
      },
    },
    {
      hotkey: "Mod+Shift+ArrowUp",
      onTrigger: (event) => commands.navigate(event, { type: "column-edge", edge: "start" }),
    },
    {
      hotkey: "Mod+Shift+ArrowDown",
      onTrigger: (event) => commands.navigate(event, { type: "column-edge", edge: "end" }),
    },
    {
      hotkey: "Mod+Shift+ArrowLeft",
      onTrigger: (event) => {
        commands.resize(event, -1, 50);
        commands.navigate(event, { type: "row-edge", edge: "start" });
      },
    },
    {
      hotkey: "Mod+Shift+ArrowRight",
      onTrigger: (event) => {
        commands.resize(event, 1, 50);
        commands.navigate(event, { type: "row-edge", edge: "end" });
      },
    },
    {
      hotkey: "Home",
      onTrigger: (event) => {
        commands.resize(event, "minimum", 0);
        commands.navigate(event, { type: "row-edge", edge: "start" });
      },
    },
    {
      hotkey: "End",
      onTrigger: (event) => {
        commands.resize(event, "maximum", 0);
        commands.navigate(event, { type: "row-edge", edge: "end" });
      },
    },
    {
      hotkey: "Shift+Home",
      onTrigger: (event) => {
        commands.resize(event, "minimum", 0);
        commands.navigate(event, { type: "row-edge", edge: "start" });
      },
    },
    {
      hotkey: "Shift+End",
      onTrigger: (event) => {
        commands.resize(event, "maximum", 0);
        commands.navigate(event, { type: "row-edge", edge: "end" });
      },
    },
    {
      hotkey: "Mod+Home",
      onTrigger: (event) => {
        commands.resize(event, "minimum", 0);
        commands.navigate(event, { type: "grid-edge", edge: "start" });
      },
    },
    {
      hotkey: "Mod+End",
      onTrigger: (event) => {
        commands.resize(event, "maximum", 0);
        commands.navigate(event, { type: "grid-edge", edge: "end" });
      },
    },
    {
      hotkey: "Mod+Shift+Home",
      onTrigger: (event) => {
        commands.resize(event, "minimum", 0);
        commands.navigate(event, { type: "grid-edge", edge: "start" });
      },
    },
    {
      hotkey: "Mod+Shift+End",
      onTrigger: (event) => {
        commands.resize(event, "maximum", 0);
        commands.navigate(event, { type: "grid-edge", edge: "end" });
      },
    },
    { hotkey: "PageUp", onTrigger: (event) => commands.page(event, -1) },
    { hotkey: "PageDown", onTrigger: (event) => commands.page(event, 1) },
    { hotkey: "Shift+PageUp", onTrigger: (event) => commands.page(event, -1) },
    { hotkey: "Shift+PageDown", onTrigger: (event) => commands.page(event, 1) },
  ];
}

const NOOP_GRID_COMMANDS: BrunoTableGridHotkeyCommands = Object.freeze({
  escape: () => undefined,
  shiftTab: () => undefined,
  headerMenu: () => undefined,
  copy: () => undefined,
  resize: () => undefined,
  activate: () => undefined,
  navigate: () => undefined,
  page: () => undefined,
});

export const BRUNO_TABLE_GRID_HOTKEYS: readonly RegisterableHotkey[] = Object.freeze(
  createBrunoTableGridHotkeyBindings(NOOP_GRID_COMMANDS).map((binding) => binding.hotkey),
);
export const BRUNO_TABLE_ROW_SELECTION_HOTKEYS: readonly RegisterableHotkey[] = Object.freeze([
  "Mod+A",
]);
export const BRUNO_TABLE_GRID_DOCUMENT_ESCAPE_HOTKEY_REGISTRATION_COUNT: number =
  BRUNO_TABLE_ESCAPE_HOTKEYS.length;
export const BRUNO_TABLE_GRID_LOCAL_HOTKEY_REGISTRATION_COUNT: number =
  BRUNO_TABLE_GRID_HOTKEYS.length - BRUNO_TABLE_GRID_DOCUMENT_ESCAPE_HOTKEY_REGISTRATION_COUNT;
export const BRUNO_TABLE_REACT_HOTKEY_REGISTRATION_COUNT: number = BRUNO_TABLE_GRID_HOTKEYS.length;
export const BRUNO_TABLE_COLUMN_GESTURE_ESCAPE_HOTKEYS: readonly Hotkey[] =
  BRUNO_TABLE_ESCAPE_HOTKEYS;
// One table owns every React registration plus the complete modifier-insensitive
// capture-phase column-gesture Escape definition set.
export const BRUNO_TABLE_BASE_HOTKEY_REGISTRATION_COUNT: number =
  BRUNO_TABLE_GRID_HOTKEYS.length + BRUNO_TABLE_COLUMN_GESTURE_ESCAPE_HOTKEYS.length;
export const BRUNO_TABLE_ROW_SELECTION_HOTKEY_REGISTRATION_COUNT: number =
  BRUNO_TABLE_ROW_SELECTION_HOTKEYS.length;
export const BRUNO_TABLE_FILTER_WORKFLOW_HOTKEY_REGISTRATION_COUNT: number = 1;

const BRUNO_TABLE_WORKFLOW_ACTIONS = new WeakMap<HTMLElement, () => void>();

export function registerBrunoTableHotkeyWorkflowAction(
  owner: HTMLElement,
  action: () => void,
): () => void {
  BRUNO_TABLE_WORKFLOW_ACTIONS.set(owner, action);
  return () => {
    if (BRUNO_TABLE_WORKFLOW_ACTIONS.get(owner) === action) {
      BRUNO_TABLE_WORKFLOW_ACTIONS.delete(owner);
    }
  };
}

export function requestBrunoTableHotkeyWorkflowAction(owner: HTMLElement): boolean {
  const action = BRUNO_TABLE_WORKFLOW_ACTIONS.get(owner);
  if (action === undefined) return false;
  action();
  return true;
}

export function isBrunoTableHotkeyWorkflowOwner(owner: HTMLElement): boolean {
  return BRUNO_TABLE_WORKFLOW_ACTIONS.has(owner);
}

export function useBrunoTableHotkeyWorkflowAction(action: () => void): RefCallback<HTMLElement> {
  const cleanupRef = useRef<() => void>(() => undefined);
  const actionRef = useRef(action);
  useEffect(() => {
    actionRef.current = action;
  }, [action]);
  useEffect(() => () => cleanupRef.current(), []);
  return useCallback((owner) => {
    cleanupRef.current();
    cleanupRef.current =
      owner === null
        ? () => undefined
        : registerBrunoTableHotkeyWorkflowAction(owner, () => actionRef.current());
  }, []);
}

/**
 * The registration bound is deliberately independent of mounted geometry. The
 * arguments make that invariant directly benchmarkable without exposing the
 * private Adapter from the package root.
 */
export function brunoTableHotkeyRegistrationBound(
  _mountedRows: number,
  _mountedColumns: number,
  activeFilterWorkflows = 0,
  rowSelection = false,
): number {
  return (
    BRUNO_TABLE_BASE_HOTKEY_REGISTRATION_COUNT +
    activeFilterWorkflows * BRUNO_TABLE_FILTER_WORKFLOW_HOTKEY_REGISTRATION_COUNT +
    (rowSelection ? BRUNO_TABLE_ROW_SELECTION_HOTKEY_REGISTRATION_COUNT : 0)
  );
}

/** One table-local bridge initializes TanStack's held-key lifecycle without per-cell subscriptions. */
export function BrunoTableHeldShiftHotkeyAdapter({
  owner,
}: {
  readonly owner: RefObject<HTMLElement | null>;
}): null {
  useKeyHold("Shift");
  useEffect(() => {
    const ownerDocument = owner.current?.ownerDocument;
    if (
      ownerDocument === undefined ||
      ownerDocument.defaultView === (typeof window === "undefined" ? undefined : window)
    ) {
      return;
    }
    return registerBrunoTableForeignDocumentHeldShift(ownerDocument);
  }, [owner]);
  return null;
}

/** Reads TanStack's shared held-key state synchronously for a pointer command. */
export function isBrunoTableHotkeyHeld(
  key: "Shift",
  owner?: Readonly<{ readonly ownerDocument: Document | null }>,
): boolean {
  const ownerDocument = owner?.ownerDocument;
  if (
    ownerDocument !== undefined &&
    ownerDocument !== null &&
    ownerDocument.defaultView !== (typeof window === "undefined" ? undefined : window)
  ) {
    return isBrunoTableForeignDocumentShiftHeld(ownerDocument);
  }
  return getKeyStateTracker().isKeyHeld(key);
}

/**
 * React boundary for every BrunoTable-owned shortcut. TanStack owns matching,
 * Mod normalization, repeat delivery, registration lifecycle, and listeners;
 * command callbacks own table/workflow eligibility and event effects.
 */
function useBrunoTableHotkeys(
  target: RefObject<HTMLElement | null> | Document | Window | null,
  bindings: readonly BrunoTableHotkeyBinding[],
  conflictBehavior: "allow" | "error",
): void {
  const definitions: UseHotkeyDefinition[] = bindings.map((binding) => ({
    hotkey: binding.hotkey,
    callback: (event, context) => {
      if (event.isComposing) return;
      binding.onTrigger(event, context);
    },
    options: { ignoreInputs: binding.allowInTextInput !== true },
  }));

  useHotkeys(definitions, {
    conflictBehavior,
    enabled: true,
    eventType: "keydown",
    platform: detectPlatform(),
    preventDefault: false,
    requireReset: false,
    stopPropagation: false,
    target,
  });
}

function ownsBrunoTableHotkeyTarget(owner: HTMLElement | null, eventTarget: EventTarget | null) {
  const OwnerElement = owner?.ownerDocument.defaultView?.Element;
  const ownerBoundary = owner?.closest("[data-bruno-table]");
  return (
    owner !== null &&
    OwnerElement !== undefined &&
    eventTarget instanceof OwnerElement &&
    ownerBoundary !== null &&
    eventTarget.closest("[data-bruno-table]") === ownerBoundary
  );
}

export function useBrunoTableGridHotkeys(
  target: RefObject<HTMLElement | null>,
  commands: BrunoTableGridHotkeyCommands,
): void {
  const ownerDocumentRef = useRef<Document | null>(null);
  const reactDocumentTargetRef = useRef<Document | null>(null);
  useLayoutEffect(() => {
    const ownerDocument = target.current?.ownerDocument ?? null;
    ownerDocumentRef.current = ownerDocument;
    reactDocumentTargetRef.current =
      ownerDocument?.defaultView === (typeof window === "undefined" ? undefined : window)
        ? ownerDocument
        : null;
  });
  const bindings = createBrunoTableGridHotkeyBindings(commands);
  const ownerScopedBindings = bindings.map((binding) => ({
    ...binding,
    onTrigger: ((event, context) => {
      if (!ownsBrunoTableHotkeyTarget(target.current, event.target)) return;
      binding.onTrigger(event, context);
    }) satisfies HotkeyCallback,
  }));
  const escapeCommandRef = useRef(commands.escape);
  useEffect(() => {
    escapeCommandRef.current = commands.escape;
  }, [commands.escape]);
  const escapeBindings = ownerScopedBindings.slice(0, BRUNO_TABLE_ESCAPE_HOTKEYS.length);
  useBrunoTableHotkeys(
    target,
    ownerScopedBindings.slice(BRUNO_TABLE_ESCAPE_HOTKEYS.length),
    "error",
  );
  // React Hotkeys accepts Documents directly but types refs as element-only.
  // The ref is resolved after this hook's layout effect and before its effect.
  useBrunoTableHotkeys(
    reactDocumentTargetRef as unknown as RefObject<HTMLElement | null>,
    escapeBindings,
    "allow",
  );
  const foreignRegistrationRef = useRef<
    Readonly<{ owner: HTMLElement; cleanup: () => void }> | undefined
  >(undefined);
  useEffect(() => {
    const owner = target.current;
    const ownerDocument = ownerDocumentRef.current;
    const previous = foreignRegistrationRef.current;
    if (previous?.owner === owner) return;
    previous?.cleanup();
    foreignRegistrationRef.current = undefined;
    if (
      owner === null ||
      ownerDocument === null ||
      ownerDocument.defaultView === (typeof window === "undefined" ? undefined : window)
    ) {
      return;
    }
    const escapeBindings = BRUNO_TABLE_ESCAPE_HOTKEYS.map((hotkey) => ({
      hotkey,
      onTrigger: ((event) => {
        const currentOwner = target.current;
        if (!ownsBrunoTableHotkeyTarget(currentOwner, event.target)) return;
        escapeCommandRef.current(event);
      }) satisfies HotkeyCallback,
    }));
    const cleanupDocument = registerBrunoTableForeignDocumentHotkeys(ownerDocument, escapeBindings);
    foreignRegistrationRef.current = {
      owner,
      cleanup: cleanupDocument,
    };
  });
  useEffect(
    () => () => {
      foreignRegistrationRef.current?.cleanup();
      foreignRegistrationRef.current = undefined;
    },
    [],
  );
}

export function useBrunoTableColumnGestureEscape(
  target: RefObject<HTMLElement | null>,
  onTrigger: (event: BrunoTableHotkeyGesture) => void,
): void {
  const onTriggerRef = useRef(onTrigger);
  useEffect(() => {
    onTriggerRef.current = onTrigger;
  }, [onTrigger]);
  const registrationRef = useRef<
    Readonly<{ ownerWindow: Window; cleanup: () => void }> | undefined
  >(undefined);
  useEffect(() => {
    const ownerWindow = target.current?.ownerDocument.defaultView;
    const previous = registrationRef.current;
    if (previous?.ownerWindow === ownerWindow) return;
    previous?.cleanup();
    registrationRef.current = undefined;
    if (ownerWindow === undefined || ownerWindow === null) return;
    const cleanup = registerBrunoTableCaptureHotkeys(
      ownerWindow,
      BRUNO_TABLE_COLUMN_GESTURE_ESCAPE_HOTKEYS,
      (event) => onTriggerRef.current(event),
    );
    registrationRef.current = { ownerWindow, cleanup };
  });
  useEffect(
    () => () => {
      registrationRef.current?.cleanup();
      registrationRef.current = undefined;
    },
    [],
  );
}

export function useBrunoTableFilterWorkflowEscape(
  target: HTMLElement | null,
  onTrigger: (event: BrunoTableHotkeyGesture) => void,
): void {
  const targetRef = useMemo(() => ({ current: target }), [target]);
  useBrunoTableHotkeys(
    targetRef,
    [{ hotkey: "Escape", allowInTextInput: true, onTrigger }],
    "error",
  );
}
