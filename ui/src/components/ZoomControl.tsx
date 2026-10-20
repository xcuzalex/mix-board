import { useUIStore } from '../store/ui';

const THEME_LABEL: Record<string, string> = {
  light: '浅色（点击切换到深色）',
  dark: '深色（点击切换到跟随系统）',
  system: '跟随系统（点击切换到浅色）',
};

function ThemeIcon({ theme }: { theme: string }) {
  if (theme === 'dark') {
    // moon
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    );
  }
  if (theme === 'system') {
    // monitor / auto
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    );
  }
  // sun
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

export function ZoomControl() {
  const zoom = useUIStore((s) => s.zoom);
  const setZoom = useUIStore((s) => s.setZoom);
  const setViewport = useUIStore((s) => s.setViewport);
  const theme = useUIStore((s) => s.theme);
  const cycleTheme = useUIStore((s) => s.cycleTheme);

  const zoomIn = () => setZoom(Math.min(5, zoom * 1.2));
  const zoomOut = () => setZoom(Math.max(0.1, zoom / 1.2));
  const resetZoom = () => {
    setZoom(1);
    setViewport(0, 0);
  };

  const btn = 'flex items-center justify-center rounded-lg text-slate-500 hover:bg-black/[0.05] hover:text-slate-800 dark:text-slate-300 dark:hover:bg-white/10';

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white/75 dark:bg-[#1c1c1e]/75 backdrop-blur-xl rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.10)] border border-black/[0.06] dark:border-white/10 px-2 py-1 z-10">
      <button className={`w-7 h-7 text-sm ${btn}`} onClick={zoomOut} title="缩小">−</button>
      <button className={`px-2 h-7 text-xs min-w-[48px] ${btn}`} onClick={resetZoom} title="重置缩放">
        {Math.round(zoom * 100)}%
      </button>
      <button className={`w-7 h-7 text-sm ${btn}`} onClick={zoomIn} title="放大">+</button>
      <span className="mx-0.5 h-5 w-px bg-black/[0.08] dark:bg-white/10" />
      <button className={`w-7 h-7 ${btn}`} onClick={cycleTheme} title={THEME_LABEL[theme]} aria-label="切换主题">
        <ThemeIcon theme={theme} />
      </button>
    </div>
  );
}
