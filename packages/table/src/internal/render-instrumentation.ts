type Listener = () => void;
type CellListener = (rowId: string, columnId: string) => void;

let clientGridSurfaceRenderListener: Listener | undefined;
let clientViewRenderListener: Listener | undefined;
let clientCellRenderListener: CellListener | undefined;

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
