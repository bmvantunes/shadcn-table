import { afterAll, beforeAll, bench, describe } from "vite-plus/test";
import { cleanup, render } from "vitest-browser-react";
import { useRef, useState } from "react";

import { useBrunoTableGridHotkeys, type BrunoTableGridHotkeyCommands } from "./hotkey-adapter";
import { compileColumns } from "./compile-columns";
import { BrunoTableNavigationRuntime } from "./navigation";

let owner: HTMLElement;
let dispatchedCommands = 0;

function AdapterBenchmarkProbe() {
  const ownerRef = useRef<HTMLElement>(null);
  const [navigation] = useState(() => {
    const runtime = new BrunoTableNavigationRuntime();
    runtime.setShape(
      Object.freeze({
        totalRows: 10_000,
        getRowId: (index: number) => `row-${String(index)}`,
        findRowIndex: (rowId: string) => Number(rowId.slice(4)),
      }),
      compileColumns([
        {
          columnId: "COL_ID_ADAPTER_BROWSER_BENCHMARK",
          field: "value",
          headerName: "Adapter Browser benchmark",
          valueType: "text",
        },
      ]),
    );
    return runtime;
  });
  const commands: BrunoTableGridHotkeyCommands = {
    escape: () => undefined,
    shiftTab: () => undefined,
    headerMenu: () => undefined,
    resize: () => undefined,
    activate: () => undefined,
    navigate: (_event, command) => {
      dispatchedCommands += 1;
      navigation.navigate(command);
    },
    page: () => undefined,
  };
  useBrunoTableGridHotkeys(ownerRef, commands);
  return <section ref={ownerRef} role="region" aria-label="Adapter Browser benchmark" />;
}

beforeAll(async () => {
  const screen = await render(<AdapterBenchmarkProbe />);
  const candidate = screen.getByRole("region", { name: "Adapter Browser benchmark" }).element();
  if (!(candidate instanceof HTMLElement)) throw new Error("Expected an HTML benchmark owner.");
  owner = candidate;
});

afterAll(async () => {
  await cleanup();
});

describe("BrunoTable real-listener Adapter dispatch benchmark (8.33 ms/120 Hz reference)", () => {
  bench(
    "matches and dispatches 100 held-arrow events through TanStack and the Adapter",
    () => {
      const before = dispatchedCommands;
      for (let gesture = 0; gesture < 100; gesture += 1) {
        owner.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown", repeat: true }),
        );
      }
      if (dispatchedCommands - before !== 100) {
        throw new Error("The Adapter did not dispatch exactly once per held-key repeat unit.");
      }
    },
    { iterations: 100, time: 0, warmupIterations: 0, warmupTime: 0 },
  );
});
