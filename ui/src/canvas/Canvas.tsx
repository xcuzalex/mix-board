import { useRef, useEffect, useLayoutEffect, useCallback, useMemo, useState } from 'react';
import { useDocumentStore } from '../store/document';
import { useUIStore } from '../store/ui';
import { Renderer } from './renderer';
import { Viewport } from './viewport';
import { hitTest, getResizeHandle, SpatialIndex } from './hit-test';
import {
  createInteractionState,
  handlePointerDown,
  handlePointerMove,
  getElementsInSelectionBox,
  createElementForTool,
  appendFreehandSamples,
  finalizeFreehandElement,
} from './interaction';
import { ContextMenu, type ContextMenuState } from '../components/ContextMenu';
import { loadImageToCache } from './renderer';
import { generateId } from '../utils/id';
import { cloneElementsWithNewIds } from '../utils/clone-elements';
import {
  findMindmapNode,
  visitMindmapNodes,
  updateMindmapNodeText,
  moveMindmapNode,
  extractMindmapNode,
} from './mindmap-ops';
import { useCanvasShortcuts } from './useCanvasShortcuts';
import { buildLinkIndex, getNoteTitle } from '../utils/links';
import { measureMarkdown, CARD_PADDING, DEFAULT_NOTE_FONT, MIN_CARD_HEIGHT } from './render/markdown';
import { getEditableDraft, computeEditingPosition } from './text-editing';
import { canvasTheme, isDefaultBackground, setCanvasTheme } from './canvas-theme';
import {
  createSceneIndex,
  findBindableElementWithStickyPreference,
  findNearestConnectionAnchor,
  getConnectionAnchorFromBinding,
  getConnectionPointFromBinding,
  getLinearAbsolutePoints,
  isConnectableElement,
  normalizeLinearPoints,
  type ConnectionAnchorDescriptor,
  type SceneIndex,
} from './linear';
import type { Element, ImageElement, LinearElement, MindmapElement, MindmapNode, StickyNoteElement } from '../types/element';
import { registerPendingCanvasInteractionFlush } from '../utils/canvas-interaction-flush';
import type { SnapGuide } from '../utils/math';
import { exportCurrentBoardAsImage, saveCurrentDocument } from '../utils/document-io';
import { useVaultStore } from '../store/vault';

const viewport = new Viewport();
const interactionState = createInteractionState();

// Module-level clipboard
let clipboard: Element[] = [];
const EMPTY_SCENE = createSceneIndex([]);

type StickyEndpointState = {
  binding: LinearElement['startBinding'];
  anchor: ConnectionAnchorDescriptor | null;
};

function areAnchorsEqual(
  left: ConnectionAnchorDescriptor | null,
  right: ConnectionAnchorDescriptor | null,
): boolean {
  return !!left && !!right
    ? left.elementId === right.elementId && left.index === right.index
    : left === right;
}

function dedupeAnchors(anchors: Array<ConnectionAnchorDescriptor | null>): ConnectionAnchorDescriptor[] {
  const next: ConnectionAnchorDescriptor[] = [];
  const seen = new Set<string>();
  for (const anchor of anchors) {
    if (!anchor) continue;
    const key = `${anchor.elementId}:${anchor.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(anchor);
  }
  return next;
}

function areIdSetsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function buildPreviewElements(
  elements: Element[],
  pendingUpdates: Map<string, Partial<Element>> | null,
): { previewSceneElements: Element[]; previewOnlyElements: Element[]; hiddenIds: Set<string> } {
  if (!pendingUpdates || pendingUpdates.size === 0) {
    return {
      previewSceneElements: elements,
      previewOnlyElements: [],
      hiddenIds: new Set(),
    };
  }

  const hiddenIds = new Set<string>();
  const previewSceneElements: Element[] = elements.map((element) => {
    const updates = pendingUpdates.get(element.id);
    if (!updates) return element;
    hiddenIds.add(element.id);
    return { ...element, ...updates } as Element;
  });

  const previewSceneIndex = createSceneIndex(previewSceneElements);
  const previewElementById = new Map(previewSceneElements.map((element) => [element.id, element]));

  for (const element of previewSceneElements) {
    if (
      (element.type !== 'line' && element.type !== 'arrow')
      || hiddenIds.has(element.id)
    ) {
      continue;
    }

    const linear = element as LinearElement;
    const dependsOnHiddenElement = !!(
      (linear.startBinding && hiddenIds.has(linear.startBinding.elementId))
      || (linear.endBinding && hiddenIds.has(linear.endBinding.elementId))
    );
    if (!dependsOnHiddenElement) continue;

    const normalized = normalizeLinearPoints(getLinearAbsolutePoints(linear, previewSceneIndex));
    const previewLinear = {
      ...linear,
      ...normalized,
    } as LinearElement;

    previewElementById.set(previewLinear.id, previewLinear);
    previewSceneIndex.byId.set(previewLinear.id, previewLinear);
    hiddenIds.add(previewLinear.id);
  }

  const finalizedPreviewSceneElements = elements.map((element) => previewElementById.get(element.id) ?? element);

  const previewOnlyElements = finalizedPreviewSceneElements.filter((element) => hiddenIds.has(element.id));
  return { previewSceneElements: finalizedPreviewSceneElements, previewOnlyElements, hiddenIds };
}

export function Canvas() {
  const sceneCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRendererRef = useRef<Renderer | null>(null);
  const overlayRendererRef = useRef<Renderer | null>(null);
  const renderSceneRef = useRef<() => void>(() => {});
  const renderOverlayRef = useRef<() => boolean>(() => false);
  const actionRef = useRef<string>('none');
  const cursorRef = useRef<string>('default');
  const panStartRef = useRef({ x: 0, y: 0 });
  const spaceRef = useRef(false);
  const selectionBoxRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const snapGuidesRef = useRef<SnapGuide[]>([]);
  const [resizeInfo, setResizeInfo] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const mindmapNodeDragRef = useRef<{ elementId: string; nodeId: string } | null>(null);
  const mindmapDropTargetRef = useRef<{ elementId: string; nodeId: string } | null>(null);
  const rafIdRef = useRef<number>(0);
  const needsSceneRenderRef = useRef(false);
  const needsOverlayRenderRef = useRef(false);
  const lastMoveTimeRef = useRef(0);
  const lastWheelTimeRef = useRef(0);
  const pendingElementUpdatesRef = useRef<Map<string, Partial<Element>> | null>(null);
  const hiddenElementIdsRef = useRef<Set<string>>(new Set());
  /**
   * Bound connectors in the current drag selection, with their resolved
   * geometry. They are unbound only if the drag actually moves (see
   * `withConnectorUnbinding`), so clicking a connected arrow keeps it attached.
   */
  const dragUnbindRef = useRef<Map<string, Pick<LinearElement, 'points' | 'width' | 'height'>> | null>(null);
  const lassoSelectedIdsRef = useRef<string[]>([]);
  const drawingBindingStateRef = useRef<{ start: StickyEndpointState; end: StickyEndpointState }>({
    start: { binding: null, anchor: null },
    end: { binding: null, anchor: null },
  });
  const resizeBindingStateRef = useRef<Map<string, StickyEndpointState>>(new Map());
  const hoveredAnchorRef = useRef<ConnectionAnchorDescriptor | null>(null);
  const activeAnchorsRef = useRef<ConnectionAnchorDescriptor[]>([]);
  const hoveredElementIdRef = useRef<string | null>(null);
  const hoveredHandleRef = useRef<string | null>(null);

  // Pan inertia & zoom smoothing & edge auto-pan
  const panHistoryRef = useRef<Array<{ dx: number; dy: number; time: number }>>([]);
  const inertiaRef = useRef<{ vx: number; vy: number; active: boolean }>({ vx: 0, vy: 0, active: false });
  const zoomCenterRef = useRef<{ x: number; y: number } | null>(null);
  const autoPanRef = useRef<{ vx: number; vy: number; active: boolean }>({ vx: 0, vy: 0, active: false });
  const lastPointerScreenRef = useRef<{ screenX: number; screenY: number } | null>(null);
  const lastSyncedFromRAFRef = useRef(0);

  // Text editing state
  const [editingElement, setEditingElement] = useState<Element | null>(null);
  const [editingMindmapNode, setEditingMindmapNode] = useState<{ elementId: string; nodeId: string } | null>(null);
  const selectedMindmapNode = useUIStore((s) => s.selectedMindmapNode);
  const setSelectedMindmapNode = useUIStore((s) => s.setSelectedMindmapNode);
  const [hoveredConnectableId, setHoveredConnectableId] = useState<string | null>(null);
  const [hoveredConnectionElementId, setHoveredConnectionElementId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  // Active "[[" autocomplete while editing text: where the "[[" starts, the typed query, highlighted row.
  const [linkSuggest, setLinkSuggest] = useState<{ start: number; query: string; index: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ show: false, x: 0, y: 0 });

  const elements = useDocumentStore((s) => s.elements);
  const appState = useDocumentStore((s) => s.appState);
  const addElement = useDocumentStore((s) => s.addElement);
  const addEmbeddedFile = useDocumentStore((s) => s.addEmbeddedFile);
  const updateElement = useDocumentStore((s) => s.updateElement);
  const applyTransaction = useDocumentStore((s) => s.applyTransaction);
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
  const showGrid = useUIStore((s) => s.showGrid);
  const showDots = useUIStore((s) => s.showDots);
  const cursorStyle = useUIStore((s) => s.cursorStyle);
  const effectiveTheme = useUIStore((s) => s.effectiveTheme);
  const setCursorStyle = useUIStore((s) => s.setCursorStyle);
  cursorRef.current = cursorStyle;
  const freedrawColor = useUIStore((s) => s.freedrawColor);
  const highlighterColor = useUIStore((s) => s.highlighterColor);
  // Starts empty (not built on every render); rebuilt below whenever elements change.
  const sceneIndexRef = useRef<SceneIndex>(EMPTY_SCENE);
  const spatialIndexRef = useRef<SpatialIndex | null>(null);

  if (sceneIndexRef.current.elements !== elements) {
    sceneIndexRef.current = createSceneIndex(elements);
    spatialIndexRef.current = new SpatialIndex(elements, sceneIndexRef.current);
  }

  // Undo/redo or deletes elsewhere can remove selected elements: drop them
  // from the selection so later gestures never look up a missing element.
  useEffect(() => {
    const ui = useUIStore.getState();
    const byId = sceneIndexRef.current.byId;
    const kept = ui.selectedIds.filter((id) => byId.has(id));
    if (kept.length !== ui.selectedIds.length) ui.setSelectedIds(kept);
    const node = ui.selectedMindmapNode;
    if (node) {
      const el = byId.get(node.elementId);
      if (!el || el.type !== 'mindmap' || !findMindmapNode(el.rootNode, node.nodeId)) ui.setSelectedMindmapNode(null);
    }
  }, [elements]);

  const syncHoveredAnchor = useCallback((nextAnchor: ConnectionAnchorDescriptor | null) => {
    if (areAnchorsEqual(hoveredAnchorRef.current, nextAnchor)) return false;
    hoveredAnchorRef.current = nextAnchor;
    return true;
  }, []);

  const syncActiveAnchors = useCallback((anchors: Array<ConnectionAnchorDescriptor | null>) => {
    const nextAnchors = dedupeAnchors(anchors);
    const prevAnchors = activeAnchorsRef.current;
    if (
      prevAnchors.length === nextAnchors.length
      && prevAnchors.every((anchor, index) => areAnchorsEqual(anchor, nextAnchors[index] ?? null))
    ) {
      return false;
    }
    activeAnchorsRef.current = nextAnchors;
    return true;
  }, []);

  const resetLinearBindingPreview = useCallback(() => {
    drawingBindingStateRef.current = {
      start: { binding: null, anchor: null },
      end: { binding: null, anchor: null },
    };
    resizeBindingStateRef.current.clear();
    hoveredAnchorRef.current = null;
    activeAnchorsRef.current = [];
  }, []);

  const invalidateScene = useCallback((includeOverlay = true) => {
    needsSceneRenderRef.current = true;
    if (includeOverlay) {
      needsOverlayRenderRef.current = true;
    }
  }, []);

  const invalidateOverlay = useCallback(() => {
    needsOverlayRenderRef.current = true;
  }, []);

  const setPendingElementUpdates = useCallback((updates: Map<string, Partial<Element>> | null) => {
    const nextUpdates = updates && updates.size > 0 ? updates : null;
    const nextHiddenIds = nextUpdates
      ? buildPreviewElements(elements, nextUpdates).hiddenIds
      : new Set<string>();
    const hiddenIdsChanged = !areIdSetsEqual(hiddenElementIdsRef.current, nextHiddenIds);

    pendingElementUpdatesRef.current = nextUpdates;
    hiddenElementIdsRef.current = nextHiddenIds;

    if (hiddenIdsChanged) {
      invalidateScene();
    } else {
      invalidateOverlay();
    }
  }, [elements, invalidateOverlay, invalidateScene]);

  const renderScene = useCallback(() => {
    // Default white page follows the theme; an explicit document background is kept.
    const bgColor = isDefaultBackground(appState.viewBackgroundColor)
      ? canvasTheme.background
      : appState.viewBackgroundColor;
    if (sceneRendererRef.current) sceneRendererRef.current.backgroundDots = showDots;
    sceneRendererRef.current?.renderSceneLayer(
      elements,
      bgColor,
      showGrid,
      appState.gridSize,
      editingElement?.id ?? editingMindmapNode?.elementId ?? null,
      editingMindmapNode?.nodeId ?? null,
      // Elements being dragged/resized are drawn by the overlay preview;
      // hide their originals instead of leaving a faded ghost behind.
      hiddenElementIdsRef.current,
    );
  }, [
    elements,
    appState.viewBackgroundColor,
    appState.gridSize,
    showGrid,
    showDots,
    editingElement,
    editingMindmapNode,
    effectiveTheme,
  ]);

  // Sync canvas-surface colors to the theme and repaint when it changes (P0.D).
  useEffect(() => {
    setCanvasTheme(effectiveTheme);
    invalidateScene();
  }, [effectiveTheme, invalidateScene]);

  const renderOverlay = useCallback(() => {
    const preview = buildPreviewElements(elements, pendingElementUpdatesRef.current);
    overlayRendererRef.current?.setHoveredElementId(hoveredElementIdRef.current);
    overlayRendererRef.current?.setHoveredHandle(hoveredHandleRef.current);
    return overlayRendererRef.current?.renderOverlayLayer({
      geometryElements: preview.previewSceneElements,
      selectedIds,
      previewElements: preview.previewOnlyElements,
      activeElement: interactionState.activeElement,
      selectionBox: selectionBoxRef.current,
      snapGuides: snapGuidesRef.current,
      hoveredElementId: hoveredConnectableId,
      hoveredAnchor: hoveredAnchorRef.current,
      activeAnchors: activeAnchorsRef.current,
      activeDrawingTool: activeTool,
      selectedMindmapNode,
      hoveredConnectionElementId,
      editingElementId: editingElement?.id ?? editingMindmapNode?.elementId ?? null,
      editingMindmapNodeId: editingMindmapNode?.nodeId ?? null,
      mindmapDropTarget: mindmapDropTargetRef.current,
      mindmapDragPreview: actionRef.current === 'mindmap-node-drag' && mindmapNodeDragRef.current
        ? {
            elementId: mindmapNodeDragRef.current.elementId,
            sourceNodeId: mindmapNodeDragRef.current.nodeId,
            pointerX: interactionState.currentX,
            pointerY: interactionState.currentY,
            offsetX: interactionState.currentX - interactionState.startX,
            offsetY: interactionState.currentY - interactionState.startY,
          }
        : null,
      lassoSelectedIds: lassoSelectedIdsRef.current,
    }) ?? false;
  }, [
    elements,
    selectedIds,
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

  useEffect(() => {
    renderOverlayRef.current = renderOverlay;
  }, [renderOverlay]);

  /** Adds the unbinding of dragged connectors to a drag's pending updates. */
  const withConnectorUnbinding = useCallback((updates: Map<string, Partial<Element>>) => {
    const unbind = dragUnbindRef.current;
    if (!unbind || actionRef.current !== 'drag') return updates;
    const merged = new Map(updates);
    for (const [id, geometry] of unbind) {
      const moved = updates.get(id);
      if (!moved) continue;
      merged.set(id, { ...geometry, startBinding: null, endBinding: null, ...moved } as Partial<Element>);
    }
    return merged;
  }, []);

  const commitPendingElementUpdates = useCallback(() => {
    const pendingUpdates = pendingElementUpdatesRef.current;
    if (!pendingUpdates) return false;
    if (pendingUpdates.size === 0) {
      setPendingElementUpdates(null);
      return false;
    }

    setPendingElementUpdates(null);
    const now = Date.now();

    applyTransaction((draft) => {
      for (const element of draft.elements) {
        const updates = pendingUpdates.get(element.id);
        if (!updates) continue;
        Object.assign(element, updates, { updatedAt: now });
      }
    }, { markDirty: true });

    invalidateScene();
    return true;
  }, [applyTransaction, invalidateScene, setPendingElementUpdates]);


  // Setup canvas
  useEffect(() => {
    const sceneCanvas = sceneCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!sceneCanvas || !overlayCanvas) return;

    const sceneCtx = sceneCanvas.getContext('2d');
    const overlayCtx = overlayCanvas.getContext('2d');
    if (!sceneCtx || !overlayCtx) return;

    sceneRendererRef.current = new Renderer(sceneCtx, viewport);
    overlayRendererRef.current = new Renderer(overlayCtx, viewport);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = overlayCanvas.getBoundingClientRect();
      for (const canvas of [sceneCanvas, overlayCanvas]) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
      }
      sceneRendererRef.current?.setSize(rect.width, rect.height);
      overlayRendererRef.current?.setSize(rect.width, rect.height);
      invalidateScene();
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [invalidateScene]);

  // RAF-based render loop for smooth rendering
  useEffect(() => {
    const loop = () => {
      let animated = false;

      // Pan inertia
      if (inertiaRef.current.active) {
        viewport.pan(inertiaRef.current.vx, inertiaRef.current.vy);
        inertiaRef.current.vx *= 0.88;
        inertiaRef.current.vy *= 0.88;
        if (Math.hypot(inertiaRef.current.vx, inertiaRef.current.vy) < 0.15) {
          inertiaRef.current.active = false;
        } else {
          animated = true;
        }
        needsSceneRenderRef.current = true;
      }

      // Zoom smoothing
      const currentTargetZoom = useUIStore.getState().targetZoom;
      const zoomDiff = Math.abs(viewport.zoom - currentTargetZoom);
      if (zoomDiff > 0.001) {
        const newZoom = viewport.zoom + (currentTargetZoom - viewport.zoom) * 0.12;
        const center = zoomCenterRef.current;
        if (center) {
          viewport.zoomAtPoint(center.x, center.y, newZoom);
        } else {
          viewport.zoom = Math.max(0.1, Math.min(5, newZoom));
        }
        needsSceneRenderRef.current = true;
        animated = true;
      }

      // Edge auto-pan during drag or select
      if (autoPanRef.current.active && (actionRef.current === 'drag' || actionRef.current === 'select')) {
        viewport.pan(autoPanRef.current.vx, autoPanRef.current.vy);

        const last = lastPointerScreenRef.current;
        if (last) {
          const result = handlePointerMove(
            viewport,
            last.screenX,
            last.screenY,
            actionRef.current,
            interactionState,
            useDocumentStore.getState().elements,
            useUIStore.getState().selectedIds,
            useUIStore.getState().showGrid,
            useDocumentStore.getState().appState.gridSize,
          );
          if (result.selectionBox) {
            selectionBoxRef.current = result.selectionBox;
            const box = result.selectionBox;
            const lassoIds = getElementsInSelectionBox(useDocumentStore.getState().elements, box);
            lassoSelectedIdsRef.current = lassoIds;
          }
          if (result.updatedElements && result.updatedElements.size > 0 && result.hasDragged !== false) {
            pendingElementUpdatesRef.current = withConnectorUnbinding(result.updatedElements);
          }
          if (result.snapGuides) {
            snapGuidesRef.current = result.snapGuides;
          }
        }
        needsSceneRenderRef.current = true;
        needsOverlayRenderRef.current = true;
        animated = true;
      }

      // Sync animated viewport changes back to React state
      if (animated) {
        const now = performance.now();
        // Throttle viewport sync; only sync zoom when animation is nearly complete
        if (now - lastSyncedFromRAFRef.current >= 50) {
          lastSyncedFromRAFRef.current = now;
          useUIStore.getState().setViewport(viewport.x, viewport.y);
        }
        const zoomDiffToTarget = Math.abs(viewport.zoom - useUIStore.getState().targetZoom);
        if (zoomDiffToTarget < 0.005) {
          useUIStore.getState().setZoom(viewport.zoom);
        }
      }

      if (needsSceneRenderRef.current) {
        needsSceneRenderRef.current = false;
        renderSceneRef.current();
      }
      if (needsOverlayRenderRef.current) {
        needsOverlayRenderRef.current = false;
        const needsAnother = renderOverlayRef.current();
        if (needsAnother) {
          needsOverlayRenderRef.current = true;
        }
      }
      rafIdRef.current = requestAnimationFrame(loop);
    };

    rafIdRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  // Mark render as needed when state changes
  useEffect(() => {
    invalidateScene();
  }, [renderScene, invalidateScene]);

  useEffect(() => {
    invalidateOverlay();
  }, [renderOverlay, invalidateOverlay]);

  // Also mark render as needed when viewport changes
  useEffect(() => {
    // Skip overwriting the mutable viewport if the RAF loop recently synced it
    // (RAF is the source of truth during animations)
    if (performance.now() - lastSyncedFromRAFRef.current < 100) return;
    viewport.update(viewportX, viewportY, zoom);
    invalidateScene();
  }, [viewportX, viewportY, zoom, invalidateScene]);

  // --- Text editing helpers ---

  /** The text an edit started from, and whether its element was just created. */
  const editSessionRef = useRef<{ initial: string; isNew: boolean } | null>(null);

  const startTextEditing = useCallback((el: Element, options?: { isNew?: boolean }) => {
    const editableTypes = ['text', 'sticky_note', 'section', 'frame', 'rectangle', 'ellipse', 'diamond', 'triangle'];
    if (!editableTypes.includes(el.type)) return;
    setEditingMindmapNode(null);
    setEditingElement(el);
    const isContainer = el.type === 'section' || el.type === 'frame';
    const content = isContainer ? (el as any).title || '' : (el as any).text || '';
    const initial = getEditableDraft(content);
    editSessionRef.current = { initial, isNew: options?.isNew ?? false };
    setEditText(initial);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  const startMindmapNodeEditing = useCallback((elementId: string, nodeId: string, text: string) => {
    setEditingElement(null);
    setEditingMindmapNode({ elementId, nodeId });
    const initial = getEditableDraft(text);
    editSessionRef.current = { initial, isNew: false };
    setEditText(initial);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  const finishEditing = useCallback(() => {
    const session = editSessionRef.current;
    editSessionRef.current = null;
    const unchanged = session !== null && editText === session.initial;
    // A just-created element's creation is already its undo step.
    const checkpoint = () => {
      if (!session?.isNew) pushHistory();
    };

    if (editingElement && editingElement.type === 'text' && editText.trim() === '') {
      // An empty text box is invisible but would still catch clicks: drop it.
      if (!session?.isNew) pushHistory();
      removeElements([editingElement.id]);
      setSelectedIds(useUIStore.getState().selectedIds.filter((id) => id !== editingElement.id));
    } else if (editingElement && !unchanged) {
      checkpoint();
      const isContainer = editingElement.type === 'section' || editingElement.type === 'frame';
      if (editingElement.type === 'sticky_note') {
        // Cards fit their height to the rendered Markdown content.
        const sticky = editingElement as StickyNoteElement;
        const fontSize = sticky.fontSize || 16;
        const { height: contentHeight } = measureMarkdown(editText, {
          width: sticky.width - CARD_PADDING * 2,
          fontSize,
          fontFamily: (sticky as any).fontFamily ?? DEFAULT_NOTE_FONT,
        });
        const newHeight = Math.max(MIN_CARD_HEIGHT, Math.ceil(contentHeight + CARD_PADDING * 2));
        updateElement(sticky.id, { text: editText, fontSize, height: newHeight } as any);
      } else if (editingElement.type === 'text' && ((editingElement as any).textAlign ?? 'left') === 'left') {
        // Left-aligned text renders as unwrapped Markdown; fit its bounds to the content.
        const textEl = editingElement as any;
        const fontSize = textEl.fontSize || 16;
        const size = measureMarkdown(editText, {
          width: Infinity,
          fontSize,
          fontFamily: textEl.fontFamily ?? DEFAULT_NOTE_FONT,
        });
        updateElement(textEl.id, {
          text: editText,
          fontSize,
          width: Math.max(40, Math.ceil(size.width) + 4),
          height: Math.max(Math.ceil(fontSize * 1.3), Math.ceil(size.height)),
        } as any);
      } else {
        updateElement(editingElement.id, (isContainer ? { title: editText } : { text: editText, fontSize: (editingElement as any).fontSize || 16 }) as any);
      }
    } else if (editingMindmapNode && !unchanged) {
      const element = sceneIndexRef.current.byId.get(editingMindmapNode.elementId);
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
  }, [editingElement, editingMindmapNode, editText, pushHistory, updateElement, removeElements, setSelectedIds]);

  // Quit, window close, opening another board etc. commit whatever is in
  // flight on the canvas first: drag/resize previews and an open text edit.
  const finishEditingRef = useRef(finishEditing);
  useLayoutEffect(() => {
    finishEditingRef.current = finishEditing;
  }, [finishEditing]);
  useEffect(() => registerPendingCanvasInteractionFlush(() => {
    const committed = commitPendingElementUpdates();
    finishEditingRef.current();
    return committed;
  }), [commitPendingElementUpdates]);

  const findMindmapHitAtPoint = useCallback((x: number, y: number) => {
    const renderer = sceneRendererRef.current;
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
    const renderer = sceneRendererRef.current;
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
    commitPendingElementUpdates();
    pushHistory();
    // Fresh ids and group ids; arrows stay bound only to shapes pasted with them.
    const copies = cloneElementsWithNewIds(clipboard, 20, (el) => getLinearAbsolutePoints(el, sceneIndexRef.current));
    for (const copy of copies) addElement(copy);
    const newIds = copies.map((copy) => copy.id);
    setSelectedIds(newIds);
    setSelectedMindmapNode(null);
    // Shift clipboard offset for subsequent pastes
    clipboard = clipboard.map(el => ({ ...el, x: el.x + 20, y: el.y + 20 }));
  }, [commitPendingElementUpdates, pushHistory, addElement, setSelectedIds]);

  const handleDuplicate = useCallback(() => {
    if (selectedIds.length === 0) return;
    commitPendingElementUpdates();
    pushHistory();
    const newIds = duplicateElements(selectedIds);
    setSelectedIds(newIds);
    setSelectedMindmapNode(null);
  }, [selectedIds, commitPendingElementUpdates, pushHistory, duplicateElements, setSelectedIds]);

  const handleDelete = useCallback(() => {
    if (selectedIds.length === 0) return;
    commitPendingElementUpdates();
    pushHistory();
    // A selected mindmap topic (not the root) deletes just that topic and its subtree.
    const node = useUIStore.getState().selectedMindmapNode;
    const mindmap = node && selectedIds.length === 1 ? sceneIndexRef.current.byId.get(node.elementId) : null;
    if (node && mindmap?.type === 'mindmap' && mindmap.id === selectedIds[0] && node.nodeId !== mindmap.rootNode.id) {
      const { root } = extractMindmapNode(mindmap.rootNode, node.nodeId);
      updateElement(mindmap.id, { rootNode: root } as Partial<Element>);
      setSelectedMindmapNode(null);
      return;
    }
    removeElements(selectedIds);
    setSelectedIds([]);
    setSelectedMindmapNode(null);
  }, [selectedIds, commitPendingElementUpdates, pushHistory, removeElements, setSelectedIds, updateElement]);

  // --- Export PNG ---
  const handleExportPNG = useCallback(() => {
    void exportCurrentBoardAsImage();
  }, []);

  // --- Pointer handlers ---

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    // Close context menu on any click
    setContextMenu({ show: false, x: 0, y: 0 });

    // Stop any ongoing inertia on new interaction
    inertiaRef.current.active = false;
    panHistoryRef.current = [];

    // If editing text, finish
    if (editingElement || editingMindmapNode) {
      finishEditing();
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Click a [[link]] rendered on a card → jump to the linked note.
    if (activeTool === 'select') {
      const cp = viewport.screenToCanvas(screenX, screenY);
      const link = sceneRendererRef.current?.getLinkAtPoint(cp.x, cp.y);
      if (link) {
        const targetId = buildLinkIndex(elements).titleToId.get(link.name.toLowerCase());
        const target = targetId && targetId !== link.elementId
          ? elements.find((el) => el.id === targetId)
          : undefined;
        if (target) {
          setSelectedIds([target.id]);
          setSelectedMindmapNode(
            target.type === 'mindmap'
              ? { elementId: target.id, nodeId: (target as MindmapElement).rootNode.id }
              : null,
          );
          setViewport(rect.width / 2 - (target.x + target.width / 2) * viewport.zoom, rect.height / 2 - (target.y + target.height / 2) * viewport.zoom);
          return;
        }
      }
    }

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
        startTextEditing(el, { isNew: true });
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
        startTextEditing(el, { isNew: true });
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
          // Get image dimensions (and make sure it decodes) before caching it
          const img = new Image();
          img.src = dataURL;
          try {
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => reject(new Error('decode failed'));
            });
          } catch {
            useVaultStore.getState().setNotice('无法读取这张图片');
            return;
          }
          await loadImageToCache(fileId, dataURL);
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
      // Priority: resize handles over connection-point arrow drawing
      let clickedHandle = false;
      for (const id of selectedIds) {
        const el = sceneIndexRef.current.byId.get(id);
        if (!el) continue;
        const handle = getResizeHandle(el, sceneIndexRef.current, canvasPos.x, canvasPos.y, 8 / viewport.zoom);
        if (handle) {
          clickedHandle = true;
          break;
        }
      }
      if (clickedHandle) {
        // fall through to handlePointerDown for resize
      } else {
        const existingHit = hitTest(sceneIndexRef.current, canvasPos.x, canvasPos.y, spatialIndexRef.current ?? undefined);
        if (!existingHit) {
          const sourceEl = sceneIndexRef.current.byId.get(hoveredConnectionElementId);
          if (sourceEl) {
            const startAnchor = hoveredAnchorRef.current?.elementId === sourceEl.id
              ? hoveredAnchorRef.current
              : findNearestConnectionAnchor(sourceEl, canvasPos.x, canvasPos.y, 12 / viewport.zoom);
            if (!startAnchor) {
              return;
            }
            const startPoint = startAnchor.point;
            const newArrow = createElementForTool('arrow', startPoint[0], startPoint[1]);
            if (newArrow && (newArrow.type === 'arrow' || newArrow.type === 'line')) {
              const arrowEl = newArrow as LinearElement;
              arrowEl.startBinding = { elementId: sourceEl.id, focus: startAnchor.focus, gap: 0 };
              arrowEl.endBinding = null;
              Object.assign(arrowEl, normalizeLinearPoints([startPoint, startPoint]));
              interactionState.activeElement = arrowEl;
              drawingBindingStateRef.current = {
                start: { binding: arrowEl.startBinding, anchor: startAnchor },
                end: { binding: null, anchor: null },
              };
              syncActiveAnchors([startAnchor]);
              interactionState.startX = canvasPos.x;
              interactionState.startY = canvasPos.y;
              interactionState.currentX = canvasPos.x;
              interactionState.currentY = canvasPos.y;
              actionRef.current = 'draw';
              pushHistory();
              canvas.setPointerCapture(e.pointerId);
              setHoveredConnectionElementId(null);
              invalidateOverlay();
              return;
            }
          }
        }
      }
    }

    if (activeTool === 'select') {
      let mindmapHit = findMindmapHitAtPoint(canvasPos.x, canvasPos.y);
      if (mindmapHit) {
        // Something stacked above the mindmap, or a selected element's resize
        // handle, gets the click instead of the topic underneath.
        const scene = sceneIndexRef.current;
        const onHandle = selectedIds.some((id) => {
          const el = scene.byId.get(id);
          return !!el && el.type !== 'mindmap' && !!getResizeHandle(el, scene, canvasPos.x, canvasPos.y, 8 / viewport.zoom);
        });
        const topHit = hitTest(scene, canvasPos.x, canvasPos.y, spatialIndexRef.current ?? undefined);
        const covered = !!topHit && topHit.id !== mindmapHit.element.id
          && scene.elements.indexOf(topHit) > scene.elements.indexOf(mindmapHit.element);
        if (onHandle || covered) mindmapHit = null;
      }
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
          // This path skips handlePointerDown, so reset its drag threshold here.
          interactionState.hasDragged = false;
          interactionState.dragThreshold = 4;
          dragUnbindRef.current = null;
          actionRef.current = 'drag';
          pushHistory();
        } else {
          mindmapNodeDragRef.current = { elementId: mindmapHit.element.id, nodeId: mindmapHit.node.id };
          mindmapDropTargetRef.current = null;
          actionRef.current = 'mindmap-node-drag';
          setCursorStyle('grabbing');
        }
        canvas.setPointerCapture(e.pointerId);
        invalidateOverlay();
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
      if (nextSelectedIds.length !== 1 || sceneIndexRef.current.byId.get(nextSelectedIds[0])?.type !== 'mindmap') {
        setSelectedMindmapNode(null);
      }
    }

    if (result.action === 'draw' && result.element) {
      // Apply active drawing color
      if (interactionState.activeElement?.type === 'freedraw') {
        interactionState.activeElement.strokeColor = freedrawColor;
      } else if (interactionState.activeElement?.type === 'highlighter') {
        (interactionState.activeElement as any).highlightColor = highlighterColor;
      } else if (interactionState.activeElement?.type === 'line' || interactionState.activeElement?.type === 'arrow') {
        const linear = interactionState.activeElement as LinearElement;
        const startAnchor = getConnectionAnchorFromBinding(sceneIndexRef.current, linear.startBinding);
        const endAnchor = getConnectionAnchorFromBinding(sceneIndexRef.current, linear.endBinding);
        drawingBindingStateRef.current = {
          start: { binding: linear.startBinding, anchor: startAnchor },
          end: { binding: linear.endBinding, anchor: endAnchor },
        };
        syncActiveAnchors([startAnchor, endAnchor]);
      }
      pushHistory();
      invalidateOverlay();
    }

    if (result.action === 'drag') {
      resetLinearBindingPreview();
      pushHistory();
      // Connected lines move freely once dragged: drag them from their resolved
      // geometry; the bindings are dropped only if the drag really moves.
      const dragIds = result.selectedIds ?? selectedIds;
      const unbind = new Map<string, Pick<LinearElement, 'points' | 'width' | 'height'>>();
      for (const id of dragIds) {
        const el = sceneIndexRef.current.byId.get(id);
        if (!el || (el.type !== 'line' && el.type !== 'arrow')) continue;
        const linearEl = el as LinearElement;
        if (linearEl.startBinding || linearEl.endBinding) {
          const normalized = normalizeLinearPoints(getLinearAbsolutePoints(linearEl, sceneIndexRef.current));
          unbind.set(id, { points: normalized.points, width: normalized.width, height: normalized.height });
          interactionState.originalElements.set(id, {
            x: normalized.x, y: normalized.y,
            width: normalized.width, height: normalized.height,
          });
        }
      }
      dragUnbindRef.current = unbind.size > 0 ? unbind : null;
    }

    if (result.action === 'resize') {
      if (result.handle === 'start' || result.handle === 'end') {
        resizeBindingStateRef.current = new Map(
          (result.selectedIds ?? selectedIds)
            .map((id) => {
              const element = sceneIndexRef.current.byId.get(id);
              if (!element || (element.type !== 'line' && element.type !== 'arrow')) return null;
              const linear = element as LinearElement;
              const binding = result.handle === 'start' ? linear.startBinding : linear.endBinding;
              return [id, { binding, anchor: getConnectionAnchorFromBinding(sceneIndexRef.current, binding) } satisfies StickyEndpointState] as const;
            })
            .filter(Boolean) as [string, StickyEndpointState][],
        );
        syncActiveAnchors(Array.from(resizeBindingStateRef.current.values(), (value) => value.anchor));
      } else {
        resetLinearBindingPreview();
      }
      pushHistory();
      invalidateOverlay();
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
    invalidateOverlay,
  ]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    if (actionRef.current === 'pan') {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      panStartRef.current = { x: e.clientX, y: e.clientY };
      viewport.pan(dx, dy);

      // Record pan sample for inertia calculation
      const sampleTime = performance.now();
      panHistoryRef.current.push({ dx, dy, time: sampleTime });
      if (panHistoryRef.current.length > 5) {
        panHistoryRef.current.shift();
      }

      const now = performance.now();
      if (now - lastMoveTimeRef.current >= 16) {
        lastMoveTimeRef.current = now;
        setViewport(viewport.x, viewport.y);
      } else {
        invalidateScene();
      }
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    lastPointerScreenRef.current = { screenX, screenY };
    const canvasPos = viewport.screenToCanvas(screenX, screenY);

    // Edge auto-pan during drag or select
    if (actionRef.current === 'drag' || actionRef.current === 'select') {
      const EDGE_MARGIN = 40;
      const SPEED_FACTOR = 0.25;
      let vx = 0;
      let vy = 0;
      if (screenX < EDGE_MARGIN) {
        vx = -(EDGE_MARGIN - screenX) * SPEED_FACTOR;
      } else if (screenX > rect.width - EDGE_MARGIN) {
        vx = (screenX - (rect.width - EDGE_MARGIN)) * SPEED_FACTOR;
      }
      if (screenY < EDGE_MARGIN) {
        vy = -(EDGE_MARGIN - screenY) * SPEED_FACTOR;
      } else if (screenY > rect.height - EDGE_MARGIN) {
        vy = (screenY - (rect.height - EDGE_MARGIN)) * SPEED_FACTOR;
      }
      autoPanRef.current = { vx, vy, active: vx !== 0 || vy !== 0 };
    } else {
      autoPanRef.current.active = false;
    }

    if (actionRef.current === 'mindmap-node-drag') {
      interactionState.currentX = canvasPos.x;
      interactionState.currentY = canvasPos.y;
      const dragState = mindmapNodeDragRef.current;
      let dropTarget: { elementId: string; nodeId: string } | null = null;

      if (dragState) {
        const sourceElement = sceneIndexRef.current.byId.get(dragState.elementId);
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
      invalidateOverlay();
      return;
    }

    const isLinearTool = activeTool === 'line' || activeTool === 'arrow'
      || interactionState.activeElement?.type === 'line'
      || interactionState.activeElement?.type === 'arrow';

    if (isLinearTool) {
      const bindingTarget = findBindableElementWithStickyPreference(sceneIndexRef.current, canvasPos.x, canvasPos.y, {
        acquireThreshold: 16 / zoom,
        releaseThreshold: 16 / zoom,
      });
      const nextHoveredId = bindingTarget?.element.id ?? null;
      if (nextHoveredId !== hoveredConnectableId) {
        setHoveredConnectableId(nextHoveredId);
      }
      if (syncHoveredAnchor(bindingTarget
        ? {
            elementId: bindingTarget.element.id,
            focus: bindingTarget.focus,
            index: bindingTarget.index,
            point: bindingTarget.point,
            normal: bindingTarget.normal,
          }
        : null)) {
        invalidateOverlay();
      }
    } else if (hoveredConnectableId) {
      setHoveredConnectableId(null);
      if (syncHoveredAnchor(null)) {
        invalidateOverlay();
      }
    } else if (hoveredAnchorRef.current && activeTool !== 'select') {
      if (syncHoveredAnchor(null)) {
        invalidateOverlay();
      }
    }

    // Track resize handle hover for visual feedback (before connection points)
    let nextHandle: string | null = null;
    if (actionRef.current === 'none' && activeTool === 'select') {
      for (const id of selectedIds) {
        const el = sceneIndexRef.current.byId.get(id);
        if (!el) continue;
        const handle = getResizeHandle(el, sceneIndexRef.current, canvasPos.x, canvasPos.y, 10 / zoom);
        if (handle) {
          nextHandle = handle;
          break;
        }
      }
      if (nextHandle !== hoveredHandleRef.current) {
        hoveredHandleRef.current = nextHandle;
        invalidateOverlay();
      }
    }

    // Hovering a rendered [[link]] (select tool, idle) shows a pointer cursor.
    const overLink = activeTool === 'select'
      && actionRef.current === 'none'
      && !!sceneRendererRef.current?.getLinkAtPoint(canvasPos.x, canvasPos.y);

    // Show connection points when hovering near a selected element's edge (select tool, idle)
    if (activeTool === 'select' && actionRef.current === 'none' && selectedIds.length >= 1) {
      let foundConnectionEl: string | null = null;
      let foundConnectionAnchor: ConnectionAnchorDescriptor | null = null;
      for (const id of selectedIds) {
        const el = sceneIndexRef.current.byId.get(id);
        if (!el || !isConnectableElement(el)) continue;
        const anchor = findNearestConnectionAnchor(el, canvasPos.x, canvasPos.y, 12 / zoom);
        if (anchor) {
          foundConnectionEl = id;
          foundConnectionAnchor = anchor;
          break;
        }
        if (foundConnectionEl) break;
      }
      if (foundConnectionEl !== hoveredConnectionElementId) {
        setHoveredConnectionElementId(foundConnectionEl);
      }
      if (syncHoveredAnchor(foundConnectionAnchor)) {
        invalidateOverlay();
      }
      let wantCursor: string;
      if (nextHandle) {
        switch (nextHandle) {
          case 'nw': case 'se': wantCursor = 'nwse-resize'; break;
          case 'ne': case 'sw': wantCursor = 'nesw-resize'; break;
          case 'n': case 's': wantCursor = 'ns-resize'; break;
          case 'e': case 'w': wantCursor = 'ew-resize'; break;
          default: wantCursor = 'default';
        }
      } else {
        wantCursor = foundConnectionEl ? 'crosshair' : overLink ? 'pointer' : 'default';
      }
      if (wantCursor !== cursorRef.current) {
        setCursorStyle(wantCursor);
      }
    } else if (hoveredConnectionElementId) {
      setHoveredConnectionElementId(null);
      if (cursorRef.current === 'crosshair') setCursorStyle('default');
      if (activeTool === 'select' && syncHoveredAnchor(null)) {
        invalidateOverlay();
      }
    } else if (activeTool === 'select' && actionRef.current === 'none') {
      // Nothing selected: only toggle between the link pointer and the default cursor.
      const wantCursor = overLink ? 'pointer' : 'default';
      if (wantCursor !== cursorRef.current && (cursorRef.current === 'pointer' || cursorRef.current === 'default')) {
        setCursorStyle(wantCursor);
      }
    }

    // Track general element hover for visual feedback
    if (actionRef.current === 'none') {
      const hit = hitTest(sceneIndexRef.current, canvasPos.x, canvasPos.y, spatialIndexRef.current ?? undefined);
      const nextHoverId = hit?.id ?? null;
      if (nextHoverId !== hoveredElementIdRef.current) {
        hoveredElementIdRef.current = nextHoverId;
        invalidateOverlay();
      }
    }

    if (actionRef.current === 'none') return;

    if (actionRef.current === 'draw' && (interactionState.activeElement?.type === 'line' || interactionState.activeElement?.type === 'arrow')) {
      const linear = interactionState.activeElement as LinearElement;
      const startPoint = getConnectionPointFromBinding(sceneIndexRef.current, linear.startBinding) ?? [
        linear.x + (linear.points[0]?.[0] ?? 0),
        linear.y + (linear.points[0]?.[1] ?? 0),
      ];
      const sticky = findBindableElementWithStickyPreference(sceneIndexRef.current, canvasPos.x, canvasPos.y, {
        acquireThreshold: 16 / zoom,
        releaseThreshold: 24 / zoom,
        fromPoint: startPoint,
        currentBinding: drawingBindingStateRef.current.end.binding,
      });
      const endAnchor = sticky
        ? {
            elementId: sticky.element.id,
            focus: sticky.focus,
            index: sticky.index,
            point: sticky.point,
            normal: sticky.normal,
          }
        : null;
      const endBinding = endAnchor
        ? { elementId: endAnchor.elementId, focus: endAnchor.focus, gap: 0 }
        : null;
      const endPoint = endAnchor?.point ?? [canvasPos.x, canvasPos.y] as [number, number];

      linear.endBinding = endBinding;
      Object.assign(linear, normalizeLinearPoints([startPoint, endPoint]));
      drawingBindingStateRef.current.end = { binding: endBinding, anchor: endAnchor };

      const startAnchor = drawingBindingStateRef.current.start.anchor;
      syncActiveAnchors([startAnchor, endAnchor]);
      setHoveredConnectableId(endAnchor?.elementId ?? null);
      syncHoveredAnchor(endAnchor);
      invalidateOverlay();
      return;
    }

    if (
      actionRef.current === 'draw'
      && (interactionState.activeElement?.type === 'freedraw' || interactionState.activeElement?.type === 'highlighter')
    ) {
      const nativeEvent = e.nativeEvent as PointerEvent;
      const rawSamples = nativeEvent.getCoalescedEvents?.() ?? [nativeEvent];
      const activeElement = interactionState.activeElement;

      appendFreehandSamples(activeElement, rawSamples.map((sample) => {
        const sampleScreenX = sample.clientX - rect.left;
        const sampleScreenY = sample.clientY - rect.top;
        const sampleCanvas = viewport.screenToCanvas(sampleScreenX, sampleScreenY);
        return {
          x: sampleCanvas.x,
          y: sampleCanvas.y,
          pressure: sample.pressure,
        };
      }));

      const lastSample = rawSamples[rawSamples.length - 1] ?? nativeEvent;
      const lastCanvasPos = viewport.screenToCanvas(lastSample.clientX - rect.left, lastSample.clientY - rect.top);
      interactionState.currentX = lastCanvasPos.x;
      interactionState.currentY = lastCanvasPos.y;
      invalidateOverlay();
      return;
    }

    if (actionRef.current === 'resize' && (interactionState.resizeHandle === 'start' || interactionState.resizeHandle === 'end')) {
      const updates = new Map<string, Partial<Element>>();
      let hoveredAnchor: ConnectionAnchorDescriptor | null = null;
      let hoveredElementId: string | null = null;
      const activeAnchors: ConnectionAnchorDescriptor[] = [];

      for (const id of selectedIds) {
        const element = sceneIndexRef.current.byId.get(id);
        if (!element || (element.type !== 'line' && element.type !== 'arrow')) continue;

        const linear = element as LinearElement;
        const points = getLinearAbsolutePoints(linear, sceneIndexRef.current);
        if (points.length < 2) continue;

        const fromPoint = interactionState.resizeHandle === 'start'
          ? points[points.length - 1]
          : points[0];
        const stickyState = resizeBindingStateRef.current.get(id) ?? {
          binding: interactionState.resizeHandle === 'start' ? linear.startBinding : linear.endBinding,
          anchor: null,
        };
        const sticky = findBindableElementWithStickyPreference(sceneIndexRef.current, canvasPos.x, canvasPos.y, {
          acquireThreshold: 16 / zoom,
          releaseThreshold: 24 / zoom,
          fromPoint,
          currentBinding: stickyState.binding,
        });
        const nextAnchor = sticky
          ? {
              elementId: sticky.element.id,
              focus: sticky.focus,
              index: sticky.index,
              point: sticky.point,
              normal: sticky.normal,
            }
          : null;
        const nextBinding = nextAnchor
          ? { elementId: nextAnchor.elementId, focus: nextAnchor.focus, gap: 0 }
          : null;
        const nextPoint = nextAnchor?.point ?? ([canvasPos.x, canvasPos.y] as [number, number]);
        const nextPoints = [...points] as [number, number][];

        if (interactionState.resizeHandle === 'start') {
          nextPoints[0] = nextPoint;
          updates.set(id, {
            ...normalizeLinearPoints(nextPoints),
            startBinding: nextBinding,
            endBinding: linear.endBinding,
          } as Partial<Element>);
        } else {
          nextPoints[nextPoints.length - 1] = nextPoint;
          updates.set(id, {
            ...normalizeLinearPoints(nextPoints),
            startBinding: linear.startBinding,
            endBinding: nextBinding,
          } as Partial<Element>);
        }

        resizeBindingStateRef.current.set(id, { binding: nextBinding, anchor: nextAnchor });
        if (!hoveredAnchor && nextAnchor) {
          hoveredAnchor = nextAnchor;
          hoveredElementId = nextAnchor.elementId;
        }
        if (nextAnchor) {
          activeAnchors.push(nextAnchor);
        }
      }

      setPendingElementUpdates(updates.size > 0 ? updates : null);
      setHoveredConnectableId(hoveredElementId);
      syncHoveredAnchor(hoveredAnchor);
      syncActiveAnchors(activeAnchors);

      if (updates.size > 0) {
        const upd = Array.from(updates.values())[0];
        if (upd.width !== undefined && upd.height !== undefined) {
          const screen = viewport.canvasToScreen(
            (upd.x ?? 0) + (upd.width ?? 0),
            (upd.y ?? 0) + (upd.height ?? 0),
          );
          setResizeInfo({ x: screen.x + 10, y: screen.y + 10, w: Math.round(upd.width), h: Math.round(upd.height) });
        }
      }

      invalidateOverlay();
      return;
    }

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
      invalidateOverlay();
    }

    if (result.selectionBox) {
      selectionBoxRef.current = result.selectionBox;
      if (actionRef.current === 'select') {
        const box = result.selectionBox;
        const lassoIds = getElementsInSelectionBox(useDocumentStore.getState().elements, box);
        lassoSelectedIdsRef.current = lassoIds;
      }
      invalidateOverlay();
    }

    if (result.updatedElements && result.hasDragged !== false) {
      setPendingElementUpdates(result.updatedElements.size > 0 ? withConnectorUnbinding(result.updatedElements) : null);

      if (actionRef.current === 'resize' && result.updatedElements.size > 0) {
        const upd = Array.from(result.updatedElements.values())[0];
        if (upd.width !== undefined && upd.height !== undefined) {
          const screen = viewport.canvasToScreen(
            (upd.x ?? 0) + (upd.width ?? 0),
            (upd.y ?? 0) + (upd.height ?? 0),
          );
          setResizeInfo({ x: screen.x + 10, y: screen.y + 10, w: Math.round(upd.width), h: Math.round(upd.height) });
        }
      }

      invalidateOverlay();
    }
  }, [
    elements,
    selectedIds,
    setViewport,
    showGrid,
    appState.gridSize,
    activeTool,
    zoom,
    hoveredConnectableId,
    hoveredConnectionElementId,
    findMindmapDropTargetAtPoint,
    invalidateOverlay,
    invalidateScene,
    setPendingElementUpdates,
  ]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const finalizePointerRelease = (
      clientX: number,
      clientY: number,
      pointerId?: number,
      shouldReleaseCapture = false,
    ) => {
      if (shouldReleaseCapture && pointerId !== undefined && canvas.hasPointerCapture(pointerId)) {
        canvas.releasePointerCapture(pointerId);
      }

      const rect = canvas.getBoundingClientRect();
      const hasPointerCoordinates = Number.isFinite(clientX) && Number.isFinite(clientY);
      const canvasPos = hasPointerCoordinates
        ? viewport.screenToCanvas(clientX - rect.left, clientY - rect.top)
        : { x: interactionState.currentX, y: interactionState.currentY };

      commitPendingElementUpdates();
      dragUnbindRef.current = null;

      // Drag threshold: if never crossed, treat as a pure click
      if (actionRef.current === 'drag' && !interactionState.hasDragged) {
        setPendingElementUpdates(null);
      }

      if (actionRef.current === 'pan') {
        setCursorStyle(activeTool === 'hand' ? 'grab' : 'default');

        // Calculate inertia velocity from recent pan samples
        const samples = panHistoryRef.current;
        if (samples.length >= 2) {
          let totalDx = 0;
          let totalDy = 0;
          let totalDt = 0;
          const startIndex = Math.max(1, samples.length - 3);
          for (let i = startIndex; i < samples.length; i++) {
            totalDx += samples[i].dx;
            totalDy += samples[i].dy;
            totalDt += samples[i].time - samples[i - 1].time;
          }
          if (totalDt > 0) {
            const vx = totalDx / totalDt; // px/ms
            const vy = totalDy / totalDt;
            const speed = Math.hypot(vx, vy);
            if (speed > 0.4) {
              // Scale to per-frame velocity (~16ms)
              inertiaRef.current = { vx: vx * 16, vy: vy * 16, active: true };
            }
          }
        }
        panHistoryRef.current = [];
      }

      if (actionRef.current === 'mindmap-node-drag') {
        const dragState = mindmapNodeDragRef.current;
        const dropTarget = mindmapDropTargetRef.current;
        mindmapNodeDragRef.current = null;
        mindmapDropTargetRef.current = null;
        setCursorStyle('default');

        if (dragState) {
          const dragDistance = Math.hypot(canvasPos.x - interactionState.startX, canvasPos.y - interactionState.startY);
          const sourceElement = sceneIndexRef.current.byId.get(dragState.elementId);

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
      }

      if (actionRef.current === 'select' && selectionBoxRef.current) {
        const box = selectionBoxRef.current;
        if (box.width > 3 || box.height > 3) {
          const ids = getElementsInSelectionBox(elements, box);
          setSelectedIds(ids);
          if (ids.length !== 1 || sceneIndexRef.current.byId.get(ids[0])?.type !== 'mindmap') {
            setSelectedMindmapNode(null);
          }
        }
      }

      if (actionRef.current === 'draw' && interactionState.activeElement) {
        const el = interactionState.activeElement;
        if (el.type === 'freedraw' || el.type === 'highlighter') {
          const finalized = finalizeFreehandElement(el as any);
          if (finalized) {
            addElement(finalized);
          }
        } else if (el.type === 'line' || el.type === 'arrow') {
          const points = getLinearAbsolutePoints(el as LinearElement, sceneIndexRef.current);
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
      }

      interactionState.activeElement = null;
      actionRef.current = 'none';
      interactionState.resizeHandle = null;
      selectionBoxRef.current = null;
      snapGuidesRef.current = [];
      mindmapNodeDragRef.current = null;
      mindmapDropTargetRef.current = null;
      setPendingElementUpdates(null);
      resetLinearBindingPreview();
      setHoveredConnectableId(null);
      setHoveredConnectionElementId(null);
      setResizeInfo(null);
      autoPanRef.current.active = false;
      lastPointerScreenRef.current = null;
      lassoSelectedIdsRef.current = [];
      invalidateOverlay();
    };

    finalizePointerRelease(e.clientX, e.clientY, e.pointerId, true);
  }, [addElement, setActiveTool, activeTool, setCursorStyle, elements, setSelectedIds, commitPendingElementUpdates, pushHistory, updateElement, zoom, resetLinearBindingPreview, setPendingElementUpdates, invalidateOverlay]);

  const onPointerCancel = useCallback((e: React.PointerEvent) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    if (canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    const rect = canvas.getBoundingClientRect();
    const clientX = Number.isFinite(e.clientX) ? e.clientX : rect.left + (interactionState.currentX * zoom + viewport.x);
    const clientY = Number.isFinite(e.clientY) ? e.clientY : rect.top + (interactionState.currentY * zoom + viewport.y);
    const event = { clientX, clientY, pointerId: e.pointerId };
    onPointerUp(event as React.PointerEvent);
  }, [onPointerUp, zoom, viewport.x, viewport.y]);

  const onLostPointerCapture = useCallback((e: React.PointerEvent) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    if (actionRef.current === 'none' && !pendingElementUpdatesRef.current && !interactionState.activeElement) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const clientX = Number.isFinite(e.clientX) ? e.clientX : rect.left + (interactionState.currentX * zoom + viewport.x);
    const clientY = Number.isFinite(e.clientY) ? e.clientY : rect.top + (interactionState.currentY * zoom + viewport.y);
    const event = { clientX, clientY, pointerId: e.pointerId };
    onPointerUp(event as React.PointerEvent);
  }, [onPointerUp, zoom, viewport.x, viewport.y]);

  // Double-click to edit text or mindmap nodes
  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const canvasPos = viewport.screenToCanvas(screenX, screenY);

    const hit = hitTest(sceneIndexRef.current, canvasPos.x, canvasPos.y, spatialIndexRef.current ?? undefined);
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
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    if (e.ctrlKey || e.metaKey) {
      const delta = -e.deltaY * 0.01;
      const currentTargetZoom = useUIStore.getState().targetZoom;
      const newTargetZoom = currentTargetZoom * (1 + delta);
      useUIStore.getState().setTargetZoom(newTargetZoom);
      zoomCenterRef.current = { x: screenX, y: screenY };
      invalidateScene();
    } else {
      viewport.pan(-e.deltaX, -e.deltaY);
      const now = performance.now();
      const shouldUpdate = now - lastWheelTimeRef.current >= 16;
      if (shouldUpdate) {
        lastWheelTimeRef.current = now;
        setViewport(viewport.x, viewport.y);
      } else {
        invalidateScene();
      }
    }
  }, [setViewport, invalidateScene]);

  const onContextMenuHandler = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ show: true, x: e.clientX, y: e.clientY });
  }, []);

  // Keyboard shortcuts (extracted to ./useCanvasShortcuts, P0.C)
  useCanvasShortcuts({
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
  });

  // --- Text editing overlay position ---
  // Text editor overlay position/style — computed by ./text-editing (P0.C).
  const editPos = computeEditingPosition({
    editingElement,
    editingMindmapNode,
    zoom,
    viewport,
    sceneIndex: sceneIndexRef.current,
    renderer: sceneRendererRef.current,
  });

  // --- "[[" link autocomplete while editing ---
  const editingOwnerId = editingElement?.id ?? editingMindmapNode?.elementId ?? null;
  const noteTitles = useMemo(() => {
    const seen = new Set<string>();
    const titles: string[] = [];
    for (const el of elements) {
      if (el.id === editingOwnerId) continue;
      const title = getNoteTitle(el);
      if (title && !seen.has(title)) {
        seen.add(title);
        titles.push(title);
      }
    }
    return titles;
  }, [elements, editingOwnerId]);

  const linkSuggestions = linkSuggest
    ? noteTitles.filter((t) => t.toLowerCase().includes(linkSuggest.query.toLowerCase())).slice(0, 8)
    : [];
  const activeSuggestion = linkSuggest ? Math.min(linkSuggest.index, linkSuggestions.length - 1) : 0;

  const updateLinkSuggest = (value: string, caret: number) => {
    // Query = text after the LAST unclosed "[[" before the caret (no "]", newline or nested "[[").
    const match = value.slice(0, caret).match(/\[\[((?:(?!\[\[)[^\]\n])*)$/u);
    if (!match) {
      setLinkSuggest(null);
      return;
    }
    const start = caret - match[1].length - 2;
    setLinkSuggest((prev) => ({ start, query: match[1], index: prev && prev.start === start ? prev.index : 0 }));
  };

  const acceptLink = (title: string) => {
    const ta = textareaRef.current;
    if (!ta || !linkSuggest) return;
    const value = ta.value;
    const caret = ta.selectionStart ?? value.length;
    const before = value.slice(0, linkSuggest.start);
    let after = value.slice(caret);
    if (after.startsWith(']]')) after = after.slice(2);
    const insert = `[[${title}]]`;
    setEditText(before + insert + after);
    setLinkSuggest(null);
    const pos = before.length + insert.length;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  };

  // Close the autocomplete when editing ends.
  useEffect(() => {
    if (!editingElement && !editingMindmapNode) setLinkSuggest(null);
  }, [editingElement, editingMindmapNode]);

  // Grow the editor textarea with its content while typing.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(editPos.height, ta.scrollHeight)}px`;
  }, [editText, editPos.height, editingElement, editingMindmapNode]);

  return (
    <div className="absolute inset-0">
      <canvas
        ref={sceneCanvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ pointerEvents: 'none' }}
      />
      <canvas
        ref={overlayCanvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ cursor: cursorStyle }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onLostPointerCapture}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
        onContextMenu={onContextMenuHandler}
        tabIndex={0}
      />

      {/* Text editing overlay */}
      {(editingElement || editingMindmapNode) && (
        <div className="absolute" style={{ left: editPos.left, top: editPos.top, zIndex: 20 }}>
          <textarea
            ref={textareaRef}
            className={`block resize-none overflow-hidden outline-none ${
              editPos.chrome === 'plain'
                ? 'border-0 bg-transparent shadow-none'
                : editingMindmapNode
                  ? 'border border-emerald-200/90 bg-white/70 shadow-[0_12px_32px_rgba(15,23,42,0.08)]'
                  : 'border border-blue-300/90 bg-white/80 shadow-[0_12px_32px_rgba(15,23,42,0.08)]'
            }`}
            style={{
              width: editPos.width,
              minHeight: editPos.height,
              fontSize: `${editPos.fontSize}px`,
              fontFamily: editPos.fontFamily,
              color: editPos.color,
              padding: editPos.padding,
              textAlign: (editPos as any).textAlign ?? 'left',
              lineHeight: 1.3,
              backgroundColor: (editPos as any).backgroundColor,
              borderRadius: `${(editPos as any).borderRadius ?? 0}px`,
            }}
            value={editText}
            onChange={(e) => {
              setEditText(e.target.value);
              updateLinkSuggest(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onSelect={(e) => updateLinkSuggest(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
            onBlur={finishEditing}
            onKeyDown={(e) => {
              if (linkSuggest && linkSuggestions.length > 0) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  e.stopPropagation();
                  const delta = e.key === 'ArrowDown' ? 1 : -1;
                  const count = linkSuggestions.length;
                  setLinkSuggest((prev) => prev && { ...prev, index: (Math.min(prev.index, count - 1) + delta + count) % count });
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  e.stopPropagation();
                  acceptLink(linkSuggestions[activeSuggestion]);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setLinkSuggest(null);
                  return;
                }
              }
              if (e.key === 'Escape') {
                finishEditing();
                e.preventDefault();
              }
              e.stopPropagation();
            }}
          />

          {linkSuggest && linkSuggestions.length > 0 && (
            <div className="absolute left-0 top-full mt-1.5 w-56 overflow-hidden rounded-xl border border-black/[0.06] bg-white/90 py-1 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_12px_36px_rgba(0,0,0,0.14)] backdrop-blur-xl dark:border-white/10 dark:bg-[#1c1c1e]/90">
              <div className="px-3 pb-1 pt-1 text-[11px] font-medium tracking-wide text-slate-400 dark:text-slate-500">链接到笔记</div>
              {linkSuggestions.map((title, i) => (
                <button
                  key={title}
                  type="button"
                  className={`flex w-full items-center px-3 py-1.5 text-left text-[13px] ${
                    i === activeSuggestion
                      ? 'bg-[#007aff] text-white'
                      : 'text-slate-700 hover:bg-black/[0.04] dark:text-slate-200 dark:hover:bg-white/10'
                  }`}
                  // mousedown + preventDefault keeps the textarea focused (no blur → finishEditing).
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    acceptLink(title);
                  }}
                >
                  <span className="truncate">{title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
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
        onBringToFront={() => { commitPendingElementUpdates(); pushHistory(); bringToFront(selectedIds); }}
        onSendToBack={() => { commitPendingElementUpdates(); pushHistory(); sendToBack(selectedIds); }}
        onBringForward={() => { commitPendingElementUpdates(); pushHistory(); bringForward(selectedIds); }}
        onSendBackward={() => { commitPendingElementUpdates(); pushHistory(); sendBackward(selectedIds); }}
        onSelectAll={() => {
          setSelectedIds(elements.map(el => el.id));
          setSelectedMindmapNode(null);
        }}
        onGroup={() => { commitPendingElementUpdates(); pushHistory(); groupElements(selectedIds); }}
        onUngroup={() => { commitPendingElementUpdates(); pushHistory(); ungroupElements(selectedIds); }}
      />
    </div>
  );
}
