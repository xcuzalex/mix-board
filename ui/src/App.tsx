import { useEffect } from 'react';
import { Canvas } from './canvas/Canvas';
import { Toolbar } from './components/Toolbar';
import { TopBar } from './components/TopBar';
import { ZoomControl } from './components/ZoomControl';
import { PropertyPanel } from './components/PropertyPanel';
import { OutlinePanel } from './components/OutlinePanel';
import { DraftRestorePrompt } from './components/DraftRestorePrompt';
import { isDesktop } from './platform';
import { useUIStore } from './store/ui';
import { applyTheme, watchSystemTheme } from './theme';
import { startAutosave } from './utils/autosave';

export default function App() {
  const topInset = isDesktop() ? '' : 'pt-11';
  const theme = useUIStore((s) => s.theme);

  // Keep the effective theme synced with the OS while preference is 'system'.
  useEffect(() => {
    applyTheme(theme);
    return watchSystemTheme(
      () => useUIStore.getState().theme,
      (effectiveTheme) => useUIStore.setState({ effectiveTheme }),
    );
  }, [theme]);

  useEffect(() => startAutosave(), []);

  return (
    <div className="w-screen h-screen overflow-hidden relative bg-white dark:bg-[#17171b]">
      <TopBar />
      <DraftRestorePrompt />
      <div className={`absolute inset-0 ${topInset}`}>
        <Canvas />
        <OutlinePanel />
        <Toolbar />
        <PropertyPanel />
        <ZoomControl />
      </div>
    </div>
  );
}
