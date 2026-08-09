import { afterEach, describe, expect, it, vi } from "vitest";

import { compileColumns } from "./compile-columns";
import { BRUNO_TABLE_MAX_PHYSICAL_ROW_HEIGHT, BrunoTableViewportRuntime } from "./virtual-viewport";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BrunoTableViewportRuntime", () => {
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
    const element = {
      addEventListener: vi.fn((name: string, listener: EventListener) => {
        if (name === "scroll") scrollListener = listener;
      }),
      clientHeight: 480,
      clientWidth: 800,
      removeEventListener: vi.fn(),
      scrollLeft: 0,
      scrollTop: 0,
      style: { setProperty },
    } as unknown as HTMLElement;
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
    const element = {
      addEventListener: vi.fn(),
      clientHeight: 480,
      clientWidth: 800,
      removeEventListener: vi.fn(),
      scrollLeft: 0,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    } as unknown as HTMLElement;
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(100, columns);
    viewport.attach(element);

    viewport.revealCell(75, "COL_ID_NAME", "body", "row-75");
    viewport.setLayout(100, columns, (rowId) => (rowId === "row-75" ? 50 : undefined));
    callback!(0);

    expect(viewport.getSnapshot().virtualWindow.rowStart).toBeGreaterThan(30);
    expect(viewport.getSnapshot().virtualWindow.rowStart).toBeLessThan(40);
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
    const element = {
      addEventListener: vi.fn((name: string, listener: EventListener) => {
        if (name === "scroll") scrollListener = listener;
      }),
      clientHeight: 480,
      clientWidth: 800,
      removeEventListener: vi.fn(),
      scrollLeft: 0,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    } as unknown as HTMLElement;
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
    const element = {
      addEventListener: vi.fn(),
      clientHeight: 480,
      clientWidth: 800,
      removeEventListener: vi.fn(),
      scrollLeft: 0,
      scrollTop: 0,
      style: { setProperty },
    } as unknown as HTMLElement;
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(1_000_000, columns);
    viewport.attach(element);

    viewport.revealCell(999_999, "COL_ID_NAME");
    callback!(0);

    expect(element.scrollTop).toBeLessThanOrEqual(BRUNO_TABLE_MAX_PHYSICAL_ROW_HEIGHT);
    const window = viewport.getSnapshot().virtualWindow;
    expect(window).toMatchObject({
      rowEnd: 1_000_000,
      totalHeight: BRUNO_TABLE_MAX_PHYSICAL_ROW_HEIGHT,
    });
    const layerOffsetCall = setProperty.mock.calls.findLast(
      ([property]) => property === "--bruno-table-row-layer-offset",
    );
    const layerOffset = Number.parseFloat(String(layerOffsetCall?.[1]));
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
    const element = {
      addEventListener: vi.fn((name: string, listener: EventListener) => {
        if (name === "scroll") scrollListener = listener;
      }),
      clientHeight: 480,
      clientWidth: 800,
      removeEventListener: vi.fn(),
      scrollLeft: 0,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    } as unknown as HTMLElement;
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
    const element = {
      addEventListener: vi.fn(),
      clientHeight: 480,
      clientWidth: 800,
      removeEventListener: vi.fn(),
      scrollLeft: 0,
      scrollTop: 720,
      style: { setProperty: vi.fn() },
    } as unknown as HTMLElement;
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
    const element = {
      addEventListener: vi.fn((name: string, listener: EventListener) => {
        if (name === "scroll") scrollListener = listener;
      }),
      clientHeight: 480,
      clientWidth: 800,
      removeEventListener: vi.fn(),
      scrollLeft: 0,
      scrollTop: 0,
      style: { setProperty: vi.fn() },
    } as unknown as HTMLElement;
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
    const element = {
      addEventListener: vi.fn(),
      clientHeight: 480,
      clientWidth: 800,
      removeEventListener: vi.fn(),
      scrollLeft: 0,
      scrollTop: 3_000,
      style: { setProperty: vi.fn() },
    } as unknown as HTMLElement;
    const viewport = new BrunoTableViewportRuntime();
    viewport.setLayout(100, columns);
    viewport.attach(element);

    viewport.setLayout(2, columns);

    expect(element.scrollTop).toBe(0);
    expect(viewport.getSnapshot().virtualWindow).toMatchObject({ rowStart: 0, rowEnd: 2 });
  });
});
