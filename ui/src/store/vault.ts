import { create } from 'zustand';
import { getPlatform, type VaultEntry, type VaultInfo } from '../platform';

export type NoticeTone = 'error' | 'info' | 'progress';

/** What the library page lists: every board, starred ones, or one folder. */
export type LibrarySection = 'all' | 'favorites' | { folder: string };

interface VaultStore {
  /** The desktop vault status has loaded (always false on the web). */
  ready: boolean;
  vault: VaultInfo | null;
  recent: VaultInfo[];
  needsWelcome: boolean;
  entries: VaultEntry[];
  /** The library page covers the canvas. */
  libraryOpen: boolean;
  section: LibrarySection;
  /** Folder that new boards go into (the open folder section); null means the vault root. */
  folder: string | null;
  /** Entry whose name is being edited in place (e.g. a board just created). */
  renamingPath: string | null;
  /** Message shown as a dismissable notice (a failed operation, or status). */
  notice: string | null;
  /** 'error' notices are red; 'info' ones neutral; 'progress' ones stay until cleared. */
  noticeTone: NoticeTone;
  setLibraryOpen: (open: boolean) => void;
  setSection: (section: LibrarySection) => void;
  /** Shows a folder (null: back to all boards). */
  setFolder: (folder: string | null) => void;
  setRenamingPath: (path: string | null) => void;
  setNotice: (notice: string | null, tone?: NoticeTone) => void;
  /** Clears the notice only if it is still `notice` (a newer one stays). */
  clearNotice: (notice: string) => void;
  /** Bumps a board's modified time after an autosave, keeping the list order fresh. */
  touchEntry: (path: string) => void;
  refreshEntries: () => Promise<void>;
}

export const useVaultStore = create<VaultStore>()((set, get) => ({
  ready: false,
  vault: null,
  recent: [],
  needsWelcome: false,
  entries: [],
  libraryOpen: false,
  section: 'all',
  folder: null,
  renamingPath: null,
  notice: null,
  noticeTone: 'error',
  setLibraryOpen: (open) => set({ libraryOpen: open }),
  setSection: (section) => set({ section, folder: typeof section === 'object' ? section.folder : null }),
  setFolder: (folder) => set({ section: folder ? { folder } : 'all', folder }),
  setRenamingPath: (path) => set({ renamingPath: path }),
  setNotice: (notice, tone = 'error') => set({ notice, noticeTone: tone }),
  clearNotice: (notice) => {
    if (get().notice === notice) set({ notice: null });
  },
  touchEntry: (path) => {
    const { entries, vault } = get();
    if (!entries.some((entry) => entry.path === path)) {
      // A board the list hasn't caught up with yet; files outside the vault aren't listed.
      if (isPathInside(path, vault?.path)) void get().refreshEntries();
      return;
    }
    const modified = Date.now();
    set({ entries: entries.map((entry) => (entry.path === path ? { ...entry, modified } : entry)) });
  },
  refreshEntries: async () => {
    const platform = await getPlatform();
    if (!platform.vault || !get().vault) {
      set({ entries: [] });
      return;
    }
    try {
      const entries = await platform.vault.list();
      set({ entries });
      fetchFromICloud(entries);
    } catch (err) {
      set({ notice: err instanceof Error ? err.message : String(err) });
    }
  },
}));

// --- iCloud downloads ---------------------------------------------------------
// Boards that iCloud hasn't stored on this Mac (evicted or not synced yet) are
// downloaded automatically when the library lists them; the list is re-read
// every few seconds until they arrive. A board that doesn't arrive within
// DOWNLOAD_GIVE_UP_MS stops the polling (offline) and is asked for again on
// the next refresh (the library reopening, or the window regaining focus).

const DOWNLOAD_POLL_MS = 2500;
const DOWNLOAD_GIVE_UP_MS = 3 * 60_000;
/** When each not-yet-downloaded board of the current vault was requested. */
let requestedAt = new Map<string, number>();
let requestedVault: string | null = null;
let pollTimer: number | null = null;

function fetchFromICloud(entries: VaultEntry[]) {
  const vault = useVaultStore.getState().vault?.path ?? null;
  if (vault !== requestedVault) {
    requestedVault = vault;
    requestedAt = new Map();
  }
  const now = Date.now();
  const missing = entries.filter((entry) => entry.kind === 'board' && !entry.downloaded);
  // Forget boards that arrived, moved or were deleted.
  requestedAt = new Map(missing.filter((entry) => requestedAt.has(entry.path)).map((entry) => [entry.path, requestedAt.get(entry.path)!]));
  const due = missing
    .filter((entry) => now - (requestedAt.get(entry.path) ?? -Infinity) > DOWNLOAD_GIVE_UP_MS)
    .map((entry) => entry.path);
  for (const path of due) requestedAt.set(path, now);
  if (due.length) {
    void getPlatform().then((platform) => platform.vault?.download(due)).catch(() => undefined);
  }
  const waiting = missing.some((entry) => now - requestedAt.get(entry.path)! < DOWNLOAD_GIVE_UP_MS);
  if (waiting && pollTimer === null) {
    pollTimer = window.setTimeout(() => {
      pollTimer = null;
      void useVaultStore.getState().refreshEntries();
    }, DOWNLOAD_POLL_MS);
  }
}

/**
 * Waits (up to `timeoutMs`) for a board to be downloaded from iCloud, asking
 * for it first. Watches the library list, which the download polling above
 * keeps refreshing, rather than scanning the vault itself.
 */
export async function whenDownloaded(path: string, timeoutMs = 60_000): Promise<'downloaded' | 'missing' | 'timeout'> {
  const platform = await getPlatform();
  if (!platform.vault) return 'missing';
  requestedAt.set(path, Date.now());
  await platform.vault.download([path]).catch(() => undefined);
  await useVaultStore.getState().refreshEntries();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const entry = useVaultStore.getState().entries.find((e) => e.path === path);
    if (!entry) return 'missing';
    if (entry.downloaded) return 'downloaded';
    if (Date.now() >= deadline) return 'timeout';
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** True when `path` is `root` itself or lies inside it. */
export function isPathInside(path: string | null | undefined, root: string | null | undefined) {
  if (!path || !root) return false;
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`);
}
