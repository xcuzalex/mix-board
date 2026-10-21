import { getPlatform, isDesktop, type VaultBridge, type VaultStatus } from '../platform';
import { useDocumentStore } from '../store/document';
import { useUIStore } from '../store/ui';
import { isPathInside, useVaultStore } from '../store/vault';
import { flushAutosave, isUnchangedSince, settleDocument, useAutosaveStore } from './autosave';
import { flushPendingCanvasInteractionState } from './canvas-interaction-flush';
import { serializeDocument } from './document-io';
import { parseFailureMessage } from './board-format';
import { isTypingTarget } from '../canvas/clipboard';

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
  await settleDocument();
  if (useAutosaveStore.getState().status === 'error') {
    // The board is about to be replaced; its edits survive as a local draft.
    useVaultStore.getState().setNotice('上一个笔记没能写入文件，修改已保存为本机草稿，下次启动时可恢复');
  }
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
  const snapshot = useDocumentStore.getState();
  const { elements, appState, files } = snapshot;
  const created = await run((vault) =>
    vault.createBoard(useVaultStore.getState().folder, serializeDocument(elements, appState, files)),
  );
  if (!created) return;
  // Edits made while the file was being created still need saving.
  const unchanged = isUnchangedSince({ elements, appState, files, filePath: snapshot.filePath });
  const file = { filePath: created.path, fileVersion: created.version };
  useDocumentStore.setState(unchanged ? { ...file, isDirty: false } : file);
  void getVault().then((vault) => vault?.setLastBoard(created.path).catch(() => undefined));
  await useVaultStore.getState().refreshEntries();
}

/** Loads the vault status at startup (desktop only) and reopens the last board. */
export async function initVault() {
  if (!isDesktop()) return;
  const status = await run((vault) => vault.status());
  if (status) await applyStatus(status);
  watchOpenBoard();
}

// --- The open board, changed on another Mac ---------------------------------

/** How often the open board's file is checked while the window is in front. */
const CHANGE_CHECK_MS = 10_000;
let watching = false;
let pointerHeld = false;
let checking = false;

/** Checks on focus and every few seconds while focused (iCloud can deliver late). Once per app. */
function watchOpenBoard() {
  if (watching) return;
  watching = true;
  window.addEventListener('focus', () => void reloadIfChangedElsewhere());
  window.addEventListener('pointerdown', () => { pointerHeld = true; }, true);
  window.addEventListener('pointerup', () => { pointerHeld = false; }, true);
  window.addEventListener('pointercancel', () => { pointerHeld = false; }, true);
  window.setInterval(() => {
    if (document.hasFocus()) void reloadIfChangedElsewhere();
  }, CHANGE_CHECK_MS);
}

/**
 * If the open board's file is no longer at the version on screen (another
 * Mac saved it, via iCloud) and there are no local edits, show that version.
 * With local edits, nothing happens here: the next save keeps both versions
 * (see `writeDocumentFile`). Never interrupts typing or a drag in progress.
 */
export async function reloadIfChangedElsewhere() {
  const { filePath, fileVersion, isDirty } = useDocumentStore.getState();
  if (!filePath || !fileVersion || isDirty || checking || pointerHeld) return;
  if (isTypingTarget(document.activeElement) || useAutosaveStore.getState().status === 'saving') return;
  checking = true;
  try {
    const platform = await getPlatform();
    if (!(await platform.documentChanged(filePath, fileVersion).catch(() => false))) return;
    const read = await platform.readDocumentFile(filePath).catch(() => null);
    if (!read) return;
    const store = useDocumentStore.getState();
    // Edited or switched boards while reading: leave it to the next save / check.
    if (store.filePath !== filePath || store.fileVersion !== fileVersion || store.isDirty || pointerHeld) return;
    const loaded = store.loadDocument(read.content);
    if (loaded !== true) {
      // Keep the old version as the base, so a later save still keeps theirs.
      useVaultStore.getState().setNotice(`这篇笔记在其他设备上有新的修改，但无法载入：${parseFailureMessage(loaded)}`);
      return;
    }
    store.setFilePath(filePath, read.version);
    clearCanvasSelection();
    useVaultStore.getState().setNotice('已载入这篇笔记在其他设备上的最新修改', 'info');
  } finally {
    checking = false;
  }
}

export async function pickVaultFolder() {
  const status = await run((vault) => vault.pickFolder());
  if (status) await applyStatus(status);
}

/** Any folder inside iCloud Drive (not only iCloud 云盘/MixNote) as the vault. */
export async function pickICloudFolder() {
  const status = await run((vault) => vault.pickFolder(true));
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
  let read: { content: string; version: string };
  try {
    read = await (await getPlatform()).readDocumentFile(path);
  } catch (err) {
    useVaultStore.getState().setNotice(`无法打开笔记：${errorMessage(err)}`);
    return;
  }
  const store = useDocumentStore.getState();
  const loaded = store.loadDocument(read.content);
  if (loaded !== true) {
    useVaultStore.getState().setNotice(`无法打开笔记：${parseFailureMessage(loaded)}`);
    return;
  }
  store.setFilePath(path, read.version);
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
 * `folder` (default: the folder open in the library; null: the vault root) and
 * its name opens for editing. Without one, a blank untitled board (saved as a
 * local draft).
 */
export async function createBoard(folder?: string | null) {
  await settleCurrentDocument();
  const store = useDocumentStore.getState();
  store.newDocument();
  clearCanvasSelection();
  useVaultStore.getState().setLibraryOpen(false);
  if (!useVaultStore.getState().vault) return;

  const { elements, appState, files } = useDocumentStore.getState();
  const target = folder === undefined ? useVaultStore.getState().folder : folder;
  const created = await run((vault) => vault.createBoard(target, serializeDocument(elements, appState, files)));
  if (!created) return;
  useDocumentStore.getState().setFilePath(created.path, created.version);
  void run((vault) => vault.setLastBoard(created.path));
  await useVaultStore.getState().refreshEntries();
  // Name it right away in the board's title field.
  useVaultStore.getState().setRenamingPath(created.path);
}

/** New folder in `parent` (default: the folder open in the library; null: the vault root). */
export async function createFolder(parent?: string | null) {
  const target = parent === undefined ? useVaultStore.getState().folder : parent;
  const path = await run((vault) => vault.createFolder(target));
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
      // A rename keeps the file's version (same bytes, same modification time).
      const doc = useDocumentStore.getState();
      doc.setFilePath(newPath + latestPath.slice(path.length), doc.fileVersion);
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
