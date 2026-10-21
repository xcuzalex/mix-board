import { getCurrentWindow } from '@tauri-apps/api/window';
import { create } from 'zustand';
import { getPlatform, isDesktop } from '../platform';
import { useDocumentStore } from '../store/document';
import { useVaultStore } from '../store/vault';
import type { AppState, EmbeddedFile } from '../types/document';
import type { Element } from '../types/element';
import { serializeDocument } from './document-io';

// Autosave only reads store snapshots: it never pushes history or touches
// elements. The one write it makes is clearing `isDirty` after a silent save.

const AUTOSAVE_DELAY_MS = 1500;
const DB_NAME = 'mixboard';
const DB_VERSION = 1;
const DRAFT_STORE = 'drafts';
// One window, one document: a single draft slot is enough.
const DRAFT_KEY = 'current';

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
  savedAt: number;
  elementCount: number;
  data: string;
}

interface AutosaveState {
  status: AutosaveStatus;
  lastSavedAt: number | null;
  error: string | null;
  /** Draft found at startup, waiting for the user to restore or discard it. */
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
}

let timer: ReturnType<typeof setTimeout> | null = null;
let pendingChange = false;
let queue: Promise<void> = Promise.resolve();
let db: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase | null> | null = null;
let draftCheck: Promise<void> | null = null;

function takeSnapshot(): Snapshot {
  const { elements, appState, files, filePath } = useDocumentStore.getState();
  return { elements, appState, files, filePath };
}

function isUnchangedSince(snapshot: Snapshot) {
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
    id: DRAFT_KEY,
    filePath: snapshot.filePath,
    savedAt: Date.now(),
    elementCount: snapshot.elements.length,
    data: serializeDocument(snapshot.elements, snapshot.appState, snapshot.files),
  };
}

function writeDraft(draft: DocumentDraft) {
  return draftRequest('readwrite', (store) => store.put(draft));
}

function deleteDraft() {
  return draftRequest('readwrite', (store) => store.delete(DRAFT_KEY)).catch(() => undefined);
}

function checkForDraft() {
  draftCheck ??= draftRequest<DocumentDraft | undefined>('readonly', (store) => store.get(DRAFT_KEY))
    .then((draft) => {
      if (!draft) return;
      if (draft.elementCount === 0) {
        void deleteDraft();
        return;
      }
      useAutosaveStore.setState({ pendingDraft: draft });
    })
    .catch(() => undefined);
  return draftCheck;
}

// --- Saving ---

/**
 * With a vault open, an untitled board becomes `未命名 N.mixboard` in the vault
 * on its first save: no dialog. Returns the new path, or null without a vault.
 */
async function createBoardInVault(snapshot: Snapshot) {
  const { vault, folder } = useVaultStore.getState();
  const platform = await getPlatform();
  if (!vault || !platform.vault) return null;
  const path = await platform.vault.createBoard(
    folder,
    serializeDocument(snapshot.elements, snapshot.appState, snapshot.files),
  );
  void platform.vault.setLastBoard(path).catch(() => undefined);
  void useVaultStore.getState().refreshEntries();
  return path;
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
      const path = await createBoardInVault(snapshot);
      if (path) {
        const unchanged = isUnchangedSince(snapshot);
        useDocumentStore.setState(unchanged ? { filePath: path, isDirty: false } : { filePath: path });
        useAutosaveStore.setState({
          status: unchanged ? 'saved' : 'dirty',
          lastSavedAt: Date.now(),
          error: null,
        });
        return;
      }
    } catch (err) {
      useAutosaveStore.setState({ status: 'error', error: errorMessage(err) });
      await checkForDraft();
      if (!useAutosaveStore.getState().pendingDraft) {
        await writeDraft(buildDraft(snapshot)).catch(() => undefined);
      }
      return;
    }
  }

  if (isDesktop() && snapshot.filePath) {
    try {
      const platform = await getPlatform();
      await platform.writeDocumentFile(
        snapshot.filePath,
        serializeDocument(snapshot.elements, snapshot.appState, snapshot.files),
      );
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
      await checkForDraft();
      if (!useAutosaveStore.getState().pendingDraft) {
        await writeDraft(buildDraft(snapshot)).catch(() => undefined);
      }
      return;
    }
  }

  await checkForDraft();
  if (useAutosaveStore.getState().pendingDraft) {
    // Don't overwrite a draft the user hasn't decided about yet.
    useAutosaveStore.setState({ status: 'dirty' });
    return;
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
 * Cmd+S for a board that has a file (or will get one in the vault): write it
 * now, in place, even if the debounced save already ran its course.
 */
export function saveNow() {
  if (useDocumentStore.getState().isDirty) pendingChange = true;
  return flushAutosave();
}

/**
 * beforeunload can't await: start the IndexedDB write synchronously so it has
 * the best chance of committing. Returns true if unsaved work was in flight.
 */
function flushDraftOnUnload() {
  if (!pendingChange && useAutosaveStore.getState().status !== 'saving') return false;
  cancelTimer();
  if (pendingChange && db && !useAutosaveStore.getState().pendingDraft) {
    pendingChange = false;
    db.transaction(DRAFT_STORE, 'readwrite').objectStore(DRAFT_STORE).put(buildDraft(takeSnapshot()));
  }
  return true;
}

function onDocumentChange(
  state: ReturnType<typeof useDocumentStore.getState>,
  prev: ReturnType<typeof useDocumentStore.getState>,
) {
  const changed = state.elements !== prev.elements
    || state.appState !== prev.appState
    || state.files !== prev.files
    || state.filePath !== prev.filePath;

  if (!state.isDirty) {
    if (prev.isDirty) {
      // Saved by hand, or replaced by open/new: nothing left to recover.
      cancelTimer();
      pendingChange = false;
      if (!useAutosaveStore.getState().pendingDraft) void deleteDraft();
      if (changed) {
        useAutosaveStore.setState({ status: 'idle', error: null });
      } else {
        useAutosaveStore.setState({ status: 'saved', lastSavedAt: Date.now(), error: null });
      }
    }
    return;
  }

  if (changed || !prev.isDirty) schedule();
}

// --- Draft restore ---

export function restoreDraft() {
  const draft = useAutosaveStore.getState().pendingDraft;
  if (!draft) return;
  const store = useDocumentStore.getState();
  store.loadDocument(draft.data);
  store.setFilePath(draft.filePath);
  // Still unsaved: mark dirty so it is saved again (to its file, or as a draft).
  useDocumentStore.setState({ isDirty: true });
  useAutosaveStore.setState({ pendingDraft: null });
}

export function discardDraft() {
  if (!useAutosaveStore.getState().pendingDraft) return;
  useAutosaveStore.setState({ pendingDraft: null });
  void deleteDraft().then(() => {
    // Edits made while the prompt was open still need a draft.
    if (useDocumentStore.getState().isDirty) schedule();
  });
}

// --- Lifecycle ---

/** Starts autosave; returns a cleanup function. Call once from the app root. */
export function startAutosave() {
  const unsubscribe = useDocumentStore.subscribe(onDocumentChange);
  void checkForDraft();

  const cleanups: Array<() => void> = [unsubscribe];

  if (isDesktop()) {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    // Tauri awaits this handler before destroying the window.
    void getCurrentWindow()
      .onCloseRequested(async () => {
        await flushAutosave();
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    cleanups.push(() => {
      disposed = true;
      unlisten?.();
    });
  } else {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (flushDraftOnUnload()) {
        // Ask the browser to confirm, which also gives the write time to land.
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') void flushAutosave();
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
