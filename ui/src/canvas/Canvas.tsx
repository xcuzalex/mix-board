import { useRef, useEffect, useCallback, useState } from 'react';
import { useDocumentStore } from '../store/document';
import { useUIStore } from '../store/ui';
import { Renderer } from './renderer';
import { Viewport } from './viewport';
import { hitTest } from './hit-test';
import {
  createInteractionState,
  handlePointerDown,
  handlePointerMove,
  getElementsInSelectionBox,
  createElementForTool,
} from './interaction';
import { ContextMenu, type ContextMenuState } from '../components/ContextMenu';
import { loadImageToCache } from './renderer';
import { generateId } from '../utils/id';
import { findNearestBindableElement, getLinearAbsolutePoints, getConnectionPoints, isConnectableElement, normalizeLinearPoints } from './linear';
import { getElementShapeVariant } from './shape-utils';
import type { Element, ImageElement, LinearElement, MindmapElement, MindmapNode } from '../types/element';
import { STICKY_NOTE_COLORS } from '../utils/color';
import { exportCurrentBoardAsImage, saveCurrentDocument } from '../utils/document-io';

const viewport = new Viewport();
const interactionState = createInteractionState();

// Module-level clipboard
let clipboard: Element[] = [];

const EDIT_PLACEHOLDERS = new Set(['输入文本', '中心主题', '新主题', '分区', '框架']);

function getEditableDraft(text: string) {
  const content = text.trim();
  if (!content) return '';
  return EDIT_PLACEHOLDERS.has(content) || /^分支\s+\d+$/.test(content) ? '' : text;
}

function getMindmapBranchTemplate(root: MindmapNode) {
  const sample = root.children[0] ?? root.rightChildren?.[0] ?? root.leftChildren?.[0];
  return {
    nodeShape: sample?.nodeShape ?? 'rounded_rect',
    backgroundColor: sample?.backgroundColor ?? '#E7F5EE',
    textColor: sample?.textColor ?? '#234032',
    fontSize: sample?.fontSize ?? 14,
  };
}

function createMindmapTopic(
  nodeType: 'branch' | 'leaf' = 'branch',
  template?: Partial<Pick<MindmapNode, 'nodeShape' | 'backgroundColor' | 'textColor' | 'fontSize'>>,
): MindmapNode {
  return {
    id: generateId(),
    text: '新主题',
    nodeType,
    nodeShape: template?.nodeShape ?? 'rounded_rect',
    backgroundColor: template?.backgroundColor ?? '#E7F5EE',
    textColor: template?.textColor ?? '#234032',
    fontSize: template?.fontSize ?? 14,
    collapsed: false,
    children: [],
    leftChildren: [],
    rightChildren: [],
  };
}

function findMindmapNode(root: MindmapNode, nodeId: string): MindmapNode | null {
  if (root.id === nodeId) return root;
  const children = [...root.children, ...(root.leftChildren || []), ...(root.rightChildren || [])];
  for (const child of children) {
    const result = findMindmapNode(child, nodeId);
    if (result) return result;
  }
  return null;
}

function visitMindmapNodes(root: MindmapNode, visit: (node: MindmapNode) => void) {
  visit(root);
  const children = [...root.children, ...(root.leftChildren || []), ...(root.rightChildren || [])];
  for (const child of children) {
    visitMindmapNodes(child, visit);
  }
}

function updateMindmapNodeText(root: MindmapNode, nodeId: string, text: string): MindmapNode {
  if (root.id === nodeId) {
    return { ...root, text };
  }

  return {
    ...root,
    children: root.children.map((child) => updateMindmapNodeText(child, nodeId, text)),
    leftChildren: (root.leftChildren || []).map((child) => updateMindmapNodeText(child, nodeId, text)),
    rightChildren: (root.rightChildren || []).map((child) => updateMindmapNodeText(child, nodeId, text)),
  };
}

function addMindmapChild(root: MindmapNode, parentId: string, node: MindmapNode): MindmapNode {
  if (root.id === parentId) {
    return {
      ...root,
      collapsed: false,
      children: [...root.children, node],
    };
  }

  return {
    ...root,
    children: root.children.map((child) => addMindmapChild(child, parentId, node)),
    leftChildren: (root.leftChildren || []).map((child) => addMindmapChild(child, parentId, node)),
    rightChildren: (root.rightChildren || []).map((child) => addMindmapChild(child, parentId, node)),
  };
}

function addMindmapSibling(root: MindmapNode, targetId: string, node: MindmapNode): MindmapNode {
  const insertInto = (nodes: MindmapNode[]): [MindmapNode[], boolean] => {
    let inserted = false;
    const nextNodes = nodes.flatMap((current) => {
      if (current.id === targetId) {
        inserted = true;
        return [current, node];
      }

      const [nextChildren, insertedInChildren] = insertInto(current.children);
      const [nextLeftChildren, insertedInLeftChildren] = insertInto(current.leftChildren || []);
      const [nextRightChildren, insertedInRightChildren] = insertInto(current.rightChildren || []);

      if (insertedInChildren || insertedInLeftChildren || insertedInRightChildren) {
        inserted = true;
        return [{
          ...current,
          children: nextChildren,
          leftChildren: nextLeftChildren,
          rightChildren: nextRightChildren,
        }];
      }

      return [current];
    });

    return [nextNodes, inserted];
  };

  if (root.id === targetId) {
    return {
      ...root,
      collapsed: false,
      children: [...root.children, node],
    };
  }

  const [children, insertedInChildren] = insertInto(root.children);
  const [leftChildren, insertedInLeftChildren] = insertInto(root.leftChildren || []);
  const [rightChildren, insertedInRightChildren] = insertInto(root.rightChildren || []);

  if (insertedInChildren || insertedInLeftChildren || insertedInRightChildren) {
    return {
      ...root,
      children,
      leftChildren,
      rightChildren,
    };
  }

  return root;
}

function extractMindmapNode(root: MindmapNode, nodeId: string): { root: MindmapNode; extracted: MindmapNode | null } {
  const extractFromList = (nodes: MindmapNode[]): { nodes: MindmapNode[]; extracted: MindmapNode | null } => {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (node.id === nodeId) {
        return { nodes: [...nodes.slice(0, index), ...nodes.slice(index + 1)], extracted: node };
      }

      const nextChildren = extractFromList(node.children);
      if (nextChildren.extracted) {
        return {
          nodes: [
            ...nodes.slice(0, index),
            { ...node, children: nextChildren.nodes },
            ...nodes.slice(index + 1),
          ],
          extracted: nextChildren.extracted,
        };
      }

      const nextLeftChildren = extractFromList(node.leftChildren || []);
      if (nextLeftChildren.extracted) {
        return {
          nodes: [
            ...nodes.slice(0, index),
            { ...node, leftChildren: nextLeftChildren.nodes },
            ...nodes.slice(index + 1),
          ],
          extracted: nextLeftChildren.extracted,
        };
      }

      const nextRightChildren = extractFromList(node.rightChildren || []);
      if (nextRightChildren.extracted) {
        return {
          nodes: [
            ...nodes.slice(0, index),
            { ...node, rightChildren: nextRightChildren.nodes },
            ...nodes.slice(index + 1),
          ],
          extracted: nextRightChildren.extracted,
        };
      }
    }

    return { nodes, extracted: null };
  };

  if (root.id === nodeId) {
    return { root, extracted: null };
  }

  const nextChildren = extractFromList(root.children);
  if (nextChildren.extracted) {
    return { root: { ...root, children: nextChildren.nodes }, extracted: nextChildren.extracted };
  }

  const nextLeftChildren = extractFromList(root.leftChildren || []);
  if (nextLeftChildren.extracted) {
    return { root: { ...root, leftChildren: nextLeftChildren.nodes }, extracted: nextLeftChildren.extracted };
  }

  const nextRightChildren = extractFromList(root.rightChildren || []);
  if (nextRightChildren.extracted) {
    return { root: { ...root, rightChildren: nextRightChildren.nodes }, extracted: nextRightChildren.extracted };
  }

  return { root, extracted: null };
}

function moveMindmapNode(root: MindmapNode, nodeId: string, targetParentId: string): MindmapNode {
  if (root.id === nodeId || nodeId === targetParentId) return root;

  const draggedNode = findMindmapNode(root, nodeId);
  if (!draggedNode || findMindmapNode(draggedNode, targetParentId)) {
    return root;
  }

  const { root: withoutNode, extracted } = extractMindmapNode(root, nodeId);
  if (!extracted) return root;

  return addMindmapChild(withoutNode, targetParentId, extracted);
}

function getShapeTextInsets(el: Element, zoom: number) {
  const variant = getElementShapeVariant(el);
  const width = el.width * zoom;
  const height = el.height * zoom;

  const inset = {
    left: 10 * zoom,
    right: 10 * zoom,
    top: 8 * zoom,
    bottom: 8 * zoom,
  };

  switch (variant) {
    case 'ellipse':
      inset.left = inset.right = Math.max(width * 0.2, 12 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.16, 8 * zoom);
      break;
    case 'diamond':
      inset.left = inset.right = Math.max(width * 0.24, 12 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.2, 10 * zoom);
      break;
    case 'triangle':
      inset.left = inset.right = Math.max(width * 0.18, 10 * zoom);
      inset.top = Math.max(height * 0.22, 12 * zoom);
      inset.bottom = Math.max(height * 0.12, 8 * zoom);
      break;
    case 'hexagon':
    case 'parallelogram':
    case 'manual_input':
      inset.left = inset.right = Math.max(width * 0.16, 12 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.12, 8 * zoom);
      break;
    case 'octagon':
    case 'trapezoid':
    case 'display':
    case 'weak_entity':
      inset.left = inset.right = Math.max(width * 0.14, 12 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.14, 8 * zoom);
      break;
    case 'delay':
      inset.left = Math.max(width * 0.12, 10 * zoom);
      inset.right = Math.max(width * 0.24, 18 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.16, 10 * zoom);
      break;
    case 'star':
    case 'cloud':
    case 'actor':
      inset.left = inset.right = Math.max(width * 0.18, 14 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.18, 12 * zoom);
      break;
    case 'speech_bubble':
      inset.left = inset.right = Math.max(width * 0.12, 10 * zoom);
      inset.top = Math.max(height * 0.12, 8 * zoom);
      inset.bottom = Math.max(height * 0.22, 16 * zoom);
      break;
    case 'arrow_left':
      inset.left = Math.max(width * 0.28, 22 * zoom);
      inset.right = Math.max(width * 0.12, 10 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.16, 8 * zoom);
      break;
    case 'arrow_right':
      inset.left = Math.max(width * 0.12, 10 * zoom);
      inset.right = Math.max(width * 0.28, 22 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.16, 8 * zoom);
      break;
    case 'double_arrow':
      inset.left = inset.right = Math.max(width * 0.24, 20 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.16, 8 * zoom);
      break;
    case 'plus':
      inset.left = inset.right = Math.max(width * 0.18, 14 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.18, 14 * zoom);
      break;
    case 'document':
    case 'multi_document':
    case 'cylinder':
    case 'package':
    case 'component':
    case 'class_box':
    case 'predefined_process':
    case 'internal_storage':
      inset.left = inset.right = Math.max(width * 0.12, 10 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.14, 8 * zoom);
      break;
    case 'weak_relationship':
      inset.left = inset.right = Math.max(width * 0.22, 14 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.2, 12 * zoom);
      break;
    case 'sync_bar':
      inset.left = inset.right = Math.max(width * 0.08, 8 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.24, 12 * zoom);
      break;
    case 'start_state':
    case 'end_state':
      inset.left = inset.right = Math.max(width * 0.22, 14 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.22, 14 * zoom);
      break;
    default:
      break;
  }

  return inset;
}

export function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const renderSceneRef = useRef<() => void>(() => {});
  const actionRef = useRef<string>('none');
  const cursorRef = useRef<string>('default');
  const panStartRef = useRef({ x: 0, y: 0 });
  const spaceRef = useRef(false);
  const selectionBoxRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const snapGuidesRef = useRef<Array<{ type: 'vertical' | 'horizontal'; position: number }>>([]);
  const [resizeInfo, setResizeInfo] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const mindmapNodeDragRef = useRef<{ elementId: string; nodeId: string } | null>(null);
  const mindmapDropTargetRef = useRef<{ elementId: string; nodeId: string } | null>(null);

  // Text editing state
  const [editingElement, setEditingElement] = useState<Element | null>(null);
  const [editingMindmapNode, setEditingMindmapNode] = useState<{ elementId: string; nodeId: string } | null>(null);
  const [selectedMindmapNode, setSelectedMindmapNode] = useState<{ elementId: string; nodeId: string } | null>(null);
  const [hoveredConnectableId, setHoveredConnectableId] = useState<string | null>(null);
  const [hoveredConnectionElementId, setHoveredConnectionElementId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ show: false, x: 0, y: 0 });

  const elements = useDocumentStore((s) => s.elements);
  const appState = useDocumentStore((s) => s.appState);
  const addElement = useDocumentStore((s) => s.addElement);
  const addEmbeddedFile = useDocumentStore((s) => s.addEmbeddedFile);
  const updateElement = useDocumentStore((s) => s.updateElement);
  const pushHistory = useDocumentStore((s) => s.pushHistory);
  const removeElements = useDocumentStore((s) => s.removeElements);
  const duplicateElements = useDocumentStore((s) => s.duplicateElements);
  const bringToFront = useDocumentStore((s) => s.bringToFront);
  const sendToBack = useDocumentStore((s) => s.sendToBack);
  const bringForward = useDocumentStore((s) => s.bringForward);
  const sendBackward = useDocumentStore((s) => s.sendBackward);
  const groupElements = useDocumentStore((s) => s.groupElements);
  const ungroupElements = useDocumentStore((s) => s.ungroupElements);

  const activeTool = useUIStore((s) => s.activeTool);
  const activeShapeVariant = useUIStore((s) => s.activeShapeVariant);
  const selectedIds = useUIStore((s) => s.selectedIds);
  const setSelectedIds = useUIStore((s) => s.setSelectedIds);
  const setActiveTool = useUIStore((s) => s.setActiveTool);
  const setActiveShapeVariant = useUIStore((s) => s.setActiveShapeVariant);
  const zoom = useUIStore((s) => s.zoom);
  const viewportX = useUIStore((s) => s.viewportX);
  const viewportY = useUIStore((s) => s.viewportY);
  const setViewport = useUIStore((s) => s.setViewport);
  const setZoom = useUIStore((s) => s.setZoom);
  const showGrid = useUIStore((s) => s.showGrid);
  const cursorStyle = useUIStore((s) => s.cursorStyle);
  const setCursorStyle = useUIStore((s) => s.setCursorStyle);
  cursorRef.current = cursorStyle;
  const freedrawColor = useUIStore((s) => s.freedrawColor);
  const highlighterColor = useUIStore((s) => s.highlighterColor);

  // Sync viewport with store
  useEffect(() => {
    viewport.update(viewportX, viewportY, zoom);
  }, [viewportX, viewportY, zoom]);

  // Render function
  const renderScene = useCallback(() => {
    rendererRef.current?.render(
      elements,
      selectedIds,
      appState.viewBackgroundColor,
      showGrid,
      appState.gridSize,
      interactionState.activeElement,
      selectionBoxRef.current,
      snapGuidesRef.current,
      hoveredConnectableId,
      activeTool,
      selectedMindmapNode,
      hoveredConnectionElementId,
      editingElement?.id ?? editingMindmapNode?.elementId ?? null,
      editingMindmapNode?.nodeId ?? null,
      mindmapDropTargetRef.current,
      actionRef.current === 'mindmap-node-drag' && mindmapNodeDragRef.current
        ? {
            elementId: mindmapNodeDragRef.current.elementId,
            sourceNodeId: mindmapNodeDragRef.current.nodeId,
            pointerX: interactionState.currentX,
            pointerY: interactionState.currentY,
            offsetX: interactionState.currentX - interactionState.startX,
            offsetY: interactionState.currentY - interactionState.startY,
          }
        : null,
    );
  }, [
    elements,
    selectedIds,
    appState.viewBackgroundColor,
    appState.gridSize,
    showGrid,
    hoveredConnectableId,
    activeTool,
    selectedMindmapNode,
    hoveredConnectionElementId,
      editingElement,
      editingMindmapNode,
  ]);

  useEffect(() => {
    renderSceneRef.current = renderScene;
  }, [renderScene]);

  // Setup canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    rendererRef.current = new Renderer(ctx, viewport);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      rendererRef.current?.setSize(rect.width, rect.height);
      renderSceneRef.current();
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Re-render when state changes (no continuous RAF loop)
  useEffect(() => {
    renderScene();
  }, [renderScene]);

  // Also re-render when viewport changes
  useEffect(() => {
    viewport.update(viewportX, viewportY, zoom);
    renderScene();
  }, [viewportX, viewportY, zoom, renderScene]);

  // --- Text editing helpers ---

  const startTextEditing = useCallback((el: Element) => {
    const editableTypes = ['text', 'sticky_note', 'section', 'frame', 'rectangle', 'ellipse', 'diamond', 'triangle'];
    if (!editableTypes.includes(el.type)) return;
    setEditingMindmapNode(null);
    setEditingElement(el);
    const isContainer = el.type === 'section' || el.type === 'frame';
    const content = isContainer ? (el as any).title || '' : (el as any).text || '';
    setEditText(getEditableDraft(content));
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  const startMindmapNodeEditing = useCallback((elementId: string, nodeId: string, text: string) => {
    setEditingElement(null);
    setEditingMindmapNode({ elementId, nodeId });
    setEditText(getEditableDraft(text));
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  const finishEditing = useCallback(() => {
    if (editingElement) {
      pushHistory();
      const isContainer = editingElement.type === 'section' || editingElement.type === 'frame';
      updateElement(editingElement.id, (isContainer ? { title: editText } : { text: editText, fontSize: (editingElement as any).fontSize || 16 }) as any);
    } else if (editingMindmapNode) {
      const element = elements.find((candidate) => candidate.id === editingMindmapNode.elementId);
      if (element?.type === 'mindmap') {
        pushHistory();
        updateElement(element.id, {
          rootNode: updateMindmapNodeText(element.rootNode, editingMindmapNode.nodeId, editText),
        } as any);
      }
    }

    setEditingElement(null);
    setEditingMindmapNode(null);
    setEditText('');
  }, [editingElement, editingMindmapNode, editText, elements, pushHistory, updateElement]);

  const findMindmapHitAtPoint = useCallback((x: number, y: number) => {
    const renderer = rendererRef.current;
    if (!renderer) return null;

    for (let index = elements.length - 1; index >= 0; index -= 1) {
      const element = elements[index];
      if (element.type !== 'mindmap') continue;
      const node = renderer.getMindmapNodeAtPoint(element as MindmapElement, x, y);
      if (node) {
        return { element: element as MindmapElement, node };
      }
    }

    return null;
  }, [elements]);

  const findMindmapDropTargetAtPoint = useCallback((x: number, y: number, source?: { elementId: string; nodeId: string } | null) => {
    const renderer = rendererRef.current;
    if (!renderer) return null;

    const candidates: Array<{ element: MindmapElement; node: MindmapNode; distance: number }> = [];
    const snapThreshold = 56 / zoom;

    for (let index = elements.length - 1; index >= 0; index -= 1) {
      const element = elements[index];
      if (element.type !== 'mindmap') continue;
      if (source && element.id !== source.elementId) continue;
      const rootRect = renderer.getMindmapNodeRect(element as MindmapElement, element.rootNode.id);

      visitMindmapNodes(element.rootNode, (node) => {
        if (source?.nodeId === node.id) return;
        const rect = renderer.getMindmapNodeRect(element as MindmapElement, node.id);
        if (!rect) return;

        const nearestX = Math.max(rect.x, Math.min(x, rect.x + rect.w));
        const nearestY = Math.max(rect.y, Math.min(y, rect.y + rect.h));
        const bodyDistance = Math.hypot(x - nearestX, y - nearestY);
        const direction = (() => {
          if (element.layout === 'mindmap_left') return 'left';
          if (element.layout === 'tree_down') return 'down';
          if (element.layout === 'mindmap_lr' && rootRect) {
            const nodeCenter = rect.x + rect.w / 2;
            const rootCenter = rootRect.x + rootRect.w / 2;
            return nodeCenter < rootCenter ? 'left' : 'right';
          }
          return 'right';
        })();

        const anchorX = direction === 'left'
          ? rect.x
          : direction === 'down'
            ? rect.x + rect.w / 2
            : rect.x + rect.w;
        const anchorY = direction === 'down' ? rect.y + rect.h : rect.y + rect.h / 2;
        const anchorDistance = Math.hypot(x - anchorX, y - anchorY);
        const distance = Math.min(bodyDistance, anchorDistance * 0.72);
        if (distance > snapThreshold) return;

        candidates.push({ element: element as MindmapElement, node, distance });
      });
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.distance - b.distance);
    return { element: candidates[0].element, node: candidates[0].node };
  }, [elements, zoom]);

  // --- Save handler (for Ctrl+S and top bar) ---
  const handleSave = useCallback(() => {
    void saveCurrentDocument();
  }, []);

  // --- Copy/Paste ---
  const handleCopy = useCallback(() => {
    clipboard = elements.filter(el => selectedIds.includes(el.id)).map(el => JSON.parse(JSON.stringify(el)));
  }, [elements, selectedIds]);

  const handlePaste = useCallback(() => {
    if (clipboard.length === 0) return;
    pushHistory();
    const newIds: string[] = [];
    for (const el of clipboard) {
      const newEl = { ...JSON.parse(JSON.stringify(el)), id: generateId(), x: el.x + 20, y: el.y + 20 };
      addElement(newEl);
      newIds.push(newEl.id);
    }
    setSelectedIds(newIds);
    setSelectedMindmapNode(null);
    // Shift clipboard offset for subsequent pastes
    clipboard = clipboard.map(el => ({ ...el, x: el.x + 20, y: el.y + 20 }));
  }, [pushHistory, addElement, setSelectedIds]);

  const handleDuplicate = useCallback(() => {
    if (selectedIds.length === 0) return;
    pushHistory();
    const newIds = duplicateElements(selectedIds);
    setSelectedIds(newIds);
    setSelectedMindmapNode(null);
  }, [selectedIds, pushHistory, duplicateElements, setSelectedIds]);

  const handleDelete = useCallback(() => {
    if (selectedIds.length === 0) return;
    pushHistory();
    removeElements(selectedIds);
    setSelectedIds([]);
    setSelectedMindmapNode(null);
  }, [selectedIds, pushHistory, removeElements, setSelectedIds]);

  // --- Export PNG ---
  const handleExportPNG = useCallback(() => {
    void exportCurrentBoardAsImage();
  }, []);

  // --- Pointer handlers ---

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Close context menu on any click
    setContextMenu({ show: false, x: 0, y: 0 });

    // If editing text, finish
    if (editingElement || editingMindmapNode) {
      finishEditing();
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Space-drag for panning
    if (spaceRef.current || activeTool === 'hand') {
      actionRef.current = 'pan';
      panStartRef.current = { x: e.clientX, y: e.clientY };
      setCursorStyle('grabbing');
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    // Text tool: click creates a text element and opens editing
    if (activeTool === 'text') {
      const canvasPos = viewport.screenToCanvas(screenX, screenY);
      const el = createElementForTool('text', canvasPos.x, canvasPos.y);
      if (el) {
        pushHistory();
        addElement(el);
        setSelectedIds([el.id]);
        setSelectedMindmapNode(null);
        setActiveTool('select');
        startTextEditing(el);
      }
      return;
    }

    // Sticky note tool: click creates a sticky note
    if (activeTool === 'sticky_note') {
      const canvasPos = viewport.screenToCanvas(screenX, screenY);
      const el = createElementForTool('sticky_note', canvasPos.x - 100, canvasPos.y - 100);
      if (el) {
        pushHistory();
        addElement(el);
        setSelectedIds([el.id]);
        setSelectedMindmapNode(null);
        setActiveTool('select');
        startTextEditing(el);
      }
      return;
    }

    // Image tool: open file picker
    if (activeTool === 'image') {
      const canvasPos = viewport.screenToCanvas(screenX, screenY);
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (ev) => {
        const file = (ev.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          const dataURL = reader.result as string;
          const fileId = generateId();
          await loadImageToCache(fileId, dataURL);
          // Get image dimensions
          const img = new Image();
          img.src = dataURL;
          await new Promise<void>((resolve) => { img.onload = () => resolve(); });
          const maxDim = 400;
          let w = img.width;
          let h = img.height;
          if (w > maxDim || h > maxDim) {
            const scale = maxDim / Math.max(w, h);
            w *= scale;
            h *= scale;
          }
          const el = createElementForTool('image', canvasPos.x - w / 2, canvasPos.y - h / 2);
          if (el) {
            pushHistory();
            addEmbeddedFile({
              id: fileId,
              mimeType: file.type || 'image/png',
              dataURL,
              created: Date.now(),
            });
            (el as ImageElement).fileId = fileId;
            el.width = w;
            el.height = h;
            addElement(el);
            setSelectedIds([el.id]);
            setSelectedMindmapNode(null);
          }
        };
        reader.readAsDataURL(file);
      };
      input.click();
      setActiveTool('select');
      return;
    }

    // Mindmap tool: click creates a mindmap
    if (activeTool === 'mindmap') {
      const canvasPos = viewport.screenToCanvas(screenX, screenY);
      const el = createElementForTool('mindmap', canvasPos.x - 200, canvasPos.y - 100);
      if (el) {
        pushHistory();
        addElement(el);
        setSelectedIds([el.id]);
        setSelectedMindmapNode({ elementId: el.id, nodeId: (el as MindmapElement).rootNode.id });
        setActiveTool('select');
      }
      return;
    }

    const canvasPos = viewport.screenToCanvas(screenX, screenY);

    // Start drawing an arrow from a connection point when hovering over one
    // But only if there's no existing element under the cursor (avoid intercepting selection of lines)
    if (activeTool === 'select' && hoveredConnectionElementId) {
      const existingHit = hitTest(elements, canvasPos.x, canvasPos.y);
      if (!existingHit) {
        const sourceEl = elements.find(e => e.id === hoveredConnectionElementId);
        if (sourceEl) {
          const points = getConnectionPoints(sourceEl);
          let nearestIdx = 0;
          let nearestDist = Infinity;
          for (let i = 0; i < points.length; i++) {
            const d = Math.hypot(canvasPos.x - points[i][0], canvasPos.y - points[i][1]);
            if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
          }
          const startPoint = points[nearestIdx];
          const FOCUS_POINTS = 3;
          const newArrow = createElementForTool('arrow', startPoint[0], startPoint[1]);
          if (newArrow && (newArrow.type === 'arrow' || newArrow.type === 'line')) {
            const arrowEl = newArrow as LinearElement;
            arrowEl.startBinding = { elementId: sourceEl.id, focus: nearestIdx / FOCUS_POINTS, gap: 0 };
            arrowEl.endBinding = null;
            Object.assign(arrowEl, normalizeLinearPoints([startPoint, startPoint]));
            interactionState.activeElement = arrowEl;
            interactionState.startX = canvasPos.x;
            interactionState.startY = canvasPos.y;
            interactionState.currentX = canvasPos.x;
            interactionState.currentY = canvasPos.y;
            actionRef.current = 'draw';
            pushHistory();
            canvas.setPointerCapture(e.pointerId);
            setHoveredConnectionElementId(null);
            return;
          }
        }
      }
    }

    if (activeTool === 'select') {
      const mindmapHit = findMindmapHitAtPoint(canvasPos.x, canvasPos.y);
      if (mindmapHit) {
        interactionState.startX = canvasPos.x;
        interactionState.startY = canvasPos.y;
        interactionState.currentX = canvasPos.x;
        interactionState.currentY = canvasPos.y;
        setSelectedIds([mindmapHit.element.id]);
        setSelectedMindmapNode({ elementId: mindmapHit.element.id, nodeId: mindmapHit.node.id });
        if (mindmapHit.node.id === mindmapHit.element.rootNode.id) {
          interactionState.originalElements = new Map([[
            mindmapHit.element.id,
            {
              x: mindmapHit.element.x,
              y: mindmapHit.element.y,
              width: mindmapHit.element.width,
              height: mindmapHit.element.height,
            },
          ]]);
          actionRef.current = 'drag';
          pushHistory();
        } else {
          mindmapNodeDragRef.current = { elementId: mindmapHit.element.id, nodeId: mindmapHit.node.id };
          mindmapDropTargetRef.current = null;
          actionRef.current = 'mindmap-node-drag';
          setCursorStyle('grabbing');
        }
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }

    const result = handlePointerDown(
      viewport, elements, selectedIds, activeTool, activeShapeVariant,
      screenX, screenY, e.shiftKey, interactionState,
    );

    actionRef.current = result.action;

    if (result.selectedIds !== undefined) {
      const nextSelectedIds = result.selectedIds;
      setSelectedIds(nextSelectedIds);
      if (nextSelectedIds.length !== 1 || elements.find((el) => el.id === nextSelectedIds[0])?.type !== 'mindmap') {
        setSelectedMindmapNode(null);
      }
    }

    if (result.action === 'draw' && result.element) {
      // Apply active drawing color
      if (interactionState.activeElement?.type === 'freedraw') {
        interactionState.activeElement.strokeColor = freedrawColor;
      } else if (interactionState.activeElement?.type === 'highlighter') {
        (interactionState.activeElement as any).highlightColor = highlighterColor;
      }
      pushHistory();
    }

    if (result.action === 'drag') {
      pushHistory();
      // For connected lines: resolve absolute points and clear bindings so they can be freely dragged
      const dragIds = result.selectedIds ?? selectedIds;
      for (const id of dragIds) {
        const el = elements.find(e => e.id === id);
        if (!el || (el.type !== 'line' && el.type !== 'arrow')) continue;
        const linearEl = el as LinearElement;
        if (linearEl.startBinding || linearEl.endBinding) {
          const absPoints = getLinearAbsolutePoints(linearEl, elements);
          const normalized = normalizeLinearPoints(absPoints);
          updateElement(id, { ...normalized, startBinding: null, endBinding: null } as any);
          // Update originalElements in interactionState with resolved bounds
          interactionState.originalElements.set(id, {
            x: normalized.x, y: normalized.y,
            width: normalized.width, height: normalized.height,
          });
        }
      }
    }

    if (result.action === 'resize') {
      pushHistory();
    }

    canvas.setPointerCapture(e.pointerId);
  }, [
    elements,
    selectedIds,
    activeTool,
    activeShapeVariant,
    pushHistory,
    setSelectedIds,
    setCursorStyle,
    editingElement,
    editingMindmapNode,
    finishEditing,
    addElement,
    addEmbeddedFile,
    setActiveTool,
    setActiveShapeVariant,
    startTextEditing,
    findMindmapHitAtPoint,
    hoveredConnectionElementId,
    freedrawColor,
    highlighterColor,
  ]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (actionRef.current === 'pan') {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      panStartRef.current = { x: e.clientX, y: e.clientY };
      viewport.pan(dx, dy);
      setViewport(viewport.x, viewport.y);
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const canvasPos = viewport.screenToCanvas(screenX, screenY);

    if (actionRef.current === 'mindmap-node-drag') {
      interactionState.currentX = canvasPos.x;
      interactionState.currentY = canvasPos.y;
      const dragState = mindmapNodeDragRef.current;
      let dropTarget: { elementId: string; nodeId: string } | null = null;

      if (dragState) {
        const sourceElement = elements.find((candidate) => candidate.id === dragState.elementId);
        const dropHit = findMindmapDropTargetAtPoint(canvasPos.x, canvasPos.y, dragState);

        if (
          sourceElement?.type === 'mindmap'
          && dropHit
          && dropHit.element.id === dragState.elementId
          && dropHit.node.id !== dragState.nodeId
        ) {
          const draggedNode = findMindmapNode(sourceElement.rootNode, dragState.nodeId);
          if (draggedNode && !findMindmapNode(draggedNode, dropHit.node.id)) {
            dropTarget = { elementId: dropHit.element.id, nodeId: dropHit.node.id };
          }
        }
      }

      mindmapDropTargetRef.current = dropTarget;
      renderScene();
      return;
    }

    const isLinearTool = activeTool === 'line' || activeTool === 'arrow'
      || interactionState.activeElement?.type === 'line'
      || interactionState.activeElement?.type === 'arrow';

    if (isLinearTool) {
      const bindingTarget = findNearestBindableElement(elements, canvasPos.x, canvasPos.y, 16 / zoom);
      setHoveredConnectableId(bindingTarget?.element.id ?? null);
    } else if (hoveredConnectableId) {
      setHoveredConnectableId(null);
    }

    // Show connection points when hovering near a selected element's edge (select tool, idle)
    if (activeTool === 'select' && actionRef.current === 'none' && selectedIds.length >= 1) {
      let foundConnectionEl: string | null = null;
      for (const id of selectedIds) {
        const el = elements.find(e => e.id === id);
        if (!el || !isConnectableElement(el)) continue;
        const points = getConnectionPoints(el);
        for (const [px, py] of points) {
          if (Math.hypot(canvasPos.x - px, canvasPos.y - py) <= 12 / zoom) {
            foundConnectionEl = id;
            break;
          }
        }
        if (foundConnectionEl) break;
      }
      if (foundConnectionEl !== hoveredConnectionElementId) {
        setHoveredConnectionElementId(foundConnectionEl);
      }
      const wantCursor = foundConnectionEl ? 'crosshair' : 'default';
      if (wantCursor !== cursorRef.current) {
        setCursorStyle(wantCursor);
      }
    } else if (hoveredConnectionElementId) {
      setHoveredConnectionElementId(null);
      if (cursorRef.current === 'crosshair') setCursorStyle('default');
    }

    if (actionRef.current === 'none') return;

    const result = handlePointerMove(
      viewport, screenX, screenY,
      actionRef.current, interactionState,
      elements, selectedIds,
      showGrid, appState.gridSize,
    );

    // Update snap guides
    snapGuidesRef.current = result.snapGuides || [];

    if (result.activeElement && actionRef.current === 'draw') {
      interactionState.activeElement = result.activeElement;
      renderScene();
    }

    if (result.selectionBox) {
      selectionBoxRef.current = result.selectionBox;
      renderScene();
    }

    if (result.updatedElements) {
      for (const [id, updates] of result.updatedElements) {
        updateElement(id, updates);
      }
      // Show size info during resize
      if (actionRef.current === 'resize' && result.updatedElements.size > 0) {
        const upd = Array.from(result.updatedElements.values())[0];
        if (upd.width !== undefined && upd.height !== undefined) {
          const screen = viewport.canvasToScreen(
            (upd.x ?? 0) + (upd.width ?? 0),
            (upd.y ?? 0) + (upd.height ?? 0),
          );
          setResizeInfo({ x: screen.x + 10, y: screen.y + 10, w: Math.round(upd.width!), h: Math.round(upd.height!) });
        }
      }
    }
  }, [
    elements,
    selectedIds,
    updateElement,
    setViewport,
    renderScene,
    showGrid,
    appState.gridSize,
    activeTool,
    zoom,
    hoveredConnectableId,
    hoveredConnectionElementId,
    findMindmapDropTargetAtPoint,
  ]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.releasePointerCapture(e.pointerId);

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const canvasPos = viewport.screenToCanvas(screenX, screenY);

    if (actionRef.current === 'pan') {
      setCursorStyle(activeTool === 'hand' ? 'grab' : 'default');
    }

    if (actionRef.current === 'mindmap-node-drag') {
      const dragState = mindmapNodeDragRef.current;
      const dropTarget = mindmapDropTargetRef.current;
      mindmapNodeDragRef.current = null;
      mindmapDropTargetRef.current = null;
      setCursorStyle('default');

      if (dragState) {
        const dragDistance = Math.hypot(canvasPos.x - interactionState.startX, canvasPos.y - interactionState.startY);
        const sourceElement = elements.find((candidate) => candidate.id === dragState.elementId);

        if (
          dragDistance > 6 / zoom
          && sourceElement?.type === 'mindmap'
          && dropTarget
          && dropTarget.elementId === dragState.elementId
          && dropTarget.nodeId !== dragState.nodeId
        ) {
          const nextRootNode = moveMindmapNode(sourceElement.rootNode, dragState.nodeId, dropTarget.nodeId);
          if (nextRootNode !== sourceElement.rootNode) {
            pushHistory();
            updateElement(sourceElement.id, { rootNode: nextRootNode } as any);
            setSelectedMindmapNode({ elementId: sourceElement.id, nodeId: dragState.nodeId });
          }
        }
      }

      actionRef.current = 'none';
      renderScene();
      return;
    }

    // Selection box - select elements within
    if (actionRef.current === 'select' && selectionBoxRef.current) {
      const box = selectionBoxRef.current;
      if (box.width > 3 || box.height > 3) {
        const ids = getElementsInSelectionBox(elements, box);
        setSelectedIds(ids);
        if (ids.length !== 1 || elements.find((el) => el.id === ids[0])?.type !== 'mindmap') {
          setSelectedMindmapNode(null);
        }
      }
      selectionBoxRef.current = null;
      renderScene();
    }

    if (actionRef.current === 'draw' && interactionState.activeElement) {
      const el = interactionState.activeElement;
      // Only add if it has some size
      if (el.type === 'freedraw' || el.type === 'highlighter') {
        if ((el as any).points.length > 1) {
          addElement(el);
          // Don't switch back to select for drawing tools - allow continuous drawing
        }
      } else if (el.type === 'line' || el.type === 'arrow') {
        const points = getLinearAbsolutePoints(el as LinearElement, elements);
        const [startPoint, endPoint] = [points[0], points[points.length - 1]];
        if (startPoint && endPoint && Math.hypot(endPoint[0] - startPoint[0], endPoint[1] - startPoint[1]) > 2) {
          addElement(el);
          setSelectedIds([el.id]);
          setSelectedMindmapNode(null);
          setActiveTool('select');
        }
      } else if (el.width > 2 || el.height > 2) {
        addElement(el);
        setSelectedIds([el.id]);
        setSelectedMindmapNode(null);
        setActiveTool('select');
      }
      interactionState.activeElement = null;
      renderScene();
    }

    actionRef.current = 'none';
    interactionState.resizeHandle = null;
    snapGuidesRef.current = [];
    setHoveredConnectableId(null);
    setHoveredConnectionElementId(null);
    setResizeInfo(null);
    renderScene();
  }, [addElement, setActiveTool, activeTool, setCursorStyle, elements, setSelectedIds, renderScene, findMindmapHitAtPoint, pushHistory, updateElement, zoom]);

  // Double-click to edit text or mindmap nodes
  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const canvasPos = viewport.screenToCanvas(screenX, screenY);

    const hit = hitTest(elements, canvasPos.x, canvasPos.y);
    const editableOnDoubleClick = ['text', 'sticky_note', 'section', 'frame', 'rectangle', 'ellipse', 'diamond', 'triangle'];
    if (hit && editableOnDoubleClick.includes(hit.type)) {
      setSelectedIds([hit.id]);
      setSelectedMindmapNode(null);
      startTextEditing(hit);
      return;
    }

    const mindmapHit = findMindmapHitAtPoint(canvasPos.x, canvasPos.y);
    if (mindmapHit) {
      setSelectedIds([mindmapHit.element.id]);
      setSelectedMindmapNode({ elementId: mindmapHit.element.id, nodeId: mindmapHit.node.id });
      startMindmapNodeEditing(mindmapHit.element.id, mindmapHit.node.id, mindmapHit.node.text);
    }
  }, [elements, setSelectedIds, startTextEditing, findMindmapHitAtPoint, startMindmapNodeEditing]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    if (e.ctrlKey || e.metaKey) {
      // Pinch zoom
      const delta = -e.deltaY * 0.01;
      const newZoom = zoom * (1 + delta);
      viewport.zoomAtPoint(screenX, screenY, newZoom);
      setZoom(viewport.zoom);
      setViewport(viewport.x, viewport.y);
    } else {
      // Pan
      viewport.pan(-e.deltaX, -e.deltaY);
      setViewport(viewport.x, viewport.y);
    }
  }, [zoom, setZoom, setViewport]);

  const onContextMenuHandler = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ show: true, x: e.clientX, y: e.clientY });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when focus is in an input / textarea / contenteditable
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) {
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
        const sel = elements.find(el => el.id === selectedIds[0]);
        if (sel && sel.type === 'sticky_note') {
          e.preventDefault();
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
        const sel = elements.find(el => el.id === selectedIds[0]);
        if (sel && sel.type === 'mindmap') {
          e.preventDefault();
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
        switch (e.key) {
          case 'z':
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
    bringToFront,
    sendToBack,
    bringForward,
    sendBackward,
    groupElements,
    ungroupElements,
    selectedMindmapNode,
  ]);

  // --- Text editing overlay position ---
  const getEditingPosition = () => {
    if (editingElement) {
      // Section/frame: textarea positioned above the element (title area)
      if (editingElement.type === 'section' || editingElement.type === 'frame') {
        const titleH = 20 * zoom;
        const screen = viewport.canvasToScreen(editingElement.x, editingElement.y - 20);
        return {
          left: screen.x,
          top: screen.y,
          width: Math.max(editingElement.width * zoom, 100),
          height: titleH,
          fontSize: 12 * zoom,
          fontFamily: 'Inter, system-ui, sans-serif',
          color: '#8B8FA3',
          padding: '2px 4px',
          backgroundColor: 'rgba(255, 255, 255, 0.96)',
          borderRadius: 6 * zoom,
        };
      }
      // Shapes: textarea centered inside the shape
      const isShape = ['rectangle', 'ellipse', 'diamond', 'triangle'].includes(editingElement.type);
      if (isShape) {
        const shapeScreen = viewport.canvasToScreen(editingElement.x, editingElement.y);
        const fs = ((editingElement as any).fontSize || 16) * zoom;
        const insets = getShapeTextInsets(editingElement, zoom);
        const width = Math.max(editingElement.width * zoom - insets.left - insets.right, fs * 1.6);
        const height = Math.max(editingElement.height * zoom - insets.top - insets.bottom, fs * 1.35);
        const paddingTop = Math.max(2, (height - fs * 1.3) / 2);
        return {
          left: shapeScreen.x + insets.left,
          top: shapeScreen.y + insets.top,
          width,
          height,
          fontSize: fs,
          fontFamily: (editingElement as any).fontFamily || 'Inter, system-ui, sans-serif',
          color: editingElement.strokeColor || '#1B1B1F',
          padding: `${paddingTop}px 2px 2px`,
          textAlign: 'center' as const,
          backgroundColor: 'transparent',
          borderRadius: 0,
          chrome: 'plain' as const,
        };
      }
      const screen = viewport.canvasToScreen(editingElement.x, editingElement.y);
      return {
        left: screen.x,
        top: screen.y,
        width: Math.max(editingElement.width * zoom, 100),
        height: Math.max(editingElement.height * zoom, 30),
        fontSize: ((editingElement as any).fontSize || 20) * zoom,
        fontFamily: (editingElement as any).fontFamily || 'Inter, system-ui, sans-serif',
        color: editingElement.type === 'sticky_note' ? '#1B1B1F' : editingElement.strokeColor,
        padding: editingElement.type === 'sticky_note' ? `${12 * zoom}px` : '2px',
        backgroundColor: editingElement.type === 'sticky_note'
          ? STICKY_NOTE_COLORS[(editingElement as any).noteColor] || editingElement.backgroundColor
          : (editingElement.backgroundColor === 'transparent' ? 'rgba(255, 255, 255, 0.96)' : editingElement.backgroundColor),
        borderRadius: editingElement.type === 'sticky_note' ? 8 * zoom : 4 * zoom,
        chrome: 'panel' as const,
      };
    }

    if (editingMindmapNode) {
      const element = elements.find((candidate) => candidate.id === editingMindmapNode.elementId);
      if (element?.type === 'mindmap') {
        const node = findMindmapNode(element.rootNode, editingMindmapNode.nodeId);
        const rect = rendererRef.current?.getMindmapNodeRect(element, editingMindmapNode.nodeId);
        if (node && rect) {
          const screen = viewport.canvasToScreen(rect.x, rect.y);
          const insetX = node.nodeShape === 'pill' ? 12 * zoom : 8 * zoom;
          const insetY = node.nodeShape === 'text' ? 0 : 4 * zoom;
          const nodeW = Math.max(rect.w * zoom - insetX * 2, node.fontSize * zoom * 1.6);
          const nodeH = Math.max(rect.h * zoom - insetY * 2, node.fontSize * zoom * 1.35);
          const lineH = node.fontSize * zoom * 1.3;
          const paddingTop = Math.max(2, (nodeH - lineH) / 2);
          return {
            left: screen.x + insetX,
            top: screen.y + insetY,
            width: nodeW,
            height: nodeH,
            fontSize: node.fontSize * zoom,
            fontFamily: 'Inter, system-ui, sans-serif',
            color: node.textColor,
            padding: `${paddingTop}px 2px 2px`,
            textAlign: 'center' as const,
            backgroundColor: node.nodeShape === 'text' ? 'rgba(255, 255, 255, 0.96)' : 'transparent',
            borderRadius: node.nodeShape === 'text' ? 10 * zoom : 0,
            chrome: node.nodeShape === 'text' ? 'panel' as const : 'plain' as const,
          };
        }
      }
    }

    return {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      fontSize: 20,
      fontFamily: 'Inter, system-ui, sans-serif',
      color: '#1B1B1F',
      padding: '2px',
      backgroundColor: 'rgba(255, 255, 255, 0.96)',
      borderRadius: 4,
      chrome: 'panel' as const,
    };
  };

  const editPos = getEditingPosition();

  return (
    <div className="absolute inset-0">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ cursor: cursorStyle }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
        onContextMenu={onContextMenuHandler}
        tabIndex={0}
      />

      {/* Text editing overlay */}
      {(editingElement || editingMindmapNode) && (
        <textarea
          ref={textareaRef}
          className={`absolute resize-none overflow-hidden outline-none ${
            editPos.chrome === 'plain'
              ? 'border-0 bg-transparent shadow-none'
              : editingMindmapNode
                ? 'border border-emerald-200/90 bg-white/70 shadow-[0_12px_32px_rgba(15,23,42,0.08)]'
                : 'border border-blue-300/90 bg-white/80 shadow-[0_12px_32px_rgba(15,23,42,0.08)]'
          }`}
          style={{
            left: editPos.left,
            top: editPos.top,
            width: editPos.width,
            height: editPos.height,
            minHeight: editPos.height,
            fontSize: `${editPos.fontSize}px`,
            fontFamily: editPos.fontFamily,
            color: editPos.color,
            padding: editPos.padding,
            textAlign: (editPos as any).textAlign ?? 'left',
            lineHeight: 1.3,
            backgroundColor: (editPos as any).backgroundColor,
            borderRadius: `${(editPos as any).borderRadius ?? 0}px`,
            zIndex: 20,
          }}
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={finishEditing}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              finishEditing();
              e.preventDefault();
            }
            e.stopPropagation();
          }}
        />
      )}

      {/* Size display during resize */}
      {resizeInfo && (
        <div
          className="absolute pointer-events-none bg-gray-800 text-white text-xs px-2 py-1 rounded shadow-lg z-20"
          style={{ left: resizeInfo.x, top: resizeInfo.y }}
        >
          {resizeInfo.w} × {resizeInfo.h}
        </div>
      )}

      {/* Context menu */}
      <ContextMenu
        state={contextMenu}
        hasSelection={selectedIds.length > 0}
        hasClipboard={clipboard.length > 0}
        canGroup={selectedIds.length > 1}
        canUngroup={elements.some(el => selectedIds.includes(el.id) && el.groupIds.length > 0)}
        onClose={() => setContextMenu({ show: false, x: 0, y: 0 })}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onBringToFront={() => { pushHistory(); bringToFront(selectedIds); }}
        onSendToBack={() => { pushHistory(); sendToBack(selectedIds); }}
        onBringForward={() => { pushHistory(); bringForward(selectedIds); }}
        onSendBackward={() => { pushHistory(); sendBackward(selectedIds); }}
        onSelectAll={() => {
          setSelectedIds(elements.map(el => el.id));
          setSelectedMindmapNode(null);
        }}
        onGroup={() => { pushHistory(); groupElements(selectedIds); }}
        onUngroup={() => { pushHistory(); ungroupElements(selectedIds); }}
      />
    </div>
  );
}
