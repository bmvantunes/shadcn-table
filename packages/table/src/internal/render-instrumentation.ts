type Listener = () => void;

let clientGridSurfaceRenderListener: Listener | undefined;
let clientViewRenderListener: Listener | undefined;

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
