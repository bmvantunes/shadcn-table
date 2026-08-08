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

export const BRUNO_TABLE_ROW_HEIGHT = 36;
export const BRUNO_TABLE_DEFAULT_VIEWPORT_HEIGHT = 480;

const ROW_HEIGHT = BRUNO_TABLE_ROW_HEIGHT;
const ROW_OVERSCAN = 4;
const COLUMN_OVERSCAN = 2;
const EMPTY_COLUMNS: readonly CompiledColumn[] = Object.freeze([]);

type ViewportLayout = Readonly<{
  readonly rowCount: number;
  readonly columns: readonly CompiledColumn[];
  readonly pinnedStart: readonly CompiledColumn[];
  readonly center: readonly CompiledColumn[];
  readonly pinnedEnd: readonly CompiledColumn[];
  readonly centerOffsets: readonly number[];
  readonly pinnedStartWidth: number;
  readonly pinnedEndWidth: number;
  readonly centerWidth: number;
  readonly totalWidth: number;
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
  private resizeObserver: ResizeObserver | null = null;
  private frame: number | null = null;
  private layout: ViewportLayout = createLayout(0, []);
  private layoutColumns: readonly CompiledColumn[] | undefined;
  private layoutKey = "";
  private snapshot: BrunoTableViewportSnapshot = INITIAL_VIEWPORT;

  public constructor() {}

  public readonly getSnapshot = (): BrunoTableViewportSnapshot => this.snapshot;

  public readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public readonly setLayout = (rowCount: number, columns: readonly CompiledColumn[]): void => {
    const nextLayoutKey = `${rowCount}|${columns
      .map((column) => `${column.columnId}:${column.pinned ?? "center"}:${column.semantics.width}`)
      .join(",")}`;
    if (nextLayoutKey === this.layoutKey && this.layoutColumns === columns) return;
    this.layoutKey = nextLayoutKey;
    this.layoutColumns = columns;
    this.layout = createLayout(rowCount, columns);
    if (this.element === null) {
      this.publishSnapshot(
        createViewportSnapshot(this.layout, {
          scrollTop: 0,
          scrollLeft: 0,
          width: 0,
          height: BRUNO_TABLE_DEFAULT_VIEWPORT_HEIGHT,
        }),
      );
      return;
    }
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

  public readonly revealCell = (rowIndex: number, columnId: string): void => {
    const element = this.element;
    const column = this.layout.columns.find((candidate) => candidate.columnId === columnId);
    if (element === null || column === undefined) return;
    const nextTop = rowIndex * ROW_HEIGHT;
    const headerInset = ROW_HEIGHT;
    const rowTop = headerInset + nextTop;
    const rowBottom = rowTop + ROW_HEIGHT;
    const visibleTop = element.scrollTop + headerInset;
    const visibleBottom = element.scrollTop + element.clientHeight;
    if (rowTop < visibleTop) element.scrollTop = Math.max(rowTop - headerInset, 0);
    else if (rowBottom > visibleBottom) {
      element.scrollTop = Math.max(rowBottom - element.clientHeight, 0);
    }
    if (column.pinned !== undefined) return;
    const centerIndex = this.layout.center.findIndex(
      (candidate) => candidate.columnId === columnId,
    );
    const centerOffset = this.layout.centerOffsets[centerIndex] ?? 0;
    const centerEnd = centerOffset + column.semantics.width;
    // The semantic table keeps pinned columns in the scrollable inline layout and makes
    // them sticky. Native scrollLeft therefore already identifies the centre-content origin;
    // subtracting the pinned-start inset would double-count that column space.
    const centerScrollLeft = element.scrollLeft;
    const centerViewportWidth = Math.max(
      element.clientWidth - this.layout.pinnedStartWidth - this.layout.pinnedEndWidth,
      0,
    );
    const columnWidth = centerEnd - centerOffset;
    if (columnWidth > centerViewportWidth) {
      const viewportEnd = centerScrollLeft + centerViewportWidth;
      if (centerEnd < centerScrollLeft) element.scrollLeft = centerEnd;
      else if (centerOffset > viewportEnd) element.scrollLeft = centerOffset - centerViewportWidth;
    } else if (centerOffset < centerScrollLeft) {
      element.scrollLeft = centerOffset;
    } else if (centerEnd > centerScrollLeft + centerViewportWidth) {
      element.scrollLeft = centerEnd - centerViewportWidth;
    }
    this.publishFromElement();
  };

  public readonly resetVertical = (): void => {
    if (this.element === null) return;
    this.element.scrollTop = 0;
    this.publishFromElement();
  };

  public readonly attach = (element: HTMLElement | null): void => {
    if (this.element === element) return;
    this.element?.removeEventListener("scroll", this.handleScroll);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.element = element;
    this.element?.addEventListener("scroll", this.handleScroll, { passive: true });
    if (this.element !== null && typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(this.element);
    }
    this.publishFromElement();
  };

  public readonly dispose = (): void => {
    this.element?.removeEventListener("scroll", this.handleScroll);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.element = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  };

  private readonly handleScroll = (): void => this.schedulePublish();
  private readonly handleResize = (): void => this.schedulePublish();

  private readonly schedulePublish = (): void => {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.publishFromElement();
    });
  };

  private readonly publishFromElement = (): void => {
    const element = this.element;
    if (element === null) return;
    element.style.setProperty("--bruno-table-scroll-top", `${element.scrollTop}px`);
    const scrollTop = quantizeScroll(element.scrollTop);
    const scrollLeft = quantizeScroll(element.scrollLeft);
    const next = createViewportSnapshot(this.layout, {
      scrollTop,
      scrollLeft,
      width: element.clientWidth,
      height: element.clientHeight,
    });
    this.publishSnapshot(next);
  };
}

function createViewportSnapshot(
  layout: ViewportLayout,
  viewport: Readonly<{
    readonly scrollTop: number;
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
    readonly scrollTop: number;
    readonly scrollLeft: number;
    readonly width: number;
    readonly height: number;
  }>,
): BrunoTableVirtualWindow {
  const rowViewportHeight = viewport.height > 0 ? viewport.height : 480;
  const rowStart = Math.max(Math.floor(viewport.scrollTop / ROW_HEIGHT) - ROW_OVERSCAN, 0);
  const rowEnd = Math.min(
    layout.rowCount,
    Math.ceil((viewport.scrollTop + rowViewportHeight) / ROW_HEIGHT) + ROW_OVERSCAN,
  );
  // Pinned columns occupy their original table slots while their visual regions are sticky.
  // The native offset consequently maps directly to the centre-column offset.
  const centerScrollLeft = viewport.scrollLeft;
  const centerViewportWidth = Math.max(
    viewport.width - layout.pinnedStartWidth - layout.pinnedEndWidth,
    0,
  );
  const firstVisible = findColumnAtOffset(
    layout.centerOffsets,
    Math.max(centerScrollLeft - BRUNO_TABLE_VIEWPORT_SCROLL_QUANTUM, 0),
  );
  const lastVisible = findColumnAtOffset(
    layout.centerOffsets,
    centerScrollLeft + centerViewportWidth + BRUNO_TABLE_VIEWPORT_SCROLL_QUANTUM,
  );
  const columnStart = Math.max(firstVisible - COLUMN_OVERSCAN, 0);
  const columnEnd = Math.min(layout.center.length, lastVisible + COLUMN_OVERSCAN + 1);
  const leftPadding = layout.centerOffsets[columnStart] ?? 0;
  const visibleWidth = (layout.centerOffsets[columnEnd] ?? layout.centerWidth) - leftPadding;
  return Object.freeze({
    rowStart,
    rowEnd,
    pinnedStart: layout.pinnedStart,
    center: Object.freeze(layout.center.slice(columnStart, columnEnd)),
    pinnedEnd: layout.pinnedEnd,
    centerStartIndex: columnStart,
    centerCount: layout.center.length,
    leftPadding,
    rightPadding: Math.max(layout.centerWidth - leftPadding - visibleWidth, 0),
    totalHeight: layout.rowCount * ROW_HEIGHT,
    totalWidth: layout.totalWidth,
  });
}

function sameVirtualWindow(left: BrunoTableVirtualWindow, right: BrunoTableVirtualWindow): boolean {
  return (
    left.rowStart === right.rowStart &&
    left.rowEnd === right.rowEnd &&
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

function createLayout(rowCount: number, columns: readonly CompiledColumn[]): ViewportLayout {
  const normalizedColumns = Object.freeze(Array.from(columns));
  const pinnedStart = Object.freeze(
    normalizedColumns.filter((column) => column.pinned === "start"),
  );
  const center = Object.freeze(normalizedColumns.filter((column) => column.pinned === undefined));
  const pinnedEnd = Object.freeze(normalizedColumns.filter((column) => column.pinned === "end"));
  const centerOffsets = [0];
  for (const column of center) {
    centerOffsets.push(centerOffsets.at(-1)! + column.semantics.width);
  }
  const pinnedStartWidth = totalColumnWidth(pinnedStart);
  const pinnedEndWidth = totalColumnWidth(pinnedEnd);
  const centerWidth = centerOffsets.at(-1) ?? 0;
  return Object.freeze({
    rowCount,
    columns: normalizedColumns,
    pinnedStart,
    center,
    pinnedEnd,
    centerOffsets: Object.freeze(centerOffsets),
    pinnedStartWidth,
    pinnedEndWidth,
    centerWidth,
    totalWidth: pinnedStartWidth + centerWidth + pinnedEndWidth,
  });
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
