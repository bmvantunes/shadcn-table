import { getHotkeyManager, HotkeysProvider } from "@tanstack/react-hotkeys";
import { StrictMode, useRef } from "react";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { cleanup, render } from "vitest-browser-react";

import {
  BRUNO_TABLE_GRID_HOTKEYS,
  BRUNO_TABLE_GRID_DOCUMENT_ESCAPE_HOTKEY_REGISTRATION_COUNT,
  requestBrunoTableHotkeyWorkflowAction,
  useBrunoTableColumnGestureEscape,
  useBrunoTableGridHotkeys,
  useBrunoTableHotkeyWorkflowAction,
  type BrunoTableGridHotkeyCommands,
} from "./hotkey-adapter";
import { compileColumns } from "./compile-columns";
import { BrunoTableNavigationRuntime } from "./navigation";

function AdapterProbe({
  commands,
  label,
}: Readonly<{
  readonly commands: BrunoTableGridHotkeyCommands;
  readonly label: string;
}>) {
  const ownerRef = useRef<HTMLElement>(null);
  useBrunoTableGridHotkeys(ownerRef, commands);
  return (
    <section ref={ownerRef} role="region" aria-label={label} tabIndex={0}>
      {label}
    </section>
  );
}

function probeCommands(
  overrides: Partial<BrunoTableGridHotkeyCommands> = {},
): BrunoTableGridHotkeyCommands {
  return {
    escape: () => undefined,
    shiftTab: () => undefined,
    headerMenu: () => undefined,
    resize: () => undefined,
    activate: () => undefined,
    navigate: () => undefined,
    page: () => undefined,
    ...overrides,
  };
}

function WorkflowActionProbe({ action }: Readonly<{ action: () => void }>) {
  const ref = useBrunoTableHotkeyWorkflowAction(action);
  return (
    <button ref={ref} type="button">
      Workflow action
    </button>
  );
}

function CaptureAdapterProbe({ action, label }: Readonly<{ action: () => void; label: string }>) {
  useBrunoTableColumnGestureEscape(action);
  return <section role="region" aria-label={label} />;
}

afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
});

describe("BrunoTable hotkey Adapter browser contract", () => {
  test.each([
    { platform: "windows" as const, modifier: { ctrlKey: true } },
    { platform: "mac" as const, modifier: { metaKey: true } },
  ])("routes every grid Mod chord on $platform", async ({ platform, modifier }) => {
    const gestures = [
      {
        hotkey: "Mod+ArrowUp" as const,
        key: "ArrowUp",
        expected: { type: "column-edge", edge: "start" },
      },
      {
        hotkey: "Mod+ArrowDown" as const,
        key: "ArrowDown",
        expected: { type: "column-edge", edge: "end" },
      },
      {
        hotkey: "Mod+ArrowLeft" as const,
        key: "ArrowLeft",
        expected: { type: "row-edge", edge: "start" },
      },
      {
        hotkey: "Mod+ArrowRight" as const,
        key: "ArrowRight",
        expected: { type: "row-edge", edge: "end" },
      },
      {
        hotkey: "Mod+Shift+ArrowUp" as const,
        key: "ArrowUp",
        shiftKey: true,
        expected: { type: "column-edge", edge: "start" },
      },
      {
        hotkey: "Mod+Shift+ArrowDown" as const,
        key: "ArrowDown",
        shiftKey: true,
        expected: { type: "column-edge", edge: "end" },
      },
      {
        hotkey: "Mod+Shift+ArrowLeft" as const,
        key: "ArrowLeft",
        shiftKey: true,
        expected: { type: "row-edge", edge: "start" },
      },
      {
        hotkey: "Mod+Shift+ArrowRight" as const,
        key: "ArrowRight",
        shiftKey: true,
        expected: { type: "row-edge", edge: "end" },
      },
      {
        hotkey: "Mod+Home" as const,
        key: "Home",
        expected: { type: "grid-edge", edge: "start" },
      },
      {
        hotkey: "Mod+End" as const,
        key: "End",
        expected: { type: "grid-edge", edge: "end" },
      },
      {
        hotkey: "Mod+Shift+Home" as const,
        key: "Home",
        shiftKey: true,
        expected: { type: "grid-edge", edge: "start" },
      },
      {
        hotkey: "Mod+Shift+End" as const,
        key: "End",
        shiftKey: true,
        expected: { type: "grid-edge", edge: "end" },
      },
    ];
    const navigate = vi.fn();
    const screen = await render(
      <HotkeysProvider defaultOptions={{ hotkey: { platform } }}>
        <AdapterProbe commands={probeCommands({ navigate })} label={`${platform} table hotkeys`} />
      </HotkeysProvider>,
    );
    const owner = screen.getByRole("region", { name: `${platform} table hotkeys` }).element();

    for (const [index, gesture] of gestures.entries()) {
      owner.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: modifier.ctrlKey ?? false,
          key: gesture.key,
          metaKey: modifier.metaKey ?? false,
          shiftKey: gesture.shiftKey ?? false,
        }),
      );
      expect(navigate.mock.calls[index]?.[1]).toEqual(gesture.expected);
    }

    expect(navigate).toHaveBeenCalledTimes(gestures.length);
  });

  test("scopes simultaneous owners and cleans up Strict Mode and HMR-like remounts", async () => {
    const first = vi.fn();
    const firstReplacement = vi.fn();
    const second = vi.fn();
    const screen = await render(
      <StrictMode>
        <AdapterProbe commands={probeCommands({ navigate: first })} label="First table hotkeys" />
        <AdapterProbe commands={probeCommands({ navigate: second })} label="Second table hotkeys" />
      </StrictMode>,
    );
    const secondOwner = screen.getByRole("region", { name: "Second table hotkeys" }).element();

    secondOwner.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown", repeat: true }),
    );
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();

    await screen.rerender(
      <StrictMode>
        <AdapterProbe
          key="hmr-remount"
          commands={probeCommands({ navigate: firstReplacement })}
          label="First table hotkeys"
        />
      </StrictMode>,
    );
    secondOwner.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    expect(first).not.toHaveBeenCalled();
    expect(firstReplacement).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();

    const remountedOwner = screen.getByRole("region", { name: "First table hotkeys" }).element();
    for (let repeat = 0; repeat < 3; repeat += 1) {
      remountedOwner.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown", repeat: repeat > 0 }),
      );
    }
    expect(firstReplacement).toHaveBeenCalledTimes(3);
  });

  test("dispatches capture workflows exactly once across Strict Mode and HMR-like remounts", async () => {
    const addWindowListener = vi.spyOn(window, "addEventListener");
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const first = vi.fn();
    const replacement = vi.fn();
    const screen = await render(
      <StrictMode>
        <CaptureAdapterProbe action={first} label="Capture workflow" />
      </StrictMode>,
    );
    const captureAdds = () =>
      addWindowListener.mock.calls.filter((call) => call[0] === "keydown" && call[2] === true);
    const captureRemoves = () =>
      removeWindowListener.mock.calls.filter((call) => call[0] === "keydown" && call[2] === true);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
    );
    expect(first).toHaveBeenCalledOnce();
    expect(captureAdds().length - captureRemoves().length).toBe(1);

    await screen.rerender(
      <StrictMode>
        <CaptureAdapterProbe key="hmr-remount" action={replacement} label="Capture workflow" />
      </StrictMode>,
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
    );
    expect(first).toHaveBeenCalledOnce();
    expect(replacement).toHaveBeenCalledOnce();
    expect(captureAdds().length - captureRemoves().length).toBe(1);

    await cleanup();
    expect(captureAdds().length - captureRemoves().length).toBe(0);
    for (const [eventType, listener, options] of captureAdds()) {
      expect(
        captureRemoves().some(
          (call) => call[0] === eventType && call[1] === listener && call[2] === options,
        ),
      ).toBe(true);
    }
    window.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
    );
    expect(replacement).toHaveBeenCalledOnce();
  });

  test("uses one listener pair and a geometry-independent registration set per owner", async () => {
    const manager = getHotkeyManager();
    const baselineRegistrations = manager.registrations.state.size;
    const baselineDocumentRegistrations = [...manager.registrations.state.values()].filter(
      (registration) => registration.target === document,
    ).length;
    const addListener = vi.spyOn(HTMLElement.prototype, "addEventListener");
    const removeListener = vi.spyOn(HTMLElement.prototype, "removeEventListener");
    const addDocumentListener = vi.spyOn(document, "addEventListener");
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    const commands = probeCommands();
    const screen = await render(<AdapterProbe commands={commands} label="Bounded table hotkeys" />);
    const owner = screen.getByRole("region", { name: "Bounded table hotkeys" }).element();

    await vi.waitFor(() =>
      expect(manager.registrations.state.size).toBe(
        baselineRegistrations + BRUNO_TABLE_GRID_HOTKEYS.length,
      ),
    );
    const ownerListenerTypes = addListener.mock.calls
      .map((call, index) => ({ eventType: call[0], owner: addListener.mock.instances[index] }))
      .filter((entry) => entry.owner === owner)
      .map((entry) => entry.eventType);
    expect(ownerListenerTypes).toEqual(["keydown", "keyup"]);
    expect(
      [...manager.registrations.state.values()].filter(
        (registration) => registration.target === document,
      ),
    ).toHaveLength(
      baselineDocumentRegistrations + BRUNO_TABLE_GRID_DOCUMENT_ESCAPE_HOTKEY_REGISTRATION_COUNT,
    );
    expect(
      addDocumentListener.mock.calls
        .map((call) => call[0])
        .filter((eventType) => eventType === "keydown" || eventType === "keyup"),
    ).toEqual(baselineDocumentRegistrations === 0 ? ["keydown", "keyup"] : []);

    await screen.rerender(<AdapterProbe commands={commands} label="Bounded table hotkeys" />);
    expect(manager.registrations.state.size).toBe(
      baselineRegistrations + BRUNO_TABLE_GRID_HOTKEYS.length,
    );
    expect(
      addListener.mock.instances.filter((listenerOwner) => listenerOwner === owner),
    ).toHaveLength(2);

    await cleanup();
    expect(manager.registrations.state.size).toBe(baselineRegistrations);
    const removedOwnerListenerTypes = removeListener.mock.calls
      .map((call, index) => ({ eventType: call[0], owner: removeListener.mock.instances[index] }))
      .filter((entry) => entry.owner === owner)
      .map((entry) => entry.eventType);
    expect(removedOwnerListenerTypes).toEqual(["keydown", "keyup"]);
    expect(
      removeDocumentListener.mock.calls
        .map((call) => call[0])
        .filter((eventType) => eventType === "keydown" || eventType === "keyup"),
    ).toEqual(baselineDocumentRegistrations === 0 ? ["keydown", "keyup"] : []);
  });

  test("does not dispatch a command from an IME-composing gesture", async () => {
    const command = vi.fn();
    const screen = await render(
      <AdapterProbe
        commands={probeCommands({ activate: command })}
        label="Composing table hotkeys"
      />,
    );
    const owner = screen.getByRole("region", { name: "Composing table hotkeys" }).element();
    owner.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, isComposing: true, key: "Enter" }),
    );
    expect(command).not.toHaveBeenCalled();
  });

  test("keeps workflow ownership attached while updating to the latest action", async () => {
    const first = vi.fn();
    const replacement = vi.fn();
    const screen = await render(<WorkflowActionProbe action={first} />);
    const ownerElement = screen.getByRole("button", { name: "Workflow action" }).element();
    if (!(ownerElement instanceof HTMLElement)) throw new Error("Expected an HTML action owner.");
    const owner = ownerElement;

    expect(requestBrunoTableHotkeyWorkflowAction(owner)).toBe(true);
    expect(first).toHaveBeenCalledOnce();

    await screen.rerender(<WorkflowActionProbe action={replacement} />);
    expect(screen.getByRole("button", { name: "Workflow action" }).element()).toBe(owner);
    expect(requestBrunoTableHotkeyWorkflowAction(owner)).toBe(true);
    expect(first).toHaveBeenCalledOnce();
    expect(replacement).toHaveBeenCalledOnce();
  });

  test("dispatches every held-key unit through the real listener and Adapter path", async () => {
    const navigation = new BrunoTableNavigationRuntime();
    navigation.setShape(
      Object.freeze({
        totalRows: 10_000,
        getRowId: (index: number) => `row-${String(index)}`,
        findRowIndex: (rowId: string) => Number(rowId.slice(4)),
      }),
      compileColumns([
        {
          columnId: "COL_ID_ADAPTER_BENCHMARK",
          field: "value",
          headerName: "Adapter benchmark",
          valueType: "text",
        },
      ]),
    );
    let dispatchedCommands = 0;
    const screen = await render(
      <AdapterProbe
        commands={probeCommands({
          navigate: (_event, command) => {
            dispatchedCommands += 1;
            navigation.navigate(command);
          },
        })}
        label="Held-key Adapter benchmark"
      />,
    );
    const owner = screen.getByRole("region", { name: "Held-key Adapter benchmark" }).element();

    for (let sample = 0; sample < 100; sample += 1) {
      for (let gesture = 0; gesture < 100; gesture += 1) {
        owner.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            key: sample % 2 === 0 ? "ArrowDown" : "ArrowUp",
            repeat: true,
          }),
        );
      }
    }

    expect(dispatchedCommands).toBe(10_000);
  });
});
