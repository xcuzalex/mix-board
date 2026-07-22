import type { Element, ArrowType, LinearElement, MindmapElement, MindmapNode, ImageElement } from '../types/element';
import { getStroke } from 'perfect-freehand';
import { STICKY_NOTE_COLORS, THEME } from '../utils/color';
import { Viewport } from './viewport';
import {
  createSceneIndex,
  getAnchorNormalFromFocus,
  getConnectionAnchorFromBinding,
  getConnectionPoints as getElementConnectionPoints,
  getLinearAbsolutePoints,
  getLinearBounds,
  isConnectableElement,
  type ConnectionAnchorDescriptor,
  type SceneIndex,
} from './linear';
import { createShapePath, getElementShapeVariant, renderShapeDecoration } from './shape-utils';
import type { SnapGuide } from '../utils/math';

// Image cache for rendering
const imageCache = new Map<string, HTMLImageElement>();

export function clearImageCache() {
  imageCache.clear();
}

export function loadImageToCache(fileId: string, dataURL: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (imageCache.has(fileId)) { resolve(); return; }
    const img = new Image();
    img.onload = () => { imageCache.set(fileId, img); resolve(); };
    img.onerror = reject;
    img.src = dataURL;
  });
}

export function getImageFromCache(fileId: string): HTMLImageElement | undefined {
  return imageCache.get(fileId);
}

export interface SelectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MindmapDragPreview {
  elementId: string;
  sourceNodeId: string;
  pointerX: number;
  pointerY: number;
  offsetX: number;
  offsetY: number;
}

export interface OverlayRenderOptions {
  geometryElements: Element[];
  selectedIds: string[];
  previewElements?: Element[];
  activeElement?: Element | null;
  selectionBox?: SelectionBox | null;
  snapGuides?: SnapGuide[];
  hoveredElementId?: string | null;
  hoveredAnchor?: ConnectionAnchorDescriptor | null;
  activeAnchors?: ConnectionAnchorDescriptor[];
  activeDrawingTool?: string | null;
  selectedMindmapNode?: { elementId: string; nodeId: string } | null;
  hoveredConnectionElementId?: string | null;
  editingElementId?: string | null;
  editingMindmapNodeId?: string | null;
  mindmapDropTarget?: { elementId: string; nodeId: string } | null;
  mindmapDragPreview?: MindmapDragPreview | null;
  lassoSelectedIds?: string[];
}

type Rect = { x: number; y: number; w: number; h: number };

type MindmapLayoutCacheEntry = {
  signature: string;
  x: number;
  y: number;
  layout: Map<string, Rect>;
};

let textLayoutCacheGeneration = 0;
let fontLoadInvalidationInstalled = false;

function invalidateTextLayoutCaches() {
  textLayoutCacheGeneration += 1;
}

function installFontLoadInvalidation() {
  if (fontLoadInvalidationInstalled) return;
  fontLoadInvalidationInstalled = true;

  if (typeof document === 'undefined' || !('fonts' in document)) return;

  const fontFaceSet = document.fonts;
  const handleFontLoad = () => {
    invalidateTextLayoutCaches();
  };

  void fontFaceSet.ready.then(handleFontLoad).catch(() => {});

  if ('addEventListener' in fontFaceSet) {
    fontFaceSet.addEventListener('loadingdone', handleFontLoad);
  }
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private viewport: Viewport;
  private width = 0;
  private height = 0;
  private sceneIndex: SceneIndex = createSceneIndex([]);
  private selectedMindmapNode: { elementId: string; nodeId: string } | null = null;
  private editingElementId: string | null = null;
  private editingMindmapNodeId: string | null = null;
  private mindmapDropTarget: { elementId: string; nodeId: string } | null = null;
  private mindmapDragPreview: { elementId: string; sourceNodeId: string; pointerX: number; pointerY: number; offsetX: number; offsetY: number } | null = null;
  private shapePathCache = new Map<string, Path2D>();
  private freehandPathCache = new Map<string, Path2D>();
  private stickyWrapCache = new Map<string, string[]>();
  private mindmapNodeMeasureCache = new Map<string, { w: number; h: number }>();
  private mindmapLayoutCache = new Map<string, MindmapLayoutCacheEntry>();
  private textLayoutCacheGeneration = -1;
  private interactiveChrome = false;
  private hoveredElementId: string | null = null;
  private hoveredHandle: string | null = null;
  private selectionAnimProgress = 1;
  private lastSelectedCount = 0;
  private selectionAnimStartTime = 0;
  private sceneIndexCache: { index: SceneIndex; elements: Element[] } | null = null;

  constructor(ctx: CanvasRenderingContext2D, viewport: Viewport) {
    this.ctx = ctx;
    this.viewport = viewport;
    installFontLoadInvalidation();
    this.refreshTextLayoutCachesIfNeeded();
  }

  setSize(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  setHoveredElementId(id: string | null) {
    this.hoveredElementId = id;
  }

  setHoveredHandle(handle: string | null) {
    this.hoveredHandle = handle;
  }

  private isElementVisible(el: Element): boolean {
    const margin = 50;
    const vpLeft = -this.viewport.x / this.viewport.zoom - margin;
    const vpTop = -this.viewport.y / this.viewport.zoom - margin;
    const vpRight = vpLeft + this.width / this.viewport.zoom + margin * 2;
    const vpBottom = vpTop + this.height / this.viewport.zoom + margin * 2;
    if (el.type === 'line' || el.type === 'arrow') {
      const bounds = getLinearBounds(el as LinearElement, this.sceneIndex);
      return bounds.x + bounds.width >= vpLeft && bounds.x <= vpRight &&
             bounds.y + bounds.height >= vpTop && bounds.y <= vpBottom;
    }
    if (el.type === 'mindmap') return true;
    return el.x + el.width >= vpLeft && el.x <= vpRight &&
           el.y + el.height >= vpTop && el.y <= vpBottom;
  }

  private getSceneIndex(elements: Element[]): SceneIndex {
    if (this.sceneIndexCache && this.sceneIndexCache.elements === elements) {
      return this.sceneIndexCache.index;
    }
    const index = createSceneIndex(elements);
    this.sceneIndexCache = { index, elements };
    return index;
  }

  private getExpandedViewportRect(): { left: number; top: number; right: number; bottom: number } {
    const margin = 100 / this.viewport.zoom;
    const left = -this.viewport.x / this.viewport.zoom - margin;
    const top = -this.viewport.y / this.viewport.zoom - margin;
    const right = left + this.width / this.viewport.zoom + margin * 2;
    const bottom = top + this.height / this.viewport.zoom + margin * 2;
    return { left, top, right, bottom };
  }

  private isElementInExpandedViewport(
    el: Element,
    vp: { left: number; top: number; right: number; bottom: number },
  ): boolean {
    if (el.type === 'line' || el.type === 'arrow') {
      const bounds = getLinearBounds(el as LinearElement, this.sceneIndex);
      return bounds.x + bounds.width >= vp.left && bounds.x <= vp.right &&
             bounds.y + bounds.height >= vp.top && bounds.y <= vp.bottom;
    }
    if (el.type === 'mindmap') return true;
    return el.x + el.width >= vp.left && el.x <= vp.right &&
           el.y + el.height >= vp.top && el.y <= vp.bottom;
  }

  private trimCache<T>(cache: Map<string, T>, maxSize: number) {
    while (cache.size > maxSize) {
      const firstKey = cache.keys().next().value;
      if (firstKey === undefined) break;
      cache.delete(firstKey);
    }
  }

  private refreshTextLayoutCachesIfNeeded() {
    if (this.textLayoutCacheGeneration === textLayoutCacheGeneration) return;

    this.stickyWrapCache.clear();
    this.mindmapNodeMeasureCache.clear();
    this.mindmapLayoutCache.clear();
    this.textLayoutCacheGeneration = textLayoutCacheGeneration;
  }

  private getMindmapLayoutSignature(el: MindmapElement): string {
    const visit = (node: MindmapNode): string => {
      const children = node.children.map(visit).join(',');
      const leftChildren = (node.leftChildren || []).map(visit).join(',');
      const rightChildren = (node.rightChildren || []).map(visit).join(',');
      return [
        node.id,
        node.text,
        node.fontSize,
        node.nodeShape,
        node.nodeType,
        node.collapsed ? 1 : 0,
        `[${children}]`,
        `[${leftChildren}]`,
        `[${rightChildren}]`,
      ].join('|');
    };

    return [el.layout, visit(el.rootNode)].join('::');
  }

  private shiftLayoutMap(layout: Map<string, Rect>, dx: number, dy: number): Map<string, Rect> {
    return new Map(Array.from(layout.entries(), ([nodeId, rect]) => [
      nodeId,
      { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h },
    ]));
  }

  private getMindmapLayout(el: MindmapElement): Map<string, Rect> {
    this.refreshTextLayoutCachesIfNeeded();
    const signature = this.getMindmapLayoutSignature(el);
    const cached = this.mindmapLayoutCache.get(el.id);
    if (cached && cached.signature === signature) {
      if (cached.x !== el.x || cached.y !== el.y) {
        const shiftedLayout = this.shiftLayoutMap(cached.layout, el.x - cached.x, el.y - cached.y);
        cached.layout = shiftedLayout;
        cached.x = el.x;
        cached.y = el.y;
      }
      return cached.layout;
    }

    const layout = this.layoutMindmapNodes(el);
    this.mindmapLayoutCache.set(el.id, { signature, x: el.x, y: el.y, layout });
    this.trimCache(this.mindmapLayoutCache, 100);
    return layout;
  }

  getMindmapBounds(el: MindmapElement): { x: number; y: number; width: number; height: number } {
    const layout = this.getMindmapLayout(el);
    if (layout.size === 0) {
      return { x: el.x, y: el.y, width: el.width, height: el.height };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const rect of layout.values()) {
      minX = Math.min(minX, rect.x);
      minY = Math.min(minY, rect.y);
      maxX = Math.max(maxX, rect.x + rect.w);
      maxY = Math.max(maxY, rect.y + rect.h);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  private getCollectiveBounds(selectedIds: string[]): { x: number; y: number; width: number; height: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of selectedIds) {
      const el = this.sceneIndex.byId.get(id);
      if (!el) continue;
      let bounds: { x: number; y: number; width: number; height: number };
      if (el.type === 'line' || el.type === 'arrow') {
        bounds = getLinearBounds(el as LinearElement, this.sceneIndex);
      } else if (el.type === 'mindmap') {
        bounds = this.getMindmapBounds(el as MindmapElement);
      } else {
        bounds = { x: el.x, y: el.y, width: el.width, height: el.height };
      }
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.width);
      maxY = Math.max(maxY, bounds.y + bounds.height);
    }
    if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  private getCachedShapePath(variant: string, width: number, height: number, roundness: number): Path2D {
    const key = `${variant}:${Math.round(width)}:${Math.round(height)}:${roundness}`;
    const cached = this.shapePathCache.get(key);
    if (cached) return cached;
    const path = createShapePath(variant as any, 0, 0, width, height, roundness);
    this.shapePathCache.set(key, path);
    this.trimCache(this.shapePathCache, 500);
    return path;
  }

  private createPathFromPolygon(points: number[][]): Path2D {
    const path = new Path2D();
    if (points.length === 0) return path;
    if (points.length === 1) {
      path.arc(points[0][0], points[0][1], 0.5, 0, Math.PI * 2);
      return path;
    }

    path.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      path.lineTo(points[i][0], points[i][1]);
    }
    path.closePath();
    return path;
  }

  private getStrokePressure(points: [number, number][], pressures: number[] | undefined, index: number) {
    const pointPressure = pressures?.[index];
    if (typeof pointPressure === 'number' && Number.isFinite(pointPressure)) {
      return Math.max(0.05, Math.min(1, pointPressure));
    }

    if (points.length <= 1) return 0.5;
    if (index === 0 || index === points.length - 1) return 0.35;

    const prev = points[index - 1];
    const curr = points[index];
    const next = points[index + 1];
    const speed = Math.hypot(curr[0] - prev[0], curr[1] - prev[1]) + Math.hypot(next[0] - curr[0], next[1] - curr[1]);
    return Math.max(0.2, Math.min(0.75, 0.72 - speed / 80));
  }

  private getFreehandCacheKey(
    type: 'freedraw' | 'highlighter',
    points: [number, number][],
    pressures: number[] | undefined,
    strokeWidth: number,
  ) {
    return `${type}|${strokeWidth}|${points.map((point, index) => `${point[0]},${point[1]},${this.getStrokePressure(points, pressures, index).toFixed(3)}`).join(';')}`;
  }

  private getCachedFreehandPath(
    type: 'freedraw' | 'highlighter',
    points: [number, number][],
    pressures: number[] | undefined,
    strokeWidth: number,
  ): Path2D {
    const key = this.getFreehandCacheKey(type, points, pressures, strokeWidth);
    const cached = this.freehandPathCache.get(key);
    if (cached) return cached;

    const strokePoints = points.map(([x, y], index) => [x, y, this.getStrokePressure(points, pressures, index)] as [number, number, number]);
    const outline = getStroke(strokePoints, type === 'highlighter'
      ? {
        size: Math.max(6, strokeWidth * 1.7),
        thinning: 0.05,
        smoothing: 0.45,
        streamline: 0.28,
        simulatePressure: !(pressures && pressures.length > 0),
        start: { cap: true, taper: 0 },
        end: { cap: true, taper: 0 },
        last: true,
      }
      : {
        size: Math.max(2, strokeWidth),
        thinning: 0.62,
        smoothing: 0.6,
        streamline: 0.42,
        simulatePressure: !(pressures && pressures.length > 0),
        start: { cap: true, taper: Math.max(strokeWidth * 0.8, 2) },
        end: { cap: true, taper: Math.max(strokeWidth * 1.1, 3) },
        last: true,
      });

    const path = outline.length >= 2
      ? this.createPathFromPolygon(outline)
      : (() => {
        const fallback = new Path2D();
        const [lastX, lastY] = points[points.length - 1];
        fallback.arc(lastX, lastY, Math.max(strokeWidth / 2, 1), 0, Math.PI * 2);
        return fallback;
      })();
    this.freehandPathCache.set(key, path);
    this.trimCache(this.freehandPathCache, 500);
    return path;
  }

  private getMindmapNodeMeasure(node: MindmapNode): { w: number; h: number } {
    this.refreshTextLayoutCachesIfNeeded();
    const key = `${node.id}|${node.text}|${node.fontSize}|${node.nodeShape}`;
    const cached = this.mindmapNodeMeasureCache.get(key);
    if (cached) return cached;

    this.ctx.font = `${node.fontSize}px Inter, system-ui, sans-serif`;
    const textWidth = this.ctx.measureText(node.text || '主题').width;
    const padding = node.nodeShape === 'text' ? 8 : 20;
    const size = {
      w: Math.max(textWidth + padding * 2, 60),
      h: node.fontSize * 1.5 + (node.nodeShape === 'text' ? 4 : 16),
    };
    this.mindmapNodeMeasureCache.set(key, size);
    this.trimCache(this.mindmapNodeMeasureCache, 2000);
    return size;
  }

  private clearCanvas(transparent: boolean, bgColor?: string) {
    const dpr = typeof window === 'undefined' ? 1 : (window.devicePixelRatio || 1);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (transparent) {
      this.ctx.clearRect(0, 0, this.width, this.height);
      return;
    }

    this.ctx.fillStyle = bgColor ?? '#FFFFFF';
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  private applyViewportTransform() {
    const dpr = typeof window === 'undefined' ? 1 : (window.devicePixelRatio || 1);
    this.ctx.setTransform(
      this.viewport.zoom * dpr, 0,
      0, this.viewport.zoom * dpr,
      this.viewport.x * dpr, this.viewport.y * dpr,
    );
  }

  renderSceneLayer(
    elements: Element[],
    bgColor: string,
    showGrid: boolean,
    gridSize: number,
    editingElementId?: string | null,
    editingMindmapNodeId?: string | null,
    excludedElementIds?: Set<string>,
    dimmedElementIds?: Set<string>,
  ) {
    this.refreshTextLayoutCachesIfNeeded();
    this.sceneIndex = this.getSceneIndex(elements);
    this.selectedMindmapNode = null;
    this.editingElementId = editingElementId ?? null;
    this.editingMindmapNodeId = editingMindmapNodeId ?? null;
    this.mindmapDropTarget = null;
    this.mindmapDragPreview = null;
    this.interactiveChrome = false;

    this.clearCanvas(false, bgColor);
    this.applyViewportTransform();

    if (showGrid) {
      this.renderGrid(gridSize);
    }

    const vpRect = this.getExpandedViewportRect();
    for (const el of elements) {
      if (excludedElementIds?.has(el.id)) continue;
      if (el.id === editingElementId) continue;
      if (!this.isElementInExpandedViewport(el, vpRect)) continue;
      if (!this.isElementVisible(el)) continue;
      const isDimmed = dimmedElementIds?.has(el.id);
      this.renderElement(el, false, isDimmed ? 0.3 : 1);
    }
  }

  renderOverlayLayer(options: OverlayRenderOptions): boolean {
    this.refreshTextLayoutCachesIfNeeded();
    this.sceneIndex = this.getSceneIndex(options.geometryElements);
    this.selectedMindmapNode = options.selectedMindmapNode ?? null;
    this.editingElementId = options.editingElementId ?? null;
    this.editingMindmapNodeId = options.editingMindmapNodeId ?? null;
    this.mindmapDropTarget = options.mindmapDropTarget ?? null;
    this.mindmapDragPreview = options.mindmapDragPreview ?? null;
    this.interactiveChrome = true;
    const selectedIdSet = new Set(options.selectedIds);

    // Update selection box animation
    const now = performance.now();
    if (options.selectedIds.length !== this.lastSelectedCount) {
      this.lastSelectedCount = options.selectedIds.length;
      if (options.selectedIds.length > 0) {
        this.selectionAnimProgress = 0;
        this.selectionAnimStartTime = now;
      } else {
        this.selectionAnimProgress = 1;
      }
    }
    if (this.selectionAnimProgress < 1) {
      this.selectionAnimProgress = Math.min(1, (now - this.selectionAnimStartTime) / 120);
    }

    this.clearCanvas(true);
    this.applyViewportTransform();

    const vpRect = this.getExpandedViewportRect();
    for (const el of options.previewElements ?? []) {
      if (!this.isElementInExpandedViewport(el, vpRect)) continue;
      if (!this.isElementVisible(el)) continue;
      this.renderElement(el, false);
    }

    if (options.activeElement && this.isElementInExpandedViewport(options.activeElement, vpRect)) {
      this.renderElement(options.activeElement, false);
    }

    this.renderConnectionPoints(
      options.geometryElements,
      options.hoveredElementId ?? null,
      options.hoveredAnchor ?? null,
      options.activeAnchors ?? [],
      options.activeDrawingTool ?? null,
      options.hoveredConnectionElementId,
    );

    if (options.selectionBox) {
      this.renderSelectionRect(options.selectionBox);
    }

    if (options.lassoSelectedIds && options.lassoSelectedIds.length > 0) {
      for (const id of options.lassoSelectedIds) {
        const el = this.sceneIndex.byId.get(id);
        if (!el) continue;
        this.renderLassoHighlight(el);
      }
    }

    // Hover highlight
    if (this.hoveredElementId && !selectedIdSet.has(this.hoveredElementId)) {
      const hoveredEl = this.sceneIndex.byId.get(this.hoveredElementId);
      if (hoveredEl) {
        this.renderHoverHighlight(hoveredEl);
      }
    }

    if (options.selectedIds.length > 1) {
      const collectiveBounds = this.getCollectiveBounds(options.selectedIds);
      this.renderSelectionBoxForBounds(collectiveBounds);
    } else if (options.selectedIds.length === 1) {
      const selectedId = options.selectedIds[0];
      const el = this.sceneIndex.byId.get(selectedId);
      if (el && this.editingElementId !== el.id && !(el.type === 'mindmap' && this.selectedMindmapNode?.elementId === el.id)) {
        this.renderSelectionBox(el);
      }
    }

    if (this.mindmapDragPreview) {
      this.renderMindmapDragPreview(this.mindmapDragPreview);
    }

    if (options.snapGuides && options.snapGuides.length > 0) {
      this.renderSnapGuides(options.snapGuides);
    }

    return this.selectionAnimProgress < 1;
  }

  render(
    elements: Element[],
    selectedIds: string[],
    bgColor: string,
    showGrid: boolean,
    gridSize: number,
    activeElement?: Element | null,
    selectionBox?: SelectionBox | null,
    snapGuides?: SnapGuide[],
    hoveredElementId?: string | null,
    hoveredAnchor?: ConnectionAnchorDescriptor | null,
    activeAnchors?: ConnectionAnchorDescriptor[],
    activeDrawingTool?: string | null,
    selectedMindmapNode?: { elementId: string; nodeId: string } | null,
    hoveredConnectionElementId?: string | null,
    editingElementId?: string | null,
    editingMindmapNodeId?: string | null,
    mindmapDropTarget?: { elementId: string; nodeId: string } | null,
    mindmapDragPreview?: MindmapDragPreview | null,
  ) {
    this.renderSceneLayer(elements, bgColor, showGrid, gridSize, editingElementId, editingMindmapNodeId);
    this.renderOverlayLayer({
      geometryElements: elements,
      selectedIds,
      activeElement,
      selectionBox,
      snapGuides,
      hoveredElementId,
      hoveredAnchor,
      activeAnchors,
      activeDrawingTool,
      selectedMindmapNode,
      hoveredConnectionElementId,
      editingElementId,
      editingMindmapNodeId,
      mindmapDropTarget,
      mindmapDragPreview,
    });
  }

  renderConnectionPoints(
    _elements: Element[],
    hoveredElementId: string | null,
    hoveredAnchor: ConnectionAnchorDescriptor | null,
    activeAnchors: ConnectionAnchorDescriptor[],
    activeDrawingTool: string | null,
    hoveredConnectionElementId?: string | null,
  ) {
    // Show connection points when drawing arrow/line OR when hovering near a selected element's edge
    const targetIds = new Set<string>();

    if (activeDrawingTool && (activeDrawingTool === 'arrow' || activeDrawingTool === 'line') && hoveredElementId) {
      targetIds.add(hoveredElementId);
    }
    if (hoveredConnectionElementId) {
      targetIds.add(hoveredConnectionElementId);
    }
    if (hoveredAnchor) {
      targetIds.add(hoveredAnchor.elementId);
    }
    for (const anchor of activeAnchors) {
      targetIds.add(anchor.elementId);
    }

    if (targetIds.size === 0) return;

    const ctx = this.ctx;
    const activeAnchorKeys = new Set(activeAnchors.map((anchor) => `${anchor.elementId}:${anchor.index}`));
    const hoveredAnchorKey = hoveredAnchor ? `${hoveredAnchor.elementId}:${hoveredAnchor.index}` : null;
    ctx.save();
    for (const id of targetIds) {
      const el = this.sceneIndex.byId.get(id);
      if (!el || !isConnectableElement(el)) continue;

      this.renderConnectionTargetHalo(el);

      const points = getElementConnectionPoints(el, this.sceneIndex);
      for (let index = 0; index < points.length; index += 1) {
        const [px, py] = points[index];
        const key = `${id}:${index}`;
        const isActive = activeAnchorKeys.has(key);
        const isHovered = hoveredAnchorKey === key;

        if (isActive || isHovered) {
          ctx.beginPath();
          ctx.arc(px, py, (isActive ? 10 : 8) / this.viewport.zoom, 0, Math.PI * 2);
          ctx.fillStyle = isActive ? 'rgba(51, 112, 255, 0.22)' : 'rgba(51, 112, 255, 0.14)';
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(px, py, (isActive ? 5.5 : 5) / this.viewport.zoom, 0, Math.PI * 2);
        ctx.fillStyle = '#3370FF';
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = (isActive ? 2.5 : 2) / this.viewport.zoom;
        ctx.stroke();

        if (isActive) {
          ctx.beginPath();
          ctx.arc(px, py, 2.1 / this.viewport.zoom, 0, Math.PI * 2);
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  private renderSnapGuides(guides: SnapGuide[]) {
    const ctx = this.ctx;
    const vp = this.viewport;
    const extent = 10000; // Large enough to cover visible area

    ctx.save();

    // 1. Draw dashed guide lines
    ctx.strokeStyle = '#3B82F6';
    ctx.lineWidth = 1.5 / vp.zoom;
    ctx.setLineDash([4 / vp.zoom, 4 / vp.zoom]);

    for (const guide of guides) {
      ctx.beginPath();
      if (guide.type === 'vertical') {
        ctx.moveTo(guide.position, -extent);
        ctx.lineTo(guide.position, extent);
      } else {
        ctx.moveTo(-extent, guide.position);
        ctx.lineTo(extent, guide.position);
      }
      ctx.stroke();
    }

    // 2. Draw endpoint dots at viewport boundaries
    ctx.setLineDash([]);
    const vpLeft = -this.viewport.x / this.viewport.zoom;
    const vpTop = -this.viewport.y / this.viewport.zoom;
    const vpRight = vpLeft + this.width / this.viewport.zoom;
    const vpBottom = vpTop + this.height / this.viewport.zoom;
    const dotRadius = 3 / vp.zoom;

    for (const guide of guides) {
      ctx.beginPath();
      if (guide.type === 'vertical') {
        ctx.arc(guide.position, vpTop, dotRadius, 0, Math.PI * 2);
        ctx.arc(guide.position, vpBottom, dotRadius, 0, Math.PI * 2);
      } else {
        ctx.arc(vpLeft, guide.position, dotRadius, 0, Math.PI * 2);
        ctx.arc(vpRight, guide.position, dotRadius, 0, Math.PI * 2);
      }
      ctx.fillStyle = '#3B82F6';
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1 / vp.zoom;
      ctx.stroke();
    }

    // 3. Draw edge highlights on target elements
    ctx.strokeStyle = '#3B82F6';
    ctx.lineWidth = 2.5 / vp.zoom;

    for (const guide of guides) {
      if (!guide.targetElementId || !guide.targetEdge) continue;
      const targetEl = this.sceneIndex.byId.get(guide.targetElementId);
      if (!targetEl) continue;

      const markLen = 12 / vp.zoom;
      const cx = targetEl.x + targetEl.width / 2;
      const cy = targetEl.y + targetEl.height / 2;

      ctx.beginPath();
      switch (guide.targetEdge) {
        case 'left':
          ctx.moveTo(targetEl.x, cy - markLen / 2);
          ctx.lineTo(targetEl.x, cy + markLen / 2);
          break;
        case 'right':
          ctx.moveTo(targetEl.x + targetEl.width, cy - markLen / 2);
          ctx.lineTo(targetEl.x + targetEl.width, cy + markLen / 2);
          break;
        case 'top':
          ctx.moveTo(cx - markLen / 2, targetEl.y);
          ctx.lineTo(cx + markLen / 2, targetEl.y);
          break;
        case 'bottom':
          ctx.moveTo(cx - markLen / 2, targetEl.y + targetEl.height);
          ctx.lineTo(cx + markLen / 2, targetEl.y + targetEl.height);
          break;
        case 'centerX':
          ctx.moveTo(cx, cy - markLen / 2);
          ctx.lineTo(cx, cy + markLen / 2);
          break;
        case 'centerY':
          ctx.moveTo(cx - markLen / 2, cy);
          ctx.lineTo(cx + markLen / 2, cy);
          break;
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  private renderGrid(gridSize: number) {
    const ctx = this.ctx;
    const vp = this.viewport;

    const startX = Math.floor(-vp.x / vp.zoom / gridSize) * gridSize;
    const startY = Math.floor(-vp.y / vp.zoom / gridSize) * gridSize;
    const endX = startX + this.width / vp.zoom + gridSize;
    const endY = startY + this.height / vp.zoom + gridSize;

    ctx.strokeStyle = '#E8E8E8';
    ctx.lineWidth = 1 / vp.zoom;
    ctx.beginPath();

    for (let x = startX; x <= endX; x += gridSize) {
      ctx.moveTo(x, startY);
      ctx.lineTo(x, endY);
    }
    for (let y = startY; y <= endY; y += gridSize) {
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
    }
    ctx.stroke();
  }

  private renderSelectionRect(box: SelectionBox) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(51, 112, 255, 0.08)';
    ctx.fillRect(box.x, box.y, box.width, box.height);
    ctx.strokeStyle = THEME.selected;
    ctx.lineWidth = 1 / this.viewport.zoom;
    ctx.setLineDash([4 / this.viewport.zoom, 4 / this.viewport.zoom]);
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    ctx.restore();
  }

  private renderLassoHighlight(el: Element) {
    const ctx = this.ctx;
    ctx.save();

    if (el.angle !== 0) {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate(el.angle);
      ctx.translate(-cx, -cy);
    }

    if (el.type === 'line' || el.type === 'arrow') {
      const bounds = getLinearBounds(el as LinearElement, this.sceneIndex);
      ctx.fillStyle = 'rgba(51, 112, 255, 0.12)';
      ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
      ctx.strokeStyle = 'rgba(51, 112, 255, 0.3)';
      ctx.lineWidth = 1 / this.viewport.zoom;
      ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    } else if (el.type === 'mindmap') {
      const bounds = this.getMindmapBounds(el as MindmapElement);
      ctx.fillStyle = 'rgba(51, 112, 255, 0.12)';
      ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
      ctx.strokeStyle = 'rgba(51, 112, 255, 0.3)';
      ctx.lineWidth = 1 / this.viewport.zoom;
      ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    } else {
      ctx.fillStyle = 'rgba(51, 112, 255, 0.12)';
      ctx.fillRect(el.x, el.y, el.width, el.height);
      ctx.strokeStyle = 'rgba(51, 112, 255, 0.3)';
      ctx.lineWidth = 1 / this.viewport.zoom;
      ctx.strokeRect(el.x, el.y, el.width, el.height);
    }

    ctx.restore();
  }

  renderElement(el: Element, _isSelected: boolean, opacityMultiplier = 1) {
    const ctx = this.ctx;

    ctx.save();
    ctx.globalAlpha = (el.opacity / 100) * opacityMultiplier;

    if (el.angle !== 0) {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate(el.angle);
      ctx.translate(-cx, -cy);
    }

    switch (el.type) {
      case 'rectangle':
        this.renderRectangle(el);
        break;
      case 'ellipse':
        this.renderEllipse(el);
        break;
      case 'diamond':
        this.renderDiamond(el);
        break;
      case 'triangle':
        this.renderTriangle(el);
        break;
      case 'line':
      case 'arrow':
        this.renderLinear(el);
        break;
      case 'text':
        this.renderText(el);
        break;
      case 'freedraw':
        this.renderFreedraw(el);
        break;
      case 'highlighter':
        this.renderHighlighter(el);
        break;
      case 'sticky_note':
        this.renderStickyNote(el);
        break;
      case 'image':
        this.renderImage(el as ImageElement);
        break;
      case 'mindmap':
        this.renderMindmap(el as MindmapElement);
        break;
      case 'section':
      case 'frame':
        this.renderFrame(el);
        break;
      default:
        this.renderRectangle(el as any);
    }

    ctx.restore();
  }

  private renderShapeText(el: Element) {
    if (!el.text || this.editingElementId === el.id) return;
    const ctx = this.ctx;
    const fontSize = el.fontSize ?? 16;
    const fontFamily = el.fontFamily ?? 'Inter, system-ui, sans-serif';
    const textAlign = el.textAlign ?? 'center';
    ctx.save();
    ctx.fillStyle = el.strokeColor || '#1B1B1F';
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.textAlign = textAlign;
    ctx.textBaseline = 'middle';
    const lines = el.text.split('\n');
    const lineHeight = fontSize * 1.3;
    const totalH = lines.length * lineHeight;
    const startY = el.y + el.height / 2 - totalH / 2 + lineHeight / 2;
    let textX = el.x + el.width / 2;
    if (textAlign === 'left') textX = el.x + 8;
    else if (textAlign === 'right') textX = el.x + el.width - 8;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], textX, startY + i * lineHeight, el.width - 16);
    }
    ctx.restore();
  }

  private renderRectangle(el: Element & { roundness?: number }) {
    const variant = getElementShapeVariant(el);
    if (variant !== 'rectangle' && variant !== 'round_rectangle' && variant !== 'pill') {
      this.renderVariantShape(el);
      return;
    }
    const ctx = this.ctx;
    const r = el.roundness ?? 0;

    ctx.beginPath();
    if (r > 0) {
      ctx.roundRect(el.x, el.y, el.width, el.height, r);
    } else {
      ctx.rect(el.x, el.y, el.width, el.height);
    }

    if (el.backgroundColor && el.backgroundColor !== 'transparent') {
      ctx.fillStyle = el.backgroundColor;
      ctx.fill();
    }
    if (el.strokeWidth > 0) {
      ctx.strokeStyle = el.strokeColor;
      ctx.lineWidth = el.strokeWidth;
      this.applyStrokeStyle(ctx, el.strokeStyle);
      ctx.stroke();
    }
    this.renderShapeText(el);
  }

  private renderEllipse(el: Element) {
    const variant = getElementShapeVariant(el);
    if (variant !== 'ellipse') {
      this.renderVariantShape(el);
      return;
    }
    const ctx = this.ctx;
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;

    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.abs(el.width / 2), Math.abs(el.height / 2), 0, 0, Math.PI * 2);

    if (el.backgroundColor && el.backgroundColor !== 'transparent') {
      ctx.fillStyle = el.backgroundColor;
      ctx.fill();
    }
    if (el.strokeWidth > 0) {
      ctx.strokeStyle = el.strokeColor;
      ctx.lineWidth = el.strokeWidth;
      this.applyStrokeStyle(ctx, el.strokeStyle);
      ctx.stroke();
    }
    this.renderShapeText(el);
  }

  private renderDiamond(el: Element) {
    const variant = getElementShapeVariant(el);
    if (variant !== 'diamond') {
      this.renderVariantShape(el);
      return;
    }
    const ctx = this.ctx;
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;

    ctx.beginPath();
    ctx.moveTo(cx, el.y);
    ctx.lineTo(el.x + el.width, cy);
    ctx.lineTo(cx, el.y + el.height);
    ctx.lineTo(el.x, cy);
    ctx.closePath();

    if (el.backgroundColor && el.backgroundColor !== 'transparent') {
      ctx.fillStyle = el.backgroundColor;
      ctx.fill();
    }
    if (el.strokeWidth > 0) {
      ctx.strokeStyle = el.strokeColor;
      ctx.lineWidth = el.strokeWidth;
      this.applyStrokeStyle(ctx, el.strokeStyle);
      ctx.stroke();
    }
    this.renderShapeText(el);
  }

  private renderTriangle(el: Element) {
    const variant = getElementShapeVariant(el);
    if (variant !== 'triangle') {
      this.renderVariantShape(el);
      return;
    }
    const ctx = this.ctx;

    ctx.beginPath();
    ctx.moveTo(el.x + el.width / 2, el.y);
    ctx.lineTo(el.x + el.width, el.y + el.height);
    ctx.lineTo(el.x, el.y + el.height);
    ctx.closePath();

    if (el.backgroundColor && el.backgroundColor !== 'transparent') {
      ctx.fillStyle = el.backgroundColor;
      ctx.fill();
    }
    if (el.strokeWidth > 0) {
      ctx.strokeStyle = el.strokeColor;
      ctx.lineWidth = el.strokeWidth;
      this.applyStrokeStyle(ctx, el.strokeStyle);
      ctx.stroke();
    }
    this.renderShapeText(el);
  }

  private renderVariantShape(el: Element & { roundness?: number }) {
    const ctx = this.ctx;
    const variant = getElementShapeVariant(el);
    const path = this.getCachedShapePath(variant, el.width, el.height, el.roundness ?? 8);

    ctx.save();
    ctx.translate(el.x, el.y);

    if (el.backgroundColor && el.backgroundColor !== 'transparent') {
      ctx.fillStyle = el.backgroundColor;
      ctx.fill(path);
    }

    if (el.strokeWidth > 0) {
      ctx.strokeStyle = el.strokeColor;
      ctx.lineWidth = el.strokeWidth;
      this.applyStrokeStyle(ctx, el.strokeStyle);
      ctx.stroke(path);
      renderShapeDecoration(ctx, variant, 0, 0, el.width, el.height);
    }

    ctx.restore();

    this.renderShapeText(el);
  }

  private renderConnectionTargetHalo(el: Element) {
    const ctx = this.ctx;
    const pad = 6 / this.viewport.zoom;

    ctx.save();
    ctx.strokeStyle = 'rgba(51, 112, 255, 0.22)';
    ctx.fillStyle = 'rgba(51, 112, 255, 0.05)';
    ctx.lineWidth = 1.5 / this.viewport.zoom;

    if (el.type === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(
        el.x + el.width / 2,
        el.y + el.height / 2,
        Math.abs(el.width / 2) + pad,
        Math.abs(el.height / 2) + pad,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.stroke();
    } else if (el.type === 'diamond') {
      ctx.beginPath();
      ctx.moveTo(el.x + el.width / 2, el.y - pad);
      ctx.lineTo(el.x + el.width + pad, el.y + el.height / 2);
      ctx.lineTo(el.x + el.width / 2, el.y + el.height + pad);
      ctx.lineTo(el.x - pad, el.y + el.height / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (el.type === 'triangle') {
      ctx.beginPath();
      ctx.moveTo(el.x + el.width / 2, el.y - pad);
      ctx.lineTo(el.x + el.width + pad, el.y + el.height + pad);
      ctx.lineTo(el.x - pad, el.y + el.height + pad);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.roundRect(el.x - pad, el.y - pad, el.width + pad * 2, el.height + pad * 2, 10 / this.viewport.zoom);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }

  private getStableBoundCurveControlPoints(
    linear: LinearElement,
    points: [number, number][],
  ): { cp1x: number; cp1y: number; cp2x: number; cp2y: number } {
    const start = points[0];
    const end = points[1];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const distance = Math.hypot(dx, dy);
    const major = Math.max(Math.abs(dx), Math.abs(dy));
    const minor = Math.min(Math.abs(dx), Math.abs(dy));
    const offset = Math.min(Math.abs(dx), Math.abs(dy)) * 0.4;

    let cp1x = start[0] + dx * 0.25 + (Math.abs(dy) > Math.abs(dx) ? offset : 0);
    let cp1y = start[1] + dy * 0.25 + (Math.abs(dx) > Math.abs(dy) ? offset : 0);
    let cp2x = end[0] - dx * 0.25 + (Math.abs(dy) > Math.abs(dx) ? offset : 0);
    let cp2y = end[1] - dy * 0.25 + (Math.abs(dx) > Math.abs(dy) ? offset : 0);

    const applyNormalHandle = (
      point: [number, number],
      normal: [number, number],
    ): [number, number] => {
      const projected = Math.abs(dx * normal[0] + dy * normal[1]);
      const handleLength = Math.min(
        Math.max(major * 0.45, minor * 0.7, projected * 0.9, 20),
        Math.max(distance * 0.7, 28),
      );
      return [point[0] + normal[0] * handleLength, point[1] + normal[1] * handleLength];
    };

    const startNormal = linear.startBinding
      ? getConnectionAnchorFromBinding(this.sceneIndex, linear.startBinding)?.normal ?? getAnchorNormalFromFocus(linear.startBinding.focus)
      : null;
    const endNormal = linear.endBinding
      ? getConnectionAnchorFromBinding(this.sceneIndex, linear.endBinding)?.normal ?? getAnchorNormalFromFocus(linear.endBinding.focus)
      : null;

    if (startNormal) {
      [cp1x, cp1y] = applyNormalHandle(start, startNormal);
    }
    if (endNormal) {
      [cp2x, cp2y] = applyNormalHandle(end, endNormal);
    }

    return { cp1x, cp1y, cp2x, cp2y };
  }

  private renderLinear(el: Element) {
    if (el.type !== 'line' && el.type !== 'arrow') return;
    const ctx = this.ctx;
    const linear = el as LinearElement;
    const pts = getLinearAbsolutePoints(linear, this.sceneIndex);
    if (pts.length < 2) return;

    ctx.strokeStyle = el.strokeColor;
    ctx.lineWidth = el.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this.applyStrokeStyle(ctx, el.strokeStyle);

    const shape = linear.connectorShape || 'straight';
    const cornerRadius = Math.min(el.strokeWidth * 2, 12);

    ctx.beginPath();

    if (shape === 'curve' && pts.length >= 2) {
      ctx.moveTo(pts[0][0], pts[0][1]);
      if (pts.length === 2) {
        const { cp1x, cp1y, cp2x, cp2y } = this.getStableBoundCurveControlPoints(linear, pts as [[number, number], [number, number]]);
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, pts[1][0], pts[1][1]);
      } else {
        for (let i = 0; i < pts.length - 1; i++) {
          const p0 = pts[Math.max(i - 1, 0)];
          const p1 = pts[i];
          const p2 = pts[i + 1];
          const p3 = pts[Math.min(i + 2, pts.length - 1)];
          const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
          const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
          const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
          const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1]);
        }
      }
    } else if (shape === 'right_angled_polyline' && pts.length >= 2) {
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1];
        const curr = pts[i];
        const midX = (prev[0] + curr[0]) / 2;
        if (i === 1) {
          ctx.lineTo(midX, prev[1]);
        }
        ctx.arcTo(midX, curr[1], curr[0], curr[1], cornerRadius);
        if (i === pts.length - 1) {
          ctx.lineTo(curr[0], curr[1]);
        } else {
          const next = pts[i + 1];
          const nextMidX = (curr[0] + next[0]) / 2;
          ctx.lineTo(nextMidX, curr[1]);
        }
      }
    } else {
      ctx.moveTo(pts[0][0], pts[0][1]);
      if (pts.length === 2 || cornerRadius === 0) {
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i][0], pts[i][1]);
        }
      } else {
        for (let i = 1; i < pts.length - 1; i++) {
          ctx.arcTo(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], cornerRadius);
        }
        ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      }
    }
    ctx.stroke();

    if (el.type === 'arrow' || el.type === 'line') {
      const startType = linear.startArrowType || 'none';
      const endType = linear.endArrowType || 'none';

      if (endType !== 'none' && pts.length >= 2) {
        const last = pts[pts.length - 1];
        const prev = pts[pts.length - 2];
        this.renderArrowHead(prev[0], prev[1], last[0], last[1], el.strokeColor, el.strokeWidth, endType);
      }
      if (startType !== 'none' && pts.length >= 2) {
        this.renderArrowHead(pts[1][0], pts[1][1], pts[0][0], pts[0][1], el.strokeColor, el.strokeWidth, startType);
      }
    }
  }

  private renderArrowHead(
    fromX: number, fromY: number,
    toX: number, toY: number,
    color: string, lineWidth: number,
    arrowType: ArrowType = 'arrow',
  ) {
    const ctx = this.ctx;
    const headLen = Math.max(10, lineWidth * 4);
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const halfAngle = Math.PI / 6;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;

    switch (arrowType) {
      case 'arrow': // Filled triangle
      case 'triangle': {
        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - headLen * Math.cos(angle - halfAngle), toY - headLen * Math.sin(angle - halfAngle));
        ctx.lineTo(toX - headLen * Math.cos(angle + halfAngle), toY - headLen * Math.sin(angle + halfAngle));
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'open_arrow': { // V shape (no fill)
        ctx.beginPath();
        ctx.moveTo(toX - headLen * Math.cos(angle - halfAngle), toY - headLen * Math.sin(angle - halfAngle));
        ctx.lineTo(toX, toY);
        ctx.lineTo(toX - headLen * Math.cos(angle + halfAngle), toY - headLen * Math.sin(angle + halfAngle));
        ctx.stroke();
        break;
      }
      case 'hollow_arrow':
      case 'hollow_triangle': { // Hollow triangle
        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - headLen * Math.cos(angle - halfAngle), toY - headLen * Math.sin(angle - halfAngle));
        ctx.lineTo(toX - headLen * Math.cos(angle + halfAngle), toY - headLen * Math.sin(angle + halfAngle));
        ctx.closePath();
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'diamond':
      case 'hollow_diamond': {
        const r = headLen * 0.6;
        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - r * Math.cos(angle) + r * 0.5 * Math.sin(angle), toY - r * Math.sin(angle) - r * 0.5 * Math.cos(angle));
        ctx.lineTo(toX - 2 * r * Math.cos(angle), toY - 2 * r * Math.sin(angle));
        ctx.lineTo(toX - r * Math.cos(angle) - r * 0.5 * Math.sin(angle), toY - r * Math.sin(angle) + r * 0.5 * Math.cos(angle));
        ctx.closePath();
        if (arrowType === 'hollow_diamond') {
          ctx.fillStyle = '#FFFFFF';
        }
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'circle':
      case 'hollow_circle': {
        const r = headLen * 0.35;
        const cx = toX - r * Math.cos(angle);
        const cy = toY - r * Math.sin(angle);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        if (arrowType === 'hollow_circle') {
          ctx.fillStyle = '#FFFFFF';
        }
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'bar': {
        const barLen = headLen * 0.6;
        ctx.beginPath();
        ctx.moveTo(toX + barLen * Math.sin(angle), toY - barLen * Math.cos(angle));
        ctx.lineTo(toX - barLen * Math.sin(angle), toY + barLen * Math.cos(angle));
        ctx.stroke();
        break;
      }
    }

    ctx.restore();
  }

  private renderText(el: Element) {
    if (el.type !== 'text') return;
    if (this.editingElementId === el.id) return;
    const ctx = this.ctx;

    ctx.fillStyle = el.strokeColor;
    ctx.font = `${el.fontSize}px ${el.fontFamily}`;
    ctx.textAlign = el.textAlign;
    ctx.textBaseline = 'top';

    const lines = el.text.split('\n');
    const lineHeight = el.fontSize * 1.3;
    let textX = el.x;
    if (el.textAlign === 'center') textX = el.x + el.width / 2;
    else if (el.textAlign === 'right') textX = el.x + el.width;

    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], textX, el.y + i * lineHeight);
    }
  }

  private renderFreedraw(el: Element) {
    if (el.type !== 'freedraw') return;
    const ctx = this.ctx;

    if (el.points.length < 2) return;
    const path = this.getCachedFreehandPath('freedraw', el.points, el.pressures, el.strokeWidth);

    ctx.save();
    ctx.translate(el.x, el.y);
    ctx.fillStyle = el.strokeColor;
    ctx.fill(path);
    ctx.restore();
  }

  private renderHighlighter(el: Element) {
    if (el.type !== 'highlighter') return;
    const ctx = this.ctx;

    if (el.points.length < 2) return;

    const path = this.getCachedFreehandPath('highlighter', el.points, el.pressures, el.strokeWidth);

    ctx.save();
    ctx.translate(el.x, el.y);
    ctx.fillStyle = el.highlightColor;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fill(path);
    ctx.restore();
  }

  private renderStickyNote(el: Element) {
    if (el.type !== 'sticky_note') return;
    const ctx = this.ctx;

    const bgColor = STICKY_NOTE_COLORS[el.noteColor] || STICKY_NOTE_COLORS.yellow;

    // Background
    ctx.fillStyle = bgColor;
    ctx.shadowColor = 'rgba(0,0,0,0.1)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    ctx.roundRect(el.x, el.y, el.width, el.height, 4);
    ctx.fill();
    ctx.shadowColor = 'transparent';

    // Clip text to element bounds
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(el.x, el.y, el.width, el.height, 4);
    ctx.clip();

    // Text (skip if being edited - textarea overlay handles it)
    if (el.text && this.editingElementId !== el.id) {
      ctx.fillStyle = '#1B1B1F';
      ctx.font = `${el.fontSize}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const padding = 12;
      const lines = this.wrapText(el.text, el.width - padding * 2, ctx.font, ctx);
      const lineHeight = el.fontSize * 1.4;
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], el.x + padding, el.y + padding + i * lineHeight, el.width - padding * 2);
      }
    }

    // Author display (bottom left)
    if (el.author) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.font = `${10}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(el.author, el.x + 8, el.y + el.height - 6, el.width - 16);
    }

    ctx.restore();
  }

  private renderFrame(el: Element) {
    if (el.type !== 'section' && el.type !== 'frame') return;
    const ctx = this.ctx;

    // Dashed border
    ctx.strokeStyle = '#8B8FA3';
    ctx.lineWidth = 1.5 / this.viewport.zoom;
    ctx.setLineDash([6 / this.viewport.zoom, 4 / this.viewport.zoom]);
    ctx.strokeRect(el.x, el.y, el.width, el.height);
    ctx.setLineDash([]);

    // Title (skip if being edited)
    if ('title' in el && el.title && this.editingElementId !== el.id) {
      ctx.fillStyle = '#8B8FA3';
      ctx.font = `${12 / this.viewport.zoom}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(el.title, el.x, el.y - 4 / this.viewport.zoom);
    }
  }

  private renderImage(el: ImageElement) {
    const ctx = this.ctx;
    const img = imageCache.get(el.fileId);
    if (img) {
      ctx.drawImage(img, el.x, el.y, el.width, el.height);
    } else {
      // Placeholder
      ctx.fillStyle = '#F5F6F7';
      ctx.fillRect(el.x, el.y, el.width, el.height);
      ctx.strokeStyle = '#E0E0E0';
      ctx.lineWidth = 1;
      ctx.strokeRect(el.x, el.y, el.width, el.height);
      ctx.fillStyle = '#8B8FA3';
      ctx.font = '14px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('图片', el.x + el.width / 2, el.y + el.height / 2);
    }
    if (el.strokeWidth > 0 && el.strokeColor !== 'transparent') {
      ctx.strokeStyle = el.strokeColor;
      ctx.lineWidth = el.strokeWidth;
      this.applyStrokeStyle(ctx, el.strokeStyle);
      ctx.strokeRect(el.x, el.y, el.width, el.height);
    }
  }

  private renderMindmap(el: MindmapElement) {
    if (!el.rootNode) return;
    const layout = this.getMindmapLayout(el);
    this.drawMindmapConnections(el, el.rootNode, layout);
    this.drawMindmapNode(el, el.rootNode, layout);
  }

  private isDraggedMindmapNode(elementId: string, nodeId: string) {
    return this.mindmapDragPreview?.elementId === elementId
      && this.mindmapDragPreview.sourceNodeId === nodeId;
  }

  private getNodeRect(layout: Map<string, Rect>, node: MindmapNode, fallbackX: number, fallbackY: number) {
    const cached = layout.get(node.id);
    return cached ?? { x: fallbackX, y: fallbackY, w: 60, h: 30 };
  }

  private layoutMindmapNodes(el: MindmapElement): Map<string, Rect> {
    const hGap = 60;
    const vGap = 20;
    const root = el.rootNode;
    const layout = new Map<string, Rect>();

    const getSubtreeHeight = (node: MindmapNode): number => {
      const children = node.collapsed ? [] : node.children;
      const size = this.getMindmapNodeMeasure(node);
      const existing = layout.get(node.id);
      layout.set(node.id, { x: existing?.x ?? 0, y: existing?.y ?? 0, w: size.w, h: size.h });
      if (children.length === 0) return size.h;
      let total = 0;
      for (const child of children) {
        total += getSubtreeHeight(child);
      }
      total += (children.length - 1) * vGap;
      return Math.max(size.h, total);
    };

    const layoutTree = (
      node: MindmapNode,
      x: number,
      y: number,
      direction: 'right' | 'left' | 'down',
    ) => {
      const size = this.getMindmapNodeMeasure(node);
      layout.set(node.id, { x, y, w: size.w, h: size.h });

      const children = node.collapsed ? [] : node.children;
      if (children.length === 0) return;

      if (direction === 'down') {
        const childWidths = children.map((c: MindmapNode) => {
          getSubtreeHeight(c);
          return layout.get(c.id)?.w ?? 60;
        });
        const totalW = childWidths.reduce((a: number, b: number) => a + b, 0) + (children.length - 1) * hGap;
        let startX = x + size.w / 2 - totalW / 2;
        for (let i = 0; i < children.length; i++) {
          layoutTree(children[i], startX, y + size.h + vGap * 2, direction);
          startX += childWidths[i] + hGap;
        }
      } else {
        const subtreeHeight = getSubtreeHeight(node);
        let startY = y + size.h / 2 - subtreeHeight / 2;
        for (const child of children) {
          const ch = getSubtreeHeight(child);
          const childRect = layout.get(child.id);
          const childH = childRect?.h ?? 30;
          const childW = childRect?.w ?? 60;
          const childY = startY + ch / 2 - childH / 2;
          const childX = direction === 'right'
            ? x + size.w + hGap
            : x - childW - hGap;
          layoutTree(child, childX, childY, direction);
          startY += ch + vGap;
        }
      }
    };

    const elLayout = el.layout || 'mindmap_right';
    if (elLayout === 'tree_down') {
      layoutTree(root, el.x, el.y, 'down');
    } else if (elLayout === 'mindmap_left') {
      layoutTree(root, el.x, el.y, 'left');
    } else if (elLayout === 'mindmap_lr') {
      const size = this.getMindmapNodeMeasure(root);
      layout.set(root.id, { x: el.x, y: el.y, w: size.w, h: size.h });

      const rightChildren = root.rightChildren?.length ? root.rightChildren : root.children;
      const leftChildren = root.leftChildren || [];

      let totalRH = 0;
      for (const child of rightChildren) totalRH += getSubtreeHeight(child);
      totalRH += Math.max(0, rightChildren.length - 1) * vGap;
      let ry = el.y + size.h / 2 - totalRH / 2;
      for (const child of rightChildren) {
        const ch = getSubtreeHeight(child);
        const childH = layout.get(child.id)?.h ?? 30;
        layoutTree(child, el.x + size.w + hGap, ry + ch / 2 - childH / 2, 'right');
        ry += ch + vGap;
      }

      let totalLH = 0;
      for (const child of leftChildren) totalLH += getSubtreeHeight(child);
      totalLH += Math.max(0, leftChildren.length - 1) * vGap;
      let ly = el.y + size.h / 2 - totalLH / 2;
      for (const child of leftChildren) {
        const ch = getSubtreeHeight(child);
        const childRect = layout.get(child.id);
        const childH = childRect?.h ?? 30;
        const childW = childRect?.w ?? 60;
        layoutTree(child, el.x - childW - hGap, ly + ch / 2 - childH / 2, 'left');
        ly += ch + vGap;
      }
    } else {
      layoutTree(root, el.x, el.y, 'right');
    }

    return layout;
  }

  private drawMindmapConnections(el: MindmapElement, node: MindmapNode, layout: Map<string, Rect>) {
    if (this.isDraggedMindmapNode(el.id, node.id)) return;
    const ctx = this.ctx;
    const nr = this.getNodeRect(layout, node, el.x, el.y);

    const style = el.lineStyle || { color: '#8B8FA3', width: 2, style: 'solid' as const };
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (style.style === 'dashed') {
      ctx.setLineDash([6, 4]);
    } else if (style.style === 'dotted') {
      ctx.setLineDash([2, 4]);
    } else {
      ctx.setLineDash([]);
    }

    const allChildren = [
      ...(node.collapsed ? [] : node.children),
      ...(node.collapsed ? [] : (node.leftChildren || [])),
      ...(node.collapsed ? [] : (node.rightChildren || [])),
    ].filter((child) => !this.isDraggedMindmapNode(el.id, child.id));

    for (const child of allChildren) {
      const cr = this.getNodeRect(layout, child, 0, 0);
      const isLeft = cr.x + cr.w < nr.x;
      const isDown = el.layout === 'tree_down';

      ctx.beginPath();
      if (el.branchStyle === 'polyline' || isDown) {
        if (isDown) {
          const fromX = nr.x + nr.w / 2, fromY = nr.y + nr.h;
          const toX = cr.x + cr.w / 2, toY = cr.y;
          const midY = (fromY + toY) / 2;
          ctx.moveTo(fromX, fromY);
          ctx.lineTo(fromX, midY);
          ctx.lineTo(toX, midY);
          ctx.lineTo(toX, toY);
        } else {
          const fromX = isLeft ? nr.x : nr.x + nr.w;
          const fromY = nr.y + nr.h / 2;
          const toX = isLeft ? cr.x + cr.w : cr.x;
          const toY = cr.y + cr.h / 2;
          const midX = (fromX + toX) / 2;
          ctx.moveTo(fromX, fromY);
          ctx.lineTo(midX, fromY);
          ctx.lineTo(midX, toY);
          ctx.lineTo(toX, toY);
        }
      } else {
        const fromX = isLeft ? nr.x : nr.x + nr.w;
        const fromY = nr.y + nr.h / 2;
        const toX = isLeft ? cr.x + cr.w : cr.x;
        const toY = cr.y + cr.h / 2;
        const cpOffset = Math.abs(toX - fromX) * 0.5;
        ctx.moveTo(fromX, fromY);
        ctx.bezierCurveTo(
          fromX + (isLeft ? -cpOffset : cpOffset), fromY,
          toX + (isLeft ? cpOffset : -cpOffset), toY,
          toX, toY,
        );
      }
      ctx.stroke();
      this.drawMindmapConnections(el, child, layout);
    }
    ctx.setLineDash([]);
  }

  private drawMindmapNode(el: MindmapElement, node: MindmapNode, layout: Map<string, Rect>) {
    if (this.isDraggedMindmapNode(el.id, node.id)) return;
    const ctx = this.ctx;
    const { x, y, w, h } = this.getNodeRect(layout, node, el.x, el.y);
    const isSelectedNode = this.interactiveChrome
      && this.selectedMindmapNode?.elementId === el.id
      && this.selectedMindmapNode.nodeId === node.id
      && this.editingMindmapNodeId !== node.id;
    const isDropTargetNode = this.interactiveChrome
      && this.mindmapDropTarget?.elementId === el.id
      && this.mindmapDropTarget.nodeId === node.id;

    if (node.nodeShape !== 'text') {
      ctx.save();
      ctx.shadowColor = node.nodeType === 'root' ? 'rgba(47, 107, 85, 0.18)' : 'rgba(15, 23, 42, 0.08)';
      ctx.shadowBlur = node.nodeType === 'root' ? 18 : 10;
      ctx.shadowOffsetY = 4;
      ctx.beginPath();
      const radius = node.nodeShape === 'pill' ? h / 2 : 6;
      ctx.roundRect(x, y, w, h, radius);
      ctx.fillStyle = node.backgroundColor || (node.nodeType === 'root' ? '#3370FF' : '#E3EAFD');
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = node.nodeType === 'root' ? 'rgba(0, 0, 0, 0.04)' : (node.backgroundColor || '#3370FF');
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    if (this.editingMindmapNodeId !== node.id) {
      ctx.fillStyle = node.textColor || (node.nodeType === 'root' && node.nodeShape !== 'text' ? '#FFFFFF' : '#1B1B1F');
      ctx.font = `${node.fontSize}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(node.text || '主题', x + w / 2, y + h / 2, w - 8);
    }

    if (isSelectedNode) {
      ctx.save();
      ctx.beginPath();
      if (node.nodeShape === 'text') {
        ctx.roundRect(x - 4, y - 4, w + 8, h + 8, 8);
      } else {
        const radius = node.nodeShape === 'pill' ? h / 2 + 4 : 10;
        ctx.roundRect(x - 4, y - 4, w + 8, h + 8, radius);
      }
      ctx.strokeStyle = THEME.selected;
      ctx.lineWidth = 2 / this.viewport.zoom;
      ctx.stroke();
      ctx.restore();
    }

    if (isDropTargetNode) {
      ctx.save();
      ctx.beginPath();
      if (node.nodeShape === 'text') {
        ctx.roundRect(x - 6, y - 6, w + 12, h + 12, 10);
      } else {
        const radius = node.nodeShape === 'pill' ? (h + 12) / 2 : 12;
        ctx.roundRect(x - 6, y - 6, w + 12, h + 12, radius);
      }
      ctx.strokeStyle = '#16A34A';
      ctx.lineWidth = 2 / this.viewport.zoom;
      ctx.setLineDash([6 / this.viewport.zoom, 4 / this.viewport.zoom]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Collapse indicator
    const allChildCount = node.children.length + (node.leftChildren?.length || 0) + (node.rightChildren?.length || 0);
    if (allChildCount > 0 && node.collapsed) {
      const ix = x + w + 4;
      const iy = y + h / 2;
      ctx.fillStyle = '#8B8FA3';
      ctx.beginPath();
      ctx.arc(ix, iy, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '10px Inter, system-ui, sans-serif';
      ctx.fillText('+', ix, iy + 1);
    }

    const allChildren = [
      ...(node.collapsed ? [] : node.children),
      ...(node.collapsed ? [] : (node.leftChildren || [])),
      ...(node.collapsed ? [] : (node.rightChildren || [])),
    ].filter((child) => !this.isDraggedMindmapNode(el.id, child.id));
    for (const child of allChildren) {
      this.drawMindmapNode(el, child, layout);
    }
  }

  private cloneMindmapNode(node: MindmapNode): MindmapNode {
    return {
      ...node,
      children: node.children.map((child) => this.cloneMindmapNode(child)),
      leftChildren: (node.leftChildren || []).map((child) => this.cloneMindmapNode(child)),
      rightChildren: (node.rightChildren || []).map((child) => this.cloneMindmapNode(child)),
    };
  }

  private addMindmapChildPreview(root: MindmapNode, parentId: string, node: MindmapNode): MindmapNode {
    if (root.id === parentId) {
      return {
        ...root,
        collapsed: false,
        children: [...root.children, node],
      };
    }

    return {
      ...root,
      children: root.children.map((child) => this.addMindmapChildPreview(child, parentId, node)),
      leftChildren: (root.leftChildren || []).map((child) => this.addMindmapChildPreview(child, parentId, node)),
      rightChildren: (root.rightChildren || []).map((child) => this.addMindmapChildPreview(child, parentId, node)),
    };
  }

  private extractMindmapNodePreview(root: MindmapNode, nodeId: string): { root: MindmapNode; extracted: MindmapNode | null } {
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

  private moveMindmapNodePreview(root: MindmapNode, nodeId: string, targetParentId: string): MindmapNode {
    if (root.id === nodeId || nodeId === targetParentId) return root;

    const draggedNode = this.findMindmapNode(root, nodeId);
    if (!draggedNode || this.findMindmapNode(draggedNode, targetParentId)) {
      return root;
    }

    const clonedRoot = this.cloneMindmapNode(root);
    const { root: withoutNode, extracted } = this.extractMindmapNodePreview(clonedRoot, nodeId);
    if (!extracted) return root;

    return this.addMindmapChildPreview(withoutNode, targetParentId, extracted);
  }

  private getProjectedMindmapNodeRect(el: MindmapElement, sourceNodeId: string, targetNodeId: string) {
    const projectedRoot = this.moveMindmapNodePreview(el.rootNode, sourceNodeId, targetNodeId);
    if (projectedRoot === el.rootNode) return null;

    const projectedElement = { ...el, rootNode: projectedRoot };
    const layout = this.layoutMindmapNodes(projectedElement);
    return layout.get(sourceNodeId) ?? null;
  }

  private findMindmapNode(root: MindmapNode, nodeId: string): MindmapNode | null {
    if (root.id === nodeId) return root;
    const allChildren = [...root.children, ...(root.leftChildren || []), ...(root.rightChildren || [])];
    for (const child of allChildren) {
      const found = this.findMindmapNode(child, nodeId);
      if (found) return found;
    }
    return null;
  }

  private getShiftedNodeRect(layout: Map<string, Rect>, node: MindmapNode, fallbackX: number, fallbackY: number, dx: number, dy: number) {
    const rect = this.getNodeRect(layout, node, fallbackX, fallbackY);
    return { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h };
  }

  private drawMindmapGhostConnections(el: MindmapElement, node: MindmapNode, layout: Map<string, Rect>, dx: number, dy: number) {
    const ctx = this.ctx;
    const nr = this.getShiftedNodeRect(layout, node, el.x, el.y, dx, dy);

    const style = el.lineStyle || { color: '#8B8FA3', width: 2, style: 'solid' as const };
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);

    const allChildren = [
      ...(node.collapsed ? [] : node.children),
      ...(node.collapsed ? [] : (node.leftChildren || [])),
      ...(node.collapsed ? [] : (node.rightChildren || [])),
    ];

    for (const child of allChildren) {
      const cr = this.getShiftedNodeRect(layout, child, 0, 0, dx, dy);
      const isLeft = cr.x + cr.w < nr.x;

      ctx.beginPath();
      const fromX = isLeft ? nr.x : nr.x + nr.w;
      const fromY = nr.y + nr.h / 2;
      const toX = isLeft ? cr.x + cr.w : cr.x;
      const toY = cr.y + cr.h / 2;
      const cpOffset = Math.abs(toX - fromX) * 0.5;
      ctx.moveTo(fromX, fromY);
      ctx.bezierCurveTo(
        fromX + (isLeft ? -cpOffset : cpOffset), fromY,
        toX + (isLeft ? cpOffset : -cpOffset), toY,
        toX, toY,
      );
      ctx.stroke();
      this.drawMindmapGhostConnections(el, child, layout, dx, dy);
    }
  }

  private drawMindmapGhostNode(node: MindmapNode, x: number, y: number, w: number, h: number) {
    const ctx = this.ctx;

    if (node.nodeShape !== 'text') {
      ctx.save();
      ctx.shadowColor = 'rgba(15, 23, 42, 0.14)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 6;
      ctx.beginPath();
      const radius = node.nodeShape === 'pill' ? h / 2 : 6;
      ctx.roundRect(x, y, w, h, radius);
      ctx.fillStyle = node.backgroundColor || (node.nodeType === 'root' ? '#3370FF' : '#E3EAFD');
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = '#2563EB';
      ctx.lineWidth = 1.5 / this.viewport.zoom;
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = node.textColor || (node.nodeType === 'root' && node.nodeShape !== 'text' ? '#FFFFFF' : '#1B1B1F');
    ctx.font = `${node.fontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(node.text || '主题', x + w / 2, y + h / 2, w - 8);
  }

  private drawMindmapGhostSubtree(el: MindmapElement, node: MindmapNode, layout: Map<string, Rect>, dx: number, dy: number) {
    const { x, y, w, h } = this.getShiftedNodeRect(layout, node, el.x, el.y, dx, dy);
    this.drawMindmapGhostNode(node, x, y, w, h);

    const allChildren = [
      ...(node.collapsed ? [] : node.children),
      ...(node.collapsed ? [] : (node.leftChildren || [])),
      ...(node.collapsed ? [] : (node.rightChildren || [])),
    ];

    for (const child of allChildren) {
      this.drawMindmapGhostSubtree(el, child, layout, dx, dy);
    }
  }

  private renderMindmapDragPreview(preview: { elementId: string; sourceNodeId: string; pointerX: number; pointerY: number; offsetX: number; offsetY: number }) {
    const element = this.sceneIndex.byId.get(preview.elementId);
    if (!element || element.type !== 'mindmap') return;

    const layout = this.getMindmapLayout(element as MindmapElement);

    const sourceNode = this.findMindmapNode((element as MindmapElement).rootNode, preview.sourceNodeId);
    const sourceRect = layout.get(preview.sourceNodeId);
    if (!sourceNode || !sourceRect) return;

    const projectedRect = this.mindmapDropTarget?.elementId === preview.elementId
      ? this.getProjectedMindmapNodeRect(element as MindmapElement, preview.sourceNodeId, this.mindmapDropTarget.nodeId)
      : null;

    const dx = projectedRect ? projectedRect.x - sourceRect.x : preview.offsetX;
    const dy = projectedRect ? projectedRect.y - sourceRect.y : preview.offsetY;

    const fromX = sourceRect.x + sourceRect.w / 2;
    const fromY = sourceRect.y + sourceRect.h / 2;
    const toX = projectedRect ? projectedRect.x + projectedRect.w / 2 : preview.pointerX;
    const toY = projectedRect ? projectedRect.y + projectedRect.h / 2 : preview.pointerY;
    const curveOffset = Math.max(Math.abs(toX - fromX) * 0.35, 24);

    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.92;
    this.drawMindmapGhostConnections(element as MindmapElement, sourceNode, layout, dx, dy);
    this.drawMindmapGhostSubtree(element as MindmapElement, sourceNode, layout, dx, dy);
    if (!projectedRect) {
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.bezierCurveTo(fromX + curveOffset, fromY, toX - curveOffset, toY, toX, toY);
      ctx.strokeStyle = '#16A34A';
      ctx.lineWidth = 2 / this.viewport.zoom;
      ctx.setLineDash([8 / this.viewport.zoom, 5 / this.viewport.zoom]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  private renderHoverHighlight(el: Element) {
    const ctx = this.ctx;
    ctx.save();

    if (el.angle !== 0) {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate(el.angle);
      ctx.translate(-cx, -cy);
    }

    const isLinear = el.type === 'line' || el.type === 'arrow';
    if (isLinear) {
      const bounds = getLinearBounds(el as LinearElement, this.sceneIndex);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(bounds.x - 1, bounds.y - 1, bounds.width + 2, bounds.height + 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1 / this.viewport.zoom;
      ctx.strokeRect(bounds.x - 1, bounds.y - 1, bounds.width + 2, bounds.height + 2);
    } else if (el.type === 'ellipse') {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.abs(el.width / 2) + 1, Math.abs(el.height / 2) + 1, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1 / this.viewport.zoom;
      ctx.stroke();
    } else if (el.type === 'diamond') {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      ctx.beginPath();
      ctx.moveTo(cx, el.y - 1);
      ctx.lineTo(el.x + el.width + 1, cy);
      ctx.lineTo(cx, el.y + el.height + 1);
      ctx.lineTo(el.x - 1, cy);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1 / this.viewport.zoom;
      ctx.stroke();
    } else if (el.type === 'triangle') {
      ctx.beginPath();
      ctx.moveTo(el.x + el.width / 2, el.y - 1);
      ctx.lineTo(el.x + el.width + 1, el.y + el.height + 1);
      ctx.lineTo(el.x - 1, el.y + el.height + 1);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1 / this.viewport.zoom;
      ctx.stroke();
    } else if (el.type === 'mindmap') {
      const bounds = this.getMindmapBounds(el as MindmapElement);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(bounds.x - 1, bounds.y - 1, bounds.width + 2, bounds.height + 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1 / this.viewport.zoom;
      ctx.strokeRect(bounds.x - 1, bounds.y - 1, bounds.width + 2, bounds.height + 2);
    } else {
      // Generic bbox highlight for rectangles, variant shapes, freedraw, text, image, sticky, frame, section
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(el.x - 1, el.y - 1, el.width + 2, el.height + 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1 / this.viewport.zoom;
      ctx.strokeRect(el.x - 1, el.y - 1, el.width + 2, el.height + 2);
    }

    ctx.restore();
  }

  private renderSelectionBox(el: Element) {
    const ctx = this.ctx;
    const padding = 4;
    const isLinear = el.type === 'line' || el.type === 'arrow';
    let bounds: { x: number; y: number; width: number; height: number };
    if (isLinear) {
      bounds = getLinearBounds(el as LinearElement, this.sceneIndex);
    } else if (el.type === 'mindmap') {
      bounds = this.getMindmapBounds(el as MindmapElement);
    } else {
      bounds = { x: el.x, y: el.y, width: el.width, height: el.height };
    }

    const progress = this.selectionAnimProgress;
    const alpha = 0.5 + 0.5 * progress;
    const scale = 0.985 + 0.015 * progress;

    ctx.save();

    if (el.angle !== 0) {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate(el.angle);
      ctx.translate(-cx, -cy);
    }

    ctx.globalAlpha *= alpha;

    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);

    ctx.strokeStyle = THEME.selected;
    ctx.lineWidth = 1.5 / this.viewport.zoom;
    ctx.setLineDash([]);

    ctx.strokeRect(
      bounds.x - padding, bounds.y - padding,
      bounds.width + padding * 2, bounds.height + padding * 2,
    );

    const baseHandleSize = 8 / this.viewport.zoom;

    if (isLinear) {
      const points = getLinearAbsolutePoints(el as LinearElement, this.sceneIndex);
      const endpointHandles: [string, number, number][] = [
        ['start', points[0][0], points[0][1]],
        ['end', points[points.length - 1][0], points[points.length - 1][1]],
      ];
      for (const [key, hx, hy] of endpointHandles) {
        const isHovered = this.hoveredHandle === key;
        const handleSize = isHovered ? baseHandleSize * 1.25 : baseHandleSize;
        const hhs = handleSize / 2;

        if (isHovered) {
          ctx.beginPath();
          ctx.arc(hx, hy, handleSize * 0.8, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
          ctx.fill();
        }

        ctx.fillStyle = isHovered ? '#3B82F6' : '#FFFFFF';
        ctx.strokeStyle = THEME.selected;
        ctx.lineWidth = 1.5 / this.viewport.zoom;
        ctx.fillRect(hx - hhs, hy - hhs, handleSize, handleSize);
        ctx.strokeRect(hx - hhs, hy - hhs, handleSize, handleSize);
      }
      ctx.restore();
      return;
    }

    const handles: [string, number, number][] = [
      ['nw', bounds.x, bounds.y],
      ['n', bounds.x + bounds.width / 2, bounds.y],
      ['ne', bounds.x + bounds.width, bounds.y],
      ['e', bounds.x + bounds.width, bounds.y + bounds.height / 2],
      ['se', bounds.x + bounds.width, bounds.y + bounds.height],
      ['s', bounds.x + bounds.width / 2, bounds.y + bounds.height],
      ['sw', bounds.x, bounds.y + bounds.height],
      ['w', bounds.x, bounds.y + bounds.height / 2],
    ];

    for (const [key, hx, hy] of handles) {
      const isHovered = this.hoveredHandle === key;
      const handleSize = isHovered ? baseHandleSize * 1.25 : baseHandleSize;
      const hhs = handleSize / 2;

      if (isHovered) {
        ctx.beginPath();
        ctx.arc(hx, hy, handleSize * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
        ctx.fill();
      }

      ctx.fillStyle = isHovered ? '#3B82F6' : '#FFFFFF';
      ctx.strokeStyle = THEME.selected;
      ctx.lineWidth = 1.5 / this.viewport.zoom;
      ctx.fillRect(hx - hhs, hy - hhs, handleSize, handleSize);
      ctx.strokeRect(hx - hhs, hy - hhs, handleSize, handleSize);
    }

    ctx.restore();
  }

  private wrapText(text: string, maxWidth: number, font: string, ctx: CanvasRenderingContext2D): string[] {
    this.refreshTextLayoutCachesIfNeeded();
    const key = `${font}|${Math.round(maxWidth)}|${text}`;
    const cached = this.stickyWrapCache.get(key);
    if (cached) return cached;

    const paragraphs = text.split('\n');
    const lines: string[] = [];
    for (const para of paragraphs) {
      if (!para) { lines.push(''); continue; }
      const words = para.split(' ');
      let line = '';
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
    }
    this.stickyWrapCache.set(key, lines);
    this.trimCache(this.stickyWrapCache, 1000);
    return lines;
  }

  private applyStrokeStyle(ctx: CanvasRenderingContext2D, style: string) {
    switch (style) {
      case 'dashed':
        ctx.setLineDash([8, 4]);
        break;
      case 'dotted':
        ctx.setLineDash([2, 4]);
        break;
      default:
        ctx.setLineDash([]);
    }
  }

  getMindmapNodeAtPoint(el: MindmapElement, x: number, y: number): MindmapNode | null {
    if (!el.rootNode) return null;

    const layout = this.getMindmapLayout(el);

    const stack: MindmapNode[] = [el.rootNode];
    const nodes: MindmapNode[] = [];
    while (stack.length > 0) {
      const current = stack.pop()!;
      nodes.push(current);
      const children = [
        ...(current.collapsed ? [] : current.children),
        ...(current.collapsed ? [] : (current.leftChildren || [])),
        ...(current.collapsed ? [] : (current.rightChildren || [])),
      ];
      for (const child of children) {
        stack.push(child);
      }
    }

    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      const rect = layout.get(node.id);
      if (!rect) continue;
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
        return node;
      }
    }

    return null;
  }

  getMindmapNodeRect(el: MindmapElement, nodeId: string): { x: number; y: number; w: number; h: number } | null {
    if (!el.rootNode) return null;
    return this.getMindmapLayout(el).get(nodeId) ?? null;
  }
}

export function getConnectionPoints(el: Element): [number, number][] {
  return getElementConnectionPoints(el);
}

export function findNearestConnectionPoint(
  el: Element,
  px: number,
  py: number,
  threshold: number,
): { point: [number, number]; focus: number } | null {
  const points = getConnectionPoints(el);
  let bestDist = threshold;
  let bestIdx = -1;

  for (let i = 0; i < points.length; i++) {
    const [cpx, cpy] = points[i];
    const dist = Math.sqrt((px - cpx) ** 2 + (py - cpy) ** 2);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  if (bestIdx === -1) return null;
  return { point: points[bestIdx], focus: bestIdx / (points.length - 1) };
}
