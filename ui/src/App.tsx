import { Canvas } from './canvas/Canvas';
import { Toolbar } from './components/Toolbar';
import { TopBar } from './components/TopBar';
import { ZoomControl } from './components/ZoomControl';
import { PropertyPanel } from './components/PropertyPanel';
import { AIChatPanel, AISettingsPanel } from './ai/components';
import { isDesktop } from './platform';

export default function App() {
  const topInset = isDesktop() ? '' : 'pt-11';

  return (
    <div className="w-screen h-screen overflow-hidden relative bg-white">
      <TopBar />
      <div className={`absolute inset-0 ${topInset}`}>
        <Canvas />
        <Toolbar />
        <PropertyPanel />
        <ZoomControl />
        <AIChatPanel />
        <AISettingsPanel />
      </div>
    </div>
  );
}
