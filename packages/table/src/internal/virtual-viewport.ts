import type { CompiledColumn } from "./compile-columns";
import {
  BRUNO_TABLE_LIVE_TOTAL_WIDTH_CSS_VARIABLE,
  BRUNO_TABLE_LIVE_VIEWPORT_FILL_CSS_VARIABLE,
  BRUNO_TABLE_LIVE_LEFT_PADDING_CSS_VARIABLE,
  BRUNO_TABLE_LIVE_RIGHT_PADDING_CSS_VARIABLE,
  brunoTableColumnCssVariable,
  brunoTablePinnedWidthCssVariable,
} from "./column-management";
import { recordBrunoTableClientColumnPreviewStyleWrite } from "./render-instrumentation";

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
  /** Whether the deterministic narrow-width policy is projecting pinned columns into centre. */
  readonly pinningSuspended: boolean;
  readonly centerStartIndex: number;
  /** Full logical centre-column count; `center` is only the mounted virtual slice. */
  readonly centerCount: number;
  readonly leftPadding: number;
  readonly rightPadding: number;
  readonly totalHeight: number;
  readonly totalWidth: number;
}>;

type Listener = () => void;
type HorizontalDirection = "ltr" | "rtl";
type RtlScrollType = "negative" | "default" | "reverse";

type HorizontalCoordinateSample = Readonly<{
  readonly logicalScrollLeft: number;
  readonly direction: HorizontalDirection;
  readonly rtlScrollType: RtlScrollType;
  readonly viewportWidth: number;
  readonly suspended: boolean;
  readonly pinnedStartWidth: number;
  readonly pinningKey: string;
}>;
type HorizontalCoordinateEnvironment = Omit<HorizontalCoordinateSample, "logicalScrollLeft">;
type PreviewHorizontalState = Readonly<{
  readonly suspended: boolean | undefined;
  readonly pinnedStartWidth: number;
  readonly pinningKey: string;
}>;

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
const MAX_REVERSE_RTL_LAYOUT_DEFERRALS = 8;
const HORIZONTAL_RECONCILIATION_SETTLED = Symbol("horizontal-reconciliation-settled");
type HorizontalReconciliation = number | typeof HORIZONTAL_RECONCILIATION_SETTLED;

export class BrunoTableViewportRuntime {
  private readonly listeners = new Set<Listener>();
  private readonly environmentListeners = new Set<Listener>();
  private readonly bodyLayers = new Set<HTMLElement>();
  private element: HTMLElement | null = null;
  private rowLayer: HTMLElement | null = null;
  private scrollbarOverlay: HTMLElement | null = null;
  private scrollbarOverlayDirection: HorizontalDirection | undefined;
  private resizeObserver: ResizeObserver | null = null;
  private rowLayerResizeObserver: ResizeObserver | null = null;
  private directionObserver: MutationObserver | null = null;
  private stylesheetRoot: HTMLHeadElement | null = null;
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
  private directionDirty = false;
  private horizontalInputPending = false;
  private horizontalInputSample: HorizontalCoordinateSample | undefined;
  private horizontalInputNativeScrollLeft: number | undefined;
  private horizontalEventOrder = 0;
  private horizontalInputEventOrder: number | undefined;
  private horizontalEnvironmentEventOrder: number | undefined;
  private directionScrollGuard: number | undefined;
  private forceGuardedDirectionReconciliation = false;
  private horizontalViewportWidth = 0;
  private lastNativeScrollLeft = 0;
  private layoutReconciliationPending = false;
  private layoutReconciliationDeferrals = 0;
  private logicalScrollLeft = 0;
  private pendingLayoutHorizontalCoordinate: HorizontalCoordinateSample | undefined;
  private rowLayerOffset = "0px";
  private layout: ViewportLayout;
  private layoutColumns: readonly CompiledColumn[] | undefined;
  private previewLayout: ViewportLayout | undefined;
  private previewPublishedSuspended: boolean | undefined;
  private previewLogicalScrollLeft: number | undefined;
  private previewHorizontalState: PreviewHorizontalState | undefined;
  private readonly previewStyleProperties = new Set<string>();
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

  public readonly subscribeEnvironment = (listener: Listener): (() => void) => {
    this.environmentListeners.add(listener);
    return () => this.environmentListeners.delete(listener);
  };

  public readonly scrollByLogical = (delta: number): boolean => {
    const element = this.element;
    if (element === null || !Number.isFinite(delta) || delta === 0) return false;
    const current = this.readLogicalScrollLeft(element);
    const maximum = horizontalScrollMaximum(this.layout, element.clientWidth);
    const next = Math.min(Math.max(current + delta, 0), maximum);
    if (next === current) return false;
    this.setLogicalScrollLeft(element, next);
    this.schedulePublish();
    return true;
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
    this.clearColumnWidthPreview(false);
    const element = this.element;
    const previousLogicalScrollTop =
      element === null ? 0 : this.readLogicalScrollTop(element, false);
    const previousHorizontalCoordinate =
      element === null ? undefined : this.captureLayoutSourceCoordinate(element);
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
    this.layoutReconciliationPending = true;
    this.layoutReconciliationDeferrals = 0;
    this.pendingLayoutHorizontalCoordinate = previousHorizontalCoordinate;
    const projectedLogicalScrollLeft = this.projectLayoutLogicalScrollLeft(
      element,
      previousHorizontalCoordinate,
    );
    if (
      previousHorizontalCoordinate !== undefined &&
      this.shouldDeferReverseRtlLayoutWrite(element, projectedLogicalScrollLeft)
    ) {
      this.pendingLayoutHorizontalCoordinate = this.captureHorizontalCoordinate(
        element,
        projectedLogicalScrollLeft,
      );
      this.layoutReconciliationDeferrals = 1;
      this.horizontalInputPending = false;
      this.horizontalInputSample = undefined;
      this.horizontalInputNativeScrollLeft = undefined;
      this.horizontalInputEventOrder = undefined;
      this.directionDirty = false;
      this.publishCoordinates(
        element,
        this.readLogicalScrollTop(element, true),
        projectedLogicalScrollLeft,
      );
      this.schedulePublish();
      return;
    }
    this.publishFromElement();
  };

  /**
   * Updates the imperative geometry used by exact reveal and scrollbar math
   * without publishing a React snapshot. The header/body CSS variables are
   * written by the same rAF that computes the pointer preview.
   */
  public readonly previewColumnWidth = (columnId: string, width: number): void => {
    const columns = this.layoutColumns;
    if (columns === undefined) return;
    if (this.previewLayout === undefined) {
      this.previewLayout = this.layout;
      this.previewPublishedSuspended =
        this.element === null
          ? undefined
          : shouldSuspendPinning(this.layout, this.element.clientWidth);
      this.previewLogicalScrollLeft =
        this.element === null ? 0 : this.readLogicalScrollLeft(this.element);
      this.previewHorizontalState = Object.freeze({
        suspended: this.horizontalSuspended,
        pinnedStartWidth: this.horizontalPinnedStartWidth,
        pinningKey: this.horizontalPinningKey,
      });
    }
    this.layout = updateColumnWidthPreviewLayout(this.layout, columnId, width);
    const element = this.element;
    const logicalScrollLeft =
      this.previewLogicalScrollLeft ?? (element === null ? 0 : this.readLogicalScrollLeft(element));
    let previewWindow: BrunoTableVirtualWindow | undefined;
    if (element !== null) {
      const previewScrollLeft = Math.min(
        logicalScrollLeft,
        horizontalScrollMaximum(this.layout, element.clientWidth),
      );
      const previewViewport = {
        logicalScrollTop: this.readLogicalScrollTop(element, false),
        scrollLeft: previewScrollLeft,
        width: element.clientWidth,
        height: element.clientHeight,
      };
      previewWindow = calculateVirtualWindow(this.layout, previewViewport);
      // Ordinary width previews keep the committed mounted window stable. A
      // preview may publish one structural viewport snapshot when the current
      // preview crosses the deterministic narrow-width policy boundary. Track
      // the last published state so an oscillating preview publishes both the
      // enter and exit transitions.
      const isSuspended = shouldSuspendPinning(this.layout, element.clientWidth);
      const reuseMountedWindow =
        this.previewPublishedSuspended === isSuspended &&
        mountedWindowCoversPreviewWindow(this.snapshot.virtualWindow, previewWindow);
      if (!reuseMountedWindow) {
        this.publishSnapshot(createViewportSnapshot(this.layout, previewViewport));
        this.previewPublishedSuspended = isSuspended;
      }
      this.writeColumnPreviewStyles(
        columnId,
        reuseMountedWindow
          ? mountedWindowPreviewPadding(this.layout, this.snapshot.virtualWindow)
          : previewWindow,
      );
      void element.scrollWidth;
      this.setLogicalScrollLeft(element, previewScrollLeft);
      this.writeScrollbarOverlay(element, previewViewport.logicalScrollTop, previewScrollLeft);
      return;
    }
    this.writeColumnPreviewStyles(columnId, previewWindow);
  };

  public readonly clearColumnWidthPreview = (publishSnapshot = true): void => {
    if (this.previewLayout === undefined) return;
    this.layout = this.previewLayout;
    this.previewLayout = undefined;
    this.previewPublishedSuspended = undefined;
    const logicalScrollLeft = this.previewLogicalScrollLeft;
    this.previewLogicalScrollLeft = undefined;
    const previewHorizontalState = this.previewHorizontalState;
    this.previewHorizontalState = undefined;
    this.horizontalSuspended = previewHorizontalState?.suspended;
    this.horizontalPinnedStartWidth = previewHorizontalState?.pinnedStartWidth ?? 0;
    this.horizontalPinningKey = previewHorizontalState?.pinningKey ?? "";
    for (const property of this.previewStyleProperties) {
      this.element?.style.removeProperty(property);
    }
    this.previewStyleProperties.clear();
    if (this.element !== null) {
      const logicalScrollTop = this.readLogicalScrollTop(this.element, false);
      const restoredLogicalScrollLeft =
        logicalScrollLeft === undefined
          ? this.readLogicalScrollLeft(this.element)
          : Math.min(
              logicalScrollLeft,
              horizontalScrollMaximum(this.layout, this.element.clientWidth),
            );
      this.logicalScrollLeft = restoredLogicalScrollLeft;
      this.setLogicalScrollLeft(this.element, restoredLogicalScrollLeft);
      this.writeScrollbarOverlay(this.element, logicalScrollTop, restoredLogicalScrollLeft);
      if (publishSnapshot) {
        this.publishSnapshot(
          createViewportSnapshot(this.layout, {
            logicalScrollTop,
            scrollLeft: restoredLogicalScrollLeft,
            width: this.element.clientWidth,
            height: this.element.clientHeight,
          }),
        );
      }
    }
  };

  private publishSnapshot(next: BrunoTableViewportSnapshot): void {
    const sharedVirtualWindow = shareVirtualWindowColumns(
      next.virtualWindow,
      this.snapshot.virtualWindow,
    );
    const sharedNext =
      sharedVirtualWindow === next.virtualWindow
        ? next
        : Object.freeze({ ...next, virtualWindow: sharedVirtualWindow });
    if (
      sharedNext.width === this.snapshot.width &&
      sharedNext.height === this.snapshot.height &&
      sameVirtualWindow(sharedNext.virtualWindow, this.snapshot.virtualWindow)
    )
      return;
    this.snapshot = sharedNext;
    for (const listener of this.listeners) listener();
  }

  public readonly revealCell = (
    rowIndex: number,
    columnId: string,
    region: "header" | "body" = "body",
    rowId?: string,
  ): void => {
    if (this.element === null) return;
    const pendingReveal: PendingReveal = {
      rowIndex,
      columnId,
      region,
    };
    if (rowId !== undefined) pendingReveal.rowId = rowId;
    this.pendingReveal = Object.freeze(pendingReveal);
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

  private applyReveal(target: RevealTarget): HorizontalReconciliation | undefined {
    const element = this.element;
    const column = this.layout.columns.find((candidate) => candidate.columnId === target.columnId);
    if (element === null || column === undefined) return undefined;
    const deferredLogicalScrollLeft = this.reconcileHorizontalEnvironment(element);
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
    if (typeof deferredLogicalScrollLeft === "number") {
      this.pendingReveal = target;
      return deferredLogicalScrollLeft;
    }
    const suspendPinning = shouldSuspendPinning(this.layout, element.clientWidth);
    if (!suspendPinning && column.pinned !== undefined) return HORIZONTAL_RECONCILIATION_SETTLED;
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
    return HORIZONTAL_RECONCILIATION_SETTLED;
  }

  public readonly resetVertical = (): void => {
    if (this.element === null) return;
    this.resolveDirectionAndDetectPendingNativeInput(this.element);
    this.pendingReveal = undefined;
    this.segmentLogicalBase = 0;
    this.segmentPhysicalAnchor = 0;
    this.lastPhysicalScrollTop = 0;
    setNativeScrollTop(this.element, 0);
    if (this.directionDirty) this.refreshHorizontalDirection(this.element);
    const pendingHorizontalCoordinate =
      this.horizontalInputSample ?? this.pendingLayoutHorizontalCoordinate;
    const projectedLogicalScrollLeft =
      pendingHorizontalCoordinate === undefined
        ? undefined
        : this.projectLayoutLogicalScrollLeft(this.element, pendingHorizontalCoordinate);
    if (
      this.layoutReconciliationPending &&
      projectedLogicalScrollLeft !== undefined &&
      this.layoutReconciliationDeferrals < MAX_REVERSE_RTL_LAYOUT_DEFERRALS &&
      this.shouldDeferReverseRtlLayoutWrite(this.element, projectedLogicalScrollLeft)
    ) {
      this.pendingLayoutHorizontalCoordinate = this.captureHorizontalCoordinate(
        this.element,
        projectedLogicalScrollLeft,
      );
      this.layoutReconciliationDeferrals += 1;
      this.horizontalInputPending = false;
      this.horizontalInputSample = undefined;
      this.horizontalInputNativeScrollLeft = undefined;
      this.horizontalInputEventOrder = undefined;
      this.publishCoordinates(this.element, 0, projectedLogicalScrollLeft);
      this.schedulePublish();
      return;
    }
    this.publishFromElement();
  };

  public readonly attach = (element: HTMLElement | null): void => {
    if (this.element === element) return;
    this.clearColumnWidthPreview(false);
    this.element?.removeEventListener("scroll", this.handleScroll);
    this.element?.removeEventListener("focusin", this.handleDirectionMutation);
    this.element?.removeEventListener("focusout", this.handleDirectionMutation);
    this.stylesheetRoot?.removeEventListener("load", this.handleDirectionMutation, true);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.directionObserver?.disconnect();
    this.directionObserver = null;
    this.element = element;
    this.stylesheetRoot = element?.ownerDocument?.head ?? null;
    this.segmentLogicalBase = 0;
    this.segmentPhysicalAnchor = 0;
    this.lastPhysicalScrollTop = element?.scrollTop ?? 0;
    this.horizontalSuspended = undefined;
    this.horizontalPinnedStartWidth = 0;
    this.horizontalPinningKey = "";
    this.horizontalDirection = element === null ? "ltr" : readHorizontalDirection(element);
    this.rtlScrollType =
      this.horizontalDirection === "rtl" ? rtlScrollType(element?.ownerDocument) : "negative";
    this.directionDirty = false;
    this.horizontalInputPending = false;
    this.horizontalInputSample = undefined;
    this.horizontalInputNativeScrollLeft = undefined;
    this.horizontalEventOrder = 0;
    this.horizontalInputEventOrder = undefined;
    this.horizontalEnvironmentEventOrder = undefined;
    this.directionScrollGuard = undefined;
    this.forceGuardedDirectionReconciliation = false;
    this.horizontalViewportWidth = element?.clientWidth ?? 0;
    this.lastNativeScrollLeft = element?.scrollLeft ?? 0;
    this.layoutReconciliationPending = false;
    this.layoutReconciliationDeferrals = 0;
    this.logicalScrollLeft = 0;
    this.pendingLayoutHorizontalCoordinate = undefined;
    this.element?.addEventListener("scroll", this.handleScroll, { passive: true });
    this.element?.addEventListener("focusin", this.handleDirectionMutation, { passive: true });
    this.element?.addEventListener("focusout", this.handleDirectionMutation, { passive: true });
    this.stylesheetRoot?.addEventListener("load", this.handleDirectionMutation, true);
    if (this.element !== null && typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(this.element);
    }
    if (this.element !== null && typeof MutationObserver !== "undefined") {
      this.directionObserver = new MutationObserver(this.handleDirectionMutation);
      for (
        let directionOwner: HTMLElement | null = this.element;
        directionOwner !== null;
        directionOwner = directionOwner.parentElement
      ) {
        this.directionObserver.observe(directionOwner, {
          attributes: true,
          attributeFilter: ["class", "dir", "style"],
        });
      }
      if (this.stylesheetRoot !== null) {
        this.directionObserver.observe(this.stylesheetRoot, {
          attributes: true,
          attributeFilter: ["disabled", "href", "media"],
          childList: true,
          characterData: true,
          subtree: true,
        });
      }
    }
    this.publishFromElement();
  };

  public readonly attachRowLayer = (element: HTMLElement | null): void => {
    if (this.rowLayer === element) return;
    this.rowLayerResizeObserver?.disconnect();
    this.rowLayerResizeObserver = null;
    this.rowLayer = element;
    if (element !== null) {
      if (typeof ResizeObserver !== "undefined") {
        this.rowLayerResizeObserver = new ResizeObserver(this.handleRowLayerResize);
        this.rowLayerResizeObserver.observe(element);
      }
    }
  };

  public readonly attachBodyLayer = (element: HTMLElement | null): (() => void) | undefined => {
    if (element === null) return;
    this.bodyLayers.add(element);
    element.style.setProperty("transform", rowLayerTransform(this.rowLayerOffset));
    return () => {
      this.bodyLayers.delete(element);
    };
  };

  public readonly attachScrollbarOverlay = (element: HTMLElement | null): void => {
    if (this.scrollbarOverlay === element) return;
    this.scrollbarOverlay = element;
    this.scrollbarOverlayDirection = undefined;
    this.publishFromElement();
  };

  public readonly dispose = (): void => {
    this.clearColumnWidthPreview();
    this.element?.removeEventListener("scroll", this.handleScroll);
    this.element?.removeEventListener("focusin", this.handleDirectionMutation);
    this.element?.removeEventListener("focusout", this.handleDirectionMutation);
    this.stylesheetRoot?.removeEventListener("load", this.handleDirectionMutation, true);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.rowLayerResizeObserver?.disconnect();
    this.rowLayerResizeObserver = null;
    this.directionObserver?.disconnect();
    this.directionObserver = null;
    this.stylesheetRoot = null;
    this.element = null;
    this.rowLayer = null;
    this.bodyLayers.clear();
    this.scrollbarOverlay = null;
    this.scrollbarOverlayDirection = undefined;
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
    this.directionDirty = false;
    this.horizontalInputPending = false;
    this.horizontalInputSample = undefined;
    this.horizontalInputNativeScrollLeft = undefined;
    this.horizontalEventOrder = 0;
    this.horizontalInputEventOrder = undefined;
    this.horizontalEnvironmentEventOrder = undefined;
    this.directionScrollGuard = undefined;
    this.forceGuardedDirectionReconciliation = false;
    this.horizontalViewportWidth = 0;
    this.lastNativeScrollLeft = 0;
    this.layoutReconciliationPending = false;
    this.layoutReconciliationDeferrals = 0;
    this.logicalScrollLeft = 0;
    this.pendingLayoutHorizontalCoordinate = undefined;
    this.rowLayerOffset = "0px";
  };

  private readonly handleScroll = (): void => {
    const element = this.element;
    if (element !== null) {
      if (this.directionScrollGuard !== undefined && element.scrollLeft === 0) {
        this.forceGuardedDirectionReconciliation = true;
        this.horizontalInputPending = false;
        this.horizontalInputNativeScrollLeft = undefined;
        this.horizontalInputSample = undefined;
        this.schedulePublish();
        return;
      }
      this.directionScrollGuard = undefined;
      this.recordPendingNativeInput(element);
    }
    this.schedulePublish();
  };
  private readonly handleResize = (): void => {
    const element = this.element;
    if (element !== null) {
      if (this.directionDirty) this.recordPendingNativeInput(element);
      this.horizontalEventOrder += 1;
      this.horizontalEnvironmentEventOrder ??= this.horizontalEventOrder;
      this.directionDirty = true;
    }
    this.schedulePublish();
  };
  private readonly handleDirectionMutation = (): void => {
    const element = this.element;
    if (element === null) return;
    if (this.directionDirty) this.recordPendingNativeInput(element);
    this.horizontalEventOrder += 1;
    this.horizontalEnvironmentEventOrder ??= this.horizontalEventOrder;
    this.directionDirty = true;
    this.schedulePublish();
  };
  private readonly handleRowLayerResize = (): void => {
    if (!this.layoutReconciliationPending) return;
    this.layoutReconciliationDeferrals = 0;
    this.schedulePublish();
  };

  private readonly schedulePublish = (): void => {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      const reveal = this.pendingReveal;
      this.pendingReveal = undefined;
      const horizontalReconciliation = reveal === undefined ? undefined : this.applyReveal(reveal);
      this.frame = null;
      this.publishFromElement(horizontalReconciliation);
      if (
        this.pendingReveal !== undefined &&
        this.layoutReconciliationDeferrals < MAX_REVERSE_RTL_LAYOUT_DEFERRALS
      ) {
        this.schedulePublish();
      }
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

  private readonly publishFromElement = (
    horizontalReconciliation?: HorizontalReconciliation,
  ): void => {
    const element = this.element;
    if (element === null) return;
    const previousDirection = this.horizontalDirection;
    const previousViewportWidth = this.horizontalViewportWidth;
    const previousSuspended = this.horizontalSuspended;
    const previousPinnedStartWidth = this.horizontalPinnedStartWidth;
    const previousPinningKey = this.horizontalPinningKey;
    const reconciliation = horizontalReconciliation ?? this.reconcileHorizontalEnvironment(element);
    const environmentChanged =
      previousDirection !== this.horizontalDirection ||
      previousViewportWidth !== element.clientWidth ||
      previousSuspended !== this.horizontalSuspended ||
      previousPinnedStartWidth !== this.horizontalPinnedStartWidth ||
      previousPinningKey !== this.horizontalPinningKey;
    const externalEnvironmentChanged =
      previousDirection !== this.horizontalDirection ||
      previousViewportWidth !== element.clientWidth ||
      (this.previewLayout === undefined && environmentChanged);
    if (externalEnvironmentChanged) {
      for (const listener of this.environmentListeners) listener();
    }
    const deferredLogicalScrollLeft =
      typeof reconciliation === "number" ? reconciliation : undefined;
    const logicalScrollTop = this.readLogicalScrollTop(element, true);
    const logicalScrollLeft = deferredLogicalScrollLeft ?? this.readLogicalScrollLeft(element);
    this.publishCoordinates(element, logicalScrollTop, logicalScrollLeft);
    this.directionDirty = false;
    this.horizontalInputPending = false;
    this.horizontalInputSample = undefined;
    this.horizontalInputNativeScrollLeft = undefined;
    this.horizontalInputEventOrder = undefined;
    this.horizontalEnvironmentEventOrder = undefined;
    this.horizontalViewportWidth = element.clientWidth;
    this.lastNativeScrollLeft = element.scrollLeft;
    if (
      deferredLogicalScrollLeft !== undefined &&
      this.layoutReconciliationDeferrals < MAX_REVERSE_RTL_LAYOUT_DEFERRALS
    ) {
      this.schedulePublish();
    }
    if (this.directionScrollGuard !== undefined) this.schedulePublish();
  };

  private publishCoordinates(
    element: HTMLElement,
    logicalScrollTop: number,
    logicalScrollLeft: number,
  ): void {
    this.logicalScrollLeft = logicalScrollLeft;
    const structuralLogicalScrollTop = quantizeScroll(logicalScrollTop);
    const structuralLogicalScrollLeft = quantizeScroll(logicalScrollLeft);
    const next = createViewportSnapshot(this.layout, {
      logicalScrollTop: structuralLogicalScrollTop,
      scrollLeft: structuralLogicalScrollLeft,
      width: element.clientWidth,
      height: element.clientHeight,
    });
    const nextRowLayerOffset = `${element.scrollTop + next.virtualWindow.rowStart * ROW_HEIGHT - logicalScrollTop}px`;
    this.writeScrollbarOverlay(element, logicalScrollTop, logicalScrollLeft);
    this.writeBodyLayerOffset(nextRowLayerOffset);
    if (this.previewLayout === undefined) this.publishSnapshot(next);
  }

  private writeBodyLayerOffset(nextOffset: string): void {
    if (nextOffset === this.rowLayerOffset) return;
    this.rowLayerOffset = nextOffset;
    const transform = rowLayerTransform(nextOffset);
    for (const layer of this.bodyLayers) {
      layer.style.setProperty("transform", transform);
    }
  }

  private writeColumnPreviewStyles(
    columnId: string,
    previewWindow?: Pick<BrunoTableVirtualWindow, "leftPadding" | "rightPadding">,
  ): void {
    const element = this.element;
    if (element === null) return;
    const set = (property: string, value: string): void => {
      element.style.setProperty(property, value);
      if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
        recordBrunoTableClientColumnPreviewStyleWrite(property);
      }
      this.previewStyleProperties.add(property);
    };
    const column = this.layout.columns.find((candidate) => candidate.columnId === columnId);
    if (column === undefined) return;
    set(brunoTableColumnCssVariable("width", columnId), `${column.semantics.width}px`);
    if (column.pinned === "start") {
      const columnIndex = this.layout.pinnedStart.findIndex(
        (candidate) => candidate.columnId === columnId,
      );
      let offset = 0;
      for (const [index, candidate] of this.layout.pinnedStart.entries()) {
        if (index >= columnIndex) {
          set(
            brunoTableColumnCssVariable("pinned-start-offset", candidate.columnId),
            `${offset}px`,
          );
        }
        offset += candidate.semantics.width;
      }
      set(brunoTablePinnedWidthCssVariable("start"), `${this.layout.pinnedStartWidth}px`);
    } else if (column.pinned === "end") {
      const columnIndex = this.layout.pinnedEnd.findIndex(
        (candidate) => candidate.columnId === columnId,
      );
      let offset = 0;
      for (let index = this.layout.pinnedEnd.length - 1; index >= 0; index -= 1) {
        const candidate = this.layout.pinnedEnd[index]!;
        if (index <= columnIndex) {
          set(brunoTableColumnCssVariable("pinned-end-offset", candidate.columnId), `${offset}px`);
        }
        offset += candidate.semantics.width;
      }
      set(brunoTablePinnedWidthCssVariable("end"), `${this.layout.pinnedEndWidth}px`);
    }
    const viewportFill =
      this.layout.pinnedEnd.length === 0
        ? 0
        : Math.max(0, element.clientWidth - this.layout.totalWidth);
    set(BRUNO_TABLE_LIVE_VIEWPORT_FILL_CSS_VARIABLE, `${viewportFill}px`);
    const nextWindow =
      previewWindow ??
      calculateVirtualWindow(this.layout, {
        logicalScrollTop: this.readLogicalScrollTop(element, false),
        scrollLeft: this.readLogicalScrollLeft(element),
        width: element.clientWidth,
        height: element.clientHeight,
      });
    set(BRUNO_TABLE_LIVE_LEFT_PADDING_CSS_VARIABLE, `${nextWindow.leftPadding}px`);
    set(BRUNO_TABLE_LIVE_RIGHT_PADDING_CSS_VARIABLE, `${nextWindow.rightPadding}px`);
    set(BRUNO_TABLE_LIVE_TOTAL_WIDTH_CSS_VARIABLE, `${this.layout.totalWidth + viewportFill}px`);
  }

  private projectLayoutLogicalScrollLeft(
    element: HTMLElement,
    sampledCoordinate: HorizontalCoordinateSample | undefined,
  ): number {
    const requestedLogicalScrollLeft =
      sampledCoordinate?.logicalScrollLeft ?? this.logicalScrollLeft;
    const sourceInset = sampledCoordinate?.suspended ? sampledCoordinate.pinnedStartWidth : 0;
    const nextInset = shouldSuspendPinning(this.layout, element.clientWidth)
      ? this.layout.pinnedStartWidth
      : 0;
    const convertedLogicalScrollLeft =
      sampledCoordinate?.pinningKey === this.layoutPinningKey && sourceInset !== nextInset
        ? requestedLogicalScrollLeft - sourceInset + nextInset
        : requestedLogicalScrollLeft;
    const maximum = horizontalScrollMaximum(this.layout, element.clientWidth);
    return Math.min(Math.max(convertedLogicalScrollLeft, 0), maximum);
  }

  private captureLayoutSourceCoordinate(element: HTMLElement): HorizontalCoordinateSample {
    this.resolveDirectionAndDetectPendingNativeInput(element);
    const sampledCoordinate = this.horizontalInputSample ?? this.pendingLayoutHorizontalCoordinate;
    if (this.directionDirty) {
      const publishedCoordinate =
        sampledCoordinate ?? this.capturePublishedHorizontalCoordinate(this.logicalScrollLeft);
      this.refreshHorizontalDirection(element);
      return publishedCoordinate;
    }
    if (sampledCoordinate !== undefined) return sampledCoordinate;
    if (element.clientWidth !== this.horizontalViewportWidth) {
      return this.capturePublishedHorizontalCoordinate(this.logicalScrollLeft);
    }
    return this.captureHorizontalCoordinate(element, this.readLogicalScrollLeft(element));
  }

  private refreshHorizontalDirection(element: HTMLElement): void {
    const nextDirection = readHorizontalDirection(element);
    if (nextDirection !== this.horizontalDirection) {
      this.horizontalDirection = nextDirection;
      this.rtlScrollType =
        nextDirection === "rtl" ? rtlScrollType(element.ownerDocument) : "negative";
    }
    this.directionDirty = false;
  }

  private shouldDeferReverseRtlLayoutWrite(
    element: HTMLElement,
    logicalScrollLeft: number,
  ): boolean {
    if (
      this.horizontalDirection !== "rtl" ||
      this.rtlScrollType !== "reverse" ||
      !Number.isFinite(element.scrollWidth)
    ) {
      return false;
    }
    const committedMaximum = Math.max(element.scrollWidth - element.clientWidth, 0);
    const nextMaximum = horizontalScrollMaximum(this.layout, element.clientWidth);
    const requestedNativeScrollLeft = nextMaximum - logicalScrollLeft;
    return requestedNativeScrollLeft > committedMaximum;
  }

  private recordPendingNativeInput(element: HTMLElement): void {
    const comparisonScrollLeft = this.horizontalInputNativeScrollLeft ?? this.lastNativeScrollLeft;
    if (element.scrollLeft === comparisonScrollLeft) return;
    this.horizontalEventOrder += 1;
    this.horizontalInputEventOrder = this.horizontalEventOrder;
    this.horizontalInputNativeScrollLeft = element.scrollLeft;
    this.horizontalInputPending = true;
  }

  private resolveDirectionAndDetectPendingNativeInput(element: HTMLElement): HorizontalDirection {
    const nextDirection = readHorizontalDirection(element);
    const directionChanged = nextDirection !== this.horizontalDirection;
    if (directionChanged && !this.directionDirty) this.directionDirty = true;
    const nativeInputScrollLeft = this.horizontalInputNativeScrollLeft;
    if (nativeInputScrollLeft === undefined) return nextDirection;
    this.horizontalInputNativeScrollLeft = undefined;
    this.lastNativeScrollLeft = nativeInputScrollLeft;
    const inputFollowsObservedEnvironmentChange =
      this.horizontalInputEventOrder !== undefined &&
      this.horizontalEnvironmentEventOrder !== undefined &&
      this.horizontalInputEventOrder > this.horizontalEnvironmentEventOrder;
    if (
      directionChanged &&
      inputFollowsObservedEnvironmentChange &&
      nativeInputScrollLeft === 0 &&
      this.logicalScrollLeft > 0
    ) {
      this.horizontalInputPending = false;
      this.horizontalInputSample = undefined;
      return nextDirection;
    }
    if (directionChanged && this.horizontalEnvironmentEventOrder === undefined) {
      const nextRtlScrollType =
        nextDirection === "rtl" ? rtlScrollType(element.ownerDocument) : "negative";
      const maximum = horizontalScrollMaximum(this.layout, element.clientWidth);
      const expectedNativeScrollLeft = nativeScrollLeftFromLogical(
        this.logicalScrollLeft,
        maximum,
        nextDirection,
        nextRtlScrollType,
      );
      if (Math.abs(nativeInputScrollLeft - expectedNativeScrollLeft) > 0.5) {
        this.lastNativeScrollLeft = nativeInputScrollLeft;
        this.horizontalInputPending = true;
        this.horizontalInputSample = this.createHorizontalCoordinateSample(
          logicalScrollLeftFromNative(
            nativeInputScrollLeft,
            maximum,
            nextDirection,
            nextRtlScrollType,
          ),
          {
            direction: nextDirection,
            rtlScrollType: nextRtlScrollType,
            viewportWidth: element.clientWidth,
            suspended: shouldSuspendPinning(this.layout, element.clientWidth),
            pinnedStartWidth: this.layout.pinnedStartWidth,
            pinningKey: this.layoutPinningKey,
          },
        );
      } else {
        this.horizontalInputPending = false;
        this.horizontalInputSample = undefined;
      }
    } else {
      const inputPrecedesObservedEnvironmentChange =
        this.horizontalInputEventOrder !== undefined &&
        this.horizontalEnvironmentEventOrder !== undefined &&
        this.horizontalInputEventOrder < this.horizontalEnvironmentEventOrder;
      const sampleViewportWidth = inputPrecedesObservedEnvironmentChange
        ? this.horizontalViewportWidth
        : element.clientWidth;
      const sampleDirection = inputPrecedesObservedEnvironmentChange
        ? this.horizontalDirection
        : nextDirection;
      const sampleRtlScrollType = inputPrecedesObservedEnvironmentChange
        ? this.rtlScrollType
        : nextDirection === "rtl"
          ? rtlScrollType(element.ownerDocument)
          : "negative";
      this.horizontalInputPending = true;
      this.horizontalInputSample = this.createHorizontalCoordinateSample(
        logicalScrollLeftFromNative(
          nativeInputScrollLeft,
          horizontalScrollMaximum(this.layout, sampleViewportWidth),
          sampleDirection,
          sampleRtlScrollType,
        ),
        {
          direction: sampleDirection,
          rtlScrollType: sampleRtlScrollType,
          viewportWidth: sampleViewportWidth,
          suspended: inputPrecedesObservedEnvironmentChange
            ? (this.horizontalSuspended ??
              shouldSuspendPinning(this.layout, this.horizontalViewportWidth))
            : shouldSuspendPinning(this.layout, sampleViewportWidth),
          pinnedStartWidth: inputPrecedesObservedEnvironmentChange
            ? this.horizontalPinnedStartWidth
            : this.layout.pinnedStartWidth,
          pinningKey: inputPrecedesObservedEnvironmentChange
            ? this.horizontalPinningKey
            : this.layoutPinningKey,
        },
      );
    }
    return nextDirection;
  }

  private reconcileHorizontalEnvironment(element: HTMLElement): HorizontalReconciliation {
    const nextDirection = this.resolveDirectionAndDetectPendingNativeInput(element);
    const directionChanged = nextDirection !== this.horizontalDirection;
    const viewportWidthChanged = element.clientWidth !== this.horizontalViewportWidth;
    if (directionChanged) {
      this.horizontalDirection = nextDirection;
      this.rtlScrollType =
        nextDirection === "rtl" ? rtlScrollType(element.ownerDocument) : "negative";
    }
    const nextSuspended = shouldSuspendPinning(this.layout, element.clientWidth);
    const previousSuspended = this.horizontalSuspended;
    const previousPinnedStartWidth = this.horizontalPinnedStartWidth;
    const previousPinningKey = this.horizontalPinningKey;
    this.horizontalSuspended = nextSuspended;
    this.horizontalPinnedStartWidth = this.layout.pinnedStartWidth;
    this.horizontalPinningKey = this.layoutPinningKey;
    const samePinningStructure = previousPinningKey === this.layoutPinningKey;
    const previousInset = previousSuspended === true ? previousPinnedStartWidth : 0;
    const nextInset = nextSuspended ? this.layout.pinnedStartWidth : 0;
    const suspensionCoordinateChanged =
      previousSuspended !== undefined && samePinningStructure && previousInset !== nextInset;
    const sampledCoordinate = this.horizontalInputSample ?? this.pendingLayoutHorizontalCoordinate;
    const guardedLogicalScrollLeft = this.forceGuardedDirectionReconciliation
      ? this.directionScrollGuard
      : undefined;
    const requestedLogicalScrollLeft =
      guardedLogicalScrollLeft ??
      sampledCoordinate?.logicalScrollLeft ??
      (this.horizontalInputPending ? this.readLogicalScrollLeft(element) : this.logicalScrollLeft);
    const sourceInset =
      sampledCoordinate === undefined
        ? this.horizontalInputPending
          ? nextInset
          : previousInset
        : sampledCoordinate.suspended
          ? sampledCoordinate.pinnedStartWidth
          : 0;
    const sourcePinningKey = sampledCoordinate?.pinningKey ?? previousPinningKey;
    const sampledEnvironmentChanged =
      sampledCoordinate !== undefined &&
      (sampledCoordinate.viewportWidth !== element.clientWidth ||
        sampledCoordinate.direction !== this.horizontalDirection ||
        sampledCoordinate.rtlScrollType !== this.rtlScrollType);
    const sampledSuspensionCoordinateChanged =
      sourcePinningKey === this.layoutPinningKey && sourceInset !== nextInset;
    if (
      this.layoutReconciliationPending ||
      directionChanged ||
      this.forceGuardedDirectionReconciliation ||
      sampledEnvironmentChanged ||
      sampledSuspensionCoordinateChanged ||
      (!this.horizontalInputPending && (viewportWidthChanged || suspensionCoordinateChanged))
    ) {
      const convertedLogicalScrollLeft = sampledSuspensionCoordinateChanged
        ? requestedLogicalScrollLeft - sourceInset + nextInset
        : requestedLogicalScrollLeft;
      const reconciledLogicalScrollLeft = Math.min(
        Math.max(convertedLogicalScrollLeft, 0),
        horizontalScrollMaximum(this.layout, element.clientWidth),
      );
      if (
        this.layoutReconciliationPending &&
        this.shouldDeferReverseRtlLayoutWrite(element, reconciledLogicalScrollLeft)
      ) {
        this.pendingLayoutHorizontalCoordinate = this.captureHorizontalCoordinate(
          element,
          reconciledLogicalScrollLeft,
        );
        if (this.layoutReconciliationDeferrals < MAX_REVERSE_RTL_LAYOUT_DEFERRALS) {
          this.layoutReconciliationDeferrals += 1;
        }
        this.directionDirty = false;
        this.horizontalViewportWidth = element.clientWidth;
        return reconciledLogicalScrollLeft;
      }
      this.setLogicalScrollLeft(element, reconciledLogicalScrollLeft);
      if (directionChanged && reconciledLogicalScrollLeft > 0) {
        this.directionScrollGuard = reconciledLogicalScrollLeft;
      }
    }
    this.layoutReconciliationPending = false;
    this.layoutReconciliationDeferrals = 0;
    this.pendingLayoutHorizontalCoordinate = undefined;
    this.directionDirty = false;
    this.horizontalViewportWidth = element.clientWidth;
    if (!directionChanged) {
      this.directionScrollGuard = undefined;
      this.forceGuardedDirectionReconciliation = false;
    }
    return HORIZONTAL_RECONCILIATION_SETTLED;
  }

  private captureHorizontalCoordinate(
    element: HTMLElement,
    logicalScrollLeft: number,
  ): HorizontalCoordinateSample {
    return this.createHorizontalCoordinateSample(logicalScrollLeft, {
      direction: this.horizontalDirection,
      rtlScrollType: this.rtlScrollType,
      viewportWidth: element.clientWidth,
      suspended: shouldSuspendPinning(this.layout, element.clientWidth),
      pinnedStartWidth: this.layout.pinnedStartWidth,
      pinningKey: this.layoutPinningKey,
    });
  }

  private capturePublishedHorizontalCoordinate(
    logicalScrollLeft: number,
  ): HorizontalCoordinateSample {
    return this.createHorizontalCoordinateSample(logicalScrollLeft, {
      direction: this.horizontalDirection,
      rtlScrollType: this.rtlScrollType,
      viewportWidth: this.horizontalViewportWidth,
      suspended:
        this.horizontalSuspended ?? shouldSuspendPinning(this.layout, this.horizontalViewportWidth),
      pinnedStartWidth: this.horizontalPinnedStartWidth,
      pinningKey: this.horizontalPinningKey,
    });
  }

  private createHorizontalCoordinateSample(
    logicalScrollLeft: number,
    environment: HorizontalCoordinateEnvironment,
  ): HorizontalCoordinateSample {
    return Object.freeze({ logicalScrollLeft, ...environment });
  }

  private readLogicalScrollLeft(element: HTMLElement): number {
    const maximum = horizontalScrollMaximum(this.layout, element.clientWidth);
    const nativeScrollLeft = Number.isFinite(element.scrollLeft) ? element.scrollLeft : 0;
    return logicalScrollLeftFromNative(
      nativeScrollLeft,
      maximum,
      this.horizontalDirection,
      this.rtlScrollType,
    );
  }

  private setLogicalScrollLeft(element: HTMLElement, requestedLogicalScrollLeft: number): void {
    const maximum = horizontalScrollMaximum(this.layout, element.clientWidth);
    const logicalScrollLeft = Math.min(Math.max(requestedLogicalScrollLeft, 0), maximum);
    const nativeScrollLeft = nativeScrollLeftFromLogical(
      logicalScrollLeft,
      maximum,
      this.horizontalDirection,
      this.rtlScrollType,
    );
    setNativeScrollLeft(element, nativeScrollLeft);
    this.logicalScrollLeft = logicalScrollLeft;
    this.lastNativeScrollLeft = element.scrollLeft;
  }

  private writeScrollbarOverlay(
    element: HTMLElement,
    logicalScrollTop: number,
    logicalScrollLeft: number,
  ): void {
    const overlay = this.scrollbarOverlay;
    if (overlay === null) return;
    const directionChanged = this.scrollbarOverlayDirection !== this.horizontalDirection;
    const horizontal = horizontalMetrics(this.layout, element.clientWidth);
    const suspendPinning = horizontal.suspendPinning;
    const pinnedStartWidth = suspendPinning ? 0 : this.layout.pinnedStartWidth;
    const pinnedEndWidth = suspendPinning ? 0 : this.layout.pinnedEndWidth;
    const centerContentWidth = horizontal.contentWidth;
    const centerViewportWidth = horizontal.viewportWidth;
    const horizontalMaximum = horizontal.maximum;
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
    if (directionChanged) {
      style.setProperty("direction", this.horizontalDirection);
      this.scrollbarOverlayDirection = this.horizontalDirection;
    }
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

interface PendingReveal {
  rowIndex: number;
  columnId: string;
  region: "header" | "body";
  rowId?: string;
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
    pinningSuspended: suspendPinning,
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
    left.pinningSuspended === right.pinningSuspended &&
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

function mountedWindowCoversPreviewWindow(
  mounted: BrunoTableVirtualWindow,
  preview: BrunoTableVirtualWindow,
): boolean {
  const mountedEnd = mounted.centerStartIndex + mounted.center.length;
  const previewEnd = preview.centerStartIndex + preview.center.length;
  return (
    mounted.pinningSuspended === preview.pinningSuspended &&
    mounted.centerCount === preview.centerCount &&
    mounted.pinnedStart.length === preview.pinnedStart.length &&
    mounted.pinnedEnd.length === preview.pinnedEnd.length &&
    preview.centerStartIndex >= mounted.centerStartIndex &&
    previewEnd <= mountedEnd
  );
}

function mountedWindowPreviewPadding(
  layout: ViewportLayout,
  mounted: BrunoTableVirtualWindow,
): Pick<BrunoTableVirtualWindow, "leftPadding" | "rightPadding"> {
  const centerOffsets = mounted.pinningSuspended
    ? layout.suspendedCenterOffsets
    : layout.centerOffsets;
  const centerWidth = mounted.pinningSuspended ? layout.suspendedCenterWidth : layout.centerWidth;
  const leftPadding = centerOffsets[mounted.centerStartIndex] ?? 0;
  const mountedEnd = mounted.centerStartIndex + mounted.center.length;
  const mountedWidth = (centerOffsets[mountedEnd] ?? centerWidth) - leftPadding;
  return {
    leftPadding,
    rightPadding: Math.max(centerWidth - leftPadding - mountedWidth, 0),
  };
}

function shareVirtualWindowColumns(
  next: BrunoTableVirtualWindow,
  previous: BrunoTableVirtualWindow,
): BrunoTableVirtualWindow {
  const pinnedStart = sameColumns(next.pinnedStart, previous.pinnedStart)
    ? previous.pinnedStart
    : next.pinnedStart;
  const center = sameColumns(next.center, previous.center) ? previous.center : next.center;
  const pinnedEnd = sameColumns(next.pinnedEnd, previous.pinnedEnd)
    ? previous.pinnedEnd
    : next.pinnedEnd;
  if (pinnedStart === next.pinnedStart && center === next.center && pinnedEnd === next.pinnedEnd) {
    return next;
  }
  return Object.freeze({ ...next, pinnedStart, center, pinnedEnd });
}

function sameColumns(left: readonly CompiledColumn[], right: readonly CompiledColumn[]): boolean {
  return left.length === right.length && left.every((column, index) => column === right[index]);
}

function updateColumnWidthPreviewLayout(
  layout: ViewportLayout,
  columnId: string,
  width: number,
): ViewportLayout {
  const pinnedStartIndex = layout.pinnedStart.findIndex((column) => column.columnId === columnId);
  const centerIndex = layout.center.findIndex((column) => column.columnId === columnId);
  const pinnedEndIndex = layout.pinnedEnd.findIndex((column) => column.columnId === columnId);
  const region =
    pinnedStartIndex >= 0
      ? "start"
      : centerIndex >= 0
        ? "center"
        : pinnedEndIndex >= 0
          ? "end"
          : undefined;
  if (region === undefined) return layout;
  const regionIndex =
    region === "start" ? pinnedStartIndex : region === "center" ? centerIndex : pinnedEndIndex;
  const currentColumn =
    region === "start"
      ? layout.pinnedStart[regionIndex]
      : region === "center"
        ? layout.center[regionIndex]
        : layout.pinnedEnd[regionIndex];
  if (currentColumn === undefined || currentColumn.semantics.width === width) return layout;
  const nextColumn = Object.freeze({
    ...currentColumn,
    semantics: Object.freeze({ ...currentColumn.semantics, width }),
  });
  const pinnedStart =
    region === "start"
      ? replaceColumnAt(layout.pinnedStart, regionIndex, nextColumn)
      : layout.pinnedStart;
  const center =
    region === "center" ? replaceColumnAt(layout.center, regionIndex, nextColumn) : layout.center;
  const pinnedEnd =
    region === "end"
      ? replaceColumnAt(layout.pinnedEnd, regionIndex, nextColumn)
      : layout.pinnedEnd;
  const delta = width - currentColumn.semantics.width;
  const centerOffsets =
    region === "center"
      ? applyColumnOffsetDelta(layout.centerOffsets, regionIndex, delta)
      : layout.centerOffsets;
  const suspendedIndex =
    region === "start"
      ? regionIndex
      : region === "center"
        ? layout.pinnedStart.length + regionIndex
        : layout.pinnedStart.length + layout.center.length + regionIndex;
  const suspendedCenter = replaceColumnAt(layout.suspendedCenter, suspendedIndex, nextColumn);
  const suspendedCenterOffsets = applyColumnOffsetDelta(
    layout.suspendedCenterOffsets,
    suspendedIndex,
    delta,
  );
  const columns = replaceColumnAt(
    layout.columns,
    layout.columns.findIndex((column) => column.columnId === columnId),
    nextColumn,
  );
  const pinnedStartWidth = layout.pinnedStartWidth + (region === "start" ? delta : 0);
  const pinnedEndWidth = layout.pinnedEndWidth + (region === "end" ? delta : 0);
  const centerWidth = layout.centerWidth + (region === "center" ? delta : 0);
  const suspendedCenterWidth = layout.suspendedCenterWidth + delta;
  return Object.freeze({
    ...layout,
    columns,
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
    totalWidth: layout.totalWidth + delta,
  });
}

function replaceColumnAt(
  columns: readonly CompiledColumn[],
  index: number,
  column: CompiledColumn,
): readonly CompiledColumn[] {
  if (index < 0 || index >= columns.length) return columns;
  const next = [...columns];
  next[index] = column;
  return Object.freeze(next);
}

function applyColumnOffsetDelta(
  offsets: readonly number[],
  index: number,
  delta: number,
): readonly number[] {
  if (delta === 0 || index < 0 || index + 1 >= offsets.length) return offsets;
  const next = [...offsets];
  for (let offsetIndex = index + 1; offsetIndex < next.length; offsetIndex += 1) {
    next[offsetIndex] = next[offsetIndex]! + delta;
  }
  return Object.freeze(next);
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
    pinningSuspended: false,
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

interface HorizontalMetrics {
  suspendPinning: boolean;
  contentWidth: number;
  viewportWidth: number;
  maximum: number;
}

function horizontalMetrics(layout: ViewportLayout, viewportWidth: number): HorizontalMetrics {
  const suspendPinning = shouldSuspendPinning(layout, viewportWidth);
  const contentWidth = suspendPinning ? layout.suspendedCenterWidth : layout.centerWidth;
  const viewport = suspendPinning
    ? viewportWidth
    : Math.max(viewportWidth - layout.pinnedStartWidth - layout.pinnedEndWidth, 0);
  return {
    suspendPinning,
    contentWidth,
    viewportWidth: viewport,
    maximum: Math.max(contentWidth - viewport, 0),
  };
}

function horizontalScrollMaximum(layout: ViewportLayout, viewportWidth: number): number {
  return horizontalMetrics(layout, viewportWidth).maximum;
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

function rowLayerTransform(offset: string): string {
  return `translate3d(0, ${offset}, 0)`;
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

function logicalScrollLeftFromNative(
  nativeScrollLeft: number,
  maximum: number,
  direction: HorizontalDirection,
  rtlType: RtlScrollType,
): number {
  const logicalScrollLeft =
    direction === "ltr"
      ? nativeScrollLeft
      : rtlType === "negative"
        ? -nativeScrollLeft
        : rtlType === "reverse"
          ? maximum - nativeScrollLeft
          : nativeScrollLeft;
  return Math.min(Math.max(logicalScrollLeft, 0), maximum);
}

function nativeScrollLeftFromLogical(
  logicalScrollLeft: number,
  maximum: number,
  direction: HorizontalDirection,
  rtlType: RtlScrollType,
): number {
  const clampedLogicalScrollLeft = Math.min(Math.max(logicalScrollLeft, 0), maximum);
  return direction === "ltr"
    ? clampedLogicalScrollLeft
    : rtlType === "negative"
      ? -clampedLogicalScrollLeft
      : rtlType === "reverse"
        ? maximum - clampedLogicalScrollLeft
        : clampedLogicalScrollLeft;
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
