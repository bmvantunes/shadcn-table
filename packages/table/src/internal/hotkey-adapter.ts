import { useHotkeys } from "@tanstack/react-hotkeys";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type {
  HotkeyCallback,
  RegisterableHotkey,
  UseHotkeyDefinition,
} from "@tanstack/react-hotkeys";
import type { RefCallback, RefObject } from "react";
import type { BrunoTableNavigationCommand } from "./navigation";

// Supported by the manager and KeyboardEvent, but omitted from 0.10.0's
// closed Key union. Keep the compatibility assertion at this one Adapter seam.
export const BRUNO_TABLE_CONTEXT_MENU_HOTKEY = "ContextMenu" as RegisterableHotkey;

type BrunoTableHotkeyBinding = Readonly<{
  hotkey: RegisterableHotkey;
  allowInTextInput?: boolean;
  onTrigger: HotkeyCallback;
}>;

export type BrunoTableGridHotkeyCommands = Readonly<{
  escape: (event: KeyboardEvent) => void;
  shiftTab: (event: KeyboardEvent) => void;
  headerMenu: (event: KeyboardEvent) => void;
  resize: (
    event: KeyboardEvent,
    adjustment: "minimum" | "maximum" | -1 | 1,
    step: number,
    allowActiveHeader?: boolean,
  ) => void;
  activate: (
    event: KeyboardEvent,
    intent: "enter" | "f2" | "space",
    alt: boolean,
    shift: boolean,
  ) => void;
  navigate: (event: KeyboardEvent, command: BrunoTableNavigationCommand) => void;
  page: (event: KeyboardEvent, direction: -1 | 1) => void;
}>;

function createBrunoTableGridHotkeyBindings(
  commands: BrunoTableGridHotkeyCommands,
): readonly BrunoTableHotkeyBinding[] {
  return [
    { hotkey: "Escape", onTrigger: commands.escape },
    { hotkey: "Shift+Tab", allowInTextInput: true, onTrigger: commands.shiftTab },
    { hotkey: "Shift+F10", onTrigger: commands.headerMenu },
    { hotkey: BRUNO_TABLE_CONTEXT_MENU_HOTKEY, onTrigger: commands.headerMenu },
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
  resize: () => undefined,
  activate: () => undefined,
  navigate: () => undefined,
  page: () => undefined,
});

export const BRUNO_TABLE_GRID_HOTKEYS: readonly RegisterableHotkey[] = Object.freeze(
  createBrunoTableGridHotkeyBindings(NOOP_GRID_COMMANDS).map((binding) => binding.hotkey),
);
export const BRUNO_TABLE_BASE_HOTKEY_REGISTRATION_COUNT: number =
  BRUNO_TABLE_GRID_HOTKEYS.length + 1;
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

export function useBrunoTableHotkeyWorkflowAction(action: () => void): RefCallback<HTMLElement> {
  const cleanupRef = useRef<() => void>(() => undefined);
  useEffect(() => () => cleanupRef.current(), []);
  return useCallback(
    (owner) => {
      cleanupRef.current();
      cleanupRef.current =
        owner === null ? () => undefined : registerBrunoTableHotkeyWorkflowAction(owner, action);
    },
    [action],
  );
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
): number {
  return (
    BRUNO_TABLE_BASE_HOTKEY_REGISTRATION_COUNT +
    activeFilterWorkflows * BRUNO_TABLE_FILTER_WORKFLOW_HOTKEY_REGISTRATION_COUNT
  );
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
    preventDefault: false,
    requireReset: false,
    stopPropagation: false,
    target,
  });
}

export function useBrunoTableGridHotkeys(
  target: RefObject<HTMLElement | null>,
  commands: BrunoTableGridHotkeyCommands,
): void {
  useBrunoTableHotkeys(target, createBrunoTableGridHotkeyBindings(commands), "error");
}

export function useBrunoTableColumnGestureEscape(onTrigger: (event: KeyboardEvent) => void): void {
  useBrunoTableHotkeys(
    typeof window === "undefined" ? null : window,
    [{ hotkey: "Escape", onTrigger }],
    "allow",
  );
}

export function useBrunoTableFilterWorkflowEscape(
  target: HTMLElement | null,
  onTrigger: (event: KeyboardEvent) => void,
): void {
  const targetRef = useMemo(() => ({ current: target }), [target]);
  useBrunoTableHotkeys(
    targetRef,
    [{ hotkey: "Escape", allowInTextInput: true, onTrigger }],
    "error",
  );
}
