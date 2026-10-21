export interface VaultInfo {
  path: string;
  name: string;
  /** False when the folder is gone (deleted, or on an unmounted drive). */
  exists: boolean;
}

export interface VaultStatus {
  current: VaultInfo | null;
  recent: VaultInfo[];
  /** First launch (or the vault went missing): show the welcome screen. */
  needsWelcome: boolean;
  /** Board last opened in the current vault, if it still exists. */
  lastBoard: string | null;
}

export interface VaultEntry {
  path: string;
  parent: string;
  /** Folder name, or board file name without its extension. */
  name: string;
  kind: 'folder' | 'board';
  /** Milliseconds since the epoch. */
  modified: number;
  /** False for iCloud placeholders not yet downloaded. */
  downloaded: boolean;
  /** Starred in the library. */
  favorite: boolean;
}

/**
 * A vault is one folder of `*.mixnote` boards (desktop only). The native side
 * owns which folder that is and rejects paths outside it.
 */
export interface VaultBridge {
  status(): Promise<VaultStatus>;
  /** Native folder picker (starting in iCloud Drive when `inICloud`); null when cancelled. */
  pickFolder(inICloud?: boolean): Promise<VaultStatus | null>;
  useICloud(): Promise<VaultStatus>;
  openRecent(path: string): Promise<VaultStatus>;
  forgetRecent(path: string): Promise<VaultStatus>;
  useLocalDrafts(): Promise<VaultStatus>;
  setLastBoard(path: string | null): Promise<void>;
  list(): Promise<VaultEntry[]>;
  setFavorite(path: string, favorite: boolean): Promise<void>;
  /** Creates `未命名 N.mixnote` in `dir` (vault root when null); returns its path and file version. */
  createBoard(dir: string | null, content: string): Promise<{ path: string; version: string }>;
  createFolder(dir: string | null): Promise<string>;
  /** Renames in place (boards keep their extension); returns the new path. */
  rename(path: string, name: string): Promise<string>;
  moveToTrash(path: string): Promise<void>;
  /** Asks iCloud to download boards not stored on this Mac yet (`downloaded: false`). */
  download(paths: string[]): Promise<void>;
}

export interface PlatformBridge {
  saveFile(data: string, defaultPath?: string): Promise<string | null>;
  openFile(): Promise<{ path: string; content: string } | null>;
  saveAsFile(data: string, defaultPath?: string): Promise<string | null>;
  /**
   * Writes a document by path, without a dialog (desktop only). `base` is the
   * file version the content is based on: if the file is no longer at that
   * version (edited on another Mac) and differs, that version is kept as a
   * sibling copy first (`otherVersion`). '' = unknown base; null = overwrite.
   */
  writeDocumentFile(path: string, data: string, base: string | null): Promise<{ version: string; otherVersion: string | null }>;
  /** Whether the file is no longer at `version` (changed on another Mac, via iCloud). */
  documentChanged(path: string, version: string): Promise<boolean>;
  /** Read a document by path without a dialog (desktop only), with its file version. */
  readDocumentFile(path: string): Promise<{ content: string; version: string }>;
  /** Vault access; null on the web, which keeps drafts + download/upload. */
  readonly vault: VaultBridge | null;
  exportAsImage(canvas: HTMLCanvasElement, format: 'png', defaultPath?: string): Promise<string | null>;
  /** Save a text document (e.g. Markdown export) with a file-type filter. */
  saveTextFile(data: string, defaultPath: string, filter: { name: string; extensions: string[] }): Promise<string | null>;
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
