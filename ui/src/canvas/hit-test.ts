import type { Element, LinearElement } from '../types/element';
import { pointInRect, pointInEllipse, pointInDiamond } from '../utils/math';
import { createSceneIndex, getLinearAbsolutePoints, getLinearBounds, type SceneIndex } from './linear';

const HIT_THRESHOLD = 4;
const SPATIAL_GRID_SIZE = 500;

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

function getElementBBox(el: Element): { x: number; y: number; width: number; height: number } {
  switch (el.type) {
    case 'line':
    case 'arrow': {
      // Conservative fallback for linear elements when SceneIndex is unavailable
      const pad = Math.max(el.width, el.height) * 2 + 200;
      return { x: el.x - pad, y: el.y - pad, width: el.width + pad * 2, height: el.height + pad * 2 };
    }
    case 'section':
    case 'frame':
      return { x: el.x - 20, y: el.y - 25, width: el.width + 40, height: el.height + 45 };
    case 'mindmap':
      return { x: el.x - 50, y: el.y - 50, width: el.width + 100, height: el.height + 100 };
    default:
      return { x: el.x, y: el.y, width: el.width, height: el.height };
  }
}

export class SpatialIndex {
  private cells = new Map<string, string[]>();
  private idSet = new Set<string>();

  constructor(elements: Element[], sceneIndex?: SceneIndex) {
    for (const el of elements) {
      let bbox: { x: number; y: number; width: number; height: number };
      if (el.type === 'line' || el.type === 'arrow') {
        if (sceneIndex) {
          bbox = getLinearBounds(el as LinearElement, sceneIndex);
        } else {
          bbox = getElementBBox(el);
        }
      } else {
        bbox = getElementBBox(el);
      }
      const minGx = Math.floor(bbox.x / SPATIAL_GRID_SIZE);
      const maxGx = Math.floor((bbox.x + bbox.width) / SPATIAL_GRID_SIZE);
      const minGy = Math.floor(bbox.y / SPATIAL_GRID_SIZE);
      const maxGy = Math.floor((bbox.y + bbox.height) / SPATIAL_GRID_SIZE);

      for (let gx = minGx; gx <= maxGx; gx++) {
        for (let gy = minGy; gy <= maxGy; gy++) {
          const key = `${gx},${gy}`;
          const list = this.cells.get(key);
          if (list) {
            list.push(el.id);
          } else {
            this.cells.set(key, [el.id]);
          }
        }
      }
      this.idSet.add(el.id);
    }
  }

  getCandidateIds(x: number, y: number): string[] {
    const gx = Math.floor(x / SPATIAL_GRID_SIZE);
    const gy = Math.floor(y / SPATIAL_GRID_SIZE);
    const result: string[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${gx + dx},${gy + dy}`;
        const list = this.cells.get(key);
        if (list) {
          result.push(...list);
        }
      }
    }
    return result;
  }

  hasElement(id: string): boolean {
    return this.idSet.has(id);
  }
}

function resolveSceneIndex(elementsOrScene: Element[] | SceneIndex): SceneIndex {
  return 'byId' in elementsOrScene ? elementsOrScene : createSceneIndex(elementsOrScene);
}

export function hitTest(
  elementsOrScene: Element[] | SceneIndex,
  x: number,
  y: number,
  spatialIndex?: SpatialIndex,
): Element | null {
  const scene = resolveSceneIndex(elementsOrScene);
  const { elements } = scene;
  const candidateIds = spatialIndex ? new Set(spatialIndex.getCandidateIds(x, y)) : null;

  // Test in reverse order (top-most first)
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (candidateIds && !candidateIds.has(el.id)) continue;
    if (!elementCouldContainPoint(el, x, y)) continue;
    if (hitTestElement(el, scene, x, y)) {
      return el;
    }
  }
  return null;
}

export function hitTestElement(el: Element, elementsOrScene: Element[] | SceneIndex, x: number, y: number): boolean {
  const scene = resolveSceneIndex(elementsOrScene);
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
      return hitTestLinear(el, scene, x, y);

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

function hitTestLinear(el: Element, scene: SceneIndex, px: number, py: number): boolean {
  if (el.type !== 'line' && el.type !== 'arrow') return false;
  const bounds = getLinearBounds(el, scene);
  const margin = HIT_THRESHOLD;
  if (
    px < bounds.x - margin ||
    px > bounds.x + bounds.width + margin ||
    py < bounds.y - margin ||
    py > bounds.y + bounds.height + margin
  ) {
    return false;
  }

  const points = getLinearAbsolutePoints(el, scene);
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
  elementsOrScene: Element[] | SceneIndex,
  x: number, y: number,
  handleSize: number,
): HandlePosition | null {
  const scene = resolveSceneIndex(elementsOrScene);
  if (el.type === 'line' || el.type === 'arrow') {
    const points = getLinearAbsolutePoints(el, scene);
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
