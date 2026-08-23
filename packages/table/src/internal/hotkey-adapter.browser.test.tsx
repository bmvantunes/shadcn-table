import { detectPlatform, getHotkeyManager, HotkeysProvider } from "@tanstack/react-hotkeys";
import { StrictMode, useCallback, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { cleanup, render } from "vitest-browser-react";

import {
  BRUNO_TABLE_GRID_HOTKEYS,
  BRUNO_TABLE_GRID_DOCUMENT_ESCAPE_HOTKEY_REGISTRATION_COUNT,
  BrunoTableHeldShiftHotkeyAdapter,
  isBrunoTableHotkeyHeld,
  requestBrunoTableHotkeyWorkflowAction,
  useBrunoTableColumnGestureEscape,
  useBrunoTableGridHotkeys,
  useBrunoTableHotkeyWorkflowAction,
  type BrunoTableGridHotkeyCommands,
} from "./hotkey-adapter";
import { compileColumns } from "./compile-columns";
import { BrunoTableNavigationRuntime } from "./navigation";

function AdapterProbe({
  children,
  commands,
  label,
}: Readonly<{
  readonly children?: ReactNode;
  readonly commands: BrunoTableGridHotkeyCommands;
  readonly label: string;
}>) {
  const ownerRef = useRef<HTMLElement>(null);
  useBrunoTableGridHotkeys(ownerRef, commands);
  return (
    <section ref={ownerRef} role="region" aria-label={label} data-bruno-table={label} tabIndex={0}>
      {label}
      {children}
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
    copy: () => undefined,
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
  const ownerRef = useRef<HTMLElement>(null);
  useBrunoTableColumnGestureEscape(ownerRef, action);
  return <section ref={ownerRef} role="region" aria-label={label} />;
}

function OwningDocumentAdapterProbe({
  captureAction,
  commands,
  onInput,
  ownerDocument,
  trackHeldShift = false,
}: Readonly<{
  captureAction: () => void;
  commands: BrunoTableGridHotkeyCommands;
  onInput: (input: HTMLInputElement | null) => void;
  ownerDocument: Document;
  trackHeldShift?: boolean;
}>) {
  const ownerRef = useRef<HTMLElement>(null);
  const setInput = useCallback((input: HTMLInputElement | null) => onInput(input), [onInput]);
  useBrunoTableGridHotkeys(ownerRef, commands);
  useBrunoTableColumnGestureEscape(ownerRef, captureAction);
  return createPortal(
    <section
      ref={ownerRef}
      role="region"
      aria-label="Secondary-document table hotkeys"
      data-bruno-table="secondary-document"
    >
      {trackHeldShift ? <BrunoTableHeldShiftHotkeyAdapter owner={ownerRef} /> : null}
      <input ref={setInput} aria-label="Secondary-document descendant" />
    </section>,
    ownerDocument.body,
  );
}

afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
});

describe("BrunoTable hotkey Adapter browser contract", () => {
  test("tracks held Shift in the table owner document", async () => {
    let input: HTMLInputElement | null = null;
    const screen = await render(
      <iframe aria-label="Held-key document" role="document" title="Held-key document" />,
    );
    const frame = screen.getByRole("document", { name: "Held-key document" }).element();
    if (!(frame instanceof HTMLIFrameElement) || frame.contentDocument === null) {
      throw new Error("Expected a same-origin held-key document.");
    }
    const ownerDocument = frame.contentDocument;
    const ownerWindow = frame.contentWindow;
    if (ownerWindow === null) throw new Error("Expected a held-key window.");
    await screen.rerender(
      <>
        <iframe aria-label="Held-key document" role="document" title="Held-key document" />
        <OwningDocumentAdapterProbe
          captureAction={() => undefined}
          commands={probeCommands()}
          onInput={(candidate) => {
            input = candidate;
          }}
          ownerDocument={ownerDocument}
          trackHeldShift
        />
      </>,
    );
    await vi.waitFor(() => expect(input).not.toBeNull());
    const foreignInput = input as HTMLInputElement | null;
    if (foreignInput === null) throw new Error("Expected the held-key descendant.");
    const ownerGlobal = ownerWindow as Window & typeof globalThis;
    const ForeignKeyboardEvent = ownerGlobal.KeyboardEvent;
    foreignInput.dispatchEvent(
      new ForeignKeyboardEvent("keydown", { bubbles: true, key: "Shift", shiftKey: true }),
    );
    expect(isBrunoTableHotkeyHeld("Shift", foreignInput)).toBe(true);
    foreignInput.dispatchEvent(new ForeignKeyboardEvent("keyup", { bubbles: true, key: "Shift" }));
    expect(isBrunoTableHotkeyHeld("Shift", foreignInput)).toBe(false);
  });

  test.each([
    { platform: "windows" as const, modifier: { ctrlKey: true } },
    { platform: "mac" as const, modifier: { metaKey: true } },
  ])("routes every grid Mod chord on $platform", async ({ platform, modifier }) => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue(
      platform === "mac" ? "MacIntel" : "Win32",
    );
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      platform === "mac" ? "Macintosh" : "Windows",
    );
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
      <AdapterProbe commands={probeCommands({ navigate })} label={`${platform} table hotkeys`} />,
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

  test("isolates table bindings from an ancestor Hotkeys provider", async () => {
    const platform = detectPlatform();
    const modifier = platform === "mac" ? { metaKey: true } : { ctrlKey: true };
    const conflictingPlatform = platform === "mac" ? "windows" : "mac";
    const navigate = vi.fn();
    const screen = await render(
      <HotkeysProvider
        defaultOptions={{
          hotkey: {
            enabled: false,
            eventType: "keyup",
            platform: conflictingPlatform,
            preventDefault: true,
            requireReset: true,
            stopPropagation: true,
          },
        }}
      >
        <AdapterProbe
          commands={probeCommands({ navigate })}
          label="Provider-isolated table hotkeys"
        />
      </HotkeysProvider>,
    );
    const owner = screen.getByRole("region", { name: "Provider-isolated table hotkeys" }).element();

    owner.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "ArrowDown",
        ...modifier,
      }),
    );

    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate.mock.calls[0]?.[1]).toEqual({ type: "column-edge", edge: "end" });
  });

  test("routes Mod+C once to the nearest owner with conflict-safe registration", async () => {
    const manager = getHotkeyManager();
    const modifier = detectPlatform() === "mac" ? { metaKey: true } : { ctrlKey: true };
    const outerCopy = vi.fn();
    const innerCopy = vi.fn();
    const screen = await render(
      <AdapterProbe commands={probeCommands({ copy: outerCopy })} label="Outer copy owner">
        <AdapterProbe commands={probeCommands({ copy: innerCopy })} label="Inner copy owner" />
      </AdapterProbe>,
    );
    const outer = screen.getByRole("region", { name: "Outer copy owner" }).element();
    const inner = screen.getByRole("region", { name: "Inner copy owner" }).element();
    await vi.waitFor(() =>
      expect(
        [...manager.registrations.state.values()].filter(
          (registration) => registration.target === outer && registration.hotkey === "Mod+C",
        ),
      ).toHaveLength(1),
    );
    const outerRegistration = [...manager.registrations.state.values()].find(
      (registration) => registration.target === outer && registration.hotkey === "Mod+C",
    );
    expect(outerRegistration?.options.conflictBehavior).toBe("error");

    inner.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "c", ...modifier }),
    );
    expect(innerCopy).toHaveBeenCalledOnce();
    expect(outerCopy).not.toHaveBeenCalled();

    outer.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "c", ...modifier }),
    );
    expect(outerCopy).toHaveBeenCalledOnce();
    expect(innerCopy).toHaveBeenCalledOnce();
  });

  test("registers Mod+A only for an installed Row Selection command", async () => {
    const manager = getHotkeyManager();
    const selectAll = vi.fn();
    const screen = await render(
      <>
        <AdapterProbe commands={probeCommands()} label="Plain table hotkeys" />
        <AdapterProbe commands={probeCommands({ selectAll })} label="Row Selection table hotkeys" />
      </>,
    );
    const plain = screen.getByRole("region", { name: "Plain table hotkeys" }).element();
    const enabled = screen.getByRole("region", { name: "Row Selection table hotkeys" }).element();
    const registrationsFor = (owner: HTMLElement | SVGElement) =>
      [...manager.registrations.state.values()].filter(
        (registration) => registration.target === owner && registration.hotkey === "Mod+A",
      );

    await vi.waitFor(() => expect(registrationsFor(enabled)).toHaveLength(1));
    expect(registrationsFor(plain)).toHaveLength(0);

    enabled.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "a",
        ...(detectPlatform() === "mac" ? { metaKey: true } : { ctrlKey: true }),
      }),
    );
    expect(selectAll).toHaveBeenCalledOnce();
  });

  test("routes descendant commands to the innermost dynamically mounted table", async () => {
    const outerEscape = vi.fn();
    const innerEscape = vi.fn();
    const outerNavigate = vi.fn();
    const innerNavigate = vi.fn();
    const outerResize = vi.fn();
    const innerResize = vi.fn();
    const screen = await render(
      <AdapterProbe
        commands={probeCommands({
          escape: outerEscape,
          navigate: outerNavigate,
          resize: outerResize,
        })}
        label="Outer table hotkeys"
      />,
    );

    await screen.rerender(
      <AdapterProbe
        commands={probeCommands({
          escape: outerEscape,
          navigate: outerNavigate,
          resize: outerResize,
        })}
        label="Outer table hotkeys"
      >
        <AdapterProbe
          commands={probeCommands({
            escape: innerEscape,
            navigate: innerNavigate,
            resize: innerResize,
          })}
          label="Inner table hotkeys"
        />
      </AdapterProbe>,
    );
    const inner = screen.getByRole("region", { name: "Inner table hotkeys" }).element();
    inner.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
    );

    expect(innerEscape).toHaveBeenCalledOnce();
    expect(outerEscape).not.toHaveBeenCalled();

    inner.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    expect(innerNavigate).toHaveBeenCalledOnce();
    expect(outerNavigate).not.toHaveBeenCalled();

    inner.dispatchEvent(
      new KeyboardEvent("keydown", { altKey: true, bubbles: true, key: "ArrowRight" }),
    );
    expect(innerResize).toHaveBeenCalledOnce();
    expect(outerResize).not.toHaveBeenCalled();
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

  test("binds descendant Escape to the grid owner's document and DOM realm", async () => {
    const manager = getHotkeyManager();
    const baselineRegistrations = manager.registrations.state.size;
    const escape = vi.fn();
    const replacementEscape = vi.fn();
    const capture = vi.fn();
    const replacementCapture = vi.fn();
    let input: HTMLInputElement | null = null;
    const setInput = (candidate: HTMLInputElement | null) => {
      input = candidate;
    };
    const screen = await render(
      <iframe aria-label="Secondary document" role="document" title="Secondary document" />,
    );
    const frame = screen.getByRole("document", { name: "Secondary document" }).element();
    if (!(frame instanceof HTMLIFrameElement) || frame.contentDocument === null) {
      throw new Error("Expected a same-origin secondary document.");
    }
    const ownerDocument = frame.contentDocument;
    const ownerWindow = frame.contentWindow;
    if (ownerWindow === null) throw new Error("Expected a secondary window.");
    const ownerGlobal = ownerWindow as Window & typeof globalThis;
    const addEventListener = vi.spyOn(ownerDocument, "addEventListener");
    const removeEventListener = vi.spyOn(ownerDocument, "removeEventListener");
    const addWindowListener = vi.spyOn(ownerWindow, "addEventListener");
    const removeWindowListener = vi.spyOn(ownerWindow, "removeEventListener");

    await screen.rerender(
      <>
        <iframe aria-label="Secondary document" role="document" title="Secondary document" />
        <StrictMode>
          <OwningDocumentAdapterProbe
            captureAction={capture}
            commands={probeCommands({ escape })}
            onInput={setInput}
            ownerDocument={ownerDocument}
          />
        </StrictMode>
      </>,
    );
    await vi.waitFor(() => {
      expect(input).not.toBeNull();
      expect(
        [...manager.registrations.state.values()].filter(
          (registration) => registration.target === ownerDocument,
        ),
      ).toHaveLength(0);
      expect(
        addEventListener.mock.calls.filter(([type]) => type === "keydown").length -
          removeEventListener.mock.calls.filter(([type]) => type === "keydown").length,
      ).toBe(1);
    });

    const foreignInput = input as HTMLInputElement | null;
    if (foreignInput === null) throw new Error("Expected the secondary-document descendant.");
    const ForeignKeyboardEvent = ownerGlobal.KeyboardEvent;
    foreignInput.dispatchEvent(
      new ForeignKeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        isComposing: true,
        key: "Escape",
      }),
    );
    expect(escape).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    foreignInput.dispatchEvent(
      new ForeignKeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      }),
    );
    expect(escape).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledOnce();

    await screen.rerender(
      <>
        <iframe aria-label="Secondary document" role="document" title="Secondary document" />
        <StrictMode>
          <OwningDocumentAdapterProbe
            key="hmr-remount"
            captureAction={replacementCapture}
            commands={probeCommands({ escape: replacementEscape })}
            onInput={setInput}
            ownerDocument={ownerDocument}
          />
        </StrictMode>
      </>,
    );
    const replacementInput = input as HTMLInputElement | null;
    if (replacementInput === null) {
      throw new Error("Expected the remounted secondary-document owner.");
    }
    replacementInput.dispatchEvent(
      new ForeignKeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
    );
    expect(escape).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledOnce();
    expect(replacementEscape).toHaveBeenCalledOnce();
    expect(replacementCapture).toHaveBeenCalledOnce();
    const documentKeydownAdds = () =>
      addEventListener.mock.calls.filter(([type]) => type === "keydown");
    const documentKeydownRemoves = () =>
      removeEventListener.mock.calls.filter(([type]) => type === "keydown");
    expect(documentKeydownAdds().length - documentKeydownRemoves().length).toBe(1);
    const captureAdds = () =>
      addWindowListener.mock.calls.filter((call) => call[0] === "keydown" && call[2] === true);
    const captureRemoves = () =>
      removeWindowListener.mock.calls.filter((call) => call[0] === "keydown" && call[2] === true);
    expect(captureAdds().length - captureRemoves().length).toBe(1);

    await cleanup();
    expect(documentKeydownAdds().length - documentKeydownRemoves().length).toBe(0);
    expect(captureAdds().length - captureRemoves().length).toBe(0);
    for (const [eventType, listener, options] of documentKeydownAdds()) {
      expect(
        documentKeydownRemoves().some(
          (call) => call[0] === eventType && call[1] === listener && call[2] === options,
        ),
      ).toBe(true);
    }
    for (const [eventType, listener, options] of captureAdds()) {
      expect(
        captureRemoves().some(
          (call) => call[0] === eventType && call[1] === listener && call[2] === options,
        ),
      ).toBe(true);
    }
    ownerWindow.dispatchEvent(
      new ForeignKeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
    );
    expect(replacementCapture).toHaveBeenCalledOnce();
    expect(manager.registrations.state.size).toBe(baselineRegistrations);
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
