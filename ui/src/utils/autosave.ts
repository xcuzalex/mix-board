import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { create } from 'zustand';
import { getPlatform, isDesktop } from '../platform';
import { useDocumentStore } from '../store/document';
import { useVaultStore } from '../store/vault';
import type { AppState, EmbeddedFile } from '../types/document';
import type { Element } from '../types/element';
import { flushPendingCanvasInteractionState } from './canvas-interaction-flush';
import { getDocumentDisplayName, serializeDocument } from './document-io';
import { parseFailureMessage } from './board-format';

// Autosave only reads store snapshots: it never pushes history or touches
// elements. The one write it makes is clearing `isDirty` after a silent save.

const AUTOSAVE_DELAY_MS = 1500;
// Storage names keep the pre-rename prefix so existing drafts survive.
const DB_NAME = 'mixboard';
const DB_VERSION = 1;
const DRAFT_STORE = 'drafts';
// Drafts older than this are dropped at startup instead of offered.
const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// Sent by the Rust side before quitting; answered with `quit_flush_done`.
const QUIT_FLUSH_EVENT = 'mixnote-flush-before-quit';

export type AutosaveStatus =
  | 'idle' // nothing edited since open/new
  | 'dirty' // edited, save scheduled
  | 'saving'
  | 'saved' // written to the document's file
  | 'draft' // written to the local IndexedDB draft
  | 'error';

export interface DocumentDraft {
  id: string;
  filePath: string | null;
  /** File version the draft's content was based on (absent in older drafts). */
  fileVersion?: string | null;
  savedAt: number;
  elementCount: number;
  data: string;
}

interface AutosaveState {
  status: AutosaveStatus;
  lastSavedAt: number | null;
  error: string | null;
  /** A draft left by an earlier document session, offered for restore. */
  pendingDraft: DocumentDraft | null;
}

export const useAutosaveStore = create<AutosaveState>(() => ({
  status: 'idle',
  lastSavedAt: null,
  error: null,
  pendingDraft: null,
}));

interface Snapshot {
  elements: Element[];
  appState: AppState;
  files: Record<string, EmbeddedFile>;
  filePath: string | null;
  fileVersion?: string | null;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let pendingChange = false;
let queue: Promise<void> = Promise.resolve();
let db: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase | null> | null = null;

/**
 * Each open document writes its draft to its own slot. Replacing the document
 * (open, new board, restore) starts a fresh slot, so the previous document's
 * draft stays behind and is offered again at the next launch instead of being
 * overwritten or deleted. A slot is only deleted once its document is saved.
 */
function newSlotId() {
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
let slotId = newSlotId();

function takeSnapshot(): Snapshot {
  const { elements, appState, files, filePath, fileVersion } = useDocumentStore.getState();
  return { elements, appState, files, filePath, fileVersion };
}

export function isUnchangedSince(snapshot: Snapshot) {
  const state = useDocumentStore.getState();
  return state.elements === snapshot.elements
    && state.appState === snapshot.appState
    && state.files === snapshot.files
    && state.filePath === snapshot.filePath;
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

// --- IndexedDB draft storage ---

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DRAFT_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onerror = () => resolve(null);
  });
  return dbPromise;
}

async function draftRequest<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDb();
  if (!database) throw new Error('IndexedDB is unavailable');
  return new Promise((resolve, reject) => {
    const tx = database.transaction(DRAFT_STORE, mode);
    const request = run(tx.objectStore(DRAFT_STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function buildDraft(snapshot: Snapshot): DocumentDraft {
  return {
    id: slotId,
    filePath: snapshot.filePath,
    fileVersion: snapshot.fileVersion ?? null,
    savedAt: Date.now(),
    elementCount: snapshot.elements.length,
    data: serializeDocument(snapshot.elements, snapshot.appState, snapshot.files),
  };
}

function writeDraft(draft: DocumentDraft) {
  return draftRequest('readwrite', (store) => store.put(draft));
}

function deleteDraft(id: string) {
  return draftRequest('readwrite', (store) => store.delete(id)).catch(() => undefined);
}

/**
 * Offers the newest draft left by another document session (empty and stale
 * ones are cleaned up). Called at startup and after each restore/discard.
 */
export async function refreshPendingDraft() {
  let drafts: DocumentDraft[];
  try {
    drafts = await draftRequest<DocumentDraft[]>('readonly', (store) => store.getAll());
  } catch {
    return;
  }
  const now = Date.now();
  const offered: DocumentDraft[] = [];
  for (const draft of drafts) {
    if (draft.id === slotId) continue;
    if (draft.elementCount === 0 || now - draft.savedAt > DRAFT_MAX_AGE_MS) {
      void deleteDraft(draft.id);
    } else {
      offered.push(draft);
    }
  }
  offered.sort((a, b) => b.savedAt - a.savedAt);
  useAutosaveStore.setState({ pendingDraft: offered[0] ?? null });
}

// --- Saving ---

/**
 * With a vault open, an untitled board becomes `未命名 N.mixnote` in the vault
 * on its first save: no dialog. Returns the new path, or null without a vault.
 */
async function createBoardInVault(snapshot: Snapshot) {
  const { vault, folder } = useVaultStore.getState();
  const platform = await getPlatform();
  if (!vault || !platform.vault) return null;
  const created = await platform.vault.createBoard(
    folder,
    serializeDocument(snapshot.elements, snapshot.appState, snapshot.files),
  );
  void platform.vault.setLastBoard(created.path).catch(() => undefined);
  void useVaultStore.getState().refreshEntries();
  return created;
}

async function persist(snapshot: Snapshot) {
  useAutosaveStore.setState({ status: 'saving' });

  if (isDesktop() && !snapshot.filePath && useVaultStore.getState().vault) {
    if (snapshot.elements.length === 0) {
      // Nothing worth a file yet; don't litter the vault with empty boards.
      useAutosaveStore.setState({ status: 'idle', error: null });
      return;
    }
    try {
      const created = await createBoardInVault(snapshot);
      if (created) {
        const unchanged = isUnchangedSince(snapshot);
        const file = { filePath: created.path, fileVersion: created.version };
        useDocumentStore.setState(unchanged ? { ...file, isDirty: false } : file);
        useAutosaveStore.setState({
          status: unchanged ? 'saved' : 'dirty',
          lastSavedAt: Date.now(),
          error: null,
        });
        return;
      }
    } catch (err) {
      useAutosaveStore.setState({ status: 'error', error: errorMessage(err) });
      await writeDraft(buildDraft(snapshot)).catch(() => undefined);
      return;
    }
  }

  if (isDesktop() && snapshot.filePath) {
    try {
      const platform = await getPlatform();
      const written = await platform.writeDocumentFile(
        snapshot.filePath,
        serializeDocument(snapshot.elements, snapshot.appState, snapshot.files),
        snapshot.fileVersion ?? null,
      );
      // The content on screen is now based on the file as just written.
      if (useDocumentStore.getState().filePath === snapshot.filePath) {
        useDocumentStore.setState({ fileVersion: written.version });
      }
      if (written.otherVersion) {
        // Edited on another Mac meanwhile: both versions are kept.
        const name = getDocumentDisplayName(written.otherVersion);
        useVaultStore.getState().setNotice(`这篇笔记在另一台设备上也被修改过，那个版本已另存为「${name}」`, 'info');
        void useVaultStore.getState().refreshEntries();
      }
      if (isUnchangedSince(snapshot)) {
        useDocumentStore.setState({ isDirty: false });
      }
      useVaultStore.getState().touchEntry(snapshot.filePath);
      useAutosaveStore.setState({
        status: useDocumentStore.getState().isDirty ? 'dirty' : 'saved',
        lastSavedAt: Date.now(),
        error: null,
      });
      return;
    } catch (err) {
      useAutosaveStore.setState({ status: 'error', error: errorMessage(err) });
      // Keep the edit recoverable even though the file write failed.
      await writeDraft(buildDraft(snapshot)).catch(() => undefined);
      return;
    }
  }

  try {
    const draft = buildDraft(snapshot);
    await writeDraft(draft);
    useAutosaveStore.setState({
      status: isUnchangedSince(snapshot) ? 'draft' : 'dirty',
      lastSavedAt: draft.savedAt,
      error: null,
    });
  } catch (err) {
    useAutosaveStore.setState({ status: 'error', error: errorMessage(err) });
  }
}

function runPersist() {
  queue = queue.then(async () => {
    if (!pendingChange || !useDocumentStore.getState().isDirty) return;
    pendingChange = false;
    await persist(takeSnapshot());
  });
  return queue;
}

function cancelTimer() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function schedule() {
  pendingChange = true;
  useAutosaveStore.setState({ status: 'dirty' });
  cancelTimer();
  timer = setTimeout(() => {
    timer = null;
    void runPersist();
  }, AUTOSAVE_DELAY_MS);
}

/** Saves any pending change now instead of waiting for the debounce. */
export function flushAutosave() {
  cancelTimer();
  return runPersist();
}

/**
 * Writes the document to its file now (desktop Cmd+S on a named document).
 * Queued behind any in-flight autosave so an older snapshot can't land last.
 * Resolves to false if the write failed (the error shows in the status).
 */
export function saveToDocumentFile() {
  cancelTimer();
  pendingChange = false;
  queue = queue.then(() => persist(takeSnapshot()));
  return queue.then(() => useAutosaveStore.getState().status !== 'error');
}

/**
 * beforeunload can't await: start the IndexedDB write synchronously so it has
 * the best chance of committing. Returns true if unsaved work was in flight.
 */
function flushDraftOnUnload() {
  if (!pendingChange && useAutosaveStore.getState().status !== 'saving') return false;
  cancelTimer();
  if (pendingChange && db) {
    pendingChange = false;
    db.transaction(DRAFT_STORE, 'readwrite').objectStore(DRAFT_STORE).put(buildDraft(takeSnapshot()));
  }
  return true;
}

function onDocumentChange(
  state: ReturnType<typeof useDocumentStore.getState>,
  prev: ReturnType<typeof useDocumentStore.getState>,
) {
  const contentChanged = state.elements !== prev.elements
    || state.appState !== prev.appState
    || state.files !== prev.files;
  const changed = contentChanged || state.filePath !== prev.filePath;

  if (!state.isDirty) {
    if (contentChanged) {
      // Replaced by open/new/restore. Whatever the previous document left in
      // its slot stays there (offered at next launch); start a fresh slot.
      cancelTimer();
      pendingChange = false;
      slotId = newSlotId();
      useAutosaveStore.setState({ status: 'idle', error: null });
    } else if (prev.isDirty) {
      // Saved to its file: its draft is no longer needed.
      cancelTimer();
      pendingChange = false;
      void deleteDraft(slotId);
      useAutosaveStore.setState({ status: 'saved', lastSavedAt: Date.now(), error: null });
    }
    return;
  }

  if (changed || !prev.isDirty) schedule();
}

// --- Draft restore ---

/** Commits in-progress canvas edits and writes pending changes now. */
export async function settleDocument() {
  flushPendingCanvasInteractionState();
  await flushAutosave();
}

export async function restoreDraft() {
  const draft = useAutosaveStore.getState().pendingDraft;
  if (!draft) return;
  // Save what is open first; replacing it keeps its own draft recoverable.
  await settleDocument();
  const store = useDocumentStore.getState();
  const loaded = store.loadDocument(draft.data);
  if (loaded !== true) {
    useVaultStore.getState().setNotice(loaded === 'newer' ? `无法恢复草稿：${parseFailureMessage(loaded)}` : '草稿已损坏，无法恢复');
    return;
  }
  // Based on the version the draft started from; older drafts don't know it
  // (''), so saving keeps any different file on disk as a copy.
  store.setFilePath(draft.filePath, draft.filePath ? (draft.fileVersion ?? '') : null);
  // Still unsaved: mark dirty so it is saved again (to its file, or as a draft).
  useDocumentStore.setState({ isDirty: true });
  await deleteDraft(draft.id);
  await refreshPendingDraft();
}

export async function discardDraft() {
  const draft = useAutosaveStore.getState().pendingDraft;
  if (!draft) return;
  useAutosaveStore.setState({ pendingDraft: null });
  await deleteDraft(draft.id);
  await refreshPendingDraft();
}

// --- Lifecycle ---

/** Starts autosave; returns a cleanup function. Call once from the app root. */
export function startAutosave() {
  const unsubscribe = useDocumentStore.subscribe(onDocumentChange);
  void refreshPendingDraft();

  const cleanups: Array<() => void> = [unsubscribe];

  if (isDesktop()) {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const keep = (fn: () => void) => {
      if (disposed) fn();
      else unlisteners.push(fn);
    };
    // Tauri awaits this handler before destroying the window.
    void getCurrentWindow()
      .onCloseRequested(async () => {
        await settleDocument();
      })
      .then(keep);
    // Cmd+Q never closes the window, so the Rust side asks for a flush and
    // holds the exit until we answer (or its timeout passes).
    void listen(QUIT_FLUSH_EVENT, async () => {
      try {
        await settleDocument();
      } finally {
        await invoke('quit_flush_done');
      }
    }).then(keep);
    cleanups.push(() => {
      disposed = true;
      for (const fn of unlisteners) fn();
    });
  } else {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      // Commit an in-progress text edit so it lands in the draft.
      flushPendingCanvasInteractionState();
      if (flushDraftOnUnload()) {
        // Ask the browser to confirm, which also gives the write time to land.
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') void settleDocument();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    cleanups.push(() => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    });
  }

  return () => {
    cancelTimer();
    for (const cleanup of cleanups) cleanup();
  };
}
