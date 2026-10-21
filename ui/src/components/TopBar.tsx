import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getPlatform, isDesktop } from '../platform';
import { useDocumentStore } from '../store/document';
import { useUIStore } from '../store/ui';
import { useAutosaveStore, type AutosaveStatus } from '../utils/autosave';
import { flushPendingCanvasInteractionState } from '../utils/canvas-interaction-flush';
import { exportCurrentBoardAsImage, exportCurrentBoardAsMarkdown, getDocumentDisplayName, saveCurrentDocument } from '../utils/document-io';

const NATIVE_MENU_EVENT = 'mixboard-native-menu';

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

export function TopBar() {
  const isDesktopApp = isDesktop();
  const desktopWindow = isDesktopApp ? getCurrentWindow() : null;
  const filePath = useDocumentStore((s) => s.filePath);
  const isDirty = useDocumentStore((s) => s.isDirty);
  const autosaveStatus = useAutosaveStore((s) => s.status);
  const lastSavedAt = useAutosaveStore((s) => s.lastSavedAt);
  const autosaveError = useAutosaveStore((s) => s.error);
  const loadDocument = useDocumentStore((s) => s.loadDocument);
  const newDocument = useDocumentStore((s) => s.newDocument);
  const setFilePath = useDocumentStore((s) => s.setFilePath);
  const pushHistory = useDocumentStore((s) => s.pushHistory);
  const removeElements = useDocumentStore((s) => s.removeElements);
  const duplicateElements = useDocumentStore((s) => s.duplicateElements);
  const undo = useDocumentStore((s) => s.undo);
  const redo = useDocumentStore((s) => s.redo);
  const bringToFront = useDocumentStore((s) => s.bringToFront);
  const sendToBack = useDocumentStore((s) => s.sendToBack);
  const bringForward = useDocumentStore((s) => s.bringForward);
  const sendBackward = useDocumentStore((s) => s.sendBackward);
  const groupElements = useDocumentStore((s) => s.groupElements);
  const ungroupElements = useDocumentStore((s) => s.ungroupElements);

  const selectedIds = useUIStore((s) => s.selectedIds);
  const canUngroup = useDocumentStore((s) =>
    selectedIds.some((selectedId) => {
      const element = s.elements.find((candidate) => candidate.id === selectedId);
      return element !== undefined && element.groupIds.length > 0;
    }),
  );
  const setSelectedIds = useUIStore((s) => s.setSelectedIds);
  const setActiveTool = useUIStore((s) => s.setActiveTool);
  const toggleGrid = useUIStore((s) => s.toggleGrid);
  const setViewport = useUIStore((s) => s.setViewport);
  const setZoom = useUIStore((s) => s.setZoom);

  const fileName = getDocumentDisplayName(filePath);
  const canGroup = selectedIds.length > 1;
  // Clean documents show no status, like macOS "— Edited" titles.
  const statusLabel = autosaveStatus === 'idle' && isDirty ? AUTOSAVE_LABELS.dirty : AUTOSAVE_LABELS[autosaveStatus];
  const statusTooltip = autosaveStatus === 'error'
    ? `自动保存失败：${autosaveError ?? '未知错误'}`
    : lastSavedAt !== null ? `上次保存 ${formatSavedAt(lastSavedAt)}` : undefined;
  const windowTitle = `${fileName}${statusLabel ? ` — ${statusLabel}` : ''} - MixBoard`;

  const handleOpen = async () => {
    flushPendingCanvasInteractionState();
    const platform = await getPlatform();
    const result = await platform.openFile();
    if (result) {
      loadDocument(result.content);
      setFilePath(result.path);
    }
  };

  useEffect(() => {
    if (!isDesktopApp) return undefined;

    let unlisten: UnlistenFn | null = null;

    const runMenuAction = async (actionId: string) => {
      switch (actionId) {
        case 'file.new':
          flushPendingCanvasInteractionState();
          newDocument();
          return;
        case 'file.open':
          await handleOpen();
          return;
        case 'file.save':
          await saveCurrentDocument();
          return;
        case 'file.export_png':
          await exportCurrentBoardAsImage();
          return;
        case 'file.export_md':
          await exportCurrentBoardAsMarkdown();
          return;
        case 'edit.undo':
          flushPendingCanvasInteractionState();
          undo();
          return;
        case 'edit.redo':
          flushPendingCanvasInteractionState();
          redo();
          return;
        case 'edit.duplicate':
          if (selectedIds.length === 0) return;
          flushPendingCanvasInteractionState();
          pushHistory();
          setSelectedIds(duplicateElements(selectedIds));
          return;
        case 'edit.delete':
          if (selectedIds.length === 0) return;
          flushPendingCanvasInteractionState();
          pushHistory();
          removeElements(selectedIds);
          setSelectedIds([]);
          return;
        case 'insert.text':
          setActiveTool('text');
          return;
        case 'insert.note':
          setActiveTool('sticky_note');
          return;
        case 'insert.arrow':
          setActiveTool('arrow');
          return;
        case 'insert.frame':
          setActiveTool('frame');
          return;
        case 'insert.section':
          setActiveTool('section');
          return;
        case 'insert.mindmap':
          setActiveTool('mindmap');
          return;
        case 'insert.image':
          setActiveTool('image');
          return;
        case 'arrange.forward':
          if (selectedIds.length === 0) return;
          flushPendingCanvasInteractionState();
          pushHistory();
          bringForward(selectedIds);
          return;
        case 'arrange.backward':
          if (selectedIds.length === 0) return;
          flushPendingCanvasInteractionState();
          pushHistory();
          sendBackward(selectedIds);
          return;
        case 'arrange.front':
          if (selectedIds.length === 0) return;
          flushPendingCanvasInteractionState();
          pushHistory();
          bringToFront(selectedIds);
          return;
        case 'arrange.back':
          if (selectedIds.length === 0) return;
          flushPendingCanvasInteractionState();
          pushHistory();
          sendToBack(selectedIds);
          return;
        case 'arrange.group':
          if (!canGroup) return;
          flushPendingCanvasInteractionState();
          pushHistory();
          groupElements(selectedIds);
          return;
        case 'arrange.ungroup':
          if (!canUngroup) return;
          flushPendingCanvasInteractionState();
          pushHistory();
          ungroupElements(selectedIds);
          return;
        case 'view.toggle_grid':
          toggleGrid();
          return;
        case 'view.toggle_dots':
          useUIStore.getState().toggleDots();
          return;
        case 'view.reset':
          setZoom(1);
          setViewport(0, 0);
          return;
        case 'help.about':
          return;
        default:
      }
    };

    void listen<string>(NATIVE_MENU_EVENT, (event) => {
      void runMenuAction(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [
    isDesktopApp,
    newDocument,
    selectedIds,
    canGroup,
    canUngroup,
    pushHistory,
    duplicateElements,
    removeElements,
    undo,
    redo,
    setSelectedIds,
    setActiveTool,
    bringForward,
    sendBackward,
    bringToFront,
    sendToBack,
    groupElements,
    ungroupElements,
    toggleGrid,
    setZoom,
    setViewport,
  ]);

  useEffect(() => {
    if (!desktopWindow) return;
    void desktopWindow.setTitle(windowTitle);
  }, [desktopWindow, windowTitle]);

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
