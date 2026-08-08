type Listener = () => void;

let clientGridSurfaceRenderListener: Listener | undefined;

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
