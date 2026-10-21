import type { Element, LinearElement, MindmapElement, MindmapNode, ImageElement, ShapeVariant } from '../types/element';
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
import { applyStrokeStyle } from './render/stroke';
import {
  drawRectangle,
  drawEllipse,
  drawDiamond,
  drawTriangle,
  type GetShapePath,
} from './render/shapes';
import { drawLinear } from './render/linear';
import {
  drawMarkdown,
  invalidateMarkdownLayoutCache,
  CARD_PADDING,
  DEFAULT_NOTE_FONT,
  type LinkHit,
} from './render/markdown';
import { drawCode, drawKanban, drawMatrix, drawTable } from './render/structured';
import { kanbanHeight } from './structured';
import {
  type Rect,
  getLayoutBounds,
  layoutMindmapNodes,
  measureMindmapNodeWith,
  visibleChildrenOf,
} from './render/mindmap-layout';
import {
  drawGrid,
  drawDotGrid,
  drawSelectionRect,
  drawSnapGuides,
  drawLassoHighlight,
} from './render/overlay';
import {
  type MindmapDrawDeps,
  drawMindmap,
  drawMindmapChrome,
  renderMindmapDragPreview as drawMindmapDragPreview,
} from './render/mindmap';
import { canvasTheme } from './canvas-theme';
import type { SnapGuide } from '../utils/math';

type Bounds = { x: number; y: number; width: number; height: number };

// --- Async asset notifications ----------------------------------------------
// Images decode and web fonts load asynchronously; the canvas only repaints
// when told to, so listeners are notified whenever an asset that changes the
// rendered output becomes available.
const assetListeners = new Set<() => void>();

function notifyAssetListeners() {
  for (const listener of Array.from(assetListeners)) {
    try {
      listener();
    } catch (error) {
      console.error('Renderer asset listener failed', error);
    }
  }
}

/**
 * Subscribes to renderer asset readiness: `cb` runs after an image finishes
 * loading into the image cache, and after web fonts finish loading (text layout
 * caches are already invalidated by then). Use it to schedule a scene redraw.
 * Returns an unsubscribe function.
 */
export function subscribeRendererAssets(cb: () => void): () => void {
  installFontLoadInvalidation();
  assetListeners.add(cb);
  return () => {
    assetListeners.delete(cb);
  };
}

// --- Image cache ------------------------------------------------------------
const imageCache = new Map<string, HTMLImageElement>();
/** In-flight loads, so a load evicted (or superseded) mid-flight never lands. */
const pendingImageLoads = new Map<string, { img: HTMLImageElement; promise: Promise<void> }>();

export function clearImageCache() {
  imageCache.clear();
  pendingImageLoads.clear();
}

/** Whether an image is decoded in the cache or currently loading. */
export function isImageCachedOrLoading(fileId: string): boolean {
  return imageCache.has(fileId) || pendingImageLoads.has(fileId);
}

/** Evicts cached (and in-flight) images whose file id is not in `fileIds`. */
export function retainImageCache(fileIds: ReadonlySet<string>) {
  for (const id of Array.from(imageCache.keys())) {
    if (!fileIds.has(id)) imageCache.delete(id);
  }
  for (const id of Array.from(pendingImageLoads.keys())) {
    if (!fileIds.has(id)) pendingImageLoads.delete(id);
  }
}

export function loadImageToCache(fileId: string, dataURL: string): Promise<void> {
  if (imageCache.has(fileId)) return Promise.resolve();
  const pending = pendingImageLoads.get(fileId);
  if (pending) return pending.promise;

  const img = new Image();
  const promise = new Promise<void>((resolve, reject) => {
    img.onload = () => {
      if (pendingImageLoads.get(fileId)?.img === img) {
        pendingImageLoads.delete(fileId);
        imageCache.set(fileId, img);
        notifyAssetListeners();
      }
      resolve();
    };
    img.onerror = (error) => {
      if (pendingImageLoads.get(fileId)?.img === img) pendingImageLoads.delete(fileId);
      reject(error);
    };
  });
  pendingImageLoads.set(fileId, { img, promise });
  img.src = dataURL;
  return promise;
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

/**
 * Cached mindmap layout. Keyed (in a WeakMap) by root-node identity: mindmap
 * trees are immutable, so any structural / text change yields a new root.
 */
type MindmapLayoutCacheEntry = {
  generation: number;
  layoutKind: MindmapElement['layout'] | undefined;
  branchStyle: MindmapElement['branchStyle'] | undefined;
  x: number;
  y: number;
  layout: Map<string, Rect>;
};

/** Cached freehand outline, keyed (in a WeakMap) by the points-array identity. */
type FreehandCacheEntry = {
  type: 'freedraw' | 'highlighter';
  strokeWidth: number;
  pressures: number[] | undefined;
  /** The live stroke appends to its arrays in place, so lengths are checked too. */
  pointCount: number;
  pressureCount: number;
  path: Path2D;
};

let textLayoutCacheGeneration = 0;
let fontLoadInvalidationInstalled = false;

function invalidateTextLayoutCaches() {
  textLayoutCacheGeneration += 1;
  invalidateMarkdownLayoutCache();
}

function installFontLoadInvalidation() {
  if (fontLoadInvalidationInstalled) return;
  fontLoadInvalidationInstalled = true;

  if (typeof document === 'undefined' || !('fonts' in document)) return;

  const fontFaceSet = document.fonts;
  const handleFontLoad = () => {
    invalidateTextLayoutCaches();
    notifyAssetListeners();
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
  private freehandPathCache = new WeakMap<[number, number][], FreehandCacheEntry>();
  private mindmapNodeMeasureCache = new Map<string, { w: number; h: number }>();
  private mindmapLayoutCache = new WeakMap<MindmapNode, MindmapLayoutCacheEntry>();
  private textLayoutCacheGeneration = -1;
  private hoveredElementId: string | null = null;
  private hoveredHandle: string | null = null;
  private selectionAnimProgress = 1;
  private lastSelectedCount = 0;
  private selectionAnimStartTime = 0;
  private sceneIndexCache: { index: SceneIndex; elements: Element[] } | null = null;
  private rough: RoughCanvas;
  /** [[link]] hit regions collected during the scene pass, in canvas coords. */
  private linkHits: Array<{ elementId: string } & LinkHit> = [];
  /** Draw the dot-grid backdrop behind the scene (off for image export). */
  backgroundDots = true;

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

  /** Returns the [[link]] at a canvas-space point, if any (from the last scene pass). */
  getLinkAtPoint(x: number, y: number): { elementId: string; name: string } | null {
    for (let i = this.linkHits.length - 1; i >= 0; i -= 1) {
      const h = this.linkHits[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
        return { elementId: h.elementId, name: h.name };
      }
    }
    return null;
  }

  private getSceneIndex(elements: Element[]): SceneIndex {
    if (this.sceneIndexCache && this.sceneIndexCache.elements === elements) {
      return this.sceneIndexCache.index;
    }
    const index = createSceneIndex(elements);
    this.sceneIndexCache = { index, elements };
    return index;
  }

  /** World-space viewport rect, padded by 100 screen pixels, used for culling. */
  private getCullRect(): { left: number; top: number; right: number; bottom: number } {
    const margin = 100 / this.viewport.zoom;
    const left = -this.viewport.x / this.viewport.zoom - margin;
    const top = -this.viewport.y / this.viewport.zoom - margin;
    const right = left + this.width / this.viewport.zoom + margin * 2;
    const bottom = top + this.height / this.viewport.zoom + margin * 2;
    return { left, top, right, bottom };
  }

  /** Whether an element's (rotation-aware) bounds intersect the cull rect. */
  private isElementInViewport(
    el: Element,
    vp: { left: number; top: number; right: number; bottom: number },
  ): boolean {
    let b = this.getElementBounds(el);
    if (el.angle) {
      // Rotation is about the element's own centre; cover every rotation.
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      const r = Math.max(
        Math.hypot(b.x - cx, b.y - cy),
        Math.hypot(b.x + b.width - cx, b.y - cy),
        Math.hypot(b.x - cx, b.y + b.height - cy),
        Math.hypot(b.x + b.width - cx, b.y + b.height - cy),
      );
      b = { x: cx - r, y: cy - r, width: r * 2, height: r * 2 };
    }
    return b.x + b.width >= vp.left && b.x <= vp.right &&
           b.y + b.height >= vp.top && b.y <= vp.bottom;
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

    // Layout-cache entries carry their generation and go stale on their own.
    this.mindmapNodeMeasureCache.clear();
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
    if (!el.rootNode) return new Map();
    const cached = this.mindmapLayoutCache.get(el.rootNode);
    if (
      cached
      && cached.generation === textLayoutCacheGeneration
      && cached.layoutKind === el.layout
      && cached.branchStyle === el.branchStyle
    ) {
      if (cached.x !== el.x || cached.y !== el.y) {
        cached.layout = this.shiftLayoutMap(cached.layout, el.x - cached.x, el.y - cached.y);
        cached.x = el.x;
        cached.y = el.y;
      }
      return cached.layout;
    }

    const layout = layoutMindmapNodes(el, this.measureMindmapNode);
    this.mindmapLayoutCache.set(el.rootNode, {
      generation: textLayoutCacheGeneration,
      layoutKind: el.layout,
      branchStyle: el.branchStyle,
      x: el.x,
      y: el.y,
      layout,
    });
    return layout;
  }

  getMindmapBounds(el: MindmapElement): Bounds {
    return getLayoutBounds(this.getMindmapLayout(el))
      ?? { x: el.x, y: el.y, width: el.width, height: el.height };
  }

  /**
   * Axis-aligned, unrotated bounds of an element in canvas space: connector
   * geometry for lines / arrows, laid-out node extents for mindmaps, else the
   * element box. Shared by culling, selection, hover and lasso chrome.
   */
  getElementBounds(el: Element): Bounds {
    if (el.type === 'line' || el.type === 'arrow') {
      return getLinearBounds(el as LinearElement, this.sceneIndex);
    }
    if (el.type === 'mindmap') {
      return this.getMindmapBounds(el as MindmapElement);
    }
    if (el.type === 'kanban') {
      return { x: el.x, y: el.y, width: el.width, height: kanbanHeight(el) };
    }
    return { x: el.x, y: el.y, width: el.width, height: el.height };
  }

  private getCollectiveBounds(selectedIds: string[]): Bounds {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of selectedIds) {
      const el = this.sceneIndex.byId.get(id);
      if (!el) continue;
      const bounds = this.getElementBounds(el);
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
    const path = createShapePath(variant as ShapeVariant, 0, 0, width, height, roundness);
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

  /**
   * Outline path for a freehand stroke, cached by the identity of its points
   * array (O(1) per frame). Committed strokes are immutable; the live stroke
   * appends in place, which the length checks catch.
   */
  private getCachedFreehandPath(
    type: 'freedraw' | 'highlighter',
    points: [number, number][],
    pressures: number[] | undefined,
    strokeWidth: number,
  ): Path2D {
    const cached = this.freehandPathCache.get(points);
    if (
      cached
      && cached.type === type
      && cached.strokeWidth === strokeWidth
      && cached.pressures === pressures
      && cached.pointCount === points.length
      && cached.pressureCount === (pressures?.length ?? 0)
    ) {
      return cached.path;
    }

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
    this.freehandPathCache.set(points, {
      type,
      strokeWidth,
      pressures,
      pointCount: points.length,
      pressureCount: pressures?.length ?? 0,
      path,
    });
    return path;
  }

  private getMindmapNodeMeasure(node: MindmapNode): { w: number; h: number } {
    this.refreshTextLayoutCachesIfNeeded();
    const key = `${node.id}|${node.text}|${node.fontSize}|${node.nodeShape}|${node.nodeType}`;
    const cached = this.mindmapNodeMeasureCache.get(key);
    if (cached) return cached;

    const size = measureMindmapNodeWith(this.ctx, node);
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
  ) {
    this.refreshTextLayoutCachesIfNeeded();
    this.sceneIndex = this.getSceneIndex(elements);
    this.linkHits = [];
    this.selectedMindmapNode = null;
    this.editingElementId = editingElementId ?? null;
    this.editingMindmapNodeId = editingMindmapNodeId ?? null;
    this.mindmapDropTarget = null;
    this.mindmapDragPreview = null;

    this.clearCanvas(false, bgColor);
    this.applyViewportTransform();

    if (showGrid) {
      this.renderGrid(gridSize);
    } else if (this.backgroundDots) {
      drawDotGrid(this.ctx, this.viewport, this.width, this.height);
    }

    const cullRect = this.getCullRect();
    for (const el of elements) {
      if (excludedElementIds?.has(el.id)) continue;
      // The element being edited still draws: each renderer skips only its
      // text, so a shape stays visible behind the (transparent) editor.
      if (!this.isElementInViewport(el, cullRect)) continue;
      this.renderElement(el);
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

    const cullRect = this.getCullRect();
    for (const el of options.previewElements ?? []) {
      if (!this.isElementInViewport(el, cullRect)) continue;
      this.renderElement(el);
    }

    if (options.activeElement && this.isElementInViewport(options.activeElement, cullRect)) {
      this.renderElement(options.activeElement);
    }

    this.renderConnectionPoints(
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

    let mindmapChromeElementId: string | null = null;
    if (options.selectedIds.length > 1) {
      const collectiveBounds = this.getCollectiveBounds(options.selectedIds);
      this.renderSelectionBoxForBounds(collectiveBounds);
    } else if (options.selectedIds.length === 1) {
      const selectedId = options.selectedIds[0];
      const el = this.sceneIndex.byId.get(selectedId);
      if (el && this.editingElementId !== el.id) {
        if (el.type === 'mindmap' && this.selectedMindmapNode?.elementId === el.id) {
          // Ring the selected node over the scene-layer mindmap, including for
          // selections made elsewhere (e.g. the outline panel). Only the chrome
          // is drawn, so the tree's opacity is not composited twice.
          this.renderMindmapChrome(el as MindmapElement, true);
          mindmapChromeElementId = el.id;
        } else {
          this.renderSelectionBox(el);
        }
      }
    }

    const dropTarget = this.mindmapDropTarget;
    if (dropTarget && dropTarget.elementId !== mindmapChromeElementId) {
      const target = this.sceneIndex.byId.get(dropTarget.elementId);
      if (target?.type === 'mindmap') this.renderMindmapChrome(target as MindmapElement, false);
    }

    if (this.mindmapDragPreview) {
      this.renderMindmapDragPreview(this.mindmapDragPreview);
    }

    if (options.snapGuides && options.snapGuides.length > 0) {
      this.renderSnapGuides(options.snapGuides);
    }

    return this.selectionAnimProgress < 1;
  }

  private renderConnectionPoints(
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
    drawLassoHighlight(this.ctx, el, this.getElementBounds(el), this.viewport.zoom);
  }

  private renderElement(el: Element) {
    const ctx = this.ctx;

    ctx.save();
    ctx.globalAlpha = el.opacity / 100;

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
      case 'table':
      case 'kanban': {
        // Cells and cards are Markdown: collect their [[link]] regions.
        const hits: LinkHit[] = [];
        if (el.type === 'table') drawTable(ctx, el, hits);
        else drawKanban(ctx, el, hits);
        for (const hit of hits) this.linkHits.push({ elementId: el.id, ...hit });
        break;
      }
      case 'matrix':
        drawMatrix(ctx, el);
        break;
      case 'code':
        drawCode(ctx, el);
        break;
      default:
        this.renderRectangle(el as Element);
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

    // Left-aligned text renders as Markdown (no wrapping — authored lines are
    // kept). Centered / right-aligned text keeps the plain renderer.
    if ((el.textAlign ?? 'left') === 'left') {
      const hits: LinkHit[] = [];
      drawMarkdown(ctx, el.text, {
        x: el.x,
        y: el.y,
        width: Infinity,
        fontSize: el.fontSize,
        fontFamily: el.fontFamily,
        color: el.strokeColor,
      }, hits);
      for (const hit of hits) this.linkHits.push({ elementId: el.id, ...hit });
      return;
    }

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
    // Multiply tints ink on a light page, but on the dark canvas it would
    // darken toward black and vanish; there the color's own alpha is used.
    if (!canvasTheme.isDark) ctx.globalCompositeOperation = 'multiply';
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

    // Markdown content (skip if being edited - textarea overlay handles it)
    if (el.text && this.editingElementId !== el.id) {
      ctx.textAlign = 'left';
      const hits: LinkHit[] = [];
      drawMarkdown(ctx, el.text, {
        x: el.x + CARD_PADDING,
        y: el.y + CARD_PADDING,
        width: el.width - CARD_PADDING * 2,
        fontSize: el.fontSize ?? 16,
        fontFamily: el.fontFamily ?? DEFAULT_NOTE_FONT,
        color: '#1B1B1F',
      }, hits);
      for (const hit of hits) this.linkHits.push({ elementId: el.id, ...hit });
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
      applyStrokeStyle(ctx, el.strokeStyle);
      ctx.strokeRect(el.x, el.y, el.width, el.height);
    }
  }

  /** Snapshots the live mindmap draw state for the extracted ./render/mindmap functions. */
  private mindmapDrawDeps(): MindmapDrawDeps {
    return {
      ctx: this.ctx,
      zoom: this.viewport.zoom,
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

  /** Selected-node / drop-target rings for a mindmap, drawn on the overlay. */
  private renderMindmapChrome(el: MindmapElement, showSelectedNode: boolean) {
    if (!el.rootNode) return;
    const deps = this.mindmapDrawDeps();
    if (!showSelectedNode) deps.selectedMindmapNode = null;
    const ctx = this.ctx;
    ctx.save();
    if (el.angle !== 0) {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate(el.angle);
      ctx.translate(-cx, -cy);
    }
    drawMindmapChrome(deps, el, this.getMindmapLayout(el));
    ctx.restore();
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

    ctx.fillStyle = canvasTheme.hoverFill;
    ctx.strokeStyle = canvasTheme.hoverStroke;
    ctx.lineWidth = 1 / this.viewport.zoom;
    ctx.beginPath();
    if (el.type === 'ellipse') {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      ctx.ellipse(cx, cy, Math.abs(el.width / 2) + 1, Math.abs(el.height / 2) + 1, 0, 0, Math.PI * 2);
    } else if (el.type === 'diamond') {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      ctx.moveTo(cx, el.y - 1);
      ctx.lineTo(el.x + el.width + 1, cy);
      ctx.lineTo(cx, el.y + el.height + 1);
      ctx.lineTo(el.x - 1, cy);
      ctx.closePath();
    } else if (el.type === 'triangle') {
      ctx.moveTo(el.x + el.width / 2, el.y - 1);
      ctx.lineTo(el.x + el.width + 1, el.y + el.height + 1);
      ctx.lineTo(el.x - 1, el.y + el.height + 1);
      ctx.closePath();
    } else {
      // Bounding-box highlight for connectors, mindmaps, rectangles, variant
      // shapes, freedraw, text, image, sticky, frame and section.
      const bounds = this.getElementBounds(el);
      ctx.rect(bounds.x - 1, bounds.y - 1, bounds.width + 2, bounds.height + 2);
    }
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Collective selection outline for a multi-selection. Restores a method that
   * was referenced but missing from HEAD (tsc error / runtime crash on
   * multi-select). Draws the shared bounding box in the single-selection style;
   * per-group resize handles are intentionally not drawn here.
   */
  private renderSelectionBoxForBounds(bounds: Bounds) {
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

    // Multi-selection keeps a faint hairline so the group's extent is readable.
    ctx.globalAlpha *= 0.55;
    ctx.strokeStyle = THEME.selected;
    ctx.lineWidth = 1 / this.viewport.zoom;
    ctx.setLineDash([]);
    ctx.strokeRect(
      bounds.x - padding, bounds.y - padding,
      bounds.width + padding * 2, bounds.height + padding * 2,
    );

    ctx.restore();
  }

  private renderSelectionBox(el: Element) {
    const ctx = this.ctx;
    const isLinear = el.type === 'line' || el.type === 'arrow';
    const bounds = this.getElementBounds(el);

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

    // No bounding frame (like Freeform / Lark): the element itself plus
    // floating round handles is enough to read as selected.
    const baseHandleSize = 9 / this.viewport.zoom;

    if (isLinear) {
      const points = getLinearAbsolutePoints(el as LinearElement, this.sceneIndex);
      const endpointHandles: [string, number, number][] = [
        ['start', points[0][0], points[0][1]],
        ['end', points[points.length - 1][0], points[points.length - 1][1]],
      ];
      for (const [key, hx, hy] of endpointHandles) {
        this.drawHandle(hx, hy, baseHandleSize, this.hoveredHandle === key);
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
      this.drawHandle(hx, hy, baseHandleSize, this.hoveredHandle === key);
    }

    ctx.restore();
  }

  /** Round white handle with a soft shadow; fills blue while hovered. */
  private drawHandle(hx: number, hy: number, size: number, hovered: boolean) {
    const ctx = this.ctx;
    const radius = (hovered ? size * 1.2 : size) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(hx, hy, radius, 0, Math.PI * 2);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 0.5;
    ctx.fillStyle = hovered ? '#007AFF' : '#FFFFFF';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = hovered ? '#FFFFFF' : THEME.selected;
    ctx.lineWidth = 1.25 / this.viewport.zoom;
    ctx.stroke();
    ctx.restore();
  }

  getMindmapNodeAtPoint(el: MindmapElement, x: number, y: number): MindmapNode | null {
    if (!el.rootNode) return null;

    const layout = this.getMindmapLayout(el);

    const stack: MindmapNode[] = [el.rootNode];
    const nodes: MindmapNode[] = [];
    while (stack.length > 0) {
      const current = stack.pop()!;
      nodes.push(current);
      for (const child of visibleChildrenOf(current)) {
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
