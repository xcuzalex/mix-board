import type { Binding, Element, LinearElement } from '../types/element';

const CONNECTABLE_TYPES = new Set([
  'rectangle',
  'ellipse',
  'diamond',
  'triangle',
  'text',
  'sticky_note',
  'image',
  'section',
  'frame',
  'mindmap',
]);

const FOCUS_POINTS = 7;

export function isConnectableElement(element: Element): boolean {
  return CONNECTABLE_TYPES.has(element.type);
}

export function getConnectionPoints(element: Element): [number, number][] {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const left = element.x;
  const right = element.x + element.width;
  const top = element.y;
  const bottom = element.y + element.height;

  return [
    [cx, top],
    [right, top],
    [right, cy],
    [right, bottom],
    [cx, bottom],
    [left, bottom],
    [left, cy],
    [left, top],
  ];
}

export function getConnectionPointFromBinding(
  elements: Element[],
  binding: Binding | null,
): [number, number] | null {
  if (!binding) return null;
  const element = elements.find((candidate) => candidate.id === binding.elementId);
  if (!element || !isConnectableElement(element)) return null;
  return getConnectionPointFromFocus(element, binding.focus);
}

export function getConnectionPointFromFocus(
  element: Element,
  focus: number,
): [number, number] {
  const points = getConnectionPoints(element);
  const index = Math.max(0, Math.min(points.length - 1, Math.round(focus * FOCUS_POINTS)));
  return points[index];
}

export function findNearestBindableElement(
  elements: Element[],
  px: number,
  py: number,
  threshold: number,
): { element: Element; point: [number, number]; focus: number } | null {
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const element = elements[i];
    if (!isConnectableElement(element)) continue;

    const points = getConnectionPoints(element);
    let bestIndex = -1;
    let bestDistance = threshold;

    for (let index = 0; index < points.length; index += 1) {
      const [cx, cy] = points[index];
      const distance = Math.hypot(px - cx, py - cy);
      if (distance <= bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    if (bestIndex >= 0) {
      return {
        element,
        point: points[bestIndex],
        focus: bestIndex / FOCUS_POINTS,
      };
    }
  }

  return null;
}

export function getLinearAbsolutePoints(
  element: LinearElement,
  elements: Element[],
): [number, number][] {
  const points = element.points.map(
    ([pointX, pointY]) => [element.x + pointX, element.y + pointY] as [number, number],
  );

  if (points.length === 0) return points;

  const start = getConnectionPointFromBinding(elements, element.startBinding);
  const end = getConnectionPointFromBinding(elements, element.endBinding);

  if (start) {
    points[0] = start;
  }
  if (end) {
    points[points.length - 1] = end;
  }

  return points;
}

export function normalizeLinearPoints(points: [number, number][]): Pick<LinearElement, 'x' | 'y' | 'width' | 'height' | 'points'> {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    points: points.map(([x, y]) => [x - minX, y - minY] as [number, number]),
  };
}

export function getLinearBounds(
  element: LinearElement,
  elements: Element[],
): { x: number; y: number; width: number; height: number } {
  const points = getLinearAbsolutePoints(element, elements);
  if (points.length === 0) {
    return {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    };
  }

  const normalized = normalizeLinearPoints(points);
  return {
    x: normalized.x,
    y: normalized.y,
    width: normalized.width,
    height: normalized.height,
  };
}
