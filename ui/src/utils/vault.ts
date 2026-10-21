import { getPlatform, isDesktop, type VaultBridge, type VaultStatus } from '../platform';
import { useDocumentStore } from '../store/document';
import { useUIStore } from '../store/ui';
import { isPathInside, useVaultStore } from '../store/vault';
import { flushAutosave } from './autosave';
import { flushPendingCanvasInteractionState } from './canvas-interaction-flush';
import { serializeDocument } from './document-io';

// Vault ("资料库") actions that touch the open document. They always finish
// pending autosaves first, so a write can't land on a path that was just
// renamed, trashed or replaced.

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

async function getVault(): Promise<VaultBridge | null> {
  return (await getPlatform()).vault;
}

async function run<T>(action: (vault: VaultBridge) => Promise<T>): Promise<T | null> {
  const vault = await getVault();
  if (!vault) return null;
  try {
    return await action(vault);
  } catch (err) {
    useVaultStore.getState().setNotice(errorMessage(err));
    return null;
  }
}

async function settleCurrentDocument() {
  flushPendingCanvasInteractionState();
  await flushAutosave();
}

function clearCanvasSelection() {
  const ui = useUIStore.getState();
  ui.setSelectedIds([]);
  ui.setSelectedMindmapNode(null);
}

function currentVaultRoot() {
  return useVaultStore.getState().vault?.path ?? null;
}

/** The open document is a board inside the current vault. */
export function isVaultBoard(path: string | null) {
  return path !== null && isPathInside(path, currentVaultRoot()) && path !== currentVaultRoot();
}

async function applyStatus(status: VaultStatus) {
  const previousRoot = currentVaultRoot();
  const root = status.current?.path ?? null;
  useVaultStore.setState({
    ready: true,
    vault: status.current,
    recent: status.recent,
    needsWelcome: status.needsWelcome,
    ...(root !== previousRoot ? { entries: [], section: 'all' as const, folder: null, renamingPath: null } : {}),
  });
  if (!root) {
    useVaultStore.getState().setLibraryOpen(false);
    return;
  }
  await useVaultStore.getState().refreshEntries();
  if (root === previousRoot) return;

  const doc = useDocumentStore.getState();
  if (doc.filePath) return; // keep an open file; it stays editable where it is
  if (doc.elements.length > 0) {
    // Scratch work made before choosing a vault moves into it.
    await saveUntitledIntoVault();
  } else if (status.lastBoard) {
    await openBoard(status.lastBoard);
  } else {
    // A fresh vault starts on its board list, like Freeform.
    useVaultStore.getState().setLibraryOpen(true);
  }
}

async function saveUntitledIntoVault() {
  const { elements, appState, files } = useDocumentStore.getState();
  const path = await run((vault) =>
    vault.createBoard(useVaultStore.getState().folder, serializeDocument(elements, appState, files)),
  );
  if (!path) return;
  useDocumentStore.setState({ filePath: path, isDirty: false });
  void getVault().then((vault) => vault?.setLastBoard(path).catch(() => undefined));
  await useVaultStore.getState().refreshEntries();
}

/** Loads the vault status at startup (desktop only) and reopens the last board. */
export async function initVault() {
  if (!isDesktop()) return;
  const status = await run((vault) => vault.status());
  if (status) await applyStatus(status);
}

export async function pickVaultFolder() {
  const status = await run((vault) => vault.pickFolder());
  if (status) await applyStatus(status);
}

export async function openICloudVault() {
  const status = await run((vault) => vault.useICloud());
  if (status) await applyStatus(status);
}

export async function openRecentVault(path: string) {
  const status = await run((vault) => vault.openRecent(path));
  if (status) await applyStatus(status);
}

export async function forgetRecentVault(path: string) {
  const status = await run((vault) => vault.forgetRecent(path));
  if (status) await applyStatus(status);
}

/** "暂时只用本机草稿": no vault; untitled boards keep using IndexedDB drafts. */
export async function chooseLocalDraftsOnly() {
  const status = await run((vault) => vault.useLocalDrafts());
  if (status) await applyStatus(status);
}

export async function openBoard(path: string) {
  await settleCurrentDocument();
  let content: string;
  try {
    content = await (await getPlatform()).readDocumentFile(path);
  } catch (err) {
    useVaultStore.getState().setNotice(`无法打开画板：${errorMessage(err)}`);
    return;
  }
  const store = useDocumentStore.getState();
  store.loadDocument(content);
  store.setFilePath(path);
  clearCanvasSelection();
  useVaultStore.getState().setLibraryOpen(false);
  if (isVaultBoard(path)) void run((vault) => vault.setLastBoard(path));
}

export function openLibrary() {
  if (!useVaultStore.getState().vault && !isDesktop()) return;
  flushPendingCanvasInteractionState();
  // Make sure the list shows the latest edit times.
  void flushAutosave().then(() => useVaultStore.getState().refreshEntries());
  useVaultStore.getState().setLibraryOpen(true);
}

export async function setFavorite(path: string, favorite: boolean) {
  const entries = useVaultStore.getState().entries;
  // Optimistic: the star flips at once, the list reloads if the write fails.
  useVaultStore.setState({ entries: entries.map((e) => (e.path === path ? { ...e, favorite } : e)) });
  const done = await run(async (vault) => {
    await vault.setFavorite(path, favorite);
    return true;
  });
  if (!done) await useVaultStore.getState().refreshEntries();
}

/**
 * New board: with a vault, a `未命名 N.mixnote` file is created right away in
 * the selected folder and its name opens for editing. Without one, a blank
 * untitled board (saved as a local draft).
 */
export async function createBoard() {
  await settleCurrentDocument();
  const store = useDocumentStore.getState();
  store.newDocument();
  clearCanvasSelection();
  useVaultStore.getState().setLibraryOpen(false);
  if (!useVaultStore.getState().vault) return;

  const { elements, appState, files } = useDocumentStore.getState();
  const path = await run((vault) =>
    vault.createBoard(useVaultStore.getState().folder, serializeDocument(elements, appState, files)),
  );
  if (!path) return;
  useDocumentStore.getState().setFilePath(path);
  void run((vault) => vault.setLastBoard(path));
  await useVaultStore.getState().refreshEntries();
  // Name it right away in the board's title field.
  useVaultStore.getState().setRenamingPath(path);
}

export async function createFolder() {
  const path = await run((vault) => vault.createFolder(useVaultStore.getState().folder));
  if (!path) return;
  await useVaultStore.getState().refreshEntries();
  useVaultStore.getState().setRenamingPath(path);
}

/** Renames a board or folder; the open board follows the rename. */
export async function renameEntry(path: string, name: string) {
  const currentPath = useDocumentStore.getState().filePath;
  const affectsCurrent = isPathInside(currentPath, path);
  if (affectsCurrent) await settleCurrentDocument();

  const newPath = await run((vault) => vault.rename(path, name));
  if (!newPath) return false;
  if (newPath !== path) {
    const latestPath = useDocumentStore.getState().filePath;
    if (latestPath && isPathInside(latestPath, path)) {
      useDocumentStore.getState().setFilePath(newPath + latestPath.slice(path.length));
    }
    const { folder } = useVaultStore.getState();
    if (folder && isPathInside(folder, path)) {
      useVaultStore.getState().setFolder(newPath + folder.slice(path.length));
    }
    if (useVaultStore.getState().renamingPath === path) useVaultStore.getState().setRenamingPath(null);
  }
  await useVaultStore.getState().refreshEntries();
  return true;
}

export function renameCurrentBoard(name: string) {
  const { filePath } = useDocumentStore.getState();
  if (!filePath || !isVaultBoard(filePath)) return Promise.resolve(false);
  return renameEntry(filePath, name);
}

/** Moves a board or folder to the system Trash; closes the open board if it went with it. */
export async function trashEntry(path: string) {
  const affectsCurrent = isPathInside(useDocumentStore.getState().filePath, path);
  if (affectsCurrent) await settleCurrentDocument();

  const trashed = await run(async (vault) => {
    await vault.moveToTrash(path);
    return true;
  });
  if (!trashed) return;
  if (affectsCurrent) {
    useDocumentStore.getState().newDocument();
    clearCanvasSelection();
  }
  const { folder } = useVaultStore.getState();
  if (folder && isPathInside(folder, path)) useVaultStore.getState().setFolder(null);
  await useVaultStore.getState().refreshEntries();
}
