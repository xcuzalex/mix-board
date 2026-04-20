import type { Element } from '../types/element';
import { pointInRect, pointInEllipse, pointInDiamond } from '../utils/math';
import { getLinearAbsolutePoints } from './linear';

const HIT_THRESHOLD = 4;

/**
 * Quick bounding-box pre-check to skip elements that clearly don't contain the point.
 * This avoids expensive hit tests for elements far from the cursor.
 */
function elementCouldContainPoint(el: Element, x: number, y: number): boolean {
  const margin = 20;
  switch (el.type) {
    case 'line':
    case 'arrow':
    case 'freedraw':
    case 'highlighter':
      // These elements need generous bounding boxes
      return x >= el.x - margin && x <= el.x + el.width + margin &&
             y >= el.y - margin && y <= el.y + el.height + margin;
    case 'section':
    case 'frame':
      // These have title areas above and borders
      return x >= el.x - 20 && x <= el.x + el.width + 20 &&
             y >= el.y - 25 && y <= el.y + el.height + 20;
    case 'mindmap':
      // Mindmap elements have complex layouts, use very generous bounds
      return x >= el.x - 50 && x <= el.x + el.width + 50 &&
             y >= el.y - 50 && y <= el.y + el.height + 50;
    default:
      return x >= el.x && x <= el.x + el.width &&
             y >= el.y && y <= el.y + el.height;
  }
}

export function hitTest(elements: Element[], x: number, y: number): Element | null {
  // Test in reverse order (top-most first)
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!elementCouldContainPoint(el, x, y)) continue;
    if (hitTestElement(el, elements, x, y)) {
      return el;
    }
  }
  return null;
}

export function hitTestElement(el: Element, elements: Element[], x: number, y: number): boolean {
  switch (el.type) {
    case 'rectangle':
    case 'text':
    case 'sticky_note':
    case 'image':
      return pointInRect(x, y, el.x, el.y, el.width, el.height);

    case 'section':
    case 'frame': {
      // Only hit on border (within threshold) or title area above
      const t = 6;
      const onLeftBorder = x >= el.x - t && x <= el.x + t && y >= el.y && y <= el.y + el.height;
      const onRightBorder = x >= el.x + el.width - t && x <= el.x + el.width + t && y >= el.y && y <= el.y + el.height;
      const onTopBorder = y >= el.y - t && y <= el.y + t && x >= el.x && x <= el.x + el.width;
      const onBottomBorder = y >= el.y + el.height - t && y <= el.y + el.height + t && x >= el.x && x <= el.x + el.width;
      const onTitle = y >= el.y - 20 && y < el.y && x >= el.x && x <= el.x + el.width;
      return onLeftBorder || onRightBorder || onTopBorder || onBottomBorder || onTitle;
    }

    case 'ellipse':
      return pointInEllipse(
        x, y,
        el.x + el.width / 2, el.y + el.height / 2,
        el.width / 2, el.height / 2,
      );

    case 'diamond':
      return pointInDiamond(x, y, el.x, el.y, el.width, el.height);

    case 'triangle':
      return hitTestTriangle(el, x, y);

    case 'line':
    case 'arrow':
      return hitTestLinear(el, elements, x, y);

    case 'freedraw':
    case 'highlighter':
      return hitTestFreedraw(el, x, y);

    case 'mindmap':
    case 'table':
    default:
      return pointInRect(x, y, el.x, el.y, el.width, el.height);
  }
}

function hitTestTriangle(el: Element, px: number, py: number): boolean {
  // Simple bounding box for now
  return pointInRect(px, py, el.x, el.y, el.width, el.height);
}

function hitTestLinear(el: Element, elements: Element[], px: number, py: number): boolean {
  if (el.type !== 'line' && el.type !== 'arrow') return false;
  const points = getLinearAbsolutePoints(el, elements);
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const dist = pointToSegmentDistance(
      px, py,
      x1, y1,
      x2, y2,
    );
    if (dist < HIT_THRESHOLD) return true;
  }
  return false;
}

function hitTestFreedraw(el: Element, px: number, py: number): boolean {
  if (el.type !== 'freedraw' && el.type !== 'highlighter') return false;
  const threshold = HIT_THRESHOLD * 2;
  const points = el.points;
  // Use stride for long strokes to reduce hit test cost
  const stride = points.length > 100 ? 3 : 1;

  for (let i = 0; i < points.length; i += stride) {
    const [x, y] = points[i];
    const dist = Math.sqrt((px - (el.x + x)) ** 2 + (py - (el.y + y)) ** 2);
    if (dist < threshold) return true;
  }
  // Check the last point if skipped by stride
  if (stride > 1 && points.length > 0) {
    const lastIdx = points.length - 1;
    if (lastIdx % stride !== 0) {
      const [x, y] = points[lastIdx];
      const dist = Math.sqrt((px - (el.x + x)) ** 2 + (py - (el.y + y)) ** 2);
      if (dist < threshold) return true;
    }
  }
  return false;
}

function pointToSegmentDistance(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

// Get the resize handle at position, returns handle index or -1
export type HandlePosition = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'start' | 'end';

export function getResizeHandle(
  el: Element,
  elements: Element[],
  x: number, y: number,
  handleSize: number,
): HandlePosition | null {
  if (el.type === 'line' || el.type === 'arrow') {
    const points = getLinearAbsolutePoints(el, elements);
    if (points.length < 2) return null;
    const hs = handleSize / 2;
    const [startX, startY] = points[0];
    const [endX, endY] = points[points.length - 1];
    if (x >= startX - hs && x <= startX + hs && y >= startY - hs && y <= startY + hs) {
      return 'start';
    }
    if (x >= endX - hs && x <= endX + hs && y >= endY - hs && y <= endY + hs) {
      return 'end';
    }
    return null;
  }

  const hs = handleSize / 2;
  const handles: [HandlePosition, number, number][] = [
    ['nw', el.x, el.y],
    ['n', el.x + el.width / 2, el.y],
    ['ne', el.x + el.width, el.y],
    ['e', el.x + el.width, el.y + el.height / 2],
    ['se', el.x + el.width, el.y + el.height],
    ['s', el.x + el.width / 2, el.y + el.height],
    ['sw', el.x, el.y + el.height],
    ['w', el.x, el.y + el.height / 2],
  ];

  for (const [pos, hx, hy] of handles) {
    if (x >= hx - hs && x <= hx + hs && y >= hy - hs && y <= hy + hs) {
      return pos;
    }
  }
  return null;
}
