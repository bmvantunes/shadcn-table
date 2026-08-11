import type { CompiledColumn } from "./compile-columns";

export type BrunoTableViewportSnapshot = Readonly<{
  readonly width: number;
  readonly height: number;
  readonly virtualWindow: BrunoTableVirtualWindow;
}>;

export type BrunoTableVirtualWindow = Readonly<{
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly pinnedStart: readonly CompiledColumn[];
  readonly center: readonly CompiledColumn[];
  readonly pinnedEnd: readonly CompiledColumn[];
  readonly centerStartIndex: number;
  readonly centerCount: number;
  readonly leftPadding: number;
  readonly rightPadding: number;
  readonly totalHeight: number;
  readonly totalWidth: number;
}>;

type Listener = () => void;
type HorizontalDirection = "ltr" | "rtl";
type RtlScrollType = "negative" | "default" | "reverse";

export const BRUNO_TABLE_ROW_HEIGHT = 36;
export const BRUNO_TABLE_DEFAULT_VIEWPORT_HEIGHT = 480;
export const BRUNO_TABLE_MAX_PHYSICAL_ROW_HEIGHT = 4_000_000;
export const BRUNO_TABLE_SCROLLBAR_TRACK_THICKNESS = 8;

const ROW_HEIGHT = BRUNO_TABLE_ROW_HEIGHT;
const ROW_OVERSCAN = 4;
const COLUMN_OVERSCAN = 2;
const MIN_CENTER_VIEWPORT_WIDTH = 80;
const MIN_SCROLLBAR_THUMB_SIZE = 24;
const EMPTY_COLUMNS: readonly CompiledColumn[] = Object.freeze([]);
const RTL_SCROLL_TYPES = new WeakMap<Document, RtlScrollType>();

type ViewportLayout = Readonly<{
  readonly rowCount: number;
  readonly headerHeight: number;
  readonly columns: readonly CompiledColumn[];
  readonly pinnedStart: readonly CompiledColumn[];
  readonly center: readonly CompiledColumn[];
  readonly pinnedEnd: readonly CompiledColumn[];
  readonly centerOffsets: readonly number[];
  readonly suspendedCenter: readonly CompiledColumn[];
  readonly suspendedCenterOffsets: readonly number[];
  readonly suspendedCenterWidth: number;
  readonly pinnedStartWidth: number;
  readonly pinnedEndWidth: number;
  readonly centerWidth: number;
  readonly logicalRowHeight: number;
  readonly physicalRowHeight: number;
  readonly totalWidth: number;
}>;

type RevealTarget = Readonly<{
  readonly rowIndex: number;
  readonly rowId?: string;
  readonly columnId: string;
  readonly region: "header" | "body";
}>;

const INITIAL_VIEWPORT: BrunoTableViewportSnapshot = Object.freeze({
  width: 0,
  height: BRUNO_TABLE_DEFAULT_VIEWPORT_HEIGHT,
  virtualWindow: emptyVirtualWindow(),
});

export const BRUNO_TABLE_VIEWPORT_SCROLL_QUANTUM = 32;

export class BrunoTableViewportRuntime {
  private readonly listeners = new Set<Listener>();
  private element: HTMLElement | null = null;
  private rowLayer: HTMLElement | null = null;
  private scrollbarOverlay: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private frame: number | null = null;
  private pendingReveal: RevealTarget | undefined;
  private segmentLogicalBase = 0;
  private segmentPhysicalAnchor = 0;
  private lastPhysicalScrollTop = 0;
  private horizontalSuspended: boolean | undefined;
  private horizontalPinnedStartWidth = 0;
  private horizontalPinningKey = "";
  private horizontalDirection: HorizontalDirection = "ltr";
  private rtlScrollType: RtlScrollType = "negative";
  private rowLayerOffset = "0px";
  private layout: ViewportLayout;
  private layoutColumns: readonly CompiledColumn[] | undefined;
  private layoutKey = "";
  private layoutPinningKey = "";
  private snapshot: BrunoTableViewportSnapshot = INITIAL_VIEWPORT;

  public constructor(private readonly headerHeight: number = ROW_HEIGHT) {
    this.layout = createLayout(0, [], headerHeight);
  }

  public readonly getSnapshot = (): BrunoTableViewportSnapshot => this.snapshot;

  public readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public readonly setLayout = (
    rowCount: number,
    columns: readonly CompiledColumn[],
    findRowIndex?: (rowId: string) => number | undefined,
  ): void => {
    this.rebasePendingReveal(findRowIndex);
    const nextLayoutKey = `${rowCount}|${columns
      .map((column) => `${column.columnId}:${column.pinned ?? "center"}:${column.semantics.width}`)
      .join(",")}`;
    if (nextLayoutKey === this.layoutKey && this.layoutColumns === columns) return;
    const element = this.element;
    const previousLogicalScrollTop =
      element === null ? 0 : this.readLogicalScrollTop(element, false);
    this.layoutKey = nextLayoutKey;
    this.layoutPinningKey = columns
      .map((column) => `${column.columnId}:${column.pinned ?? "center"}`)
      .join(",");
    this.layoutColumns = columns;
    this.layout = createLayout(rowCount, columns, this.headerHeight);
    if (element === null) {
      this.publishSnapshot(
        createViewportSnapshot(this.layout, {
          logicalScrollTop: 0,
          scrollLeft: 0,
          width: 0,
          height: BRUNO_TABLE_DEFAULT_VIEWPORT_HEIGHT,
        }),
      );
      return;
    }
    const clampedLogicalScrollTop = Math.min(
      previousLogicalScrollTop,
      logicalScrollMaximum(this.layout, element.clientHeight),
    );
    this.setLogicalScrollTop(element, clampedLogicalScrollTop);
    this.publishFromElement();
  };

  private publishSnapshot(next: BrunoTableViewportSnapshot): void {
    if (
      next.width === this.snapshot.width &&
      next.height === this.snapshot.height &&
      sameVirtualWindow(next.virtualWindow, this.snapshot.virtualWindow)
    )
      return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  public readonly revealCell = (
    rowIndex: number,
    columnId: string,
    region: "header" | "body" = "body",
    rowId?: string,
  ): void => {
    if (this.element === null) return;
    this.pendingReveal = Object.freeze({
      rowIndex,
      columnId,
      region,
      ...(rowId === undefined ? {} : { rowId }),
    });
    this.schedulePublish();
  };

  private rebasePendingReveal(
    findRowIndex: ((rowId: string) => number | undefined) | undefined,
  ): void {
    const pending = this.pendingReveal;
    if (
      pending === undefined ||
      pending.region === "header" ||
      pending.rowId === undefined ||
      findRowIndex === undefined
    ) {
      return;
    }
    const rowIndex = findRowIndex(pending.rowId);
    this.pendingReveal =
      rowIndex === undefined ? undefined : Object.freeze({ ...pending, rowIndex });
  }

  private applyReveal(target: RevealTarget): void {
    const element = this.element;
    const column = this.layout.columns.find((candidate) => candidate.columnId === target.columnId);
    if (element === null || column === undefined) return;
    this.rebaseHorizontalCoordinate(element);
    if (target.region === "body") {
      const logicalScrollTop = this.readLogicalScrollTop(element, false);
      const rowTop = this.layout.headerHeight + target.rowIndex * ROW_HEIGHT;
      const rowBottom = rowTop + ROW_HEIGHT;
      const visibleTop = logicalScrollTop + this.layout.headerHeight;
      const visibleBottom = logicalScrollTop + element.clientHeight;
      let nextLogicalScrollTop = logicalScrollTop;
      if (rowTop < visibleTop) nextLogicalScrollTop = Math.max(rowTop - ROW_HEIGHT, 0);
      else if (rowBottom > visibleBottom) {
        nextLogicalScrollTop = Math.max(rowBottom - element.clientHeight, 0);
      }
      this.setLogicalScrollTop(element, nextLogicalScrollTop);
    }
    const suspendPinning = shouldSuspendPinning(this.layout, element.clientWidth);
    if (!suspendPinning && column.pinned !== undefined) return;
    const center = suspendPinning ? this.layout.suspendedCenter : this.layout.center;
    const centerOffsets = suspendPinning
      ? this.layout.suspendedCenterOffsets
      : this.layout.centerOffsets;
    const centerIndex = center.findIndex((candidate) => candidate.columnId === target.columnId);
    const centerOffset = centerOffsets[centerIndex] ?? 0;
    const centerEnd = centerOffset + column.semantics.width;
    // The semantic table keeps pinned columns in the scrollable inline layout and makes
    // them sticky. The normalized logical scroll coordinate therefore identifies the
    // centre-content origin; subtracting the pinned-start inset would double-count it.
    const centerScrollLeft = this.readLogicalScrollLeft(element);
    const centerViewportWidth = Math.max(
      element.clientWidth -
        (suspendPinning ? 0 : this.layout.pinnedStartWidth + this.layout.pinnedEndWidth),
      0,
    );
    const columnWidth = centerEnd - centerOffset;
    if (columnWidth > centerViewportWidth) {
      const viewportEnd = centerScrollLeft + centerViewportWidth;
      if (centerEnd <= centerScrollLeft) {
        this.setLogicalScrollLeft(element, Math.max(centerEnd - centerViewportWidth, 0));
      } else if (centerOffset >= viewportEnd) {
        this.setLogicalScrollLeft(element, centerOffset);
      }
    } else if (centerOffset < centerScrollLeft) {
      this.setLogicalScrollLeft(element, centerOffset);
    } else if (centerEnd > centerScrollLeft + centerViewportWidth) {
      this.setLogicalScrollLeft(element, centerEnd - centerViewportWidth);
    }
  }

  public readonly resetVertical = (): void => {
    if (this.element === null) return;
    this.pendingReveal = undefined;
    this.segmentLogicalBase = 0;
    this.segmentPhysicalAnchor = 0;
    this.lastPhysicalScrollTop = 0;
    setNativeScrollTop(this.element, 0);
    this.publishFromElement();
  };

  public readonly attach = (element: HTMLElement | null): void => {
    if (this.element === element) return;
    this.element?.removeEventListener("scroll", this.handleScroll);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.element = element;
    this.segmentLogicalBase = 0;
    this.segmentPhysicalAnchor = 0;
    this.lastPhysicalScrollTop = element?.scrollTop ?? 0;
    this.horizontalSuspended = undefined;
    this.horizontalPinnedStartWidth = 0;
    this.horizontalPinningKey = "";
    this.horizontalDirection = element === null ? "ltr" : readHorizontalDirection(element);
    this.rtlScrollType =
      this.horizontalDirection === "rtl" ? rtlScrollType(element?.ownerDocument) : "negative";
    this.element?.addEventListener("scroll", this.handleScroll, { passive: true });
    if (this.element !== null && typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(this.element);
    }
    this.publishFromElement();
  };

  public readonly attachRowLayer = (element: HTMLElement | null): void => {
    if (this.rowLayer === element) return;
    this.rowLayer?.style.removeProperty("--bruno-table-row-layer-offset");
    this.rowLayer = element;
    if (element !== null) {
      element.style.setProperty("--bruno-table-row-layer-offset", this.rowLayerOffset);
    }
  };

  public readonly attachScrollbarOverlay = (element: HTMLElement | null): void => {
    if (this.scrollbarOverlay === element) return;
    this.scrollbarOverlay = element;
    this.publishFromElement();
  };

  public readonly dispose = (): void => {
    this.element?.removeEventListener("scroll", this.handleScroll);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.element = null;
    this.rowLayer?.style.removeProperty("--bruno-table-row-layer-offset");
    this.rowLayer = null;
    this.scrollbarOverlay = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.pendingReveal = undefined;
    this.segmentLogicalBase = 0;
    this.segmentPhysicalAnchor = 0;
    this.lastPhysicalScrollTop = 0;
    this.horizontalSuspended = undefined;
    this.horizontalPinnedStartWidth = 0;
    this.horizontalPinningKey = "";
    this.horizontalDirection = "ltr";
    this.rtlScrollType = "negative";
    this.rowLayerOffset = "0px";
  };

  private readonly handleScroll = (): void => this.schedulePublish();
  private readonly handleResize = (): void => this.schedulePublish();

  private readonly schedulePublish = (): void => {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      const reveal = this.pendingReveal;
      this.pendingReveal = undefined;
      if (reveal !== undefined) this.applyReveal(reveal);
      this.frame = null;
      this.publishFromElement();
      if (this.pendingReveal !== undefined) this.schedulePublish();
    });
  };

  private readLogicalScrollTop(element: HTMLElement, rebase: boolean): number {
    const physicalMaximum = physicalScrollMaximum(this.layout, element.clientHeight);
    const logicalMaximum = logicalScrollMaximum(this.layout, element.clientHeight);
    if (logicalMaximum <= physicalMaximum || physicalMaximum === 0) {
      this.segmentLogicalBase = 0;
      this.segmentPhysicalAnchor = 0;
      const logicalScrollTop = Math.min(Math.max(element.scrollTop, 0), logicalMaximum);
      this.lastPhysicalScrollTop = element.scrollTop;
      return logicalScrollTop;
    }
    if (rebase && element.scrollTop <= 0) {
      this.setLogicalScrollTop(element, 0);
      return 0;
    }
    if (rebase && element.scrollTop >= physicalMaximum - 1) {
      this.setLogicalScrollTop(element, logicalMaximum);
      return logicalMaximum;
    }
    if (
      rebase &&
      Math.abs(element.scrollTop - this.lastPhysicalScrollTop) >
        Math.max(element.clientHeight * 4, ROW_HEIGHT * 20)
    ) {
      const proportionalLogicalScrollTop = (element.scrollTop / physicalMaximum) * logicalMaximum;
      this.setLogicalScrollTop(element, proportionalLogicalScrollTop);
      return proportionalLogicalScrollTop;
    }
    const logicalScrollTop = Math.min(
      Math.max(this.segmentLogicalBase + element.scrollTop - this.segmentPhysicalAnchor, 0),
      logicalMaximum,
    );
    if (
      rebase &&
      (element.scrollTop <= physicalMaximum * 0.2 || element.scrollTop >= physicalMaximum * 0.8)
    ) {
      this.setLogicalScrollTop(element, logicalScrollTop);
    } else {
      this.lastPhysicalScrollTop = element.scrollTop;
    }
    return logicalScrollTop;
  }

  private setLogicalScrollTop(element: HTMLElement, requestedLogicalScrollTop: number): void {
    const physicalMaximum = physicalScrollMaximum(this.layout, element.clientHeight);
    const logicalMaximum = logicalScrollMaximum(this.layout, element.clientHeight);
    const logicalScrollTop = Math.min(Math.max(requestedLogicalScrollTop, 0), logicalMaximum);
    let physicalScrollTop: number;
    if (logicalMaximum <= physicalMaximum || physicalMaximum === 0) {
      this.segmentLogicalBase = 0;
      this.segmentPhysicalAnchor = 0;
      physicalScrollTop = logicalScrollTop;
    } else {
      const edgeSpan = physicalMaximum * 0.75;
      if (logicalScrollTop <= edgeSpan) {
        this.segmentLogicalBase = 0;
        this.segmentPhysicalAnchor = 0;
        physicalScrollTop = logicalScrollTop;
      } else if (logicalScrollTop >= logicalMaximum - edgeSpan) {
        this.segmentLogicalBase = logicalMaximum - physicalMaximum;
        this.segmentPhysicalAnchor = 0;
        physicalScrollTop = logicalScrollTop - this.segmentLogicalBase;
      } else {
        const physicalAnchor = physicalMaximum / 2;
        this.segmentLogicalBase = logicalScrollTop;
        this.segmentPhysicalAnchor = physicalAnchor;
        physicalScrollTop = physicalAnchor;
      }
    }
    setNativeScrollTop(element, physicalScrollTop);
    this.lastPhysicalScrollTop = physicalScrollTop;
  }

  private readonly publishFromElement = (): void => {
    const element = this.element;
    if (element === null) return;
    this.rebaseHorizontalCoordinate(element);
    const logicalScrollTop = this.readLogicalScrollTop(element, true);
    const logicalScrollLeft = this.readLogicalScrollLeft(element);
    const structuralLogicalScrollTop = quantizeScroll(logicalScrollTop);
    const structuralLogicalScrollLeft = quantizeScroll(logicalScrollLeft);
    const next = createViewportSnapshot(this.layout, {
      logicalScrollTop: structuralLogicalScrollTop,
      scrollLeft: structuralLogicalScrollLeft,
      width: element.clientWidth,
      height: element.clientHeight,
    });
    this.rowLayerOffset = `${element.scrollTop + next.virtualWindow.rowStart * ROW_HEIGHT - logicalScrollTop}px`;
    this.rowLayer?.style.setProperty("--bruno-table-row-layer-offset", this.rowLayerOffset);
    this.writeScrollbarOverlay(element, logicalScrollTop, logicalScrollLeft);
    this.publishSnapshot(next);
  };

  private readLogicalScrollLeft(element: HTMLElement): number {
    const maximum = horizontalScrollMaximum(this.layout, element.clientWidth);
    const nativeScrollLeft = Number.isFinite(element.scrollLeft) ? element.scrollLeft : 0;
    const logicalScrollLeft =
      this.horizontalDirection === "ltr"
        ? nativeScrollLeft
        : this.rtlScrollType === "negative"
          ? -nativeScrollLeft
          : this.rtlScrollType === "reverse"
            ? maximum - nativeScrollLeft
            : nativeScrollLeft;
    return Math.min(Math.max(logicalScrollLeft, 0), maximum);
  }

  private setLogicalScrollLeft(element: HTMLElement, requestedLogicalScrollLeft: number): void {
    const maximum = horizontalScrollMaximum(this.layout, element.clientWidth);
    const logicalScrollLeft = Math.min(Math.max(requestedLogicalScrollLeft, 0), maximum);
    const nativeScrollLeft =
      this.horizontalDirection === "ltr"
        ? logicalScrollLeft
        : this.rtlScrollType === "negative"
          ? -logicalScrollLeft
          : this.rtlScrollType === "reverse"
            ? maximum - logicalScrollLeft
            : logicalScrollLeft;
    setNativeScrollLeft(element, nativeScrollLeft);
  }

  private rebaseHorizontalCoordinate(element: HTMLElement): void {
    const nextSuspended = shouldSuspendPinning(this.layout, element.clientWidth);
    const previousSuspended = this.horizontalSuspended;
    const previousPinnedStartWidth = this.horizontalPinnedStartWidth;
    const previousPinningKey = this.horizontalPinningKey;
    this.horizontalSuspended = nextSuspended;
    this.horizontalPinnedStartWidth = this.layout.pinnedStartWidth;
    this.horizontalPinningKey = this.layoutPinningKey;
    if (previousSuspended === undefined) return;
    if (previousPinningKey !== this.layoutPinningKey) return;
    const previousInset = previousSuspended ? previousPinnedStartWidth : 0;
    const nextInset = nextSuspended ? this.layout.pinnedStartWidth : 0;
    if (previousInset === nextInset) return;
    const centerContentWidth = nextSuspended
      ? this.layout.suspendedCenterWidth
      : this.layout.centerWidth;
    const centerViewportWidth = Math.max(
      element.clientWidth -
        (nextSuspended ? 0 : this.layout.pinnedStartWidth + this.layout.pinnedEndWidth),
      0,
    );
    const maximum = Math.max(centerContentWidth - centerViewportWidth, 0);
    const logicalScrollLeft = this.readLogicalScrollLeft(element);
    this.setLogicalScrollLeft(
      element,
      Math.min(Math.max(logicalScrollLeft - previousInset + nextInset, 0), maximum),
    );
  }

  private writeScrollbarOverlay(
    element: HTMLElement,
    logicalScrollTop: number,
    logicalScrollLeft: number,
  ): void {
    const overlay = this.scrollbarOverlay;
    if (overlay === null) return;
    const suspendPinning = shouldSuspendPinning(this.layout, element.clientWidth);
    const pinnedStartWidth = suspendPinning ? 0 : this.layout.pinnedStartWidth;
    const pinnedEndWidth = suspendPinning ? 0 : this.layout.pinnedEndWidth;
    const centerContentWidth = suspendPinning
      ? this.layout.suspendedCenterWidth
      : this.layout.centerWidth;
    const centerViewportWidth = Math.max(
      element.clientWidth - pinnedStartWidth - pinnedEndWidth,
      0,
    );
    const horizontalMaximum = Math.max(centerContentWidth - centerViewportWidth, 0);
    const nativeVerticalWidth = Math.max(
      finiteDimension(element.offsetWidth, element.clientWidth) - element.clientWidth,
      0,
    );
    const horizontalTrackWidth = centerViewportWidth;
    const horizontalVisible =
      horizontalMaximum > 0 && centerViewportWidth > 0 && horizontalTrackWidth > 0;
    const horizontalThumbWidth = scrollbarThumbSize(
      horizontalTrackWidth,
      centerViewportWidth,
      centerContentWidth,
    );
    const horizontalThumbOffset = scrollbarThumbOffset(
      logicalScrollLeft,
      horizontalMaximum,
      horizontalTrackWidth - horizontalThumbWidth,
    );
    const horizontalThumbTransform =
      this.horizontalDirection === "rtl" ? -horizontalThumbOffset : horizontalThumbOffset;
    const bodyViewportHeight = Math.max(element.clientHeight - this.layout.headerHeight, 0);
    const verticalMaximum = logicalScrollMaximum(this.layout, element.clientHeight);
    const verticalTrackHeight = Math.max(
      bodyViewportHeight - (horizontalVisible ? BRUNO_TABLE_SCROLLBAR_TRACK_THICKNESS : 0),
      0,
    );
    const verticalThumbHeight = scrollbarThumbSize(
      verticalTrackHeight,
      bodyViewportHeight,
      this.layout.logicalRowHeight,
    );
    const verticalThumbOffset = scrollbarThumbOffset(
      logicalScrollTop,
      verticalMaximum,
      verticalTrackHeight - verticalThumbHeight,
    );
    const nativeHorizontalWidth = Math.max(
      finiteDimension(element.offsetHeight, element.clientHeight) - element.clientHeight,
      0,
    );
    const style = overlay.style;
    style.setProperty(
      "--bruno-table-scrollbar-horizontal-display",
      horizontalVisible ? "block" : "none",
    );
    style.setProperty("--bruno-table-scrollbar-horizontal-start", `${pinnedStartWidth}px`);
    style.setProperty(
      "--bruno-table-scrollbar-horizontal-end",
      `${pinnedEndWidth + nativeVerticalWidth}px`,
    );
    style.setProperty("--bruno-table-scrollbar-horizontal-bottom", `${nativeHorizontalWidth}px`);
    style.setProperty(
      "--bruno-table-scrollbar-horizontal-thumb-width",
      `${horizontalThumbWidth}px`,
    );
    style.setProperty(
      "--bruno-table-scrollbar-horizontal-thumb-offset",
      `${horizontalThumbTransform}px`,
    );
    style.setProperty(
      "--bruno-table-scrollbar-vertical-display",
      verticalMaximum > 0 && verticalTrackHeight > 0 ? "block" : "none",
    );
    style.setProperty("--bruno-table-scrollbar-vertical-top", `${this.layout.headerHeight}px`);
    style.setProperty("--bruno-table-scrollbar-vertical-right", `${nativeVerticalWidth}px`);
    style.setProperty(
      "--bruno-table-scrollbar-vertical-bottom",
      `${nativeHorizontalWidth + (horizontalVisible ? BRUNO_TABLE_SCROLLBAR_TRACK_THICKNESS : 0)}px`,
    );
    style.setProperty("--bruno-table-scrollbar-vertical-thumb-height", `${verticalThumbHeight}px`);
    style.setProperty("--bruno-table-scrollbar-vertical-thumb-offset", `${verticalThumbOffset}px`);
  }
}

function finiteDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function scrollbarThumbSize(trackSize: number, viewportSize: number, contentSize: number): number {
  if (trackSize <= 0 || viewportSize <= 0 || contentSize <= viewportSize) return trackSize;
  return Math.min(
    Math.max((trackSize * viewportSize) / contentSize, MIN_SCROLLBAR_THUMB_SIZE),
    trackSize,
  );
}

function scrollbarThumbOffset(position: number, maximum: number, travel: number): number {
  if (maximum <= 0 || travel <= 0) return 0;
  return (Math.min(Math.max(position, 0), maximum) / maximum) * travel;
}

function createViewportSnapshot(
  layout: ViewportLayout,
  viewport: Readonly<{
    readonly logicalScrollTop: number;
    readonly scrollLeft: number;
    readonly width: number;
    readonly height: number;
  }>,
): BrunoTableViewportSnapshot {
  return Object.freeze({
    width: viewport.width,
    height: viewport.height,
    virtualWindow: calculateVirtualWindow(layout, viewport),
  });
}

function calculateVirtualWindow(
  layout: ViewportLayout,
  viewport: Readonly<{
    readonly logicalScrollTop: number;
    readonly scrollLeft: number;
    readonly width: number;
    readonly height: number;
  }>,
): BrunoTableVirtualWindow {
  const rowViewportHeight =
    viewport.height > 0 ? viewport.height : BRUNO_TABLE_DEFAULT_VIEWPORT_HEIGHT;
  const rowStart = Math.max(Math.floor(viewport.logicalScrollTop / ROW_HEIGHT) - ROW_OVERSCAN, 0);
  const rowEnd = Math.min(
    layout.rowCount,
    Math.ceil((viewport.logicalScrollTop + rowViewportHeight) / ROW_HEIGHT) + ROW_OVERSCAN,
  );
  const suspendPinning = shouldSuspendPinning(layout, viewport.width);
  const pinnedStart = suspendPinning ? EMPTY_COLUMNS : layout.pinnedStart;
  const pinnedEnd = suspendPinning ? EMPTY_COLUMNS : layout.pinnedEnd;
  const center = suspendPinning ? layout.suspendedCenter : layout.center;
  const centerOffsets = suspendPinning ? layout.suspendedCenterOffsets : layout.centerOffsets;
  const centerWidth = suspendPinning ? layout.suspendedCenterWidth : layout.centerWidth;
  // Pinned columns occupy their original table slots while their visual regions are sticky.
  // The native offset consequently maps directly to the centre-column offset.
  const centerScrollLeft = viewport.scrollLeft;
  const centerViewportWidth = Math.max(
    viewport.width - (suspendPinning ? 0 : layout.pinnedStartWidth + layout.pinnedEndWidth),
    0,
  );
  const firstVisible = findColumnAtOffset(
    centerOffsets,
    Math.max(centerScrollLeft - BRUNO_TABLE_VIEWPORT_SCROLL_QUANTUM, 0),
  );
  const lastVisible = findColumnAtOffset(
    centerOffsets,
    centerScrollLeft + centerViewportWidth + BRUNO_TABLE_VIEWPORT_SCROLL_QUANTUM,
  );
  const columnStart = Math.max(firstVisible - COLUMN_OVERSCAN, 0);
  const columnEnd = Math.min(center.length, lastVisible + COLUMN_OVERSCAN + 1);
  const leftPadding = centerOffsets[columnStart] ?? 0;
  const visibleWidth = (centerOffsets[columnEnd] ?? centerWidth) - leftPadding;
  return Object.freeze({
    rowStart,
    rowEnd,
    pinnedStart,
    center: Object.freeze(center.slice(columnStart, columnEnd)),
    pinnedEnd,
    centerStartIndex: columnStart,
    centerCount: center.length,
    leftPadding,
    rightPadding: Math.max(centerWidth - leftPadding - visibleWidth, 0),
    totalHeight: layout.physicalRowHeight,
    totalWidth: layout.totalWidth,
  });
}

function sameVirtualWindow(left: BrunoTableVirtualWindow, right: BrunoTableVirtualWindow): boolean {
  return (
    left.rowStart === right.rowStart &&
    left.rowEnd === right.rowEnd &&
    left.centerStartIndex === right.centerStartIndex &&
    left.centerCount === right.centerCount &&
    left.leftPadding === right.leftPadding &&
    left.rightPadding === right.rightPadding &&
    left.totalHeight === right.totalHeight &&
    left.totalWidth === right.totalWidth &&
    sameColumns(left.pinnedStart, right.pinnedStart) &&
    sameColumns(left.center, right.center) &&
    sameColumns(left.pinnedEnd, right.pinnedEnd)
  );
}

function sameColumns(left: readonly CompiledColumn[], right: readonly CompiledColumn[]): boolean {
  return left.length === right.length && left.every((column, index) => column === right[index]);
}

function createLayout(
  rowCount: number,
  columns: readonly CompiledColumn[],
  headerHeight: number,
): ViewportLayout {
  const normalizedColumns = Object.freeze(Array.from(columns));
  const pinnedStart = Object.freeze(
    normalizedColumns.filter((column) => column.pinned === "start"),
  );
  const center = Object.freeze(normalizedColumns.filter((column) => column.pinned === undefined));
  const pinnedEnd = Object.freeze(normalizedColumns.filter((column) => column.pinned === "end"));
  const centerOffsets = columnOffsets(center);
  const suspendedCenter = Object.freeze([...pinnedStart, ...center, ...pinnedEnd]);
  const suspendedCenterOffsets = columnOffsets(suspendedCenter);
  const pinnedStartWidth = totalColumnWidth(pinnedStart);
  const pinnedEndWidth = totalColumnWidth(pinnedEnd);
  const centerWidth = centerOffsets.at(-1) ?? 0;
  const suspendedCenterWidth = suspendedCenterOffsets.at(-1) ?? 0;
  const logicalRowHeight = rowCount * ROW_HEIGHT;
  const physicalRowHeight = Math.min(logicalRowHeight, BRUNO_TABLE_MAX_PHYSICAL_ROW_HEIGHT);
  return Object.freeze({
    rowCount,
    headerHeight,
    columns: normalizedColumns,
    pinnedStart,
    center,
    pinnedEnd,
    centerOffsets,
    suspendedCenter,
    suspendedCenterOffsets,
    suspendedCenterWidth,
    pinnedStartWidth,
    pinnedEndWidth,
    centerWidth,
    logicalRowHeight,
    physicalRowHeight,
    totalWidth: pinnedStartWidth + centerWidth + pinnedEndWidth,
  });
}

function columnOffsets(columns: readonly CompiledColumn[]): readonly number[] {
  const offsets = [0];
  for (const column of columns) offsets.push(offsets.at(-1)! + column.semantics.width);
  return Object.freeze(offsets);
}

function shouldSuspendPinning(layout: ViewportLayout, viewportWidth: number): boolean {
  const hasPinnedColumns = layout.pinnedStart.length > 0 || layout.pinnedEnd.length > 0;
  if (!hasPinnedColumns) return false;
  if (viewportWidth <= 0) return true;
  if (layout.center.length === 0) {
    return layout.pinnedStartWidth + layout.pinnedEndWidth > viewportWidth;
  }
  const reservedCenterWidth = Math.min(MIN_CENTER_VIEWPORT_WIDTH, viewportWidth);
  return layout.pinnedStartWidth + layout.pinnedEndWidth > viewportWidth - reservedCenterWidth;
}

function emptyVirtualWindow(): BrunoTableVirtualWindow {
  return Object.freeze({
    rowStart: 0,
    rowEnd: 0,
    pinnedStart: EMPTY_COLUMNS,
    center: EMPTY_COLUMNS,
    pinnedEnd: EMPTY_COLUMNS,
    centerStartIndex: 0,
    centerCount: 0,
    leftPadding: 0,
    rightPadding: 0,
    totalHeight: 0,
    totalWidth: 0,
  });
}

function physicalScrollMaximum(layout: ViewportLayout, viewportHeight: number): number {
  return Math.max(layout.physicalRowHeight + layout.headerHeight - viewportHeight, 0);
}

function horizontalScrollMaximum(layout: ViewportLayout, viewportWidth: number): number {
  const suspendPinning = shouldSuspendPinning(layout, viewportWidth);
  const contentWidth = suspendPinning ? layout.suspendedCenterWidth : layout.centerWidth;
  const viewport = suspendPinning
    ? viewportWidth
    : Math.max(viewportWidth - layout.pinnedStartWidth - layout.pinnedEndWidth, 0);
  return Math.max(contentWidth - viewport, 0);
}

function logicalScrollMaximum(layout: ViewportLayout, viewportHeight: number): number {
  return Math.max(layout.logicalRowHeight + layout.headerHeight - viewportHeight, 0);
}

function totalColumnWidth(columns: readonly CompiledColumn[]): number {
  return columns.reduce((total, column) => total + column.semantics.width, 0);
}

function findColumnAtOffset(widths: readonly number[], offset: number): number {
  let low = 0;
  let high = Math.max(widths.length - 1, 0);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((widths[middle] ?? 0) > offset) high = middle;
    else low = middle + 1;
  }
  return Math.max(low - 1, 0);
}

function quantizeScroll(value: number): number {
  return (
    Math.floor(value / BRUNO_TABLE_VIEWPORT_SCROLL_QUANTUM) * BRUNO_TABLE_VIEWPORT_SCROLL_QUANTUM
  );
}

function setNativeScrollTop(element: HTMLElement, top: number): void {
  if (typeof element.scrollTo === "function") {
    element.scrollTo({ behavior: "instant", top });
    return;
  }
  element.scrollTop = top;
}

function setNativeScrollLeft(element: HTMLElement, left: number): void {
  if (typeof element.scrollTo === "function") {
    element.scrollTo({ behavior: "instant", left });
    return;
  }
  element.scrollLeft = left;
}

function readHorizontalDirection(element: HTMLElement): HorizontalDirection {
  const computedDirection =
    element.ownerDocument?.defaultView?.getComputedStyle?.(element)?.direction;
  if (computedDirection === "rtl") return "rtl";
  return element.getAttribute?.("dir")?.toLowerCase() === "rtl" ? "rtl" : "ltr";
}

function rtlScrollType(ownerDocument: Document | undefined): RtlScrollType {
  if (ownerDocument === undefined) return "negative";
  const cached = RTL_SCROLL_TYPES.get(ownerDocument);
  if (cached !== undefined) return cached;
  const outer = ownerDocument.createElement("div");
  const inner = ownerDocument.createElement("div");
  outer.dir = "rtl";
  outer.style.cssText =
    "position:absolute;visibility:hidden;overflow:scroll;width:4px;height:1px;top:-9999px;";
  inner.style.cssText = "width:8px;height:1px;";
  outer.appendChild(inner);
  (ownerDocument.body ?? ownerDocument.documentElement).appendChild(outer);
  let type: RtlScrollType;
  if (outer.scrollLeft > 0) type = "reverse";
  else {
    outer.scrollLeft = 1;
    type = outer.scrollLeft === 0 ? "negative" : "default";
  }
  outer.parentNode?.removeChild(outer);
  RTL_SCROLL_TYPES.set(ownerDocument, type);
  return type;
}
