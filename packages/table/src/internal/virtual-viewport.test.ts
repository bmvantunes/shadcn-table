import { afterEach, describe, expect, it, vi } from "vitest";

import { compileColumns } from "./compile-columns";
import {
  BRUNO_TABLE_LIVE_RIGHT_PADDING_CSS_VARIABLE,
  brunoTableColumnCssVariable,
} from "./column-management";
import { BRUNO_TABLE_MAX_PHYSICAL_ROW_HEIGHT, BrunoTableViewportRuntime } from "./virtual-viewport";

type TestRtlScrollType = "negative" | "default" | "reverse";

type ViewportStyleHooks = Readonly<{
  readonly setProperty?: (property: string, value: string) => void;
  readonly removeProperty?: (property: string) => void;
}>;

type ViewportElementOptions = Readonly<{
  readonly addEventListener?: (type: string, listener: EventListener) => void;
  readonly removeEventListener?: (type: string, listener: EventListener) => void;
  readonly clientHeight?: number | (() => number);
  readonly clientWidth?: number | (() => number);
  readonly offsetHeight?: number | (() => number);
  readonly offsetWidth?: number | (() => number);
  readonly scrollLeft?:
    | number
    | Readonly<{
        readonly get: () => number;
        readonly set: (value: number) => void;
      }>;
  readonly scrollTop?: number;
  readonly scrollWidth?: number | (() => number);
  readonly style?: ViewportStyleHooks;
  readonly ownerDocument?: Document | undefined;
}>;

const viewportFrames = new Map<TestRtlScrollType, HTMLIFrameElement>();
const rtlCreateElementDocuments = new WeakSet<Document>();
const rtlStyleHarnesses = new WeakMap<
  Window,
  {
    readDirection: () => "ltr" | "rtl";
    readonly nativeGetComputedStyle: Window["getComputedStyle"];
  }
>();

function createViewportElement(options: ViewportElementOptions = {}): HTMLElement {
  const element = (options.ownerDocument ?? document).createElement("div");
  const defineDimension = (
    name: "clientHeight" | "clientWidth" | "offsetHeight" | "offsetWidth",
  ): void => {
    const value = options[name];
    if (value === undefined) return;
    Object.defineProperty(element, name, {
      configurable: true,
      get: typeof value === "function" ? value : () => value,
    });
  };
  defineDimension("clientHeight");
  defineDimension("clientWidth");
  defineDimension("offsetHeight");
  defineDimension("offsetWidth");
  if (options.scrollWidth !== undefined) {
    Object.defineProperty(element, "scrollWidth", {
      configurable: true,
      get:
        typeof options.scrollWidth === "function" ? options.scrollWidth : () => options.scrollWidth,
    });
  } else {
    Object.defineProperty(element, "scrollWidth", {
      configurable: true,
      get: () => Number.NaN,
    });
  }
  if (options.scrollLeft !== undefined) {
    if (typeof options.scrollLeft === "number") {
      let scrollLeft = options.scrollLeft;
      Object.defineProperty(element, "scrollLeft", {
        configurable: true,
        get: () => scrollLeft,
        set: (value: number) => {
          scrollLeft = value;
        },
      });
    } else {
      Object.defineProperty(element, "scrollLeft", {
        configurable: true,
        get: options.scrollLeft.get,
        set: options.scrollLeft.set,
      });
    }
  }
  if (options.scrollTop !== undefined) {
    let scrollTop = options.scrollTop;
    Object.defineProperty(element, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
  }
  if (options.addEventListener !== undefined) {
    const addEventListener = options.addEventListener;
    vi.spyOn(element, "addEventListener").mockImplementation((type, listener) => {
      if (typeof listener === "function") addEventListener(type, listener);
    });
  }
  if (options.removeEventListener !== undefined) {
    const removeEventListener = options.removeEventListener;
    vi.spyOn(element, "removeEventListener").mockImplementation((type, listener) => {
      if (typeof listener === "function") removeEventListener(type, listener);
    });
  }
  if (options.style?.setProperty !== undefined) {
    const setProperty = options.style.setProperty;
    vi.spyOn(element.style, "setProperty").mockImplementation((property, value) => {
      if (value !== null) setProperty(property, value);
    });
  }
  if (options.style?.removeProperty !== undefined) {
    const removeProperty = options.style.removeProperty;
    vi.spyOn(element.style, "removeProperty").mockImplementation((property) => {
      removeProperty(property);
      return "";
    });
  }
  function scrollTo(optionsOrX?: ScrollToOptions | number, y?: number): void;
  function scrollTo(optionsOrX: ScrollToOptions | number = {}, y?: number): void {
    if (typeof optionsOrX === "number") {
      element.scrollLeft = optionsOrX;
      element.scrollTop = y ?? 0;
      return;
    }
    if (optionsOrX.left !== undefined) element.scrollLeft = optionsOrX.left;
    if (optionsOrX.top !== undefined) element.scrollTop = optionsOrX.top;
  }
  element.scrollTo = scrollTo;
  return element;
}

class TestResizeObserver implements ResizeObserver {
  protected readonly callback: ResizeObserverCallback;
  protected readonly targets = new Set<Element>();

  public constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  public observe(target: Element): void {
    this.targets.add(target);
  }

  public unobserve(target: Element): void {
    this.targets.delete(target);
  }

  public disconnect(): void {
    this.targets.clear();
  }

  public takeRecords(): ResizeObserverEntry[] {
    return [];
  }

  public trigger(): void {
    this.callback([], this);
  }
}

class TestMutationObserver implements MutationObserver {
  protected readonly callback: MutationCallback;
  protected readonly targets = new Set<Node>();

  public constructor(callback: MutationCallback) {
    this.callback = callback;
  }

  public observe(target: Node, _options?: MutationObserverInit): void {
    this.targets.add(target);
  }

  public disconnect(): void {
    this.targets.clear();
  }

  public takeRecords(): MutationRecord[] {
    return [];
  }

  public trigger(): void {
    this.callback([], this);
  }
}

function createRtlOwnerDocument(
  type: TestRtlScrollType,
  readDirection: () => "ltr" | "rtl" = () => "rtl",
): Document {
  let frame = viewportFrames.get(type);
  if (frame === undefined) {
    frame = document.createElement("iframe");
    document.body.appendChild(frame);
    viewportFrames.set(type, frame);
  }
  const ownerDocument = frame.contentDocument;
  const ownerWindow = frame.contentWindow;
  if (ownerDocument === null || ownerWindow === null) {
    throw new Error("The viewport browser harness requires an iframe document.");
  }
  if (!rtlCreateElementDocuments.has(ownerDocument)) {
    const nativeCreateElement = ownerDocument.createElement.bind(ownerDocument);
    Object.defineProperty(ownerDocument, "createElement", {
      configurable: true,
      value: (tagName: string, options?: ElementCreationOptions): HTMLElement => {
        const element = nativeCreateElement(tagName, options);
        let scrollLeft = type === "reverse" ? 1 : 0;
        Object.defineProperty(element, "scrollLeft", {
          configurable: true,
          get: () => scrollLeft,
          set: (value: number) => {
            scrollLeft = type === "negative" && value > 0 ? 0 : value;
          },
        });
        return element;
      },
    });
    rtlCreateElementDocuments.add(ownerDocument);
  }
  const existingStyleHarness = rtlStyleHarnesses.get(ownerWindow);
  if (existingStyleHarness === undefined) {
    const nativeGetComputedStyle = ownerWindow.getComputedStyle.bind(ownerWindow);
    const styleHarness = { readDirection, nativeGetComputedStyle };
    rtlStyleHarnesses.set(ownerWindow, styleHarness);
    Object.defineProperty(ownerWindow, "getComputedStyle", {
      configurable: true,
      value: (element: HTMLElement, pseudoElement?: string | null): CSSStyleDeclaration => {
        const direction = styleHarness.readDirection();
        element.style.direction = direction;
        element.setAttribute("dir", direction);
        return nativeGetComputedStyle(element, pseudoElement);
      },
    });
  } else {
    existingStyleHarness.readDirection = readDirection;
  }
  return ownerDocument;
}

function createDeferredReverseRtlHarness(clientWidth = 200): Readonly<{
  callbacks: FrameRequestCallback[];
  commitScrollWidth: (width: number) => void;
  element: HTMLElement;
}> {
  const callbacks: FrameRequestCallback[] = [];
  let committedScrollWidth = clientWidth;
  let nativeScrollLeft = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const element = createViewportElement({
    addEventListener: () => undefined,
    clientHeight: 480,
    clientWidth,
    ownerDocument: createRtlOwnerDocument("reverse"),
    scrollLeft: {
      get: () => nativeScrollLeft,
      set: (value) => {
        const committedMaximum = Math.max(committedScrollWidth - clientWidth, 0);
        nativeScrollLeft = Math.min(Math.max(value, 0), committedMaximum);
      },
    },
    scrollTop: 0,
    scrollWidth: () => committedScrollWidth,
  });
  return Object.freeze({
    callbacks,
    commitScrollWidth: (width: number) => {
      committedScrollWidth = width;
    },
    element,
  });
}

function observeResizeTargets(): (target: Element) => void {
  const callbacks = new Map<Element, ResizeObserverCallback>();
  vi.stubGlobal(
    "ResizeObserver",
    class extends TestResizeObserver {
      public constructor(callback: ResizeObserverCallback) {
        super(callback);
      }

      public override observe(target: Element) {
        super.observe(target);
        callbacks.set(target, this.callback);
      }
      public override disconnect() {
        for (const target of this.targets) {
          if (callbacks.get(target) === this.callback) callbacks.delete(target);
        }
        super.disconnect();
      }
    },
  );
  const observer = new ResizeObserver(() => undefined);
  return (target) => callbacks.get(target)?.([], observer);
}

function installViewportObserverHarness(): Readonly<{
  readonly frames: FrameRequestCallback[];
  readonly triggerMutation: (target: Node) => void;
  readonly triggerResize: (target: Element) => void;
}> {
  const frames: FrameRequestCallback[] = [];
  const mutationCallbacks = new Map<Node, Map<MutationObserver, MutationCallback>>();
  const resizeCallbacks = new Map<Element, Map<ResizeObserver, ResizeObserverCallback>>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class extends TestResizeObserver {
      public constructor(callback: ResizeObserverCallback) {
        super(callback);
      }
      public override observe(target: Element) {
        super.observe(target);
        const observers = resizeCallbacks.get(target) ?? new Map();
        observers.set(this, this.callback);
        resizeCallbacks.set(target, observers);
      }
      public override disconnect() {
        for (const target of this.targets) {
          const observers = resizeCallbacks.get(target);
          observers?.delete(this);
          if (observers?.size === 0) resizeCallbacks.delete(target);
        }
        super.disconnect();
      }
    },
  );
  vi.stubGlobal(
    "MutationObserver",
    class extends TestMutationObserver {
      public constructor(callback: MutationCallback) {
        super(callback);
      }
      public override observe(target: Node) {
        super.observe(target);
        const observers = mutationCallbacks.get(target) ?? new Map();
        observers.set(this, this.callback);
        mutationCallbacks.set(target, observers);
      }
      public override disconnect() {
        for (const target of this.targets) {
          const observers = mutationCallbacks.get(target);
          observers?.delete(this);
          if (observers?.size === 0) mutationCallbacks.delete(target);
        }
        super.disconnect();
      }
    },
  );
  return Object.freeze({
    frames,
    triggerMutation: (target: Node) => {
      for (const [observer, callback] of mutationCallbacks.get(target) ?? []) {
        callback([], observer);
      }
    },
    triggerResize: (target: Element) => {
      for (const [observer, callback] of resizeCallbacks.get(target) ?? []) {
        callback([], observer);
      }
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BrunoTableViewportRuntime", () => {
  it("removes resize target registrations when an observer disconnects", () => {
    const triggerResize = observeResizeTargets();
    const callback = vi.fn<ResizeObserverCallback>();
    const observer = new ResizeObserver(callback);
    const target = document.createElement("div");

    observer.observe(target);
    triggerResize(target);
    expect(callback).toHaveBeenCalledOnce();

    observer.disconnect();
    triggerResize(target);
    expect(callback).toHaveBeenCalledOnce();
  });

  it("publishes detached layout changes once and keeps hot scroll coordinates private", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const viewport = new BrunoTableViewportRuntime();
    const listener = vi.fn();
    viewport.subscribe(listener);

    viewport.setLayout(2, columns);

    expect(listener).toHaveBeenCalledOnce();
    expect(viewport.getSnapshot().virtualWindow).toMatchObject({
      rowStart: 0,
      rowEnd: 2,
      totalHeight: 72,
    });
    expect(viewport.getSnapshot()).not.toHaveProperty("scrollTop");
    expect(viewport.getSnapshot()).not.toHaveProperty("scrollLeft");

    viewport.setLayout(2, columns);
    expect(listener).toHaveBeenCalledOnce();

    viewport.setLayout(2, Object.freeze(Array.from(columns)));
    expect(listener).toHaveBeenCalledOnce();
  });

  it("batches midpoint reveals and keeps segmented same-window scroll out of React", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const callbacks: FrameRequestCallback[] = [];
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const setProperty = vi.fn();
    let scrollListener: EventListener | undefined;
    const element = createViewportElement({
      addEventListener: (name, listener) => {
        if (name === "scroll") scrollListener = listener;
      },
      clientHeight: 480,
      clientWidth: 800,
      scrollLeft: 0,
      scrollTop: 0,
      style: { setProperty },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(1_000_000, columns);
    viewport.attach(element);

    viewport.revealCell(400_000, "COL_ID_NAME");
    viewport.revealCell(500_000, "COL_ID_NAME");

    expect(requestFrame).toHaveBeenCalledOnce();
    callbacks[0]!(0);
    expect(viewport.getSnapshot().virtualWindow.rowStart).toBeGreaterThan(499_900);
    const listener = vi.fn();
    viewport.subscribe(listener);

    element.scrollTop += 1;
    scrollListener!(new Event("scroll"));
    callbacks[1]!(0);

    expect(listener).not.toHaveBeenCalled();
  });

  it("frame-batches pinned-aware scrollbar geometry onto only the overlay subtree", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_START",
        field: "name",
        headerName: "Start",
        pinned: "start",
        valueType: "text",
        width: 120,
      },
      ...Array.from({ length: 10 }, (_, index) => ({
        columnId: `COL_ID_CENTER_${index}`,
        field: "name",
        headerName: `Center ${index}`,
        valueType: "text" as const,
        width: 120,
      })),
      {
        columnId: "COL_ID_END",
        field: "name",
        headerName: "End",
        pinned: "end",
        valueType: "text",
        width: 140,
      },
    ]);
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    let scrollListener: EventListener | undefined;
    const geometryOrder: string[] = [];
    const gridSetProperty = vi.fn();
    const bodyLayerSetProperty = vi.fn((_property: string, _value: string) =>
      geometryOrder.push("write-body-transform"),
    );
    const overlaySetProperty = vi.fn((_property: string, _value: string) =>
      geometryOrder.push("write-overlay"),
    );
    const element = createViewportElement({
      addEventListener: (name, listener) => {
        if (name === "scroll") scrollListener = listener;
      },
      clientHeight: 480,
      clientWidth: 800,
      offsetHeight: () => {
        geometryOrder.push("read-offset-height");
        return 495;
      },
      offsetWidth: () => {
        geometryOrder.push("read-offset-width");
        return 815;
      },
      scrollLeft: 0,
      scrollTop: 0,
      style: { setProperty: gridSetProperty },
    });
    const overlay = createViewportElement({ style: { setProperty: overlaySetProperty } });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(100, columns);
    viewport.attach(element);
    viewport.attachRowLayer(createViewportElement({ style: { setProperty: vi.fn() } }));
    viewport.attachBodyLayer(
      createViewportElement({ style: { setProperty: bodyLayerSetProperty } }),
    );
    viewport.attachScrollbarOverlay(overlay);

    const initialProperties = new Map(
      overlaySetProperty.mock.calls.map(
        ([property, value]) => [String(property), String(value)] as const,
      ),
    );
    expect(initialProperties.get("--bruno-table-scrollbar-horizontal-start")).toBe("120px");
    expect(initialProperties.get("--bruno-table-scrollbar-horizontal-end")).toBe("155px");
    expect(initialProperties.get("direction")).toBe("ltr");
    expect(initialProperties.get("--bruno-table-scrollbar-horizontal-bottom")).toBe("15px");
    expect(initialProperties.get("--bruno-table-scrollbar-vertical-top")).toBe("36px");
    expect(initialProperties.get("--bruno-table-scrollbar-vertical-right")).toBe("15px");
    expect(initialProperties.get("--bruno-table-scrollbar-vertical-bottom")).toBe("23px");
    overlaySetProperty.mockClear();
    gridSetProperty.mockClear();
    bodyLayerSetProperty.mockClear();
    geometryOrder.length = 0;

    element.scrollLeft = 300;
    element.scrollTop = 1_200;
    scrollListener!(new Event("scroll"));
    scrollListener!(new Event("scroll"));

    expect(callbacks).toHaveLength(1);
    expect(overlaySetProperty).not.toHaveBeenCalled();
    callbacks[0]!(0);

    const scrolledProperties = new Map(
      overlaySetProperty.mock.calls.map(
        ([property, value]) => [String(property), String(value)] as const,
      ),
    );
    expect(
      Number.parseFloat(scrolledProperties.get("--bruno-table-scrollbar-horizontal-thumb-offset")!),
    ).toBeGreaterThan(0);
    expect(
      Number.parseFloat(scrolledProperties.get("--bruno-table-scrollbar-vertical-thumb-offset")!),
    ).toBeGreaterThan(0);
    expect(bodyLayerSetProperty).toHaveBeenCalledWith("transform", expect.stringContaining("3d"));
    const firstWrite = geometryOrder.findIndex((operation) => operation.startsWith("write"));
    const lastRead = geometryOrder.findLastIndex((operation) => operation.startsWith("read"));
    expect(lastRead).toBeGreaterThanOrEqual(0);
    expect(firstWrite).toBeGreaterThan(lastRead);
    expect(
      gridSetProperty.mock.calls.some(([property]) => String(property).includes("scrollbar")),
    ).toBe(false);

    overlaySetProperty.mockClear();
    element.scrollLeft = 660;
    element.scrollTop = 3_156;
    viewport.attach(null);
    viewport.attach(element);
    const maximumProperties = new Map(
      overlaySetProperty.mock.calls.map(
        ([property, value]) => [String(property), String(value)] as const,
      ),
    );
    expect(
      Number.parseFloat(maximumProperties.get("--bruno-table-scrollbar-horizontal-thumb-offset")!) +
        Number.parseFloat(maximumProperties.get("--bruno-table-scrollbar-horizontal-thumb-width")!),
    ).toBeCloseTo(540, 6);
    expect(
      Number.parseFloat(maximumProperties.get("--bruno-table-scrollbar-vertical-thumb-offset")!) +
        Number.parseFloat(maximumProperties.get("--bruno-table-scrollbar-vertical-thumb-height")!),
    ).toBeCloseTo(436, 6);
  });

  it("unregisters replaced body layers before a later transform frame", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_BODY_LAYER_CLEANUP",
        field: "name",
        headerName: "Body layer cleanup",
        valueType: "text",
      },
    ]);
    const callbacks: FrameRequestCallback[] = [];
    let scrollListener: EventListener | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const element = createViewportElement({
      addEventListener: (name, listener) => {
        if (name === "scroll") scrollListener = listener;
      },
      clientHeight: 480,
      clientWidth: 800,
      scrollLeft: 0,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(1_000, columns);
    viewport.attach(element);

    const detachedWrite = vi.fn();
    for (let index = 0; index < 100; index += 1) {
      const cleanup = viewport.attachBodyLayer(
        createViewportElement({ style: { setProperty: detachedWrite } }),
      );
      expect(cleanup).toBeTypeOf("function");
      cleanup!();
    }
    detachedWrite.mockClear();
    const mountedWrites = [vi.fn(), vi.fn(), vi.fn()];
    for (const setProperty of mountedWrites) {
      viewport.attachBodyLayer(createViewportElement({ style: { setProperty } }));
      setProperty.mockClear();
    }

    element.scrollTop = 1_200;
    scrollListener!(new Event("scroll"));
    callbacks.shift()!(0);

    expect(detachedWrite).not.toHaveBeenCalled();
    for (const setProperty of mountedWrites) {
      expect(setProperty).toHaveBeenCalledOnce();
      expect(setProperty).toHaveBeenCalledWith("transform", expect.stringContaining("3d"));
    }
  });

  it("keeps decorative tracks disjoint with overlay-native scrollbars and suspended pinning", () => {
    const suspendedColumns = compileColumns([
      {
        columnId: "COL_ID_START",
        field: "name",
        headerName: "Start",
        pinned: "start",
        valueType: "text",
        width: 600,
      },
      {
        columnId: "COL_ID_CENTER",
        field: "name",
        headerName: "Center",
        valueType: "text",
        width: 120,
      },
      {
        columnId: "COL_ID_END",
        field: "name",
        headerName: "End",
        pinned: "end",
        valueType: "text",
        width: 600,
      },
    ]);
    const overlaySetProperty = vi.fn();
    const element = createViewportElement({
      clientHeight: 480,
      clientWidth: 800,
      offsetHeight: 480,
      offsetWidth: 800,
      scrollLeft: 0,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(100, suspendedColumns);
    viewport.attach(element);
    viewport.attachScrollbarOverlay(
      createViewportElement({ style: { setProperty: overlaySetProperty } }),
    );

    const properties = new Map(
      overlaySetProperty.mock.calls.map(
        ([property, value]) => [String(property), String(value)] as const,
      ),
    );
    expect(viewport.getSnapshot().virtualWindow.pinnedStart).toHaveLength(0);
    expect(viewport.getSnapshot().virtualWindow.pinnedEnd).toHaveLength(0);
    expect(properties.get("--bruno-table-scrollbar-horizontal-start")).toBe("0px");
    expect(properties.get("--bruno-table-scrollbar-horizontal-end")).toBe("0px");
    expect(properties.get("--bruno-table-scrollbar-vertical-bottom")).toBe("8px");

    overlaySetProperty.mockClear();
    element.scrollTop = 3_156;
    viewport.attach(null);
    viewport.attach(element);
    const suspendedMaximumProperties = new Map(
      overlaySetProperty.mock.calls.map(
        ([property, value]) => [String(property), String(value)] as const,
      ),
    );
    expect(
      Number.parseFloat(
        suspendedMaximumProperties.get("--bruno-table-scrollbar-vertical-thumb-offset")!,
      ) +
        Number.parseFloat(
          suspendedMaximumProperties.get("--bruno-table-scrollbar-vertical-thumb-height")!,
        ),
    ).toBeCloseTo(436, 6);

    overlaySetProperty.mockClear();
    viewport.setLayout(
      100,
      compileColumns([
        {
          columnId: "COL_ID_UNPINNED_START",
          field: "name",
          headerName: "Unpinned start",
          valueType: "text",
          width: 600,
        },
        {
          columnId: "COL_ID_UNPINNED_CENTER",
          field: "name",
          headerName: "Unpinned center",
          valueType: "text",
          width: 120,
        },
        {
          columnId: "COL_ID_UNPINNED_END",
          field: "name",
          headerName: "Unpinned end",
          valueType: "text",
          width: 600,
        },
      ]),
    );
    const unpinnedProperties = new Map(
      overlaySetProperty.mock.calls.map(
        ([property, value]) => [String(property), String(value)] as const,
      ),
    );
    expect(unpinnedProperties.get("--bruno-table-scrollbar-horizontal-start")).toBe("0px");
    expect(unpinnedProperties.get("--bruno-table-scrollbar-horizontal-end")).toBe("0px");
    expect(unpinnedProperties.get("--bruno-table-scrollbar-vertical-bottom")).toBe("8px");
    expect(
      Number.parseFloat(unpinnedProperties.get("--bruno-table-scrollbar-vertical-thumb-offset")!) +
        Number.parseFloat(unpinnedProperties.get("--bruno-table-scrollbar-vertical-thumb-height")!),
    ).toBeCloseTo(436, 6);
  });

  it("rebases horizontal coordinates when viewport width suspends and restores pinning", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_START",
        field: "name",
        headerName: "Start",
        pinned: "start",
        valueType: "text",
        width: 100,
      },
      ...Array.from({ length: 10 }, (_, index) => ({
        columnId: `COL_ID_CENTER_${String(index)}`,
        field: "name",
        headerName: `Center ${String(index)}`,
        valueType: "text" as const,
        width: 100,
      })),
      {
        columnId: "COL_ID_END",
        field: "name",
        headerName: "End",
        pinned: "end",
        valueType: "text",
        width: 100,
      },
    ]);
    const callbacks: FrameRequestCallback[] = [];
    let resize: (() => void) | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "ResizeObserver",
      class extends TestResizeObserver {
        public constructor(callback: ResizeObserverCallback) {
          super(callback);
          resize = () => this.trigger();
        }
      },
    );
    let width = 300;
    const element = createViewportElement({
      clientHeight: 480,
      clientWidth: () => width,
      scrollLeft: 320,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(100, columns);
    viewport.attach(element);
    expect(viewport.getSnapshot().virtualWindow.pinnedStart).toHaveLength(1);

    width = 260;
    resize!();
    callbacks.shift()!(0);
    expect(viewport.getSnapshot().virtualWindow.pinnedStart).toHaveLength(0);
    expect(element.scrollLeft).toBe(420);

    width = 300;
    resize!();
    callbacks.shift()!(0);
    expect(viewport.getSnapshot().virtualWindow.pinnedStart).toHaveLength(1);
    expect(element.scrollLeft).toBe(320);
  });

  it.each(["ltr", "reverse-rtl"] as const)(
    "converts the near-maximum suspended offset before restoring sticky pinning in %s",
    (direction) => {
      const columns = compileColumns([
        {
          columnId: "COL_ID_THRESHOLD_START",
          field: "name",
          headerName: "Threshold start",
          pinned: "start",
          valueType: "text",
          width: 100,
        },
        ...Array.from({ length: 10 }, (_, index) => ({
          columnId: `COL_ID_THRESHOLD_CENTER_${index}`,
          field: "name",
          headerName: `Threshold center ${index}`,
          valueType: "text" as const,
          width: 100,
        })),
        {
          columnId: "COL_ID_THRESHOLD_END",
          field: "name",
          headerName: "Threshold end",
          pinned: "end",
          valueType: "text",
          width: 100,
        },
      ]);
      const callbacks: FrameRequestCallback[] = [];
      let resize: (() => void) | undefined;
      let width = 260;
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        callbacks.push(callback);
        return callbacks.length;
      });
      vi.stubGlobal("cancelAnimationFrame", vi.fn());
      vi.stubGlobal(
        "ResizeObserver",
        class extends TestResizeObserver {
          public constructor(callback: ResizeObserverCallback) {
            super(callback);
            resize = () => this.trigger();
          }
        },
      );
      const element = createViewportElement({
        clientHeight: 480,
        clientWidth: () => width,
        ownerDocument: direction === "reverse-rtl" ? createRtlOwnerDocument("reverse") : undefined,
        scrollLeft: direction === "reverse-rtl" ? 0 : 940,
        scrollTop: 0,
        style: { setProperty: vi.fn() },
      });
      const viewport = new BrunoTableViewportRuntime();
      viewport.setLayout(2, columns);
      viewport.attach(element);
      expect(viewport.getSnapshot().virtualWindow.pinnedStart).toHaveLength(0);

      width = 300;
      viewport.setLayout(3, columns);
      expect(viewport.getSnapshot().virtualWindow.pinnedStart).toHaveLength(1);
      expect(element.scrollLeft).toBe(direction === "reverse-rtl" ? 60 : 840);

      resize!();
      callbacks.shift()!(0);
      expect(viewport.getSnapshot().virtualWindow.pinnedStart).toHaveLength(1);
      expect(element.scrollLeft).toBe(direction === "reverse-rtl" ? 60 : 840);
    },
  );

  it.each(["negative", "default", "reverse"] as const)(
    "normalizes exact RTL reveal writes for the %s native scroll model",
    (rtlType) => {
      const columns = compileColumns(
        Array.from({ length: 10 }, (_, index) => ({
          columnId: `COL_ID_RTL_${index}`,
          field: "name",
          headerName: `RTL ${index}`,
          valueType: "text" as const,
          width: 100,
        })),
      );
      const callbacks: FrameRequestCallback[] = [];
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        callbacks.push(callback);
        return callbacks.length;
      });
      vi.stubGlobal("cancelAnimationFrame", vi.fn());
      const maximum = 800;
      const element = createViewportElement({
        clientHeight: 480,
        clientWidth: 200,
        ownerDocument: createRtlOwnerDocument(rtlType),
        scrollLeft: rtlType === "reverse" ? maximum : 0,
        scrollTop: 0,
        style: { setProperty: vi.fn() },
      });
      const viewport = new BrunoTableViewportRuntime();
      viewport.setLayout(2, columns);
      viewport.attach(element);

      viewport.revealCell(0, "COL_ID_RTL_9", "header");
      callbacks.shift()!(0);
      expect(element.scrollLeft).toBe(
        rtlType === "negative" ? -maximum : rtlType === "reverse" ? 0 : maximum,
      );
      expect(viewport.getSnapshot().virtualWindow.center.at(-1)?.columnId).toBe("COL_ID_RTL_9");

      viewport.revealCell(0, "COL_ID_RTL_0", "header");
      callbacks.shift()!(0);
      if (rtlType === "reverse") expect(element.scrollLeft).toBe(maximum);
      else expect(Math.abs(element.scrollLeft)).toBe(0);
      expect(viewport.getSnapshot().virtualWindow.center[0]?.columnId).toBe("COL_ID_RTL_0");
    },
  );

  it("frame-batches direction reconciliation and preserves newer native user input", () => {
    const columns = compileColumns(
      Array.from({ length: 10 }, (_, index) => ({
        columnId: `COL_ID_DIRECTION_${index}`,
        field: "name",
        headerName: `Direction ${index}`,
        valueType: "text" as const,
        width: 100,
      })),
    );
    const callbacks: FrameRequestCallback[] = [];
    let direction: "ltr" | "rtl" = "ltr";
    let clientWidthReads = 0;
    let directionFrameWidth = 200;
    let mutation: MutationCallback | undefined;
    let scrollListener: EventListener | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "MutationObserver",
      class extends TestMutationObserver {
        public constructor(callback: MutationCallback) {
          super(callback);
          mutation = callback;
        }
      },
    );
    const ownerDocument = createRtlOwnerDocument("negative", () => direction);
    const readComputedStyle = vi.spyOn(ownerDocument.defaultView!, "getComputedStyle");
    const element = createViewportElement({
      addEventListener: (name, listener) => {
        if (name === "scroll") scrollListener = listener;
      },
      clientHeight: 480,
      clientWidth: () => {
        clientWidthReads += 1;
        return directionFrameWidth;
      },
      ownerDocument,
      scrollLeft: 320,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(2, columns);
    viewport.attach(element);
    expect(readComputedStyle).toHaveBeenCalledTimes(2);

    direction = "rtl";
    mutation!([], new TestMutationObserver(() => undefined));
    directionFrameWidth = 240;
    element.scrollLeft = 0;
    scrollListener!(new Event("scroll"));
    expect(readComputedStyle).toHaveBeenCalledTimes(2);
    expect(element.scrollLeft).toBe(0);
    callbacks.shift()!(0);
    expect(readComputedStyle).toHaveBeenCalledTimes(3);
    expect(element.scrollLeft).toBe(-320);

    direction = "ltr";
    mutation!([], new TestMutationObserver(() => undefined));
    element.scrollLeft = 0;
    scrollListener!(new Event("scroll"));
    element.scrollLeft = 480;
    scrollListener!(new Event("scroll"));
    callbacks.shift()!(0);
    expect(element.scrollLeft).toBe(480);
    expect(viewport.getSnapshot().virtualWindow.centerStartIndex).toBeGreaterThan(1);

    element.scrollLeft = 600;
    scrollListener!(new Event("scroll"));
    direction = "rtl";
    mutation!([], new TestMutationObserver(() => undefined));
    callbacks.shift()!(0);
    expect(element.scrollLeft).toBe(-600);

    readComputedStyle.mockClear();
    clientWidthReads = 0;
    for (const nativeScrollLeft of [-640, -680, -720]) {
      element.scrollLeft = nativeScrollLeft;
      scrollListener!(new Event("scroll"));
    }
    expect(readComputedStyle).not.toHaveBeenCalled();
    expect(clientWidthReads).toBe(0);
    expect(callbacks).toHaveLength(1);
    callbacks.shift()!(0);
    expect(readComputedStyle).toHaveBeenCalledOnce();
    expect(clientWidthReads).toBeGreaterThan(0);
    expect(element.scrollLeft).toBe(-720);
  });

  it("refreshes computed direction during resize-driven environment reconciliation", () => {
    const columns = compileColumns(
      Array.from({ length: 10 }, (_, index) => ({
        columnId: `COL_ID_RESIZE_DIRECTION_${index}`,
        field: "name",
        headerName: `Resize direction ${index}`,
        valueType: "text" as const,
        width: 100,
      })),
    );
    const callbacks: FrameRequestCallback[] = [];
    let direction: "ltr" | "rtl" = "ltr";
    let resize: (() => void) | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "ResizeObserver",
      class extends TestResizeObserver {
        public constructor(callback: ResizeObserverCallback) {
          super(callback);
          resize = () => this.trigger();
        }
      },
    );
    const ownerDocument = createRtlOwnerDocument("negative", () => direction);
    const readComputedStyle = vi.spyOn(ownerDocument.defaultView!, "getComputedStyle");
    const overlaySetProperty = vi.fn();
    const element = createViewportElement({
      clientHeight: 480,
      clientWidth: 200,
      ownerDocument,
      scrollLeft: 600,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(2, columns);
    viewport.attach(element);
    viewport.attachScrollbarOverlay(
      createViewportElement({ style: { setProperty: overlaySetProperty } }),
    );
    const initialCenterStart = viewport.getSnapshot().virtualWindow.centerStartIndex;
    expect(readComputedStyle).toHaveBeenCalledTimes(3);

    overlaySetProperty.mockClear();
    direction = "rtl";
    resize!();
    expect(readComputedStyle).toHaveBeenCalledTimes(3);
    callbacks.shift()!(0);

    expect(readComputedStyle).toHaveBeenCalledTimes(4);
    expect(element.scrollLeft).toBe(-600);
    expect(viewport.getSnapshot().virtualWindow.centerStartIndex).toBe(initialCenterStart);
    expect(overlaySetProperty).toHaveBeenCalledWith("direction", "rtl");
  });

  it("keeps a post-resize reverse-RTL round trip authoritative", () => {
    const columns = compileColumns(
      Array.from({ length: 10 }, (_, index) => ({
        columnId: `COL_ID_RESIZE_ROUND_TRIP_${index}`,
        field: "name",
        headerName: `Resize round trip ${index}`,
        valueType: "text" as const,
        width: 100,
      })),
    );
    const observers = installViewportObserverHarness();
    let clientWidthReads = 0;
    let scrollListener: EventListener | undefined;
    let width = 200;
    const element = createViewportElement({
      addEventListener: (name, listener) => {
        if (name === "scroll") scrollListener = listener;
      },
      clientHeight: 480,
      clientWidth: () => {
        clientWidthReads += 1;
        return width;
      },
      ownerDocument: createRtlOwnerDocument("reverse"),
      scrollLeft: 500,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(2, columns);
    viewport.attach(element);

    width = 300;
    clientWidthReads = 0;
    observers.triggerResize(element);
    element.scrollLeft = 450;
    scrollListener!(new Event("scroll"));
    element.scrollLeft = 500;
    scrollListener!(new Event("scroll"));
    width = 400;
    observers.triggerResize(element);

    expect(clientWidthReads).toBe(0);
    expect(observers.frames).toHaveLength(1);
    observers.frames.shift()!(0);
    expect(element.scrollLeft).toBe(500);
  });

  it("keeps a post-direction reverse-RTL round trip authoritative", () => {
    const columns = compileColumns(
      Array.from({ length: 10 }, (_, index) => ({
        columnId: `COL_ID_DIRECTION_ROUND_TRIP_${index}`,
        field: "name",
        headerName: `Direction round trip ${index}`,
        valueType: "text" as const,
        width: 100,
      })),
    );
    const observers = installViewportObserverHarness();
    let clientWidthReads = 0;
    let direction: "ltr" | "rtl" = "ltr";
    let width = 200;
    let scrollListener: EventListener | undefined;
    const ownerDocument = createRtlOwnerDocument("reverse", () => direction);
    const readComputedStyle = vi.spyOn(ownerDocument.defaultView!, "getComputedStyle");
    const element = createViewportElement({
      addEventListener: (name, listener) => {
        if (name === "scroll") scrollListener = listener;
      },
      clientHeight: 480,
      clientWidth: () => {
        clientWidthReads += 1;
        return width;
      },
      ownerDocument,
      scrollLeft: 500,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(2, columns);
    viewport.attach(element);

    direction = "rtl";
    observers.triggerMutation(element);
    width = 240;
    element.scrollLeft = 0;
    scrollListener!(new Event("scroll"));
    readComputedStyle.mockClear();
    clientWidthReads = 0;
    element.scrollLeft = 450;
    scrollListener!(new Event("scroll"));
    element.scrollLeft = 500;
    scrollListener!(new Event("scroll"));
    observers.triggerMutation(element);

    expect(readComputedStyle).not.toHaveBeenCalled();
    expect(clientWidthReads).toBe(0);
    expect(observers.frames).toHaveLength(1);
    observers.frames.shift()!(0);
    expect(readComputedStyle).toHaveBeenCalledOnce();
    expect(element.scrollLeft).toBe(500);
  });

  it("publishes a structural pinned-resize preview at the suspension threshold and restores it", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_PREVIEW_START",
        field: "name",
        headerName: "Preview start",
        valueType: "text" as const,
        width: 160,
        pinned: "start" as const,
      },
      {
        columnId: "COL_ID_PREVIEW_CENTER",
        field: "name",
        headerName: "Preview center",
        valueType: "text" as const,
        width: 160,
      },
      {
        columnId: "COL_ID_PREVIEW_END",
        field: "name",
        headerName: "Preview end",
        valueType: "text" as const,
        width: 140,
        pinned: "end" as const,
      },
    ]);
    const removeProperty = vi.fn();
    const setProperty = vi.fn();
    const element = createViewportElement({
      clientHeight: 480,
      clientWidth: 500,
      ownerDocument: createRtlOwnerDocument("negative", () => "ltr"),
      scrollLeft: 0,
      scrollTop: 0,
      style: { removeProperty, setProperty },
    });
    const viewport = new BrunoTableViewportRuntime();
    const publications = vi.fn();
    viewport.setLayout(2, columns);
    viewport.attach(element);
    viewport.subscribe(publications);
    const publicationsBeforePreview = publications.mock.calls.length;
    expect(viewport.getSnapshot().virtualWindow.pinnedStart).toHaveLength(1);

    viewport.previewColumnWidth("COL_ID_PREVIEW_START", 300);
    expect(viewport.getSnapshot().virtualWindow.pinnedStart).toHaveLength(0);
    expect(viewport.getSnapshot().virtualWindow.pinnedEnd).toHaveLength(0);
    expect(publications.mock.calls.length).toBeGreaterThan(publicationsBeforePreview);
    expect(setProperty).toHaveBeenCalledWith(
      brunoTableColumnCssVariable("width", "COL_ID_PREVIEW_START"),
      "300px",
    );

    const publicationsAfterSuspension = publications.mock.calls.length;
    viewport.previewColumnWidth("COL_ID_PREVIEW_START", 160);
    expect(publications.mock.calls.length).toBeGreaterThan(publicationsAfterSuspension);
    expect(viewport.getSnapshot().virtualWindow.pinnedStart[0]?.columnId).toBe(
      "COL_ID_PREVIEW_START",
    );
    expect(viewport.getSnapshot().virtualWindow.pinnedEnd[0]?.columnId).toBe("COL_ID_PREVIEW_END");

    viewport.clearColumnWidthPreview();
    expect(viewport.getSnapshot().virtualWindow.pinnedStart[0]?.columnId).toBe(
      "COL_ID_PREVIEW_START",
    );
    expect(viewport.getSnapshot().virtualWindow.pinnedEnd[0]?.columnId).toBe("COL_ID_PREVIEW_END");
    expect(removeProperty).toHaveBeenCalled();
  });

  it("publishes one bounded structural preview when shrinking a wide centre exposes columns", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_WIDE_PREVIEW",
        field: "name",
        headerName: "Wide preview",
        valueType: "text" as const,
        width: 800,
      },
      ...Array.from({ length: 12 }, (_unused, index) => ({
        columnId: `COL_ID_EXPOSED_${String(index)}`,
        field: "name" as const,
        headerName: `Exposed ${String(index)}`,
        valueType: "text" as const,
        width: 100,
      })),
    ]);
    const setProperty = vi.fn();
    const element = createViewportElement({
      clientHeight: 480,
      clientWidth: 240,
      ownerDocument: createRtlOwnerDocument("negative", () => "ltr"),
      scrollLeft: 0,
      scrollTop: 0,
      style: { removeProperty: vi.fn(), setProperty },
    });
    const viewport = new BrunoTableViewportRuntime();
    const publications = vi.fn();
    viewport.setLayout(2, columns);
    viewport.attach(element);
    viewport.subscribe(publications);

    expect(
      viewport.getSnapshot().virtualWindow.center.map(({ columnId }) => columnId),
    ).not.toContain("COL_ID_EXPOSED_4");

    viewport.previewColumnWidth("COL_ID_WIDE_PREVIEW", 100);

    const previewWindow = viewport.getSnapshot().virtualWindow;
    expect(previewWindow.center.map(({ columnId }) => columnId)).toContain("COL_ID_EXPOSED_3");
    expect(publications).toHaveBeenCalledTimes(1);
    expect(setProperty).toHaveBeenCalledWith(
      brunoTableColumnCssVariable("width", "COL_ID_WIDE_PREVIEW"),
      "100px",
    );
    expect(setProperty).toHaveBeenCalledWith(
      BRUNO_TABLE_LIVE_RIGHT_PADDING_CSS_VARIABLE,
      `${String(previewWindow.rightPadding)}px`,
    );

    const publicationCounts: number[] = [];
    for (const width of [90, 80, 70, 60]) {
      const publicationCountBeforePreview = publications.mock.calls.length;
      viewport.previewColumnWidth("COL_ID_WIDE_PREVIEW", width);
      publicationCounts.push(publications.mock.calls.length - publicationCountBeforePreview);
    }
    expect(publicationCounts).toEqual([0, 0, 1, 0]);
    expect(publicationCounts.every((count) => count <= 1)).toBe(true);
  });

  it("keeps preview padding aligned with the retained mounted slice when widening a centre column", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_WIDEN_PREVIEW",
        field: "name",
        headerName: "Widen preview",
        valueType: "text" as const,
        width: 100,
      },
      ...Array.from({ length: 12 }, (_unused, index) => ({
        columnId: `COL_ID_WIDENED_${String(index)}`,
        field: "name" as const,
        headerName: `Widened ${String(index)}`,
        valueType: "text" as const,
        width: 100,
      })),
    ]);
    const setProperty = vi.fn();
    const element = createViewportElement({
      clientHeight: 480,
      clientWidth: 240,
      ownerDocument: createRtlOwnerDocument("negative", () => "ltr"),
      scrollLeft: 0,
      scrollTop: 0,
      style: { removeProperty: vi.fn(), setProperty },
    });
    const viewport = new BrunoTableViewportRuntime();
    const publications = vi.fn();
    viewport.setLayout(2, columns);
    viewport.attach(element);
    viewport.subscribe(publications);

    const mountedWindow = viewport.getSnapshot().virtualWindow;
    expect(mountedWindow.center.length).toBeGreaterThan(3);
    expect(mountedWindow.center[0]?.columnId).toBe("COL_ID_WIDEN_PREVIEW");

    viewport.previewColumnWidth("COL_ID_WIDEN_PREVIEW", 800);

    expect(publications).not.toHaveBeenCalled();
    const rightPaddingWrites = setProperty.mock.calls
      .filter(([property]) => property === BRUNO_TABLE_LIVE_RIGHT_PADDING_CSS_VARIABLE)
      .map(([, value]) => value);
    expect(rightPaddingWrites.at(-1)).toBe("800px");
  });

  it("clears an active width preview before replacing the viewport element", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_ATTACH_PREVIEW",
        field: "name",
        headerName: "Attach preview",
        valueType: "text" as const,
        width: 160,
      },
    ]);
    const oldRemoveProperty = vi.fn();
    const oldElement = createViewportElement({
      clientHeight: 480,
      clientWidth: 500,
      ownerDocument: createRtlOwnerDocument("negative", () => "ltr"),
      scrollLeft: 0,
      scrollTop: 0,
      style: { removeProperty: oldRemoveProperty, setProperty: vi.fn() },
    });
    const newElement = createViewportElement({
      clientHeight: 480,
      clientWidth: 500,
      ownerDocument: createRtlOwnerDocument("negative", () => "ltr"),
      scrollLeft: 0,
      scrollTop: 0,
      style: { removeProperty: vi.fn(), setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(2, columns);
    viewport.attach(oldElement);
    viewport.previewColumnWidth("COL_ID_ATTACH_PREVIEW", 300);
    viewport.attach(newElement);

    expect(oldRemoveProperty).toHaveBeenCalledWith(
      brunoTableColumnCssVariable("width", "COL_ID_ATTACH_PREVIEW"),
    );
    expect(viewport.getSnapshot().virtualWindow.center[0]?.semantics.width).toBe(160);
  });

  it("refreshes computed direction before reveal after a CSS-only change", () => {
    const columns = compileColumns(
      Array.from({ length: 10 }, (_, index) => ({
        columnId: `COL_ID_CSS_DIRECTION_${index}`,
        field: "name",
        headerName: `CSS direction ${index}`,
        valueType: "text" as const,
        width: 100,
      })),
    );
    const callbacks: FrameRequestCallback[] = [];
    let direction: "ltr" | "rtl" = "ltr";
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const ownerDocument = createRtlOwnerDocument("negative", () => direction);
    const readComputedStyle = vi.spyOn(ownerDocument.defaultView!, "getComputedStyle");
    const element = createViewportElement({
      clientHeight: 480,
      clientWidth: 200,
      ownerDocument,
      scrollLeft: 320,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(2, columns);
    viewport.attach(element);
    expect(readComputedStyle).toHaveBeenCalledTimes(2);

    // Models CSSStyleSheet.insertRule(), which changes computed style without a DOM mutation.
    direction = "rtl";
    viewport.revealCell(0, "COL_ID_CSS_DIRECTION_7", "header");
    callbacks.shift()!(0);

    expect(readComputedStyle).toHaveBeenCalledTimes(3);
    expect(element.scrollLeft).toBe(-600);
    expect(
      viewport
        .getSnapshot()
        .virtualWindow.center.some(({ columnId }) => columnId === "COL_ID_CSS_DIRECTION_7"),
    ).toBe(true);

    viewport.revealCell(0, "COL_ID_CSS_DIRECTION_8", "header");
    callbacks.shift()!(0);
    expect(readComputedStyle).toHaveBeenCalledTimes(4);
  });

  it("decodes the first native input after a CSS-only direction change", () => {
    const columns = compileColumns(
      Array.from({ length: 10 }, (_, index) => ({
        columnId: `COL_ID_CSS_INPUT_${index}`,
        field: "name",
        headerName: `CSS input ${index}`,
        valueType: "text" as const,
        width: 100,
      })),
    );
    const callbacks: FrameRequestCallback[] = [];
    let direction: "ltr" | "rtl" = "ltr";
    let scrollListener: EventListener | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const ownerDocument = createRtlOwnerDocument("negative", () => direction);
    const element = createViewportElement({
      addEventListener: (name, listener) => {
        if (name === "scroll") scrollListener = listener;
      },
      clientHeight: 480,
      clientWidth: 200,
      ownerDocument,
      scrollLeft: 320,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(2, columns);
    viewport.attach(element);

    // Models a CSSStyleSheet.insertRule() direction change followed immediately by user input.
    direction = "rtl";
    element.scrollLeft = -600;
    scrollListener!(new Event("scroll"));
    callbacks.shift()!(0);

    expect(element.scrollLeft).toBe(-600);
    expect(viewport.getSnapshot().virtualWindow.center.map(({ columnId }) => columnId)).toContain(
      "COL_ID_CSS_INPUT_7",
    );
  });

  it("observes inherited direction changes on every ancestor", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_DIRECTION_OBSERVER",
        field: "name",
        headerName: "Direction observer",
        valueType: "text",
        width: 100,
      },
    ]);
    const observations: Array<{
      readonly target: Node;
      readonly options: MutationObserverInit;
    }> = [];
    vi.stubGlobal(
      "MutationObserver",
      class {
        public constructor(_callback: MutationCallback) {}
        public observe(target: Node, options: MutationObserverInit) {
          observations.push({ target, options });
        }
        public disconnect() {}
      },
    );
    const ownerDocument = createRtlOwnerDocument("negative", () => "ltr");
    const documentElement = ownerDocument.documentElement;
    const body = ownerDocument.body;
    const explicitDirectionOwner = ownerDocument.createElement("div");
    const intermediateOwner = ownerDocument.createElement("div");
    const directParent = ownerDocument.createElement("div");
    const element = createViewportElement({
      clientHeight: 480,
      clientWidth: 200,
      ownerDocument,
      scrollLeft: 0,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    });
    body.appendChild(explicitDirectionOwner);
    explicitDirectionOwner.appendChild(intermediateOwner);
    intermediateOwner.appendChild(directParent);
    directParent.appendChild(element);
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(2, columns);
    viewport.attach(element);

    expect(
      observations.find(({ target }) => target === directParent)?.options.attributeFilter,
    ).toEqual(["class", "dir", "style"]);
    expect(
      observations.find(({ target }) => target === intermediateOwner)?.options.attributeFilter,
    ).toEqual(["class", "dir", "style"]);
    expect(
      observations.find(({ target }) => target === explicitDirectionOwner)?.options.attributeFilter,
    ).toEqual(["class", "dir", "style"]);
    expect(observations.find(({ target }) => target === body)?.options.attributeFilter).toEqual([
      "class",
      "dir",
      "style",
    ]);
    expect(
      observations.find(({ target }) => target === documentElement)?.options.attributeFilter,
    ).toEqual(["class", "dir", "style"]);
    expect(observations.find(({ target }) => target === ownerDocument.head)?.options).toEqual({
      attributes: true,
      attributeFilter: ["disabled", "href", "media"],
      childList: true,
      characterData: true,
      subtree: true,
    });
  });

  it.each(["ltr", "reverse-rtl"] as const)(
    "preserves input sampled before a pin-suspending resize in %s",
    (direction) => {
      const columns = compileColumns([
        {
          columnId: "COL_ID_INPUT_RESIZE_START",
          field: "name",
          headerName: "Input resize start",
          pinned: "start",
          valueType: "text",
          width: 100,
        },
        ...Array.from({ length: 10 }, (_, index) => ({
          columnId: `COL_ID_INPUT_RESIZE_CENTER_${index}`,
          field: "name",
          headerName: `Input resize center ${index}`,
          valueType: "text" as const,
          width: 100,
        })),
        {
          columnId: "COL_ID_INPUT_RESIZE_END",
          field: "name",
          headerName: "Input resize end",
          pinned: "end",
          valueType: "text",
          width: 100,
        },
      ]);
      const callbacks: FrameRequestCallback[] = [];
      let resize: (() => void) | undefined;
      let scrollListener: EventListener | undefined;
      let width = 300;
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        callbacks.push(callback);
        return callbacks.length;
      });
      vi.stubGlobal("cancelAnimationFrame", vi.fn());
      vi.stubGlobal(
        "ResizeObserver",
        class extends TestResizeObserver {
          public constructor(callback: ResizeObserverCallback) {
            super(callback);
            resize = () => this.trigger();
          }
        },
      );
      const element = createViewportElement({
        addEventListener: (name, listener) => {
          if (name === "scroll") scrollListener = listener;
        },
        clientHeight: 480,
        clientWidth: () => width,
        ownerDocument: direction === "reverse-rtl" ? createRtlOwnerDocument("reverse") : undefined,
        scrollLeft: direction === "reverse-rtl" ? 900 : 0,
        scrollTop: 0,
        style: { setProperty: vi.fn() },
      });
      const viewport = new BrunoTableViewportRuntime();
      viewport.setLayout(2, columns);
      viewport.attach(element);

      element.scrollLeft = direction === "reverse-rtl" ? 500 : 400;
      scrollListener!(new Event("scroll"));
      width = 260;
      resize!();
      callbacks.shift()!(0);

      expect(element.scrollLeft).toBe(direction === "reverse-rtl" ? 440 : 500);
      expect(viewport.getSnapshot().virtualWindow.pinnedStart).toHaveLength(0);
    },
  );

  it("preserves the logical offset when a reverse-RTL resize changes the maximum", () => {
    const columns = compileColumns(
      Array.from({ length: 10 }, (_, index) => ({
        columnId: `COL_ID_REVERSE_RESIZE_${index}`,
        field: "name",
        headerName: `Reverse resize ${index}`,
        valueType: "text" as const,
        width: 100,
      })),
    );
    const callbacks: FrameRequestCallback[] = [];
    let resize: (() => void) | undefined;
    let width = 200;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "ResizeObserver",
      class extends TestResizeObserver {
        public constructor(callback: ResizeObserverCallback) {
          super(callback);
          resize = () => this.trigger();
        }
      },
    );
    const element = createViewportElement({
      clientHeight: 480,
      clientWidth: () => width,
      ownerDocument: createRtlOwnerDocument("reverse"),
      scrollLeft: 500,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(2, columns);
    viewport.attach(element);

    width = 300;
    resize!();
    callbacks.shift()!(0);
    expect(element.scrollLeft).toBe(400);
  });

  it("keeps one reverse-RTL geometry generation across a simultaneous resize and layout change", () => {
    const columns = compileColumns(
      Array.from({ length: 10 }, (_, index) => ({
        columnId: `COL_ID_COMBINED_${index}`,
        field: "name",
        headerName: `Combined ${index}`,
        valueType: "text" as const,
        width: 100,
      })),
    );
    const widerColumns = compileColumns(
      columns.map((column, index) => ({
        columnId: column.columnId,
        field: "name",
        headerName: column.headerName,
        valueType: "text" as const,
        width: index === columns.length - 1 ? 200 : 100,
      })),
    );
    let width = 200;
    const element = createViewportElement({
      clientHeight: 480,
      clientWidth: () => width,
      ownerDocument: createRtlOwnerDocument("reverse"),
      scrollLeft: 500,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(2, columns);
    viewport.attach(element);

    width = 300;
    viewport.setLayout(2, widerColumns);

    expect(element.scrollLeft).toBe(500);
    expect(viewport.getSnapshot().virtualWindow.center.map((column) => column.columnId)).toContain(
      "COL_ID_COMBINED_3",
    );
  });

  it("defers a reverse-RTL widening write until the content extent commits", () => {
    const initialColumns = compileColumns([
      {
        columnId: "COL_ID_DEFERRED_REVERSE_0",
        field: "name",
        headerName: "Deferred reverse 0",
        valueType: "text",
        width: 100,
      },
    ]);
    const widerColumns = compileColumns(
      Array.from({ length: 10 }, (_, index) => ({
        columnId: `COL_ID_DEFERRED_REVERSE_${index}`,
        field: "name",
        headerName: `Deferred reverse ${index}`,
        valueType: "text" as const,
        width: 100,
      })),
    );
    const widestColumns = compileColumns(
      Array.from({ length: 12 }, (_, index) => ({
        columnId: `COL_ID_DEFERRED_REVERSE_${index}`,
        field: "name",
        headerName: `Deferred reverse ${index}`,
        valueType: "text" as const,
        width: 100,
      })),
    );
    const callbacks: FrameRequestCallback[] = [];
    const clientWidth = 200;
    let committedScrollWidth = 200;
    let nativeScrollLeft = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const element = createViewportElement({
      clientHeight: 480,
      clientWidth,
      ownerDocument: createRtlOwnerDocument("reverse"),
      scrollLeft: {
        get: () => nativeScrollLeft,
        set: (value) => {
          const committedMaximum = Math.max(committedScrollWidth - clientWidth, 0);
          nativeScrollLeft = Math.min(Math.max(value, 0), committedMaximum);
        },
      },
      scrollTop: 0,
      scrollWidth: () => committedScrollWidth,
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(2, initialColumns);
    viewport.attach(element);

    viewport.setLayout(2, widerColumns);
    viewport.setLayout(2, widestColumns);
    viewport.resetVertical();

    expect(element.scrollLeft).toBe(0);
    expect(viewport.getSnapshot().virtualWindow.center[0]?.columnId).toBe(
      "COL_ID_DEFERRED_REVERSE_0",
    );
    expect(callbacks).toHaveLength(1);

    callbacks.shift()!(0);

    expect(element.scrollLeft).toBe(0);
    expect(viewport.getSnapshot().virtualWindow.center[0]?.columnId).toBe(
      "COL_ID_DEFERRED_REVERSE_0",
    );
    expect(callbacks).toHaveLength(1);

    committedScrollWidth = 1_200;
    callbacks.shift()!(0);

    expect(element.scrollLeft).toBe(1_000);
    expect(viewport.getSnapshot().virtualWindow.center[0]?.columnId).toBe(
      "COL_ID_DEFERRED_REVERSE_0",
    );
  });

  it("bounds reverse-RTL reconciliation when the content extent never commits", () => {
    const initialColumns = compileColumns([
      {
        columnId: "COL_ID_BOUNDED_REVERSE_0",
        field: "name",
        headerName: "Bounded reverse 0",
        valueType: "text",
        width: 100,
      },
    ]);
    const widerColumns = compileColumns(
      Array.from({ length: 10 }, (_, index) => ({
        columnId: `COL_ID_BOUNDED_REVERSE_${index}`,
        field: "name",
        headerName: `Bounded reverse ${index}`,
        valueType: "text" as const,
        width: 100,
      })),
    );
    const triggerResize = observeResizeTargets();
    const { callbacks, commitScrollWidth, element } = createDeferredReverseRtlHarness();
    const rowLayer = createViewportElement({
      style: { removeProperty: vi.fn(), setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(2, initialColumns);
    viewport.attach(element);
    viewport.attachRowLayer(rowLayer);

    viewport.setLayout(2, widerColumns);
    for (let frame = 0; frame < 16 && callbacks.length > 0; frame += 1) {
      callbacks.shift()!(frame);
    }

    expect(callbacks).toHaveLength(0);
    expect(element.scrollLeft).toBe(0);
    expect(viewport.getSnapshot().virtualWindow.center[0]?.columnId).toBe(
      "COL_ID_BOUNDED_REVERSE_0",
    );

    commitScrollWidth(1_000);
    triggerResize(rowLayer);
    callbacks.shift()!(17);

    expect(element.scrollLeft).toBe(800);
    expect(viewport.getSnapshot().virtualWindow.center[0]?.columnId).toBe(
      "COL_ID_BOUNDED_REVERSE_0",
    );
  });

  it("retries a reveal after deferred reverse-RTL layout reconciliation", () => {
    const initialColumns = compileColumns([
      {
        columnId: "COL_ID_DEFERRED_REVEAL_0",
        field: "name",
        headerName: "Deferred reveal 0",
        valueType: "text",
        width: 100,
      },
    ]);
    const widerColumns = compileColumns(
      Array.from({ length: 10 }, (_, index) => ({
        columnId: `COL_ID_DEFERRED_REVEAL_${index}`,
        field: "name",
        headerName: `Deferred reveal ${index}`,
        valueType: "text" as const,
        width: 100,
      })),
    );
    const triggerResize = observeResizeTargets();
    const { callbacks, commitScrollWidth, element } = createDeferredReverseRtlHarness();
    const rowLayer = createViewportElement({
      style: { removeProperty: vi.fn(), setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(2, initialColumns);
    viewport.attach(element);
    viewport.attachRowLayer(rowLayer);

    viewport.setLayout(2, widerColumns);
    viewport.revealCell(0, "COL_ID_DEFERRED_REVEAL_5", "header");
    for (let frame = 0; frame < 16 && callbacks.length > 0; frame += 1) {
      callbacks.shift()!(frame);
    }

    expect(callbacks).toHaveLength(0);
    expect(
      viewport.getSnapshot().virtualWindow.center.map(({ columnId }) => columnId),
    ).not.toContain("COL_ID_DEFERRED_REVEAL_5");

    commitScrollWidth(1_000);
    triggerResize(rowLayer);
    callbacks.shift()!(17);

    expect(viewport.getSnapshot().virtualWindow.center.map(({ columnId }) => columnId)).toContain(
      "COL_ID_DEFERRED_REVEAL_5",
    );
    expect(element.scrollLeft).toBe(400);
  });

  it("resolves a dirty reverse-RTL direction before classifying a widening write", () => {
    const initialColumns = compileColumns([
      {
        columnId: "COL_ID_DIRTY_REVERSE_0",
        field: "name",
        headerName: "Dirty reverse 0",
        valueType: "text",
        width: 100,
      },
    ]);
    const widerColumns = compileColumns(
      Array.from({ length: 10 }, (_, index) => ({
        columnId: `COL_ID_DIRTY_REVERSE_${index}`,
        field: "name",
        headerName: `Dirty reverse ${index}`,
        valueType: "text" as const,
        width: 100,
      })),
    );
    const callbacks: FrameRequestCallback[] = [];
    const clientWidth = 200;
    let committedScrollWidth = 200;
    let direction: "ltr" | "rtl" = "ltr";
    let mutation: MutationCallback | undefined;
    let nativeScrollLeft = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "MutationObserver",
      class extends TestMutationObserver {
        public constructor(callback: MutationCallback) {
          super(callback);
          mutation = callback;
        }
      },
    );
    const element = createViewportElement({
      clientHeight: 480,
      clientWidth,
      ownerDocument: createRtlOwnerDocument("reverse", () => direction),
      scrollLeft: {
        get: () => nativeScrollLeft,
        set: (value) => {
          const committedMaximum = Math.max(committedScrollWidth - clientWidth, 0);
          nativeScrollLeft = Math.min(Math.max(value, 0), committedMaximum);
        },
      },
      scrollTop: 0,
      scrollWidth: () => committedScrollWidth,
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(2, initialColumns);
    viewport.attach(element);

    direction = "rtl";
    mutation!([], new TestMutationObserver(() => undefined));
    viewport.setLayout(2, widerColumns);

    expect(element.scrollLeft).toBe(0);
    expect(callbacks).toHaveLength(1);

    committedScrollWidth = 1_000;
    callbacks.shift()!(0);

    expect(element.scrollLeft).toBe(800);
    expect(viewport.getSnapshot().virtualWindow.center[0]?.columnId).toBe("COL_ID_DIRTY_REVERSE_0");
  });

  it("keeps post-layout reverse-RTL native input authoritative", () => {
    const initialColumns = compileColumns([
      {
        columnId: "COL_ID_DEFERRED_INPUT_0",
        field: "name",
        headerName: "Deferred input 0",
        valueType: "text",
        width: 100,
      },
    ]);
    const widerColumns = compileColumns(
      Array.from({ length: 10 }, (_, index) => ({
        columnId: `COL_ID_DEFERRED_INPUT_${index}`,
        field: "name",
        headerName: `Deferred input ${index}`,
        valueType: "text" as const,
        width: 100,
      })),
    );
    const callbacks: FrameRequestCallback[] = [];
    const clientWidth = 200;
    let committedScrollWidth = 200;
    let mutation: MutationCallback | undefined;
    let nativeScrollLeft = 0;
    let scrollListener: EventListener | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "MutationObserver",
      class extends TestMutationObserver {
        public constructor(callback: MutationCallback) {
          super(callback);
          mutation = callback;
        }
      },
    );
    const element = createViewportElement({
      addEventListener: (name, listener) => {
        if (name === "scroll") scrollListener = listener;
      },
      clientHeight: 480,
      clientWidth,
      ownerDocument: createRtlOwnerDocument("reverse"),
      scrollLeft: {
        get: () => nativeScrollLeft,
        set: (value) => {
          const committedMaximum = Math.max(committedScrollWidth - clientWidth, 0);
          nativeScrollLeft = Math.min(Math.max(value, 0), committedMaximum);
        },
      },
      scrollTop: 0,
      scrollWidth: () => committedScrollWidth,
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(2, initialColumns);
    viewport.attach(element);
    viewport.setLayout(2, widerColumns);

    committedScrollWidth = 1_000;
    element.scrollLeft = 600;
    scrollListener!(new Event("scroll"));
    mutation!([], new TestMutationObserver(() => undefined));
    element.scrollLeft = 500;
    mutation!([], new TestMutationObserver(() => undefined));
    viewport.resetVertical();

    expect(element.scrollLeft).toBe(500);
    callbacks.shift()!(0);

    expect(element.scrollLeft).toBe(500);
    expect(viewport.getSnapshot().virtualWindow.center.map(({ columnId }) => columnId)).toContain(
      "COL_ID_DEFERRED_INPUT_3",
    );
  });

  it("projects a deferred reverse-RTL coordinate when resize suspends pinning", () => {
    const initialColumns = compileColumns([
      {
        columnId: "COL_ID_DEFERRED_PIN_START",
        field: "name",
        headerName: "Deferred pin start",
        pinned: "start",
        valueType: "text",
        width: 100,
      },
      {
        columnId: "COL_ID_DEFERRED_PIN_CENTER_0",
        field: "name",
        headerName: "Deferred pin center 0",
        valueType: "text",
        width: 100,
      },
      {
        columnId: "COL_ID_DEFERRED_PIN_END",
        field: "name",
        headerName: "Deferred pin end",
        pinned: "end",
        valueType: "text",
        width: 100,
      },
    ]);
    const widerColumns = compileColumns([
      {
        columnId: "COL_ID_DEFERRED_PIN_START",
        field: "name",
        headerName: "Deferred pin start",
        pinned: "start",
        valueType: "text",
        width: 100,
      },
      ...Array.from({ length: 10 }, (_, index) => ({
        columnId: `COL_ID_DEFERRED_PIN_CENTER_${index}`,
        field: "name",
        headerName: `Deferred pin center ${index}`,
        valueType: "text" as const,
        width: 100,
      })),
      {
        columnId: "COL_ID_DEFERRED_PIN_END",
        field: "name",
        headerName: "Deferred pin end",
        pinned: "end",
        valueType: "text",
        width: 100,
      },
    ]);
    const callbacks: FrameRequestCallback[] = [];
    let committedScrollWidth = 400;
    let nativeScrollLeft = 0;
    let resize: (() => void) | undefined;
    let width = 400;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "ResizeObserver",
      class extends TestResizeObserver {
        public constructor(callback: ResizeObserverCallback) {
          super(callback);
          resize = () => this.trigger();
        }
      },
    );
    const element = createViewportElement({
      clientHeight: 480,
      clientWidth: () => width,
      ownerDocument: createRtlOwnerDocument("reverse"),
      scrollLeft: {
        get: () => nativeScrollLeft,
        set: (value) => {
          const committedMaximum = Math.max(committedScrollWidth - width, 0);
          nativeScrollLeft = Math.min(Math.max(value, 0), committedMaximum);
        },
      },
      scrollTop: 0,
      scrollWidth: () => committedScrollWidth,
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(2, initialColumns);
    viewport.attach(element);

    viewport.setLayout(2, widerColumns);
    width = 260;
    resize!();
    viewport.resetVertical();

    expect(element.scrollLeft).toBe(0);
    expect(viewport.getSnapshot().virtualWindow.pinnedStart).toHaveLength(0);
    expect(viewport.getSnapshot().virtualWindow.pinnedEnd).toHaveLength(0);

    committedScrollWidth = 1_200;
    callbacks.shift()!(0);

    expect(element.scrollLeft).toBe(840);
    expect(viewport.getSnapshot().virtualWindow.pinnedStart).toHaveLength(0);
    expect(viewport.getSnapshot().virtualWindow.pinnedEnd).toHaveLength(0);
  });

  it.each(["ltr", "reverse-rtl"] as const)(
    "keeps latest native input authoritative across a simultaneous resize and layout change in %s",
    (direction) => {
      vi.stubGlobal(
        "requestAnimationFrame",
        vi.fn(() => 1),
      );
      vi.stubGlobal("cancelAnimationFrame", vi.fn());
      const columns = compileColumns(
        Array.from({ length: 10 }, (_, index) => ({
          columnId: `COL_ID_INPUT_${index}`,
          field: "name",
          headerName: `Input ${index}`,
          valueType: "text" as const,
          width: 100,
        })),
      );
      const widerColumns = compileColumns(
        columns.map((column, index) => ({
          columnId: column.columnId,
          field: "name",
          headerName: column.headerName,
          valueType: "text" as const,
          width: index === columns.length - 1 ? 200 : 100,
        })),
      );
      let width = 200;
      let scrollListener: EventListener | undefined;
      const element = createViewportElement({
        addEventListener: (name, listener) => {
          if (name === "scroll") scrollListener = listener;
        },
        clientHeight: 480,
        clientWidth: () => width,
        ownerDocument: direction === "reverse-rtl" ? createRtlOwnerDocument("reverse") : undefined,
        scrollLeft: direction === "reverse-rtl" ? 480 : 320,
        scrollTop: 0,
        style: { setProperty: vi.fn() },
      });
      const viewport = new BrunoTableViewportRuntime();
      viewport.setLayout(2, columns);
      viewport.attach(element);

      width = 300;
      element.scrollLeft = direction === "reverse-rtl" ? 220 : 480;
      scrollListener!(new Event("scroll"));
      viewport.setLayout(2, widerColumns);

      expect(element.scrollLeft).toBe(direction === "reverse-rtl" ? 320 : 480);
      expect(viewport.getSnapshot().virtualWindow.centerStartIndex).toBeGreaterThan(1);
    },
  );

  it("keeps the native horizontal coordinate when the pinning structure changes", () => {
    const pinnedColumns = compileColumns([
      {
        columnId: "COL_ID_START",
        field: "name",
        headerName: "Start",
        pinned: "start",
        valueType: "text",
        width: 100,
      },
      ...Array.from({ length: 10 }, (_, index) => ({
        columnId: `COL_ID_CENTER_${String(index)}`,
        field: "name",
        headerName: `Center ${String(index)}`,
        valueType: "text" as const,
        width: 100,
      })),
    ]);
    const unpinnedColumns = compileColumns(
      pinnedColumns.map((column) => ({
        columnId: column.columnId,
        field: "name",
        headerName: column.headerName,
        valueType: "text" as const,
        width: column.semantics.width,
      })),
    );
    const element = createViewportElement({
      clientHeight: 480,
      clientWidth: 100,
      scrollLeft: 420,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(100, pinnedColumns);
    viewport.attach(element);
    expect(viewport.getSnapshot().virtualWindow.pinnedStart).toHaveLength(0);

    viewport.setLayout(100, unpinnedColumns);

    expect(element.scrollLeft).toBe(420);
  });

  it("rebases a queued identity-owned reveal when a same-shape row space is published", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    let callback: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (next: FrameRequestCallback) => {
      callback = next;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const element = createViewportElement({
      clientHeight: 480,
      clientWidth: 800,
      scrollLeft: 0,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(100, columns);
    viewport.attach(element);

    viewport.revealCell(75, "COL_ID_NAME", "body", "row-75");
    viewport.setLayout(100, columns, (rowId) => (rowId === "row-75" ? 50 : undefined));
    callback!(0);

    expect(viewport.getSnapshot().virtualWindow.rowStart).toBeGreaterThan(30);
    expect(viewport.getSnapshot().virtualWindow.rowStart).toBeLessThan(40);
  });

  it("preserves a queued index-only reveal across a layout publication", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    let callback: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (next: FrameRequestCallback) => {
      callback = next;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const element = createViewportElement({
      clientHeight: 480,
      clientWidth: 800,
      scrollLeft: 0,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(100, columns);
    viewport.attach(element);

    viewport.revealCell(75, "COL_ID_NAME");
    viewport.setLayout(101, columns);
    callback!(0);

    expect(viewport.getSnapshot().virtualWindow.rowStart).toBeGreaterThan(50);
  });

  it("keeps a thousand-column horizontal window bounded", () => {
    const columns = compileColumns(
      Array.from({ length: 1_000 }, (_, index) => ({
        columnId: `COL_ID_STRESS_${String(index).padStart(4, "0")}`,
        field: "name",
        headerName: `Stress ${index}`,
        valueType: "text" as const,
        width: 120,
      })),
    );
    let callback: FrameRequestCallback | undefined;
    let scrollListener: EventListener | undefined;
    vi.stubGlobal("requestAnimationFrame", (next: FrameRequestCallback) => {
      callback = next;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const element = createViewportElement({
      addEventListener: (name, listener) => {
        if (name === "scroll") scrollListener = listener;
      },
      clientHeight: 480,
      clientWidth: 800,
      scrollLeft: 0,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(2, columns);
    viewport.attach(element);

    const initial = viewport.getSnapshot().virtualWindow;
    expect(initial.centerCount).toBe(1_000);
    expect(initial.center.length).toBeLessThanOrEqual(12);
    expect(initial.totalWidth).toBe(120_000);

    element.scrollLeft = 60_000;
    scrollListener!(new Event("scroll"));
    callback!(0);
    const middle = viewport.getSnapshot().virtualWindow;
    expect(middle.centerStartIndex).toBeGreaterThan(490);
    expect(middle.centerStartIndex).toBeLessThan(510);
    expect(middle.center.length).toBeLessThanOrEqual(12);
  });

  it("publishes off-screen column-count changes that preserve visible geometry", () => {
    const columns = compileColumns(
      Array.from({ length: 10 }, (_, index) => ({
        columnId: `COL_ID_REPLACE_${String(index).padStart(2, "0")}`,
        field: "name",
        headerName: `Replace ${index}`,
        valueType: "text" as const,
        width: 120,
      })),
    );
    const replacementTail = compileColumns([
      {
        columnId: "COL_ID_REPLACEMENT_TAIL",
        field: "name",
        headerName: "Replacement tail",
        valueType: "text",
        width: 240,
      },
    ]);
    const replacementColumns = Object.freeze([...columns.slice(0, 8), ...replacementTail]);
    const element = createViewportElement({
      clientHeight: 480,
      clientWidth: 240,
      scrollLeft: 0,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(2, columns);
    viewport.attach(element);
    const initial = viewport.getSnapshot().virtualWindow;
    expect(initial).toMatchObject({ centerCount: 10, totalWidth: 1_200 });
    const listener = vi.fn();
    viewport.subscribe(listener);

    viewport.setLayout(2, replacementColumns);

    expect(listener).toHaveBeenCalledOnce();
    expect(viewport.getSnapshot().virtualWindow).toMatchObject({
      centerStartIndex: 0,
      centerCount: 9,
      totalWidth: 1_200,
    });
    expect(viewport.getSnapshot().virtualWindow.center).toEqual(initial.center);
  });

  it("virtualizes and reveals across a suspended many-column pinned layout", () => {
    const columns = compileColumns([
      ...Array.from({ length: 30 }, (_, index) => ({
        columnId: `COL_ID_START_${String(index).padStart(2, "0")}`,
        field: "name",
        headerName: `Start ${index}`,
        valueType: "text" as const,
        pinned: "start" as const,
        width: 120,
      })),
      {
        columnId: "COL_ID_CENTER",
        field: "name",
        headerName: "Center",
        valueType: "text",
        width: 120,
      },
      ...Array.from({ length: 30 }, (_, index) => ({
        columnId: `COL_ID_END_${String(index).padStart(2, "0")}`,
        field: "name",
        headerName: `End ${index}`,
        valueType: "text" as const,
        pinned: "end" as const,
        width: 120,
      })),
    ]);
    let callback: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (next: FrameRequestCallback) => {
      callback = next;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const element = createViewportElement({
      clientHeight: 480,
      clientWidth: 240,
      scrollLeft: 0,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(2, columns);

    expect(viewport.getSnapshot().virtualWindow).toMatchObject({
      pinnedStart: [],
      pinnedEnd: [],
      centerCount: 61,
      totalWidth: 7_320,
    });
    expect(viewport.getSnapshot().virtualWindow.center.length).toBeLessThan(10);

    viewport.attach(element);

    expect(viewport.getSnapshot().virtualWindow).toMatchObject({
      pinnedStart: [],
      pinnedEnd: [],
      centerCount: 61,
      totalWidth: 7_320,
    });
    expect(viewport.getSnapshot().virtualWindow.center.length).toBeLessThan(10);

    viewport.revealCell(0, "COL_ID_END_29", "header");
    callback!(0);
    expect(element.scrollLeft).toBe(7_080);
    expect(viewport.getSnapshot().virtualWindow.center.length).toBeLessThan(10);
    expect(viewport.getSnapshot().virtualWindow.center.at(-1)?.columnId).toBe("COL_ID_END_29");

    viewport.revealCell(0, "COL_ID_START_00", "header");
    callback!(0);
    expect(element.scrollLeft).toBe(0);
    expect(viewport.getSnapshot().virtualWindow.center[0]?.columnId).toBe("COL_ID_START_00");
  });

  it("suspends at 79px and restores pinning at the exact 80px centre threshold", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_START",
        field: "name",
        headerName: "Start",
        valueType: "text",
        pinned: "start",
        width: 180,
      },
      {
        columnId: "COL_ID_CENTER",
        field: "name",
        headerName: "Center",
        valueType: "text",
        width: 120,
      },
      {
        columnId: "COL_ID_END",
        field: "name",
        headerName: "End",
        valueType: "text",
        pinned: "end",
        width: 180,
      },
    ]);
    const snapshotAtWidth = (clientWidth: number) => {
      const viewport = new BrunoTableViewportRuntime();
      viewport.setLayout(2, columns);
      viewport.attach(
        createViewportElement({
          clientHeight: 480,
          clientWidth,
          scrollLeft: 0,
          scrollTop: 0,
          style: { setProperty: vi.fn() },
        }),
      );
      return viewport.getSnapshot().virtualWindow;
    };

    expect(snapshotAtWidth(439)).toMatchObject({
      pinnedStart: [],
      pinnedEnd: [],
      centerCount: 3,
    });
    expect(snapshotAtWidth(440)).toMatchObject({
      centerCount: 1,
    });
    expect(snapshotAtWidth(440).pinnedStart).toHaveLength(1);
    expect(snapshotAtWidth(440).pinnedEnd).toHaveLength(1);
  });

  it("bounds, reveals, and restores an oversized centreless pinned layout", () => {
    const columns = compileColumns([
      ...Array.from({ length: 30 }, (_, index) => ({
        columnId: `COL_ID_ALL_START_${String(index).padStart(2, "0")}`,
        field: "name",
        headerName: `All start ${index}`,
        valueType: "text" as const,
        pinned: "start" as const,
        width: 120,
      })),
      ...Array.from({ length: 30 }, (_, index) => ({
        columnId: `COL_ID_ALL_END_${String(index).padStart(2, "0")}`,
        field: "name",
        headerName: `All end ${index}`,
        valueType: "text" as const,
        pinned: "end" as const,
        width: 120,
      })),
    ]);
    let callback: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (next: FrameRequestCallback) => {
      callback = next;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    let clientWidth = 240;
    const element = createViewportElement({
      clientHeight: 480,
      clientWidth: () => clientWidth,
      scrollLeft: 0,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(2, columns);

    expect(viewport.getSnapshot().virtualWindow).toMatchObject({
      pinnedStart: [],
      pinnedEnd: [],
      centerCount: 60,
      totalWidth: 7_200,
    });
    expect(viewport.getSnapshot().virtualWindow.center.length).toBeLessThan(10);

    viewport.attach(element);
    viewport.revealCell(0, "COL_ID_ALL_END_29", "header");
    callback!(0);
    expect(element.scrollLeft).toBe(6_960);
    expect(viewport.getSnapshot().virtualWindow.center.at(-1)?.columnId).toBe("COL_ID_ALL_END_29");

    clientWidth = 8_000;
    viewport.attach(null);
    viewport.attach(element);
    expect(viewport.getSnapshot().virtualWindow.pinnedStart).toHaveLength(30);
    expect(viewport.getSnapshot().virtualWindow.pinnedEnd).toHaveLength(30);
    expect(viewport.getSnapshot().virtualWindow.centerCount).toBe(0);
  });

  it("reaches the million-row suffix within browser-safe geometry", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    let callback: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (next: FrameRequestCallback) => {
      callback = next;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const setProperty = vi.fn();
    const element = createViewportElement({
      clientHeight: 480,
      clientWidth: 800,
      scrollLeft: 0,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    });
    const bodyLayer = createViewportElement({ style: { setProperty } });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(1_000_000, columns);
    viewport.attach(element);
    viewport.attachBodyLayer(bodyLayer);

    viewport.revealCell(999_999, "COL_ID_NAME");
    callback!(0);

    expect(element.scrollTop).toBeLessThanOrEqual(BRUNO_TABLE_MAX_PHYSICAL_ROW_HEIGHT);
    const window = viewport.getSnapshot().virtualWindow;
    expect(window).toMatchObject({
      rowEnd: 1_000_000,
      totalHeight: BRUNO_TABLE_MAX_PHYSICAL_ROW_HEIGHT,
    });
    const layerTransformCall = setProperty.mock.calls.findLast(
      ([property]) => property === "transform",
    );
    const layerOffset = Number.parseFloat(
      /translate3d\(0, ([^,]+), 0\)/.exec(String(layerTransformCall?.[1]))?.[1] ?? "NaN",
    );
    expect(layerOffset + (window.rowEnd - window.rowStart - 1) * 36).toBeLessThanOrEqual(
      BRUNO_TABLE_MAX_PHYSICAL_ROW_HEIGHT,
    );
  });

  it("maps absolute native scrollbar jumps across a million logical rows", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    let callback: FrameRequestCallback | undefined;
    let scrollListener: EventListener | undefined;
    vi.stubGlobal("requestAnimationFrame", (next: FrameRequestCallback) => {
      callback = next;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const element = createViewportElement({
      addEventListener: (name, listener) => {
        if (name === "scroll") scrollListener = listener;
      },
      clientHeight: 480,
      clientWidth: 800,
      scrollLeft: 0,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(1_000_000, columns);
    viewport.attach(element);

    element.scrollTop = BRUNO_TABLE_MAX_PHYSICAL_ROW_HEIGHT / 2;
    scrollListener!(new Event("scroll"));
    callback!(0);
    expect(viewport.getSnapshot().virtualWindow.rowStart).toBeGreaterThan(499_000);
    expect(viewport.getSnapshot().virtualWindow.rowStart).toBeLessThan(501_000);

    element.scrollTop = BRUNO_TABLE_MAX_PHYSICAL_ROW_HEIGHT;
    scrollListener!(new Event("scroll"));
    callback!(0);
    expect(viewport.getSnapshot().virtualWindow.rowEnd).toBe(1_000_000);

    element.scrollTop = 0;
    scrollListener!(new Event("scroll"));
    callback!(0);
    expect(viewport.getSnapshot().virtualWindow.rowStart).toBe(0);
  });

  it("keeps vertical scroll fixed when revealing a sticky header destination", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    let callback: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (next: FrameRequestCallback) => {
      callback = next;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const element = createViewportElement({
      clientHeight: 480,
      clientWidth: 800,
      scrollLeft: 0,
      scrollTop: 720,
      style: { setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(100, columns);
    viewport.attach(element);

    viewport.revealCell(0, "COL_ID_NAME", "header");
    callback!(0);

    expect(element.scrollTop).toBe(720);
  });

  it("keeps unchanged logical windows out of React notifications while scrolling", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    let callback: FrameRequestCallback | undefined;
    let scrollListener: EventListener | undefined;
    vi.stubGlobal("requestAnimationFrame", (next: FrameRequestCallback) => {
      callback = next;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const element = createViewportElement({
      addEventListener: (name, listener) => {
        if (name === "scroll") scrollListener = listener;
      },
      clientHeight: 480,
      clientWidth: 800,
      scrollLeft: 0,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(100, columns);
    viewport.attach(element);
    const listener = vi.fn();
    viewport.subscribe(listener);

    element.scrollTop = 1;
    scrollListener!(new Event("scroll"));
    callback!(0);

    expect(listener).not.toHaveBeenCalled();
  });

  it("clamps a deep scroll before publishing a shrunken live layout", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const element = createViewportElement({
      clientHeight: 480,
      clientWidth: 800,
      scrollLeft: 0,
      scrollTop: 3_000,
      style: { setProperty: vi.fn() },
    });
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(100, columns);
    viewport.attach(element);

    viewport.setLayout(2, columns);

    expect(element.scrollTop).toBe(0);
    expect(viewport.getSnapshot().virtualWindow).toMatchObject({ rowStart: 0, rowEnd: 2 });
  });
});
