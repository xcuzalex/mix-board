/**
 * Global keyboard shortcuts for the canvas (Escape / Delete / Tab / Enter mindmap
 * ops, Cmd+Z/A/S/C/V/D/G, layer order, Shift tool keys, single-key tool switches,
 * Space-to-pan). Extracted verbatim from Canvas.tsx (P0.C).
 *
 * The handler closes over a lot of component state; it is threaded in via params.
 * The effect body and dependency array are kept identical to the original so
 * behavior (and re-subscription timing) is unchanged.
 */
import { useEffect, type Dispatch, type SetStateAction, type MutableRefObject } from 'react';
import { useDocumentStore } from '../store/document';
import { useUIStore } from '../store/ui';
import { createElementForTool } from './interaction';
import {
  getMindmapBranchTemplate,
  createMindmapTopic,
  addMindmapChild,
  addMindmapSibling,
} from './mindmap-ops';
import type { SceneIndex } from './linear';
import type { ContextMenuState } from '../components/ContextMenu';
import type { Element, ShapeVariant } from '../types/element';
import type { ToolType } from '../types/tool';

type MindmapNodeRef = { elementId: string; nodeId: string };

export interface CanvasShortcutsParams {
  selectedIds: string[];
  elements: Element[];
  editingElement: Element | null;
  editingMindmapNode: MindmapNodeRef | null;
  selectedMindmapNode: MindmapNodeRef | null;
  spaceRef: MutableRefObject<boolean>;
  sceneIndexRef: MutableRefObject<SceneIndex>;
  finishEditing: () => void;
  pushHistory: () => void;
  setSelectedIds: (ids: string[]) => void;
  setSelectedMindmapNode: (value: MindmapNodeRef | null) => void;
  setContextMenu: Dispatch<SetStateAction<ContextMenuState>>;
  setActiveTool: (tool: ToolType) => void;
  setActiveShapeVariant: (variant: ShapeVariant) => void;
  setCursorStyle: (style: string) => void;
  handleSave: () => void;
  handleCopy: () => void;
  handlePaste: () => void;
  handleDuplicate: () => void;
  handleDelete: () => void;
  handleExportPNG: () => void;
  commitPendingElementUpdates: () => void;
  bringToFront: (ids: string[]) => void;
  sendToBack: (ids: string[]) => void;
  bringForward: (ids: string[]) => void;
  sendBackward: (ids: string[]) => void;
  groupElements: (ids: string[]) => string;
  ungroupElements: (ids: string[]) => void;
  addElement: (element: Element) => void;
  updateElement: (id: string, updates: Partial<Element>) => void;
  startTextEditing: (el: Element) => void;
}

export function useCanvasShortcuts(params: CanvasShortcutsParams) {
  const {
    selectedIds,
    elements,
    editingElement,
    editingMindmapNode,
    selectedMindmapNode,
    spaceRef,
    sceneIndexRef,
    finishEditing,
    pushHistory,
    setSelectedIds,
    setSelectedMindmapNode,
    setContextMenu,
    setActiveTool,
    setActiveShapeVariant,
    setCursorStyle,
    handleSave,
    handleCopy,
    handlePaste,
    handleDuplicate,
    handleDelete,
    handleExportPNG,
    commitPendingElementUpdates,
    bringToFront,
    sendToBack,
    bringForward,
    sendBackward,
    groupElements,
    ungroupElements,
    addElement,
    updateElement,
    startTextEditing,
  } = params;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when focus is in an input / textarea / contenteditable
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      // Space/Enter on a focused button activate the button, not the canvas.
      if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) {
        return;
      }

      // Don't intercept shortcuts when the target is inside an overlay panel (e.g. AI chat)
      if ((e.target as HTMLElement)?.closest?.('[data-overlay-panel]')) {
        return;
      }
      // Also skip if text is selected inside an overlay panel (copy support)
      const sel = window.getSelection();
      if (sel && sel.toString() && sel.anchorNode) {
        const anchor = sel.anchorNode instanceof HTMLElement
          ? sel.anchorNode
          : sel.anchorNode.parentElement;
        if (anchor?.closest('[data-overlay-panel]')) {
          return;
        }
      }

      // Don't handle shortcuts when editing text
      if (editingElement || editingMindmapNode) {
        if (e.key === 'Escape') {
          finishEditing();
          e.preventDefault();
        }
        return;
      }

      // Space for pan
      if (e.code === 'Space' && !e.repeat) {
        spaceRef.current = true;
        setCursorStyle('grab');
        e.preventDefault();
        return;
      }

      // Escape
      if (e.key === 'Escape') {
        setSelectedIds([]);
        setSelectedMindmapNode(null);
        setContextMenu({ show: false, x: 0, y: 0 });
        return;
      }

      // Delete
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0) {
        handleDelete();
        return;
      }

      // Tab: create adjacent sticky note (when a sticky note is selected)
      if (e.key === 'Tab' && selectedIds.length === 1) {
        const sel = sceneIndexRef.current.byId.get(selectedIds[0]);
        if (sel && sel.type === 'sticky_note') {
          e.preventDefault();
          commitPendingElementUpdates();
          const newEl = createElementForTool(
            'sticky_note',
            sel.x + sel.width + 20,
            sel.y,
          );
          if (newEl) {
            newEl.width = sel.width;
            newEl.height = sel.height;
            (newEl as any).noteColor = (sel as any).noteColor;
            (newEl as any).fontSize = (sel as any).fontSize;
            pushHistory();
            addElement(newEl);
            setSelectedIds([newEl.id]);
            setSelectedMindmapNode(null);
            startTextEditing(newEl);
          }
          return;
        }

        // Tab on mindmap: add child node
        if (sel && sel.type === 'mindmap') {
          e.preventDefault();
          commitPendingElementUpdates();
          pushHistory();
          const targetNodeId = selectedMindmapNode?.elementId === sel.id
            ? selectedMindmapNode.nodeId
            : sel.rootNode.id;
          const newNode = createMindmapTopic('leaf', getMindmapBranchTemplate(sel.rootNode));
          updateElement(sel.id, {
            rootNode: addMindmapChild(sel.rootNode, targetNodeId, newNode),
          } as any);
          setSelectedMindmapNode({ elementId: sel.id, nodeId: newNode.id });
          return;
        }
      }

      // Enter on mindmap: add sibling node
      if (e.key === 'Enter' && selectedIds.length === 1 && !e.metaKey && !e.ctrlKey) {
        const sel = sceneIndexRef.current.byId.get(selectedIds[0]);
        if (sel && sel.type === 'mindmap') {
          e.preventDefault();
          commitPendingElementUpdates();
          pushHistory();
          const targetNodeId = selectedMindmapNode?.elementId === sel.id
            ? selectedMindmapNode.nodeId
            : sel.rootNode.id;
          const newNode = createMindmapTopic('branch', getMindmapBranchTemplate(sel.rootNode));
          updateElement(sel.id, {
            rootNode: addMindmapSibling(sel.rootNode, targetNodeId, newNode),
          } as any);
          setSelectedMindmapNode({ elementId: sel.id, nodeId: newNode.id });
          return;
        }
      }

      // Ctrl/Cmd shortcuts
      if (e.metaKey || e.ctrlKey) {
        // With Shift held e.key is the shifted character ('}' for ']', 'Z' for
        // 'z' in some engines), so match the physical bracket keys and lowercase letters.
        const key = e.code === 'BracketRight' ? ']' : e.code === 'BracketLeft' ? '[' : e.key.toLowerCase();
        switch (key) {
          case 'z':
            commitPendingElementUpdates();
            if (e.shiftKey) {
              useDocumentStore.getState().redo();
            } else {
              useDocumentStore.getState().undo();
            }
            e.preventDefault();
            return;
          case 'a':
            setSelectedIds(elements.map(el => el.id));
            setSelectedMindmapNode(null);
            e.preventDefault();
            return;
          case 's':
            handleSave();
            e.preventDefault();
            return;
          case 'c':
            handleCopy();
            e.preventDefault();
            return;
          case 'v':
            handlePaste();
            e.preventDefault();
            return;
          case 'd':
            handleDuplicate();
            e.preventDefault();
            return;
          case 'g':
            if (selectedIds.length > 1) {
              commitPendingElementUpdates();
              if (e.shiftKey) {
                pushHistory();
                ungroupElements(selectedIds);
              } else {
                pushHistory();
                groupElements(selectedIds);
              }
            }
            e.preventDefault();
            return;
          case 'e':
            if (e.shiftKey) {
              handleExportPNG();
              e.preventDefault();
            }
            return;
          case ']':
            if (selectedIds.length > 0) {
              commitPendingElementUpdates();
              pushHistory();
              if (e.shiftKey) {
                bringToFront(selectedIds);
              } else {
                bringForward(selectedIds);
              }
            }
            e.preventDefault();
            return;
          case '[':
            if (selectedIds.length > 0) {
              commitPendingElementUpdates();
              pushHistory();
              if (e.shiftKey) {
                sendToBack(selectedIds);
              } else {
                sendBackward(selectedIds);
              }
            }
            e.preventDefault();
            return;
        }
      }

      // Shift tool shortcuts
      if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        switch (e.key) {
          case 'P': setActiveTool('highlighter'); e.preventDefault(); return;
          case 'S': setActiveTool('section'); e.preventDefault(); return;
          case 'G': useUIStore.getState().toggleGrid(); e.preventDefault(); return;
        }
      }

      // Tool shortcuts (no modifiers)
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        switch (e.key.toLowerCase()) {
          case 'v': setActiveTool('select'); break;
          case 'h': setActiveTool('hand'); break;
          case 'r': setActiveTool('rectangle'); setActiveShapeVariant('round_rectangle'); break;
          case 'o': setActiveTool('ellipse'); setActiveShapeVariant('ellipse'); break;
          case 'd': setActiveTool('diamond'); setActiveShapeVariant('diamond'); break;
          case 'l': setActiveTool('line'); break;
          case 'a': setActiveTool('arrow'); break;
          case 't': setActiveTool('text'); break;
          case 'n': setActiveTool('sticky_note'); break;
          case 'p': setActiveTool('freedraw'); break;
          case 'i': setActiveTool('image'); break;
          case 'm': setActiveTool('mindmap'); break;
          case 'f': setActiveTool('frame'); break;
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceRef.current = false;
        setCursorStyle('default');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    selectedIds,
    elements,
    editingElement,
    editingMindmapNode,
    finishEditing,
    pushHistory,
    setSelectedIds,
    setActiveTool,
    setActiveShapeVariant,
    setCursorStyle,
    handleSave,
    handleCopy,
    handlePaste,
    handleDuplicate,
    handleDelete,
    handleExportPNG,
    commitPendingElementUpdates,
    bringToFront,
    sendToBack,
    bringForward,
    sendBackward,
    groupElements,
    ungroupElements,
    selectedMindmapNode,
  ]);
}
