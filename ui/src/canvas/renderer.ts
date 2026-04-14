import type { Element, ArrowType, LinearElement, MindmapElement, MindmapNode, ImageElement } from '../types/element';
import { STICKY_NOTE_COLORS, THEME } from '../utils/color';
import { Viewport } from './viewport';
import {
  getConnectionPoints as getElementConnectionPoints,
  getLinearAbsolutePoints,
  getLinearBounds,
  isConnectableElement,
} from './linear';
import { createShapePath, getElementShapeVariant, renderShapeDecoration } from './shape-utils';

// Image cache for rendering
const imageCache = new Map<string, HTMLImageElement>();

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

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private viewport: Viewport;
  private width = 0;
  private height = 0;
  private sceneElements: Element[] = [];
  private selectedMindmapNode: { elementId: string; nodeId: string } | null = null;
  private editingElementId: string | null = null;
  private editingMindmapNodeId: string | null = null;
  private mindmapDropTarget: { elementId: string; nodeId: string } | null = null;
  private mindmapDragPreview: { elementId: string; sourceNodeId: string; pointerX: number; pointerY: number; offsetX: number; offsetY: number } | null = null;

  constructor(ctx: CanvasRenderingContext2D, viewport: Viewport) {
    this.ctx = ctx;
    this.viewport = viewport;
  }

  setSize(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  render(
    elements: Element[],
    selectedIds: string[],
    bgColor: string,
    showGrid: boolean,
    gridSize: number,
    activeElement?: Element | null,
    selectionBox?: SelectionBox | null,
    snapGuides?: Array<{ type: 'vertical' | 'horizontal'; position: number }>,
    hoveredElementId?: string | null,
    activeDrawingTool?: string | null,
    selectedMindmapNode?: { elementId: string; nodeId: string } | null,
    hoveredConnectionElementId?: string | null,
    editingElementId?: string | null,
    editingMindmapNodeId?: string | null,
    mindmapDropTarget?: { elementId: string; nodeId: string } | null,
    mindmapDragPreview?: { elementId: string; sourceNodeId: string; pointerX: number; pointerY: number; offsetX: number; offsetY: number } | null,
  ) {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    this.sceneElements = elements;
    this.selectedMindmapNode = selectedMindmapNode ?? null;
    this.editingElementId = editingElementId ?? null;
    this.editingMindmapNodeId = editingMindmapNodeId ?? null;
    this.mindmapDropTarget = mindmapDropTarget ?? null;
    this.mindmapDragPreview = mindmapDragPreview ?? null;

    // Clear
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, this.width, this.height);

    // Apply viewport transform
    ctx.setTransform(
      this.viewport.zoom * dpr, 0,
      0, this.viewport.zoom * dpr,
      this.viewport.x * dpr, this.viewport.y * dpr,
    );

    // Grid
    if (showGrid) {
      this.renderGrid(gridSize);
    }

    // Elements
    for (const el of elements) {
      this.renderElement(el, selectedIds.includes(el.id));
    }

    // Active element being drawn
    if (activeElement) {
      this.renderElement(activeElement, false);
    }

    this.renderConnectionPoints(elements, hoveredElementId ?? null, activeDrawingTool ?? null, hoveredConnectionElementId);

    // Selection box (rubber-band)
    if (selectionBox) {
      this.renderSelectionRect(selectionBox);
    }

    // Selection highlights
    for (const el of elements) {
      if (selectedIds.includes(el.id)) {
        if (this.editingElementId === el.id) {
          continue;
        }
        // Skip outer bounding box for mindmap when a node is selected
        if (el.type === 'mindmap' && this.selectedMindmapNode?.elementId === el.id) {
          continue;
        }
        this.renderSelectionBox(el);
      }
    }

    if (this.mindmapDragPreview) {
      this.renderMindmapDragPreview(this.mindmapDragPreview);
    }

    // Snap guides
    if (snapGuides && snapGuides.length > 0) {
      this.renderSnapGuides(snapGuides);
    }
  }

  renderConnectionPoints(
    elements: Element[],
    hoveredElementId: string | null,
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

    if (targetIds.size === 0) return;

    const ctx = this.ctx;
    ctx.save();
    for (const id of targetIds) {
      const el = elements.find(e => e.id === id);
      if (!el || !isConnectableElement(el)) continue;

      const points = getElementConnectionPoints(el);
      for (const [px, py] of points) {
        ctx.beginPath();
        ctx.arc(px, py, 5 / this.viewport.zoom, 0, Math.PI * 2);
        ctx.fillStyle = '#3370FF';
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2 / this.viewport.zoom;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private renderSnapGuides(guides: Array<{ type: 'vertical' | 'horizontal'; position: number }>) {
    const ctx = this.ctx;
    const vp = this.viewport;

    ctx.save();
    ctx.strokeStyle = '#FF6B6B';
    ctx.lineWidth = 1 / vp.zoom;
    ctx.setLineDash([4 / vp.zoom, 4 / vp.zoom]);

    const extent = 10000; // Large enough to cover visible area

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

  renderElement(el: Element, _isSelected: boolean) {
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
    const path = createShapePath(variant, el.x, el.y, el.width, el.height, el.roundness ?? 8);

    if (el.backgroundColor && el.backgroundColor !== 'transparent') {
      ctx.fillStyle = el.backgroundColor;
      ctx.fill(path);
    }

    if (el.strokeWidth > 0) {
      ctx.strokeStyle = el.strokeColor;
      ctx.lineWidth = el.strokeWidth;
      this.applyStrokeStyle(ctx, el.strokeStyle);
      ctx.stroke(path);
      renderShapeDecoration(ctx, variant, el.x, el.y, el.width, el.height);
    }

    this.renderShapeText(el);
  }

  private renderLinear(el: Element) {
    if (el.type !== 'line' && el.type !== 'arrow') return;
    const ctx = this.ctx;
    const linear = el as LinearElement;
    const pts = getLinearAbsolutePoints(linear, this.sceneElements);
    if (pts.length < 2) return;

    ctx.strokeStyle = el.strokeColor;
    ctx.lineWidth = el.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this.applyStrokeStyle(ctx, el.strokeStyle);

    const shape = linear.connectorShape || 'straight';

    ctx.beginPath();

    if (shape === 'curve' && pts.length >= 2) {
      // Bezier curve
      ctx.moveTo(pts[0][0], pts[0][1]);
      if (pts.length === 2) {
        // Single bezier with auto control points
        const dx = pts[1][0] - pts[0][0];
        const dy = pts[1][1] - pts[0][1];
        const offset = Math.min(Math.abs(dx), Math.abs(dy)) * 0.4;
        const cp1x = pts[0][0] + dx * 0.25 + (Math.abs(dy) > Math.abs(dx) ? offset : 0);
        const cp1y = pts[0][1] + dy * 0.25 + (Math.abs(dx) > Math.abs(dy) ? offset : 0);
        const cp2x = pts[1][0] - dx * 0.25 + (Math.abs(dy) > Math.abs(dx) ? offset : 0);
        const cp2y = pts[1][1] - dy * 0.25 + (Math.abs(dx) > Math.abs(dy) ? offset : 0);
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, pts[1][0], pts[1][1]);
      } else {
        // Multiple points: use quadratic curves through midpoints
        for (let i = 1; i < pts.length - 1; i++) {
          const midX = (pts[i][0] + pts[i + 1][0]) / 2;
          const midY = (pts[i][1] + pts[i + 1][1]) / 2;
          ctx.quadraticCurveTo(pts[i][0], pts[i][1], midX, midY);
        }
        ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      }
    } else if (shape === 'right_angled_polyline' && pts.length >= 2) {
      // Right-angled polyline (step connector)
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1];
        const curr = pts[i];
        const midX = (prev[0] + curr[0]) / 2;
        ctx.lineTo(midX, prev[1]);
        ctx.lineTo(midX, curr[1]);
        ctx.lineTo(curr[0], curr[1]);
      }
    } else {
      // Straight or polyline
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i][0], pts[i][1]);
      }
    }
    ctx.stroke();

    // Draw arrow heads
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

    ctx.beginPath();
    ctx.moveTo(el.x + el.points[0][0], el.y + el.points[0][1]);

    for (let i = 1; i < el.points.length; i++) {
      ctx.lineTo(el.x + el.points[i][0], el.y + el.points[i][1]);
    }

    ctx.strokeStyle = el.strokeColor;
    ctx.lineWidth = el.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  private renderHighlighter(el: Element) {
    if (el.type !== 'highlighter') return;
    const ctx = this.ctx;

    if (el.points.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(el.x + el.points[0][0], el.y + el.points[0][1]);

    for (let i = 1; i < el.points.length; i++) {
      ctx.lineTo(el.x + el.points[i][0], el.y + el.points[i][1]);
    }

    ctx.strokeStyle = el.highlightColor;
    ctx.lineWidth = el.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'multiply';
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
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

    // Text (skip if being edited - textarea overlay handles it)
    if (el.text && this.editingElementId !== el.id) {
      ctx.fillStyle = '#1B1B1F';
      ctx.font = `${el.fontSize}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const padding = 12;
      const lines = this.wrapText(el.text, el.width - padding * 2, ctx);
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

  // Layout cache: node id -> { x, y, w, h } (avoids mutating frozen immer state)
  private nodeLayout = new Map<string, { x: number; y: number; w: number; h: number }>();

  private renderMindmap(el: MindmapElement) {
    if (!el.rootNode) return;
    this.nodeLayout.clear();
    this.layoutMindmapNodes(el);
    this.drawMindmapConnections(el, el.rootNode);
    this.drawMindmapNode(el, el.rootNode);
  }

  private isDraggedMindmapNode(elementId: string, nodeId: string) {
    return this.mindmapDragPreview?.elementId === elementId
      && this.mindmapDragPreview.sourceNodeId === nodeId;
  }

  private getNodeRect(node: MindmapNode, fallbackX: number, fallbackY: number) {
    const cached = this.nodeLayout.get(node.id);
    return cached ?? { x: fallbackX, y: fallbackY, w: 60, h: 30 };
  }

  private layoutMindmapNodes(el: MindmapElement) {
    const hGap = 60;
    const vGap = 20;
    const root = el.rootNode;
    const layout = this.nodeLayout;

    const measureNode = (node: MindmapNode): { w: number; h: number } => {
      this.ctx.font = `${node.fontSize}px Inter, system-ui, sans-serif`;
      const textWidth = this.ctx.measureText(node.text || '主题').width;
      const padding = node.nodeShape === 'text' ? 8 : 20;
      return {
        w: Math.max(textWidth + padding * 2, 60),
        h: node.fontSize * 1.5 + (node.nodeShape === 'text' ? 4 : 16),
      };
    };

    const getSubtreeHeight = (node: MindmapNode): number => {
      const children = node.collapsed ? [] : node.children;
      const size = measureNode(node);
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
      const size = measureNode(node);
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
      const size = measureNode(root);
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
  }

  private drawMindmapConnections(el: MindmapElement, node: MindmapNode) {
    if (this.isDraggedMindmapNode(el.id, node.id)) return;
    const ctx = this.ctx;
    const nr = this.getNodeRect(node, el.x, el.y);

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
      const cr = this.getNodeRect(child, 0, 0);
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
      this.drawMindmapConnections(el, child);
    }
    ctx.setLineDash([]);
  }

  private drawMindmapNode(el: MindmapElement, node: MindmapNode) {
    if (this.isDraggedMindmapNode(el.id, node.id)) return;
    const ctx = this.ctx;
    const { x, y, w, h } = this.getNodeRect(node, el.x, el.y);
    const isSelectedNode = this.selectedMindmapNode?.elementId === el.id
      && this.selectedMindmapNode.nodeId === node.id
      && this.editingMindmapNodeId !== node.id;
    const isDropTargetNode = this.mindmapDropTarget?.elementId === el.id
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
      this.drawMindmapNode(el, child);
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
    this.nodeLayout.clear();
    this.layoutMindmapNodes(projectedElement);
    return this.nodeLayout.get(sourceNodeId) ?? null;
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

  private getShiftedNodeRect(node: MindmapNode, fallbackX: number, fallbackY: number, dx: number, dy: number) {
    const rect = this.getNodeRect(node, fallbackX, fallbackY);
    return { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h };
  }

  private drawMindmapGhostConnections(el: MindmapElement, node: MindmapNode, dx: number, dy: number) {
    const ctx = this.ctx;
    const nr = this.getShiftedNodeRect(node, el.x, el.y, dx, dy);

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
      const cr = this.getShiftedNodeRect(child, 0, 0, dx, dy);
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
      this.drawMindmapGhostConnections(el, child, dx, dy);
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

  private drawMindmapGhostSubtree(el: MindmapElement, node: MindmapNode, dx: number, dy: number) {
    const { x, y, w, h } = this.getShiftedNodeRect(node, el.x, el.y, dx, dy);
    this.drawMindmapGhostNode(node, x, y, w, h);

    const allChildren = [
      ...(node.collapsed ? [] : node.children),
      ...(node.collapsed ? [] : (node.leftChildren || [])),
      ...(node.collapsed ? [] : (node.rightChildren || [])),
    ];

    for (const child of allChildren) {
      this.drawMindmapGhostSubtree(el, child, dx, dy);
    }
  }

  private renderMindmapDragPreview(preview: { elementId: string; sourceNodeId: string; pointerX: number; pointerY: number; offsetX: number; offsetY: number }) {
    const element = this.sceneElements.find((candidate) => candidate.id === preview.elementId);
    if (!element || element.type !== 'mindmap') return;

    this.nodeLayout.clear();
    this.layoutMindmapNodes(element as MindmapElement);

    const sourceNode = this.findMindmapNode((element as MindmapElement).rootNode, preview.sourceNodeId);
    const sourceRect = this.nodeLayout.get(preview.sourceNodeId);
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
    this.drawMindmapGhostConnections(element as MindmapElement, sourceNode, dx, dy);
    this.drawMindmapGhostSubtree(element as MindmapElement, sourceNode, dx, dy);
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

  private renderSelectionBox(el: Element) {
    const ctx = this.ctx;
    const padding = 4;
    const isLinear = el.type === 'line' || el.type === 'arrow';
    const bounds = isLinear
      ? getLinearBounds(el as LinearElement, this.sceneElements)
      : { x: el.x, y: el.y, width: el.width, height: el.height };

    ctx.save();
    ctx.strokeStyle = THEME.selected;
    ctx.lineWidth = 1.5 / this.viewport.zoom;
    ctx.setLineDash([]);

    ctx.strokeRect(
      bounds.x - padding, bounds.y - padding,
      bounds.width + padding * 2, bounds.height + padding * 2,
    );

    // Draw handles
    const handleSize = 8 / this.viewport.zoom;
    const hs = handleSize / 2;
    if (isLinear) {
      const points = getLinearAbsolutePoints(el as LinearElement, this.sceneElements);
      const endpoints = [points[0], points[points.length - 1]].filter(Boolean) as [number, number][];
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = THEME.selected;
      for (const [hx, hy] of endpoints) {
        ctx.fillRect(hx - hs, hy - hs, handleSize, handleSize);
        ctx.strokeRect(hx - hs, hy - hs, handleSize, handleSize);
      }
      ctx.restore();
      return;
    }

    const handles = [
      [bounds.x, bounds.y],
      [bounds.x + bounds.width / 2, bounds.y],
      [bounds.x + bounds.width, bounds.y],
      [bounds.x + bounds.width, bounds.y + bounds.height / 2],
      [bounds.x + bounds.width, bounds.y + bounds.height],
      [bounds.x + bounds.width / 2, bounds.y + bounds.height],
      [bounds.x, bounds.y + bounds.height],
      [bounds.x, bounds.y + bounds.height / 2],
    ];

    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = THEME.selected;
    ctx.lineWidth = 1.5 / this.viewport.zoom;

    for (const [hx, hy] of handles) {
      ctx.fillRect(hx - hs, hy - hs, handleSize, handleSize);
      ctx.strokeRect(hx - hs, hy - hs, handleSize, handleSize);
    }

    ctx.restore();
  }

  private wrapText(text: string, maxWidth: number, ctx: CanvasRenderingContext2D): string[] {
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

    this.nodeLayout.clear();
    this.layoutMindmapNodes(el);

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
      const rect = this.nodeLayout.get(node.id);
      if (!rect) continue;
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
        return node;
      }
    }

    return null;
  }

  getMindmapNodeRect(el: MindmapElement, nodeId: string): { x: number; y: number; w: number; h: number } | null {
    if (!el.rootNode) return null;
    this.nodeLayout.clear();
    this.layoutMindmapNodes(el);
    return this.nodeLayout.get(nodeId) ?? null;
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
