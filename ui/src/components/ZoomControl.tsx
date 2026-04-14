import { useUIStore } from '../store/ui';

export function ZoomControl() {
  const zoom = useUIStore((s) => s.zoom);
  const setZoom = useUIStore((s) => s.setZoom);
  const setViewport = useUIStore((s) => s.setViewport);

  const zoomIn = () => setZoom(Math.min(5, zoom * 1.2));
  const zoomOut = () => setZoom(Math.max(0.1, zoom / 1.2));
  const resetZoom = () => {
    setZoom(1);
    setViewport(0, 0);
  };

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white rounded-lg shadow-lg border border-gray-200 px-2 py-1 z-10">
      <button
        className="w-7 h-7 flex items-center justify-center rounded text-gray-600 hover:bg-gray-100 text-sm"
        onClick={zoomOut}
        title="缩小"
      >
        −
      </button>
      <button
        className="px-2 h-7 flex items-center justify-center rounded text-gray-600 hover:bg-gray-100 text-xs min-w-[48px]"
        onClick={resetZoom}
        title="重置缩放"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        className="w-7 h-7 flex items-center justify-center rounded text-gray-600 hover:bg-gray-100 text-sm"
        onClick={zoomIn}
        title="放大"
      >
        +
      </button>
    </div>
  );
}
