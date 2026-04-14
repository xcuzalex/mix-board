export interface PlatformBridge {
  saveFile(data: string, defaultPath?: string): Promise<string | null>;
  openFile(): Promise<{ path: string; content: string } | null>;
  saveAsFile(data: string, defaultPath?: string): Promise<string | null>;
  exportAsImage(canvas: HTMLCanvasElement, format: 'png', defaultPath?: string): Promise<string | null>;
  isDesktop(): boolean;
  isWeb(): boolean;
}

type TauriWindow = Window & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
};

function isInTauriEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  const tauriWindow = window as TauriWindow;
  return '__TAURI_INTERNALS__' in tauriWindow || '__TAURI__' in tauriWindow;
}

let bridge: PlatformBridge | null = null;
let bridgeKind: 'desktop' | 'web' | null = null;

export async function getPlatform(): Promise<PlatformBridge> {
  const nextBridgeKind = isInTauriEnvironment() ? 'desktop' : 'web';
  if (bridge && bridgeKind === nextBridgeKind) return bridge;

  if (nextBridgeKind === 'desktop') {
    const { TauriBridge } = await import('./tauri');
    bridge = new TauriBridge();
  } else {
    const { WebBridge } = await import('./web');
    bridge = new WebBridge();
  }
  bridgeKind = nextBridgeKind;
  return bridge;
}

export function isDesktop(): boolean {
  return isInTauriEnvironment();
}
