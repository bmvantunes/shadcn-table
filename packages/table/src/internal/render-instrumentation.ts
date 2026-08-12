type Listener = () => void;
type CellListener = (rowId: string, columnId: string) => void;
type ColumnPreviewStyleWriteListener = (property: string) => void;
type RowOrderPlanningListener = (tableId: string) => void;

let clientGridSurfaceRenderListener: Listener | undefined;
let clientHeaderRenderListener: Listener | undefined;
let clientViewRenderListener: Listener | undefined;
let clientCellRenderListener: CellListener | undefined;
let clientColumnResizeFrameListener: Listener | undefined;
let clientColumnReorderFrameListener: Listener | undefined;
let clientColumnPreviewStyleWriteListener: ColumnPreviewStyleWriteListener | undefined;
const clientRowOrderPlanningListeners = new Set<RowOrderPlanningListener>();

export function recordBrunoTableClientRowOrderPlanning(tableId: string): void {
  for (const listener of clientRowOrderPlanningListeners) listener(tableId);
}

export function installBrunoTableClientRowOrderPlanningListener(
  listener: RowOrderPlanningListener,
): () => void {
  clientRowOrderPlanningListeners.add(listener);
  return () => clientRowOrderPlanningListeners.delete(listener);
}

export function recordBrunoTableClientCellRender(rowId: string, columnId: string): void {
  clientCellRenderListener?.(rowId, columnId);
}

export function installBrunoTableClientCellRenderListener(listener: CellListener): () => void {
  clientCellRenderListener = listener;
  return () => {
    if (clientCellRenderListener === listener) {
      clientCellRenderListener = undefined;
    }
  };
}

export function recordBrunoTableClientViewRender(): void {
  clientViewRenderListener?.();
}

export function installBrunoTableClientViewRenderListener(listener: Listener): () => void {
  clientViewRenderListener = listener;
  return () => {
    if (clientViewRenderListener === listener) {
      clientViewRenderListener = undefined;
    }
  };
}

export function recordBrunoTableClientGridSurfaceRender(): void {
  clientGridSurfaceRenderListener?.();
}

export function installBrunoTableClientGridSurfaceRenderListener(listener: Listener): () => void {
  clientGridSurfaceRenderListener = listener;
  return () => {
    if (clientGridSurfaceRenderListener === listener) {
      clientGridSurfaceRenderListener = undefined;
    }
  };
}

export function recordBrunoTableClientColumnResizeFrame(): void {
  clientColumnResizeFrameListener?.();
}

export function installBrunoTableClientColumnResizeFrameListener(listener: Listener): () => void {
  clientColumnResizeFrameListener = listener;
  return () => {
    if (clientColumnResizeFrameListener === listener) clientColumnResizeFrameListener = undefined;
  };
}

export function recordBrunoTableClientColumnReorderFrame(): void {
  clientColumnReorderFrameListener?.();
}

export function installBrunoTableClientColumnReorderFrameListener(listener: Listener): () => void {
  clientColumnReorderFrameListener = listener;
  return () => {
    if (clientColumnReorderFrameListener === listener) clientColumnReorderFrameListener = undefined;
  };
}

export function recordBrunoTableClientColumnPreviewStyleWrite(property: string): void {
  clientColumnPreviewStyleWriteListener?.(property);
}

export function installBrunoTableClientColumnPreviewStyleWriteListener(
  listener: ColumnPreviewStyleWriteListener,
): () => void {
  clientColumnPreviewStyleWriteListener = listener;
  return () => {
    if (clientColumnPreviewStyleWriteListener === listener) {
      clientColumnPreviewStyleWriteListener = undefined;
    }
  };
}

export function recordBrunoTableClientHeaderRender(): void {
  clientHeaderRenderListener?.();
}

export function installBrunoTableClientHeaderRenderListener(listener: Listener): () => void {
  clientHeaderRenderListener = listener;
  return () => {
    if (clientHeaderRenderListener === listener) {
      clientHeaderRenderListener = undefined;
    }
  };
}
