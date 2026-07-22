type FlushPendingCanvasInteractionCallback = () => void | boolean;

let flushPendingCanvasInteractionCallback: FlushPendingCanvasInteractionCallback | null = null;

export function registerPendingCanvasInteractionFlush(
  callback: FlushPendingCanvasInteractionCallback,
) {
  flushPendingCanvasInteractionCallback = callback;

  return () => {
    if (flushPendingCanvasInteractionCallback === callback) {
      flushPendingCanvasInteractionCallback = null;
    }
  };
}

export function flushPendingCanvasInteractionState() {
  return flushPendingCanvasInteractionCallback?.() ?? false;
}
