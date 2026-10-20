import type { Element, LinearElement, MindmapElement, MindmapNode, ImageElement } from '../types/element';
import { getStroke } from 'perfect-freehand';
import rough from 'roughjs';
import type { RoughCanvas } from 'roughjs/bin/canvas';
import { STICKY_NOTE_COLORS, THEME } from '../utils/color';
import { Viewport } from './viewport';
import {
  createSceneIndex,
  getConnectionPoints as getElementConnectionPoints,
  getLinearAbsolutePoints,
  getLinearBounds,
  isConnectableElement,
  type ConnectionAnchorDescriptor,
  type SceneIndex,
} from './linear';
import { createShapePath } from './shape-utils';
import { applyStrokeStyle as applyStrokeStyleShared } from './render/stroke';
import {
  drawRectangle,
  drawEllipse,
  drawDiamond,
  drawTriangle,
  type GetShapePath,
} from './render/shapes';
import { drawLinear } from './render/linear';
import {
  type Rect,
  getMindmapLayoutSignature,
  layoutMindmapNodes,
} from './render/mindmap-layout';
import {
  drawGrid,
  drawSelectionRect,
  drawSnapGuides,
  drawLassoHighlight,
} from './render/overlay';
import {
  type MindmapDrawDeps,
  drawMindmap,
  renderMindmapDragPreview as drawMindmapDragPreview,
} from './render/mindmap';
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
  private rough: RoughCanvas;

  constructor(ctx: CanvasRenderingContext2D, viewport: Viewport) {
    this.ctx = ctx;
    this.viewport = viewport;
    this.rough = rough.canvas(ctx.canvas);
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

  private shiftLayoutMap(layout: Map<string, Rect>, dx: number, dy: number): Map<string, Rect> {
    return new Map(Array.from(layout.entries(), ([nodeId, rect]) => [
      nodeId,
      { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h },
    ]));
  }

  private getMindmapLayout(el: MindmapElement): Map<string, Rect> {
    this.refreshTextLayoutCachesIfNeeded();
    const signature = getMindmapLayoutSignature(el);
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

    const layout = layoutMindmapNodes(el, this.measureMindmapNode);
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

  /** Bound once so extracted shape renderers can reuse the instance path cache without per-call closures. */
  private getShapePath: GetShapePath = (variant, width, height, roundness) =>
    this.getCachedShapePath(variant, width, height, roundness);

  /** Bound node-measure (ctx.measureText + cache) injected into the extracted mindmap layout engine. */
  private measureMindmapNode = (node: MindmapNode) => this.getMindmapNodeMeasure(node);

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
      if (el && this.editingElementId !== el.id) {
        if (el.type === 'mindmap' && this.selectedMindmapNode?.elementId === el.id) {
          // Redraw the mindmap on the overlay (interactiveChrome=true) so the
          // selected node ring shows, including for selections made elsewhere
          // (e.g. the outline panel).
          this.renderMindmap(el as MindmapElement);
        } else {
          this.renderSelectionBox(el);
        }
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
          ctx.fillStyle = isActive ? 'rgba(0, 122, 255, 0.22)' : 'rgba(0, 122, 255, 0.14)';
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(px, py, (isActive ? 5.5 : 5) / this.viewport.zoom, 0, Math.PI * 2);
        ctx.fillStyle = '#007AFF';
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

  // Overlay chrome (grid / snap guides / drag-select rect / lasso) extracted to
  // ./render/overlay (P0.B).
  private renderSnapGuides(guides: SnapGuide[]) {
    drawSnapGuides(this.ctx, guides, this.viewport, this.width, this.height, this.sceneIndex);
  }

  private renderGrid(gridSize: number) {
    drawGrid(this.ctx, gridSize, this.viewport, this.width, this.height);
  }

  private renderSelectionRect(box: SelectionBox) {
    drawSelectionRect(this.ctx, box, this.viewport.zoom);
  }

  private renderLassoHighlight(el: Element) {
    drawLassoHighlight(this.ctx, el, this.viewport, this.sceneIndex, (m) => this.getMindmapBounds(m));
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

  // Basic shape drawing extracted to ./render/shapes (P0.B). The renderElement
  // switch delegates straight to the pure draw* fns; they fall back to variant
  // shapes and draw inline text internally, using the instance path cache.
  private renderRectangle(el: Element & { roundness?: number }) {
    drawRectangle(this.ctx, el, this.editingElementId, this.getShapePath, this.rough);
  }

  private renderEllipse(el: Element) {
    drawEllipse(this.ctx, el, this.editingElementId, this.getShapePath, this.rough);
  }

  private renderDiamond(el: Element) {
    drawDiamond(this.ctx, el, this.editingElementId, this.getShapePath, this.rough);
  }

  private renderTriangle(el: Element) {
    drawTriangle(this.ctx, el, this.editingElementId, this.getShapePath, this.rough);
  }

  private renderConnectionTargetHalo(el: Element) {
    const ctx = this.ctx;
    const pad = 6 / this.viewport.zoom;

    ctx.save();
    ctx.strokeStyle = 'rgba(0, 122, 255, 0.22)';
    ctx.fillStyle = 'rgba(0, 122, 255, 0.05)';
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

  // Connector (line/arrow) drawing extracted to ./render/linear (P0.B).
  private renderLinear(el: Element) {
    drawLinear(this.ctx, el, this.sceneIndex);
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

  /** Snapshots the live mindmap draw state for the extracted ./render/mindmap functions. */
  private mindmapDrawDeps(): MindmapDrawDeps {
    return {
      ctx: this.ctx,
      zoom: this.viewport.zoom,
      interactiveChrome: this.interactiveChrome,
      selectedMindmapNode: this.selectedMindmapNode,
      mindmapDropTarget: this.mindmapDropTarget,
      editingMindmapNodeId: this.editingMindmapNodeId,
      mindmapDragPreview: this.mindmapDragPreview,
      sceneIndex: this.sceneIndex,
      getMindmapLayout: (el) => this.getMindmapLayout(el),
      measureMindmapNode: this.measureMindmapNode,
    };
  }

  private renderMindmap(el: MindmapElement) {
    if (!el.rootNode) return;
    const layout = this.getMindmapLayout(el);
    drawMindmap(this.mindmapDrawDeps(), el, layout);
  }

  private renderMindmapDragPreview(preview: { elementId: string; sourceNodeId: string; pointerX: number; pointerY: number; offsetX: number; offsetY: number }) {
    drawMindmapDragPreview(this.mindmapDrawDeps(), preview);
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

  /**
   * Collective selection outline for a multi-selection. Restores a method that
   * was referenced but missing from HEAD (tsc error / runtime crash on
   * multi-select). Draws the shared bounding box in the single-selection style;
   * per-group resize handles are intentionally not drawn here.
   */
  private renderSelectionBoxForBounds(bounds: { x: number; y: number; width: number; height: number }) {
    const ctx = this.ctx;
    const padding = 4;
    const progress = this.selectionAnimProgress;
    const alpha = 0.5 + 0.5 * progress;
    const scale = 0.985 + 0.015 * progress;

    ctx.save();
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

        ctx.fillStyle = isHovered ? '#007AFF' : '#FFFFFF';
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

      ctx.fillStyle = isHovered ? '#007AFF' : '#FFFFFF';
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
    applyStrokeStyleShared(ctx, style);
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
