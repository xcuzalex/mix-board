import { create } from 'zustand';
import { getPlatform, type VaultEntry, type VaultInfo } from '../platform';

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
  /** Last failed vault operation, shown as a dismissable notice. */
  notice: string | null;
  setLibraryOpen: (open: boolean) => void;
  setSection: (section: LibrarySection) => void;
  /** Shows a folder (null: back to all boards). */
  setFolder: (folder: string | null) => void;
  setRenamingPath: (path: string | null) => void;
  setNotice: (notice: string | null) => void;
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
  setLibraryOpen: (open) => set({ libraryOpen: open }),
  setSection: (section) => set({ section, folder: typeof section === 'object' ? section.folder : null }),
  setFolder: (folder) => set({ section: folder ? { folder } : 'all', folder }),
  setRenamingPath: (path) => set({ renamingPath: path }),
  setNotice: (notice) => set({ notice }),
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
      set({ entries: await platform.vault.list() });
    } catch (err) {
      set({ notice: err instanceof Error ? err.message : String(err) });
    }
  },
}));

/** True when `path` is `root` itself or lies inside it. */
export function isPathInside(path: string | null | undefined, root: string | null | undefined) {
  if (!path || !root) return false;
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`);
}
