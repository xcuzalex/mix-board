import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getPlatform, isDesktop } from '../platform';
import { useDocumentStore } from '../store/document';
import { useUIStore } from '../store/ui';
import { settleDocument, useAutosaveStore, type AutosaveStatus } from '../utils/autosave';
import { useVaultStore } from '../store/vault';
import { flushPendingCanvasInteractionState } from '../utils/canvas-interaction-flush';
import { exportCurrentBoardAsImage, exportCurrentBoardAsMarkdown, getDocumentDisplayName, saveCurrentDocument } from '../utils/document-io';
import { createBoard, openBoard, openLibrary, pickVaultFolder } from '../utils/vault';
import { parseFailureMessage } from '../utils/board-format';

const NATIVE_MENU_EVENT = 'mixnote-native-menu';

const AUTOSAVE_LABELS: Record<AutosaveStatus, string> = {
  idle: '',
  dirty: '已编辑',
  saving: '正在保存…',
  saved: '已保存',
  draft: '草稿已存到本机',
  error: '保存失败',
};

const AUTOSAVE_DOT_CLASSES: Record<AutosaveStatus, string> = {
  idle: 'bg-transparent',
  dirty: 'bg-amber-400',
  saving: 'bg-sky-400 animate-pulse',
  saved: 'bg-emerald-400',
  draft: 'bg-emerald-400',
  error: 'bg-red-500',
};

function formatSavedAt(timestamp: number | null) {
  if (timestamp === null) return '';
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

/** Focus is in a text field, where Cmd+Z / Delete belong to the field. */
function isEditingText() {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

async function openDocumentFile() {
  flushPendingCanvasInteractionState();
  const platform = await getPlatform();
  if (platform.vault) {
    // Desktop: pick a path, then open it like a vault board (saving the current one first).
    const result = await platform.openFile();
    if (result) await openBoard(result.path);
    return;
  }
  const result = await platform.openFile();
  if (!result) return;
  // Save the current board first; replacing it keeps its draft recoverable.
  await settleDocument();
  const doc = useDocumentStore.getState();
  const loaded = doc.loadDocument(result.content);
  if (loaded === true) {
    doc.setFilePath(result.path, null);
  } else {
    useVaultStore.getState().setNotice(`无法打开：${parseFailureMessage(loaded)}`);
  }
}

/** Runs a native-menu action against the current state (read at call time). */
async function runMenuAction(actionId: string) {
  const doc = useDocumentStore.getState();
  const ui = useUIStore.getState();
  const { selectedIds } = ui;
  const boardHidden = useVaultStore.getState().libraryOpen;
  const editsBoard = /^(edit|arrange|insert)\./.test(actionId);

  if (editsBoard && isEditingText()) {
    // Let the focused field handle its own undo/redo.
    if (actionId === 'edit.undo') document.execCommand('undo');
    if (actionId === 'edit.redo') document.execCommand('redo');
    return;
  }
  // The library page covers the board: don't change what can't be seen.
  if (editsBoard && boardHidden) return;

  const edit = (apply: () => void) => {
    if (selectedIds.length === 0) return;
    flushPendingCanvasInteractionState();
    doc.pushHistory();
    apply();
  };

  switch (actionId) {
    case 'file.new': return createBoard();
    case 'file.open': return openDocumentFile();
    case 'file.open_vault': return pickVaultFolder();
    case 'file.library': return openLibrary();
    case 'file.save': return void (await saveCurrentDocument());
    case 'file.export_png': return void (await exportCurrentBoardAsImage());
    case 'file.export_md': return void (await exportCurrentBoardAsMarkdown());
    case 'edit.undo':
      flushPendingCanvasInteractionState();
      return doc.undo();
    case 'edit.redo':
      flushPendingCanvasInteractionState();
      return doc.redo();
    case 'edit.duplicate':
      return edit(() => ui.setSelectedIds(doc.duplicateElements(selectedIds)));
    case 'edit.delete':
      return edit(() => {
        doc.removeElements(selectedIds);
        ui.setSelectedIds([]);
      });
    case 'insert.text': return ui.setActiveTool('text');
    case 'insert.note': return ui.setActiveTool('sticky_note');
    case 'insert.arrow': return ui.setActiveTool('arrow');
    case 'insert.frame': return ui.setActiveTool('frame');
    case 'insert.section': return ui.setActiveTool('section');
    case 'insert.mindmap': return ui.setActiveTool('mindmap');
    case 'insert.image': return ui.setActiveTool('image');
    case 'arrange.forward': return edit(() => doc.bringForward(selectedIds));
    case 'arrange.backward': return edit(() => doc.sendBackward(selectedIds));
    case 'arrange.front': return edit(() => doc.bringToFront(selectedIds));
    case 'arrange.back': return edit(() => doc.sendToBack(selectedIds));
    case 'arrange.group':
      if (selectedIds.length < 2) return;
      return edit(() => doc.groupElements(selectedIds));
    case 'arrange.ungroup': {
      const byId = new Map(doc.elements.map((el) => [el.id, el]));
      if (!selectedIds.some((id) => (byId.get(id)?.groupIds.length ?? 0) > 0)) return;
      return edit(() => doc.ungroupElements(selectedIds));
    }
    case 'view.toggle_grid': return ui.toggleGrid();
    case 'view.toggle_dots': return ui.toggleDots();
    case 'view.reset':
      ui.setZoom(1);
      ui.setViewport(0, 0);
      return;
    default:
  }
}

export function TopBar() {
  const isDesktopApp = isDesktop();
  const filePath = useDocumentStore((s) => s.filePath);
  const isDirty = useDocumentStore((s) => s.isDirty);
  const autosaveStatus = useAutosaveStore((s) => s.status);
  const lastSavedAt = useAutosaveStore((s) => s.lastSavedAt);
  const autosaveError = useAutosaveStore((s) => s.error);

  const fileName = getDocumentDisplayName(filePath);
  // Clean documents show no status, like macOS "— Edited" titles.
  const statusLabel = autosaveStatus === 'idle' && isDirty ? AUTOSAVE_LABELS.dirty : AUTOSAVE_LABELS[autosaveStatus];
  const statusTooltip = autosaveStatus === 'error'
    ? `自动保存失败：${autosaveError ?? '未知错误'}`
    : lastSavedAt !== null ? `上次保存 ${formatSavedAt(lastSavedAt)}` : undefined;
  const libraryOpen = useVaultStore((s) => s.libraryOpen);
  // The note (and its save status), like a document window; the library page
  // covers the note, so it names itself instead.
  const windowTitle = libraryOpen ? '资料库' : `${fileName}${statusLabel ? ` — ${statusLabel}` : ''}`;

  // Subscribe once; actions read the stores when they run, so the listener
  // never holds stale state and can't be registered twice.
  useEffect(() => {
    if (!isDesktopApp) return undefined;
    let disposed = false;
    let unlisten: UnlistenFn | null = null;
    void listen<string>(NATIVE_MENU_EVENT, (event) => {
      runMenuAction(event.payload).catch((err) => {
        useVaultStore.getState().setNotice(`操作失败：${errorMessage(err)}`);
      });
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isDesktopApp]);

  useEffect(() => {
    if (!isDesktopApp) return;
    void getCurrentWindow().setTitle(windowTitle);
  }, [isDesktopApp, windowTitle]);

  if (isDesktopApp) {
    // The native title bar carries the status; only surface failures in-canvas.
    if (autosaveStatus !== 'error') return null;
    return (
      <div className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2 select-none">
        <div
          className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-red-200 bg-white/85 px-3 py-1 text-xs font-medium text-red-600 shadow-sm backdrop-blur-xl dark:border-red-400/30 dark:bg-[#1c1c1e]/85 dark:text-red-300"
          title={statusTooltip}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
          {AUTOSAVE_LABELS.error}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-x-0 top-0 z-30 h-11 select-none">
      <div
        className="absolute inset-0 border-b border-slate-200 bg-white dark:border-white/10 dark:bg-[#1d1d22]"
      />

      <div className="pointer-events-none relative z-10 flex h-full items-center px-4">
        <div className="flex-1" />

        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div
            className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/84 px-3 py-1 text-xs font-medium text-slate-500 shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-slate-300"
            title={statusTooltip}
          >
            <span>{fileName}</span>
            {statusLabel && (
              <>
                <span className="text-slate-300 dark:text-slate-500">—</span>
                <span
                  className={`h-1.5 w-1.5 rounded-full ${AUTOSAVE_DOT_CLASSES[autosaveStatus === 'idle' ? 'dirty' : autosaveStatus]}`}
                  data-autosave-status={autosaveStatus}
                />
                <span className={autosaveStatus === 'error' ? 'text-red-600 dark:text-red-300' : 'text-slate-400 dark:text-slate-400'}>
                  {statusLabel}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
