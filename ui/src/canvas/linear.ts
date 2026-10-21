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

export interface ConnectionAnchorDescriptor {
  elementId: string;
  focus: number;
  index: number;
  point: [number, number];
  normal: [number, number];
}

export interface BindableElementMatch {
  element: Element;
  point: [number, number];
  focus: number;
  index: number;
  normal: [number, number];
  distance: number;
  distanceSq: number;
  fromDistanceSq: number;
}

export interface StickyBindingSearchOptions {
  acquireThreshold: number;
  releaseThreshold: number;
  fromPoint?: [number, number];
  currentBinding?: Binding | null;
  marginalImprovement?: number;
}

export interface SceneIndex {
  version: number;
  elements: Element[];
  byId: Map<string, Element>;
  connectionPoints: Map<Element, [number, number][]>;
  linearAbsolutePoints: Map<LinearElement, [number, number][]>;
  linearBounds: Map<LinearElement, { x: number; y: number; width: number; height: number }>;
}

type SceneLookup = Element[] | SceneIndex;

export function createSceneIndex(elements: Element[], version = 0): SceneIndex {
  return {
    version,
    elements,
    byId: new Map(elements.map((element) => [element.id, element])),
    connectionPoints: new Map(),
    linearAbsolutePoints: new Map(),
    linearBounds: new Map(),
  };
}

function isSceneIndex(value: SceneLookup): value is SceneIndex {
  return 'byId' in value;
}

function resolveSceneIndex(scene: SceneLookup): SceneIndex {
  return isSceneIndex(scene) ? scene : createSceneIndex(scene);
}

function getSceneElements(scene: SceneLookup): Element[] {
  return isSceneIndex(scene) ? scene.elements : scene;
}

function getSceneElementById(scene: SceneLookup, elementId: string): Element | undefined {
  if (isSceneIndex(scene)) {
    return scene.byId.get(elementId);
  }
  return scene.find((candidate) => candidate.id === elementId);
}

function getStickyRebindingMargin(
  acquireThreshold: number,
  releaseThreshold: number,
  marginalImprovement?: number,
): number {
  if (typeof marginalImprovement === 'number' && Number.isFinite(marginalImprovement)) {
    return Math.max(0, marginalImprovement);
  }

  const minThreshold = Math.max(0, Math.min(acquireThreshold, releaseThreshold));
  const thresholdSpan = Math.max(0, releaseThreshold - acquireThreshold);

  return Math.max(minThreshold * 0.2, thresholdSpan * 0.5);
}

const ANCHOR_NORMALS: [number, number][] = [
  [0, -1],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [1, 0],
  [Math.SQRT1_2, Math.SQRT1_2],
  [0, 1],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [-1, 0],
  [-Math.SQRT1_2, -Math.SQRT1_2],
];

export function isConnectableElement(element: Element): boolean {
  return CONNECTABLE_TYPES.has(element.type);
}

export function getConnectionPoints(element: Element, scene?: SceneLookup): [number, number][] {
  const cached = scene && isSceneIndex(scene) ? scene.connectionPoints.get(element) : undefined;
  if (cached) return cached;

  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const left = element.x;
  const right = element.x + element.width;
  const top = element.y;
  const bottom = element.y + element.height;

  const points: [number, number][] = [
    [cx, top],
    [right, top],
    [right, cy],
    [right, bottom],
    [cx, bottom],
    [left, bottom],
    [left, cy],
    [left, top],
  ];

  if (scene && isSceneIndex(scene)) {
    scene.connectionPoints.set(element, points);
  }

  return points;
}

export function getConnectionPointIndexFromFocus(focus: number): number {
  return Math.max(0, Math.min(FOCUS_POINTS, Math.round(focus * FOCUS_POINTS)));
}

export function getConnectionFocusFromIndex(index: number): number {
  return Math.max(0, Math.min(FOCUS_POINTS, index)) / FOCUS_POINTS;
}

export function getAnchorNormalFromIndex(index: number): [number, number] {
  return ANCHOR_NORMALS[Math.max(0, Math.min(ANCHOR_NORMALS.length - 1, index))];
}

export function getAnchorNormalFromFocus(focus: number): [number, number] {
  return getAnchorNormalFromIndex(getConnectionPointIndexFromFocus(focus));
}

export function getConnectionAnchorFromFocus(
  element: Element,
  focus: number,
  scene?: SceneLookup,
): ConnectionAnchorDescriptor {
  const index = getConnectionPointIndexFromFocus(focus);
  return {
    elementId: element.id,
    focus: getConnectionFocusFromIndex(index),
    index,
    point: getConnectionPoints(element, scene)[index],
    normal: getAnchorNormalFromIndex(index),
  };
}

export function getConnectionAnchorFromBinding(
  scene: SceneLookup,
  binding: Binding | null,
): ConnectionAnchorDescriptor | null {
  if (!binding) return null;
  const element = getSceneElementById(scene, binding.elementId);
  if (!element || !isConnectableElement(element)) return null;
  return getConnectionAnchorFromFocus(element, binding.focus, scene);
}

export function findNearestConnectionAnchor(
  element: Element,
  px: number,
  py: number,
  threshold: number,
  fromPoint?: [number, number],
): ConnectionAnchorDescriptor | null {
  const match = findBestAnchorMatchInElement(element, px, py, threshold, fromPoint);
  if (!match) return null;
  return {
    elementId: match.element.id,
    focus: match.focus,
    index: match.index,
    point: match.point,
    normal: match.normal,
  };
}

export function getConnectionPointFromBinding(
  scene: SceneLookup,
  binding: Binding | null,
): [number, number] | null {
  return getConnectionAnchorFromBinding(scene, binding)?.point ?? null;
}


function findBestAnchorMatchInElement(
  element: Element,
  px: number,
  py: number,
  threshold: number,
  fromPoint?: [number, number],
  scene?: SceneLookup,
): BindableElementMatch | null {
  const thresholdSq = threshold * threshold;
  const points = getConnectionPoints(element, scene);

  let bestIndex = -1;
  let bestDistanceSq = thresholdSq;
  let bestFromDistanceSq = Number.POSITIVE_INFINITY;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const dx = px - point[0];
    const dy = py - point[1];
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq > bestDistanceSq) continue;

    const fromDistanceSq = fromPoint
      ? (fromPoint[0] - point[0]) * (fromPoint[0] - point[0]) +
        (fromPoint[1] - point[1]) * (fromPoint[1] - point[1])
      : 0;

    if (
      distanceSq < bestDistanceSq ||
      (distanceSq === bestDistanceSq && fromDistanceSq <= bestFromDistanceSq)
    ) {
      bestDistanceSq = distanceSq;
      bestFromDistanceSq = fromDistanceSq;
      bestIndex = index;
    }
  }

  if (bestIndex < 0) return null;

  return {
    element,
    point: points[bestIndex],
    focus: getConnectionFocusFromIndex(bestIndex),
    index: bestIndex,
    normal: getAnchorNormalFromIndex(bestIndex),
    distance: Math.sqrt(bestDistanceSq),
    distanceSq: bestDistanceSq,
    fromDistanceSq: bestFromDistanceSq,
  };
}

function resolveCurrentBindingMatch(
  scene: SceneLookup,
  px: number,
  py: number,
  fromPoint: [number, number] | undefined,
  currentBinding: Binding | null | undefined,
): BindableElementMatch | null {
  if (!currentBinding) return null;
  const element = getSceneElementById(scene, currentBinding.elementId);
  if (!element || !isConnectableElement(element)) return null;

  const anchor = getConnectionAnchorFromFocus(element, currentBinding.focus, scene);
  const dx = px - anchor.point[0];
  const dy = py - anchor.point[1];
  const distanceSq = dx * dx + dy * dy;

  return {
    element,
    point: anchor.point,
    focus: anchor.focus,
    index: anchor.index,
    normal: anchor.normal,
    distance: Math.sqrt(distanceSq),
    distanceSq,
    fromDistanceSq: fromPoint
      ? (fromPoint[0] - anchor.point[0]) * (fromPoint[0] - anchor.point[0]) +
        (fromPoint[1] - anchor.point[1]) * (fromPoint[1] - anchor.point[1])
      : 0,
  };
}

export function findBindableElementWithStickyPreference(
  scene: SceneLookup,
  px: number,
  py: number,
  options: StickyBindingSearchOptions,
): BindableElementMatch | null {
  const {
    acquireThreshold,
    releaseThreshold,
    fromPoint,
    currentBinding,
    marginalImprovement,
  } = options;
  const stickyRebindingMargin = getStickyRebindingMargin(
    acquireThreshold,
    releaseThreshold,
    marginalImprovement,
  );

  let bestAcquire: BindableElementMatch | null = null;

  const elements = getSceneElements(scene);

  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const element = elements[i];
    if (!isConnectableElement(element)) continue;

    const left = element.x;
    const right = element.x + element.width;
    const top = element.y;
    const bottom = element.y + element.height;
    const maxThreshold = Math.max(acquireThreshold, releaseThreshold);

    if (
      px < left - maxThreshold ||
      px > right + maxThreshold ||
      py < top - maxThreshold ||
      py > bottom + maxThreshold
    ) {
      continue;
    }

    const candidate = findBestAnchorMatchInElement(
      element,
      px,
      py,
      acquireThreshold,
      fromPoint,
      scene,
    );
    if (!candidate) continue;

    if (
      !bestAcquire ||
      candidate.distanceSq < bestAcquire.distanceSq ||
      (candidate.distanceSq === bestAcquire.distanceSq && candidate.fromDistanceSq <= bestAcquire.fromDistanceSq)
    ) {
      bestAcquire = candidate;
    }
  }

  const current = resolveCurrentBindingMatch(scene, px, py, fromPoint, currentBinding);
  if (!current || current.distanceSq > releaseThreshold * releaseThreshold) {
    return bestAcquire;
  }

  if (!bestAcquire) {
    return current;
  }

  if (bestAcquire.element.id === current.element.id && bestAcquire.index === current.index) {
    return current;
  }

  if (current.distance <= bestAcquire.distance + stickyRebindingMargin) {
    return current;
  }

  return bestAcquire;
}


export function getLinearAbsolutePoints(
  element: LinearElement,
  scene: SceneLookup,
): [number, number][] {
  const sceneIndex = resolveSceneIndex(scene);
  const cached = sceneIndex.linearAbsolutePoints.get(element);
  if (cached) return cached;

  const points = element.points.map(
    ([pointX, pointY]) => [element.x + pointX, element.y + pointY] as [number, number],
  );

  if (points.length === 0) {
    sceneIndex.linearAbsolutePoints.set(element, points);
    return points;
  }

  const start = getConnectionPointFromBinding(sceneIndex, element.startBinding);
  const end = getConnectionPointFromBinding(sceneIndex, element.endBinding);

  if (start) {
    points[0] = start;
  }
  if (end) {
    points[points.length - 1] = end;
  }

  sceneIndex.linearAbsolutePoints.set(element, points);
  return points;
}

export function normalizeLinearPoints(points: [number, number][]): Pick<LinearElement, 'x' | 'y' | 'width' | 'height' | 'points'> {
  if (points.length === 0) {
    return {
      x: Number.POSITIVE_INFINITY,
      y: Number.POSITIVE_INFINITY,
      width: Number.NEGATIVE_INFINITY,
      height: Number.NEGATIVE_INFINITY,
      points: [],
    };
  }

  let minX = points[0][0];
  let maxX = minX;
  let minY = points[0][1];
  let maxY = minY;

  for (let index = 1; index < points.length; index += 1) {
    const [x, y] = points[index];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const normalizedPoints = new Array<[number, number]>(points.length);
  for (let index = 0; index < points.length; index += 1) {
    const [x, y] = points[index];
    normalizedPoints[index] = [x - minX, y - minY];
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    points: normalizedPoints,
  };
}

export function getLinearBounds(
  element: LinearElement,
  scene: SceneLookup,
): { x: number; y: number; width: number; height: number } {
  const sceneIndex = resolveSceneIndex(scene);
  const cached = sceneIndex.linearBounds.get(element);
  if (cached) return cached;

  const { points } = element;
  if (points.length === 0) {
    const bounds = {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    };
    sceneIndex.linearBounds.set(element, bounds);
    return bounds;
  }

  const absolutePoints = getLinearAbsolutePoints(element, sceneIndex);
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;

  for (let index = 0; index < points.length; index += 1) {
    const [x, y] = absolutePoints[index];

    if (index === 0) {
      minX = x;
      maxX = x;
      minY = y;
      maxY = y;
      continue;
    }

    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const bounds = {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
  sceneIndex.linearBounds.set(element, bounds);
  return bounds;
}
