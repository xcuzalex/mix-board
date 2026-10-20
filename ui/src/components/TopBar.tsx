import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getPlatform, isDesktop } from '../platform';
import { useDocumentStore } from '../store/document';
import { useUIStore } from '../store/ui';
import { flushPendingCanvasInteractionState } from '../utils/canvas-interaction-flush';
import { exportCurrentBoardAsImage, exportCurrentBoardAsMarkdown, getDocumentDisplayName, saveCurrentDocument } from '../utils/document-io';

const NATIVE_MENU_EVENT = 'mixboard-native-menu';

export function TopBar() {
  const isDesktopApp = isDesktop();
  const desktopWindow = isDesktopApp ? getCurrentWindow() : null;
  const filePath = useDocumentStore((s) => s.filePath);
  const isDirty = useDocumentStore((s) => s.isDirty);
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
  const windowTitle = `${fileName}${isDirty ? ' *' : ''} - MixBoard`;

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
    return null;
  }

  return (
    <div className="absolute inset-x-0 top-0 z-30 h-11 select-none">
      <div
        className="absolute inset-0 border-b border-slate-200 bg-white dark:border-white/10 dark:bg-[#1d1d22]"
      />

      <div className="pointer-events-none relative z-10 flex h-full items-center px-4">
        <div className="flex-1" />

        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="rounded-full border border-slate-200/80 bg-white/84 px-3 py-1 text-xs font-medium text-slate-500 shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-slate-300">
            {fileName}
            {isDirty ? ' *' : ''}
          </div>
        </div>
      </div>
    </div>
  );
}
