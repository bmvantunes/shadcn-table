import { getHotkeyManager, HotkeysProvider } from "@tanstack/react-hotkeys";
import { StrictMode, useRef } from "react";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { cleanup, render } from "vitest-browser-react";

import {
  BRUNO_TABLE_GRID_HOTKEYS,
  useBrunoTableGridHotkeys,
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
      { hotkey: "Mod+ArrowUp" as const, key: "ArrowUp" },
      { hotkey: "Mod+ArrowDown" as const, key: "ArrowDown" },
      { hotkey: "Mod+ArrowLeft" as const, key: "ArrowLeft" },
      { hotkey: "Mod+ArrowRight" as const, key: "ArrowRight" },
      { hotkey: "Mod+Shift+ArrowUp" as const, key: "ArrowUp", shiftKey: true },
      { hotkey: "Mod+Shift+ArrowDown" as const, key: "ArrowDown", shiftKey: true },
      { hotkey: "Mod+Shift+ArrowLeft" as const, key: "ArrowLeft", shiftKey: true },
      { hotkey: "Mod+Shift+ArrowRight" as const, key: "ArrowRight", shiftKey: true },
      { hotkey: "Mod+Home" as const, key: "Home" },
      { hotkey: "Mod+End" as const, key: "End" },
      { hotkey: "Mod+Shift+Home" as const, key: "Home", shiftKey: true },
      { hotkey: "Mod+Shift+End" as const, key: "End", shiftKey: true },
    ];
    const navigate = vi.fn();
    const screen = await render(
      <HotkeysProvider defaultOptions={{ hotkey: { platform } }}>
        <AdapterProbe commands={probeCommands({ navigate })} label={`${platform} table hotkeys`} />
      </HotkeysProvider>,
    );
    const owner = screen.getByRole("region", { name: `${platform} table hotkeys` }).element();

    for (const gesture of gestures) {
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

  test("uses one listener pair and a geometry-independent registration set per owner", async () => {
    const manager = getHotkeyManager();
    const baselineRegistrations = manager.registrations.state.size;
    const addListener = vi.spyOn(HTMLElement.prototype, "addEventListener");
    const removeListener = vi.spyOn(HTMLElement.prototype, "removeEventListener");
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

  test("benchmarks held-key matching through the real listener and Adapter dispatch path", async () => {
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
    const samples: number[] = [];

    for (let sample = 0; sample < 100; sample += 1) {
      const startedAt = performance.now();
      for (let gesture = 0; gesture < 100; gesture += 1) {
        owner.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            key: sample % 2 === 0 ? "ArrowDown" : "ArrowUp",
            repeat: true,
          }),
        );
      }
      samples.push(performance.now() - startedAt);
    }

    const sorted = samples.toSorted((left, right) => left - right);
    const p99Ms = sorted[Math.ceil(sorted.length * 0.99) - 1] ?? Number.POSITIVE_INFINITY;
    console.info(
      JSON.stringify({
        benchmark: "BrunoTable real-listener held-key Adapter dispatch",
        gestures: dispatchedCommands,
        p99Ms,
        referenceFrameBudgetMs: 8.33,
      }),
    );
    expect(dispatchedCommands).toBe(10_000);
    expect(p99Ms).toBeLessThan(8.33);
  });
});
