/**
 * Overlay chrome drawing — the non-element decorations painted on the overlay
 * layer: background grid, snap guides, the drag-select rectangle, and the lasso
 * highlight. Extracted from renderer.ts (P0.B).
 *
 * Pure drawing functions. Scene/viewport state is threaded in; `getMindmapBounds`
 * is injected because it depends on the Renderer's layout cache.
 */
import type { Element, LinearElement, MindmapElement } from '../../types/element';
import type { SnapGuide } from '../../utils/math';
import { getLinearBounds, type SceneIndex } from '../linear';
import type { Viewport } from '../viewport';
import { THEME } from '../../utils/color';
import { canvasTheme } from '../canvas-theme';

type Box = { x: number; y: number; width: number; height: number };
type Bounds = { x: number; y: number; width: number; height: number };

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  gridSize: number,
  vp: Viewport,
  width: number,
  height: number,
) {
  const startX = Math.floor(-vp.x / vp.zoom / gridSize) * gridSize;
  const startY = Math.floor(-vp.y / vp.zoom / gridSize) * gridSize;
  const endX = startX + width / vp.zoom + gridSize;
  const endY = startY + height / vp.zoom + gridSize;

  ctx.strokeStyle = canvasTheme.grid;
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

export function drawSelectionRect(ctx: CanvasRenderingContext2D, box: Box, zoom: number) {
  ctx.save();
  ctx.fillStyle = 'rgba(105, 101, 219, 0.08)';
  ctx.fillRect(box.x, box.y, box.width, box.height);
  ctx.strokeStyle = THEME.selected;
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([4 / zoom, 4 / zoom]);
  ctx.strokeRect(box.x, box.y, box.width, box.height);
  ctx.restore();
}

export function drawSnapGuides(
  ctx: CanvasRenderingContext2D,
  guides: SnapGuide[],
  vp: Viewport,
  width: number,
  height: number,
  sceneIndex: SceneIndex,
) {
  const extent = 10000; // Large enough to cover visible area

  ctx.save();

  // 1. Draw dashed guide lines
  ctx.strokeStyle = '#6965db';
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
  const vpLeft = -vp.x / vp.zoom;
  const vpTop = -vp.y / vp.zoom;
  const vpRight = vpLeft + width / vp.zoom;
  const vpBottom = vpTop + height / vp.zoom;
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
    ctx.fillStyle = '#6965db';
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1 / vp.zoom;
    ctx.stroke();
  }

  // 3. Draw edge highlights on target elements
  ctx.strokeStyle = '#6965db';
  ctx.lineWidth = 2.5 / vp.zoom;

  for (const guide of guides) {
    if (!guide.targetElementId || !guide.targetEdge) continue;
    const targetEl = sceneIndex.byId.get(guide.targetElementId);
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

export function drawLassoHighlight(
  ctx: CanvasRenderingContext2D,
  el: Element,
  vp: Viewport,
  sceneIndex: SceneIndex,
  getMindmapBounds: (el: MindmapElement) => Bounds,
) {
  ctx.save();

  if (el.angle !== 0) {
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(el.angle);
    ctx.translate(-cx, -cy);
  }

  if (el.type === 'line' || el.type === 'arrow') {
    const bounds = getLinearBounds(el as LinearElement, sceneIndex);
    ctx.fillStyle = 'rgba(105, 101, 219, 0.12)';
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.strokeStyle = 'rgba(105, 101, 219, 0.3)';
    ctx.lineWidth = 1 / vp.zoom;
    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
  } else if (el.type === 'mindmap') {
    const bounds = getMindmapBounds(el as MindmapElement);
    ctx.fillStyle = 'rgba(105, 101, 219, 0.12)';
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.strokeStyle = 'rgba(105, 101, 219, 0.3)';
    ctx.lineWidth = 1 / vp.zoom;
    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
  } else {
    ctx.fillStyle = 'rgba(105, 101, 219, 0.12)';
    ctx.fillRect(el.x, el.y, el.width, el.height);
    ctx.strokeStyle = 'rgba(105, 101, 219, 0.3)';
    ctx.lineWidth = 1 / vp.zoom;
    ctx.strokeRect(el.x, el.y, el.width, el.height);
  }

  ctx.restore();
}
